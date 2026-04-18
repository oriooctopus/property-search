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
}

interface SearchRequest {
  bounds?: Bounds | null;
  filters?: SearchFilters;
  commuteRules?: CommuteRule[] | null;
  /** When provided, restrict results to listings that appear in ANY of these wishlists. */
  wishlistIds?: string[] | null;
  limit?: number;
}

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

// Supabase query builder type is complex; use any locally to avoid
// fighting the chain-style return types from the SDK.
/* eslint-disable @typescript-eslint/no-explicit-any */

function applyBoundsAndFilters(
  q: any,
  bounds: Bounds | null | undefined,
  filters: SearchFilters,
): any {
  q = q.is("delisted_at", null);

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
    const limit = Math.min(Math.max(body.limit ?? 2000, 1), 5000);
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
          });
        }
      }
    }

    const commuteIds = effectiveIds;

    // ---- 2. Build and run the listings query.
    let rows: Listing[] = [];

    if (commuteIds === null) {
      // Page through results — PostgREST caps each response at ~1000 rows
      // regardless of .limit(), so use .range() to fetch up to `limit`.
      // The `last_update_date` + `created_at` sort can produce ties (e.g. many
      // rows with NULL last_update_date), so we add a stable tiebreaker on
      // `id` to avoid the same row appearing on consecutive pages — which
      // would produce duplicate React keys in the list.
      const PAGE_SIZE = 1000;
      const seen = new Set<number>();
      for (let page = 0; rows.length < limit; page++) {
        const from = page * PAGE_SIZE;
        const to = Math.min(from + PAGE_SIZE - 1, limit - 1);
        if (from > to) break;
        let pageQ: any = supabase
          .from("listings")
          .select("*")
          .order("last_update_date", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to);
        pageQ = applyBoundsAndFilters(pageQ, bounds, filters);
        const { data, error } = await pageQ;
        if (error) {
          console.error("[listings-search] query error:", error.message);
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
        const pageRows = (data ?? []) as Listing[];
        for (const r of pageRows) {
          if (!seen.has(r.id)) {
            seen.add(r.id);
            rows.push(r);
          }
        }
        if (pageRows.length < PAGE_SIZE) break;
      }
    } else {
      // Commute rules resolved — intersect via .in('id', …). Supabase caps
      // the length of an IN clause well above what we'll hit (tens of
      // thousands), but we'll still batch to be safe and merge.
      const ids = [...commuteIds];
      const CHUNK = 500;
      const seen = new Set<number>();
      for (let i = 0; i < ids.length && rows.length < limit; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        let chunkQ: any = supabase
          .from("listings")
          .select("*")
          .order("last_update_date", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .in("id", chunk)
          .limit(limit);
        chunkQ = applyBoundsAndFilters(chunkQ, bounds, filters);
        const { data, error } = await chunkQ;
        if (error) {
          console.error("[listings-search] chunk query error:", error.message);
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
        for (const r of (data ?? []) as Listing[]) {
          if (!seen.has(r.id)) {
            seen.add(r.id);
            rows.push(r);
          }
        }
      }
      // Re-sort after merging chunks (same order clause as the single-shot path).
      rows.sort((a, b) => {
        const ad = a.last_update_date ?? a.created_at ?? "";
        const bd = b.last_update_date ?? b.created_at ?? "";
        return bd.localeCompare(ad);
      });
      if (rows.length > limit) rows = rows.slice(0, limit);
    }

    // ---- 3. Apply the JS-side filters (perRoom pricing, scam filter).
    rows = applyJsFilters(rows, filters);

    // ---- 4. Build commute-info map restricted to the returned listings.
    const commuteInfo: Record<number, ListingCommuteMeta> = {};
    if (commuteIds !== null) {
      for (const r of rows) {
        const m = resolvedCommute.meta[r.id];
        if (m) commuteInfo[r.id] = m;
      }
    }

    return NextResponse.json({
      listings: rows,
      commuteInfo,
      total: rows.length,
      commuteMessage: resolvedCommute.message,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[listings-search] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
