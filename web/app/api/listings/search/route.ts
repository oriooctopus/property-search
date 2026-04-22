import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import type { Database } from "@/lib/types";
import type { CommuteRule } from "@/components/Filters";
import { resolveCommuteRules, type ListingCommuteMeta } from "@/lib/commute-resolver";

// ---------------------------------------------------------------------------
// Unified listings search endpoint.
//
// Applies bounds + numeric filters in SQL (so the 500/2000 row cap is shared
// across ALL active filters rather than just bounds + delisted_at), then
// intersects with commute-rule matches when present.
// ---------------------------------------------------------------------------

type Listing = Database["public"]["Tables"]["listings"]["Row"];

interface Bounds {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

interface SearchFilters {
  selectedBeds?: number[] | null;
  minBaths?: number | null;
  includeNaBaths?: boolean;
  minRent?: number | null;
  maxRent?: number | null;
  priceMode?: "total" | "perRoom";
  maxListingAge?:
    | "1h"
    | "3h"
    | "6h"
    | "12h"
    | "1d"
    | "2d"
    | "3d"
    | "1w"
    | "2w"
    | "1m"
    | null;
  selectedSources?: string[] | null;
  minYearBuilt?: number | null;
  maxYearBuilt?: number | null;
  minSqft?: number | null;
  maxSqft?: number | null;
  excludeNoSqft?: boolean;
  minAvailableDate?: string | null;
  maxAvailableDate?: string | null;
}

interface SearchRequest {
  bounds?: Bounds | null;
  filters?: SearchFilters;
  commuteRules?: CommuteRule[] | null;
  /** When provided, restrict results to listings that appear in ANY of these wishlists. */
  wishlistIds?: string[] | null;
  /**
   * Page size for offset-based pagination. Defaults to DEFAULT_PAGE_LIMIT (100).
   * Capped at MAX_PAGE_LIMIT (200) to keep payloads small. Legacy callers that
   * passed `limit: 2000` to get "everything" now receive only the first page —
   * use `offset` to paginate.
   */
  limit?: number;
  /** Offset for pagination. Defaults to 0. */
  offset?: number;
}

// Pagination bounds — initial payload is ~100 rows so the grid renders
// quickly; subsequent pages are loaded as the user scrolls. Cap each page
// at 200 to keep client-side network I/O predictable.
const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 200;

const MAX_AGE_MS: Record<string, number> = {
  "1h": 3_600_000,
  "3h": 10_800_000,
  "6h": 21_600_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "2d": 172_800_000,
  "3d": 259_200_000,
  "1w": 604_800_000,
  "2w": 1_209_600_000,
  "1m": 2_592_000_000,
};

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_ANON_KEY");
  }
  return createClient<Database>(url, key);
}

// Only fetch the columns the UI actually needs. Dropping photos (legacy),
// availability_date, external_id, last_seen_at etc. saves ~1MB+.
//
// `delisted_at` is included so wishlist-mode callers can group removed
// listings into a separate "Removed" section. For non-wishlist callers it is
// always NULL (filtered out in `applyBoundsAndFilters`) so the extra bytes
// are negligible.
const LISTING_SELECT = [
  "id", "address", "area", "price", "beds", "baths", "sqft",
  "lat", "lon", "transit_summary", "photo_urls", "url",
  "list_date", "last_update_date", "source", "year_built",
  "photos", "created_at", "availability_date", "delisted_at",
].join(", ");

// Supabase query builder type is complex; use any locally to avoid
// fighting the chain-style return types from the SDK.
/* eslint-disable @typescript-eslint/no-explicit-any */

function applyBoundsAndFilters(
  q: any,
  bounds: Bounds | null | undefined,
  filters: SearchFilters,
  options: { includeDelisted?: boolean } = {},
): any {
  if (!options.includeDelisted) {
    q = q.is("delisted_at", null);
  }
  q = q.neq("source", "facebook-marketplace");

  if (bounds) {
    q = q
      .gte("lat", bounds.latMin)
      .lte("lat", bounds.latMax)
      .gte("lon", bounds.lonMin)
      .lte("lon", bounds.lonMax);
  }

  // Beds — discrete list, with 7 = "7+"
  if (filters.selectedBeds && filters.selectedBeds.length > 0) {
    const beds = filters.selectedBeds;
    if (beds.includes(7)) {
      const others = beds.filter((b) => b !== 7);
      if (others.length > 0) {
        // bed IN (...others) OR bed >= 7
        const orClauses = [`beds.gte.7`, ...others.map((b) => `beds.eq.${b}`)];
        q = q.or(orClauses.join(","));
      } else {
        q = q.gte("beds", 7);
      }
    } else {
      q = q.in("beds", beds);
    }
  }

  // Baths
  if (filters.minBaths != null) {
    if (filters.includeNaBaths) {
      // baths IS NULL OR baths = 0 OR baths >= minBaths
      q = q.or(`baths.is.null,baths.eq.0,baths.gte.${filters.minBaths}`);
    } else {
      q = q.gte("baths", filters.minBaths);
    }
  }

  // Price — for priceMode=total we can push min/max into SQL directly.
  // For priceMode=perRoom we can't cleanly because of the beds=0 edge case
  // and divide-by-zero; we'll apply those in JS after the query.
  if (filters.priceMode !== "perRoom") {
    if (filters.minRent != null) q = q.gte("price", filters.minRent);
    if (filters.maxRent != null) q = q.lte("price", filters.maxRent);
  }

  // Listing age
  if (filters.maxListingAge && MAX_AGE_MS[filters.maxListingAge]) {
    const cutoffIso = new Date(Date.now() - MAX_AGE_MS[filters.maxListingAge]).toISOString();
    // list_date IS NULL OR list_date >= cutoff — keep null-date listings
    // visible (matches the pre-refactor client behavior on line 625).
    q = q.or(`list_date.is.null,list_date.gte.${cutoffIso}`);
  }

  // Source
  if (filters.selectedSources && filters.selectedSources.length > 0) {
    q = q.in("source", filters.selectedSources);
  }

  // Year built
  if (filters.minYearBuilt != null) q = q.gte("year_built", filters.minYearBuilt);
  if (filters.maxYearBuilt != null) q = q.lte("year_built", filters.maxYearBuilt);

  // Sqft
  if (filters.excludeNoSqft) q = q.not("sqft", "is", null);
  if (filters.minSqft != null) q = q.gte("sqft", filters.minSqft);
  if (filters.maxSqft != null) q = q.lte("sqft", filters.maxSqft);

  // Move-in / availability date. When either bound is set, exclude listings
  // with NULL availability_date (otherwise the filter would silently let
  // unknown-availability rows through).
  if (filters.minAvailableDate || filters.maxAvailableDate) {
    q = q.not("availability_date", "is", null);
    if (filters.minAvailableDate) q = q.gte("availability_date", filters.minAvailableDate);
    if (filters.maxAvailableDate) q = q.lte("availability_date", filters.maxAvailableDate);
  }

  // Scam filter (matches client): per-room < $800 is spam. Keep beds=0.
  // Expressed as: beds = 0 OR price >= beds * 800. The latter is hard in
  // PostgREST so we filter in JS after fetch (it's cheap on 2000 rows).

  return q;
}

/**
 * Apply the filters that can't be (or aren't) pushed down to SQL:
 *  - priceMode=perRoom min/max
 *  - scam filter (price-per-bed < $800)
 */
function applyJsFilters(rows: Listing[], filters: SearchFilters): Listing[] {
  return rows.filter((l) => {
    // Scam filter
    if (l.beds !== 0 && l.price / l.beds < 800) return false;

    if (filters.priceMode === "perRoom") {
      const eff = l.price / Math.max(l.beds ?? 1, 1);
      if (filters.minRent != null && eff < filters.minRent) return false;
      if (filters.maxRent != null && eff > filters.maxRent) return false;
    }

    return true;
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SearchRequest;
    const filters: SearchFilters = body.filters ?? {};
    const bounds = body.bounds ?? null;
    const limit = Math.min(
      Math.max(body.limit ?? DEFAULT_PAGE_LIMIT, 1),
      MAX_PAGE_LIMIT,
    );
    const offset = Math.max(body.offset ?? 0, 0);
    const commuteRules = body.commuteRules ?? null;
    const wishlistIds = body.wishlistIds ?? null;

    const supabase = getClient();

    // ---- 0. Resolve wishlistIds to a Set of listing_ids (if provided). Empty
    //        list → explicitly no results.
    let wishlistListingIds: Set<number> | null = null;
    if (wishlistIds !== null) {
      if (wishlistIds.length === 0) {
        return NextResponse.json({
          listings: [],
          commuteInfo: {},
          total: 0,
          commuteMessage: null,
          hasMore: false,
          nextOffset: null,
        });
      }
      const { data: items, error: itemsErr } = await supabase
        .from('wishlist_items')
        .select('listing_id')
        .in('wishlist_id', wishlistIds);
      if (itemsErr) {
        console.error('[listings-search] wishlist_items query error:', itemsErr.message);
        return NextResponse.json({ error: itemsErr.message }, { status: 500 });
      }
      wishlistListingIds = new Set(((items ?? []) as Array<{ listing_id: number }>).map((r) => r.listing_id));
      if (wishlistListingIds.size === 0) {
        return NextResponse.json({
          listings: [],
          commuteInfo: {},
          total: 0,
          commuteMessage: null,
          hasMore: false,
          nextOffset: null,
        });
      }
    }

    // ---- 1. Resolve commute rules first (if any) so we can push the ID
    //        intersection into the SQL query and avoid fetching rows the
    //        commute filter would discard anyway.
    const resolvedCommute = await resolveCommuteRules(commuteRules);

    // If commute returned an explicit empty set (rules resolved but no match),
    // short-circuit.
    if (resolvedCommute.ids !== null && resolvedCommute.ids.size === 0) {
      return NextResponse.json({
        listings: [],
        commuteInfo: {},
        total: 0,
        commuteMessage: resolvedCommute.message,
        hasMore: false,
        nextOffset: null,
      });
    }

    // Compute the effective ID filter set by intersecting commute + wishlist
    // restrictions. `null` means "no restriction from this source".
    let effectiveIds: Set<number> | null = resolvedCommute.ids;
    if (wishlistListingIds !== null) {
      if (effectiveIds === null) {
        effectiveIds = wishlistListingIds;
      } else {
        const intersected = new Set<number>();
        for (const id of effectiveIds) {
          if (wishlistListingIds.has(id)) intersected.add(id);
        }
        effectiveIds = intersected;
        if (effectiveIds.size === 0) {
          return NextResponse.json({
            listings: [],
            commuteInfo: {},
            total: 0,
            commuteMessage: resolvedCommute.message,
            hasMore: false,
            nextOffset: null,
          });
        }
      }
    }

    const commuteIds = effectiveIds;

    // In wishlist mode we want the user to see *everything* they saved,
    // including listings that have since been delisted (they'll be grouped
    // into a "Removed" section in the UI). For all other queries we keep the
    // default behavior of excluding delisted rows.
    const includeDelisted = wishlistListingIds !== null;

    // ---- 2. Build and run the listings query (offset + limit pagination).
    //
    // The `last_update_date` + `created_at` sort can produce ties (e.g. many
    // rows with NULL last_update_date), so we include a stable tiebreaker on
    // `id` to make offset pagination deterministic — the same (filters, sort)
    // combo applied with different offsets will never double-count or skip
    // rows.
    let rows: Listing[] = [];
    // Raw row count before JS-side scam / per-room filtering. We use this to
    // compute `hasMore`: if we got a full page back from Supabase there's
    // almost certainly more upstream, regardless of how many rows survived
    // JS filtering.
    let rawRowCount = 0;

    if (commuteIds === null) {
      let pageQ: any = supabase
        .from("listings")
        .select(LISTING_SELECT)
        .order("last_update_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(offset, offset + limit - 1);
      pageQ = applyBoundsAndFilters(pageQ, bounds, filters, { includeDelisted });
      const { data, error } = await pageQ;
      if (error) {
        console.error("[listings-search] query error:", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      rows = (data ?? []) as Listing[];
      rawRowCount = rows.length;
    } else {
      // Commute rules resolved — intersect via .in('id', …). We fetch all
      // matching rows across chunks, sort client-side (since .in() shuffles
      // order), then apply offset/limit to the sorted set. Commute-filtered
      // result sets are typically small (hundreds, not thousands) so this
      // is cheap.
      const ids = [...commuteIds];
      const CHUNK = 500;
      const seen = new Set<number>();
      const allRows: Listing[] = [];
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        let chunkQ: any = supabase
          .from("listings")
          .select(LISTING_SELECT)
          .order("last_update_date", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .in("id", chunk);
        chunkQ = applyBoundsAndFilters(chunkQ, bounds, filters, { includeDelisted });
        const { data, error } = await chunkQ;
        if (error) {
          console.error("[listings-search] chunk query error:", error.message);
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
        for (const r of (data ?? []) as Listing[]) {
          if (!seen.has(r.id)) {
            seen.add(r.id);
            allRows.push(r);
          }
        }
      }
      // Re-sort after merging chunks (same order clause as the single-shot path).
      allRows.sort((a, b) => {
        const ad = a.last_update_date ?? a.created_at ?? "";
        const bd = b.last_update_date ?? b.created_at ?? "";
        const cmp = bd.localeCompare(ad);
        if (cmp !== 0) return cmp;
        return a.id - b.id;
      });
      rawRowCount = Math.max(0, Math.min(limit, allRows.length - offset));
      rows = allRows.slice(offset, offset + limit);
    }

    // Did Supabase give us a full page? If so, assume there's more.
    const hasMore = rawRowCount >= limit;
    const nextOffset = hasMore ? offset + rawRowCount : null;

    // ---- 3. Apply the JS-side filters (perRoom pricing, scam filter).
    rows = applyJsFilters(rows, filters);

    // ---- 4. Trim photo_urls to max 3 per listing to reduce payload size.
    //         Full photo set is only needed in ListingDetail (fetched separately).
    const trimmedRows = rows.map((r) => ({
      ...r,
      photo_urls: (r.photo_urls ?? []).slice(0, 3),
    }));

    // ---- 5. Build commute-info map restricted to the returned listings.
    const commuteInfo: Record<number, ListingCommuteMeta> = {};
    if (commuteIds !== null) {
      for (const r of trimmedRows) {
        const m = resolvedCommute.meta[r.id];
        if (m) commuteInfo[r.id] = m;
      }
    }

    return NextResponse.json(
      {
        listings: trimmedRows,
        commuteInfo,
        // `total` is the size of *this page* after JS filtering — not the
        // full result-set size. Kept for backwards compatibility with
        // existing callers; paginated UIs should rely on `hasMore` /
        // `nextOffset` rather than accumulating `total`.
        total: trimmedRows.length,
        commuteMessage: resolvedCommute.message,
        hasMore,
        nextOffset,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[listings-search] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
