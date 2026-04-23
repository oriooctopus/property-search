import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";
import type { CommuteRule } from "@/components/Filters";
import { resolveCommuteRules } from "@/lib/commute-resolver";

// ---------------------------------------------------------------------------
// Shared filter logic for /api/listings/hidden/{count,unhide}.
//
// Both endpoints need to answer the same question: "of the user's hidden
// listings, which ones would currently match the active search filters?"
// That logic is centralized here so the two routes can't drift.
//
// The filter shape and SQL pushdown mirror /api/listings/search/route.ts
// (deliberately copied — not refactored — to keep this hotfix scoped). If
// the search route's filter logic changes, mirror it here too.
// ---------------------------------------------------------------------------

type Listing = Database["public"]["Tables"]["listings"]["Row"];

/**
 * Filter shape mirrored from /api/listings/search/route.ts. Kept structurally
 * identical so callers can pass the same `filters` payload to both endpoints.
 */
export interface SearchFilters {
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
  includeNaAvailableDate?: boolean;
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
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_ANON_KEY");
  }
  return createClient<Database>(url, key);
}

/**
 * Returns true when at least one filter property is "active" (i.e. would
 * actually narrow the result set). Used by callers to distinguish "matching
 * filters yields the empty set" from "no filters were provided so the answer
 * is meaningless".
 */
function hasActiveFilter(filters: SearchFilters): boolean {
  if (filters.selectedBeds && filters.selectedBeds.length > 0) return true;
  if (filters.minBaths != null) return true;
  if (filters.minRent != null) return true;
  if (filters.maxRent != null) return true;
  if (filters.maxListingAge) return true;
  if (filters.selectedSources && filters.selectedSources.length > 0) return true;
  if (filters.minYearBuilt != null) return true;
  if (filters.maxYearBuilt != null) return true;
  if (filters.minSqft != null) return true;
  if (filters.maxSqft != null) return true;
  if (filters.excludeNoSqft) return true;
  if (filters.minAvailableDate || filters.maxAvailableDate) return true;
  return false;
}

// Supabase query builder type is complex; use any locally to avoid
// fighting the chain-style return types from the SDK.
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Apply the same SQL-pushdown filter logic as the search route. Bounds are
 * intentionally NOT supported here — hidden-listing matching is global, not
 * scoped to the current viewport.
 *
 * NOTE: We intentionally DO NOT add `.is("delisted_at", null)` or the
 * `.neq("source", "facebook-marketplace")` exclusions that the search route
 * applies. The hidden-listing reset CTA should be able to clear out any
 * hidden row the user has — including ones that were since delisted — so the
 * count and the bulk-unhide mutation stay consistent with the user's mental
 * model ("unhide everything that matches my current filters").
 */
function applyFilters(q: any, filters: SearchFilters): any {
  // Beds — discrete list, with 7 = "7+"
  if (filters.selectedBeds && filters.selectedBeds.length > 0) {
    const beds = filters.selectedBeds;
    if (beds.includes(7)) {
      const others = beds.filter((b) => b !== 7);
      if (others.length > 0) {
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
      q = q.or(`baths.is.null,baths.eq.0,baths.gte.${filters.minBaths}`);
    } else {
      q = q.gte("baths", filters.minBaths);
    }
  }

  // Price (total mode only — perRoom handled in JS).
  if (filters.priceMode !== "perRoom") {
    if (filters.minRent != null) q = q.gte("price", filters.minRent);
    if (filters.maxRent != null) q = q.lte("price", filters.maxRent);
  }

  // Listing age — include NULL list_date so we don't silently hide them.
  if (filters.maxListingAge && MAX_AGE_MS[filters.maxListingAge]) {
    const cutoffIso = new Date(Date.now() - MAX_AGE_MS[filters.maxListingAge]).toISOString();
    q = q.or(`list_date.is.null,list_date.gte.${cutoffIso}`);
  }

  if (filters.selectedSources && filters.selectedSources.length > 0) {
    q = q.in("source", filters.selectedSources);
  }

  if (filters.minYearBuilt != null) q = q.gte("year_built", filters.minYearBuilt);
  if (filters.maxYearBuilt != null) q = q.lte("year_built", filters.maxYearBuilt);

  if (filters.excludeNoSqft) q = q.not("sqft", "is", null);
  if (filters.minSqft != null) q = q.gte("sqft", filters.minSqft);
  if (filters.maxSqft != null) q = q.lte("sqft", filters.maxSqft);

  if (filters.minAvailableDate || filters.maxAvailableDate) {
    const mind = filters.minAvailableDate;
    const maxd = filters.maxAvailableDate;
    if (filters.includeNaAvailableDate) {
      const clauses: string[] = ["availability_date.is.null"];
      if (mind && maxd)
        clauses.push(`and(availability_date.gte.${mind},availability_date.lte.${maxd})`);
      else if (mind) clauses.push(`availability_date.gte.${mind}`);
      else if (maxd) clauses.push(`availability_date.lte.${maxd}`);
      q = q.or(clauses.join(","));
    } else {
      q = q.not("availability_date", "is", null);
      if (mind) q = q.gte("availability_date", mind);
      if (maxd) q = q.lte("availability_date", maxd);
    }
  }

  return q;
}

/**
 * Apply the JS-side filters (perRoom price + scam filter), mirroring
 * /api/listings/search/route.ts. Kept in sync deliberately — diverging would
 * make the unhide CTA unhide listings that the search would still hide.
 */
function applyJsFilters(rows: Listing[], filters: SearchFilters): Listing[] {
  return rows.filter((l) => {
    if (l.beds !== 0 && l.price / l.beds < 800) return false;

    if (filters.priceMode === "perRoom") {
      const eff = l.price / Math.max(l.beds ?? 1, 1);
      if (filters.minRent != null && eff < filters.minRent) return false;
      if (filters.maxRent != null && eff > filters.maxRent) return false;
    }

    return true;
  });
}

interface ResolveArgs {
  /** Listing IDs from the user's `hidden_listings` table. */
  hiddenIds: number[];
  /** Active search filters (same shape as /api/listings/search). */
  filters: SearchFilters;
  /** Optional commute rules (same shape as /api/listings/search). */
  commuteRules: CommuteRule[] | null | undefined;
}

/**
 * Of the supplied `hiddenIds`, return the subset whose listings would also
 * match the supplied search filters + commute rules.
 *
 * Returns:
 *   - `number[]` — the IDs that match (may be empty).
 *   - `null`     — when no filters or commute rules were active. Callers
 *                  should treat this as "matching is meaningless" and either
 *                  fall back to `hiddenIds` (unhide route) or report `null`
 *                  to the client (count route).
 */
export async function resolveHiddenMatchingFilters(
  args: ResolveArgs,
): Promise<number[] | null> {
  const { hiddenIds, filters, commuteRules } = args;

  if (hiddenIds.length === 0) return [];

  const filtersActive = hasActiveFilter(filters);
  const commuteActive = !!(commuteRules && commuteRules.length > 0);

  if (!filtersActive && !commuteActive) {
    return null;
  }

  const supabase = getClient();

  // Resolve commute rules first so we can intersect their ID set with the
  // hidden IDs before going to SQL.
  let candidateIds: number[] = hiddenIds;
  if (commuteActive) {
    const resolved = await resolveCommuteRules(commuteRules);
    if (resolved.ids !== null) {
      if (resolved.ids.size === 0) return [];
      const filtered: number[] = [];
      for (const id of hiddenIds) {
        if (resolved.ids.has(id)) filtered.push(id);
      }
      candidateIds = filtered;
      if (candidateIds.length === 0) return [];
    }
    // resolved.ids === null → commute rules pass-through (data not yet
    // available); fall through and apply just the SQL filters.
  }

  if (!filtersActive) {
    // Commute narrowed the set but no SQL filters to apply.
    return candidateIds;
  }

  // Fetch the candidate rows in chunks (PostgREST .in() can be touchy on
  // very long lists), apply SQL filters per chunk, then JS filters on the
  // union. We only need columns the JS filter touches: id/price/beds.
  const CHUNK = 500;
  const seen = new Set<number>();
  const matchedRows: Listing[] = [];
  for (let i = 0; i < candidateIds.length; i += CHUNK) {
    const chunk = candidateIds.slice(i, i + CHUNK);
    let q: any = supabase
      .from("listings")
      .select("id, price, beds")
      .in("id", chunk);
    q = applyFilters(q, filters);
    const { data, error } = await q;
    if (error) {
      throw new Error(error.message);
    }
    for (const r of (data ?? []) as Listing[]) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        matchedRows.push(r);
      }
    }
  }

  const survived = applyJsFilters(matchedRows, filters);
  return survived.map((r) => r.id);
}
