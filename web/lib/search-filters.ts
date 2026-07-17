/**
 * Pure SQL-filter-building logic for the listings search endpoint
 * (app/api/listings/search/route.ts).
 *
 * Extracted out of route.ts into its own module because Next.js's app-router
 * route typing only permits HTTP-method exports (GET/POST/etc, config, ...)
 * from a route.ts file — exporting a plain helper function from route.ts
 * directly fails `next build`'s generated route-type check. This also makes
 * the filter logic unit-testable without a live Supabase connection (see
 * tests/search-route-availability-filter.test.ts): applyBoundsAndFilters
 * only calls chainable query-builder methods, so a stub recorder object
 * exercises it fully.
 */

export interface Bounds {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

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

// Supabase query builder type is complex; use `any` locally to avoid
// fighting the chain-style return types from the SDK (matches the
// pre-existing style this was extracted from in route.ts).
export function applyBoundsAndFilters(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q: any,
  bounds: Bounds | null | undefined,
  filters: SearchFilters,
  options: { includeDelisted?: boolean } = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  // Listing age. We always include listings with NULL list_date (Craigslist
  // and Marketplace often lack it) so the filter doesn't silently hide them.
  if (filters.maxListingAge && MAX_AGE_MS[filters.maxListingAge]) {
    const cutoffIso = new Date(Date.now() - MAX_AGE_MS[filters.maxListingAge]).toISOString();
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

  // Move-in / availability date. When a bound is set, default to EXCLUDING
  // rows with NULL availability_date so the filter doesn't silently leak
  // unknown-availability listings. Users can opt back in via
  // includeNaAvailableDate (mirrors includeNaBaths / includeNaListingAge).
  if (filters.minAvailableDate || filters.maxAvailableDate) {
    const mind = filters.minAvailableDate;
    const maxd = filters.maxAvailableDate;
    if (filters.includeNaAvailableDate) {
      // IS NULL OR within bounds
      const clauses: string[] = ["availability_date.is.null"];
      if (mind && maxd) clauses.push(`and(availability_date.gte.${mind},availability_date.lte.${maxd})`);
      else if (mind) clauses.push(`availability_date.gte.${mind}`);
      else if (maxd) clauses.push(`availability_date.lte.${maxd}`);
      q = q.or(clauses.join(","));
    } else {
      // Deliberate product rule: Craigslist's post-redesign detail pages
      // frequently don't state availability at all (unlike StreetEasy),
      // and unlike a "leave it blank" opt-in via includeNaAvailableDate,
      // the user wants date-less CL posts to ALWAYS fit an availability
      // window filter rather than be silently excluded — a CL row with no
      // stated date shouldn't be punished for CL's sparser data. This is
      // scoped to source='craigslist' only: a CL row that DOES have a
      // stated availability_date is still range-checked normally below,
      // and every other source keeps the original strict
      // NOT NULL + range-only behavior.
      const rangeClauses: string[] = ["availability_date.not.is.null"];
      if (mind) rangeClauses.push(`availability_date.gte.${mind}`);
      if (maxd) rangeClauses.push(`availability_date.lte.${maxd}`);
      const rangeClause =
        rangeClauses.length > 1 ? `and(${rangeClauses.join(",")})` : rangeClauses[0];
      q = q.or(`and(source.eq.craigslist,availability_date.is.null),${rangeClause}`);
    }
  }

  // Scam filter (matches client): per-room < $800 is spam. Keep beds=0.
  // Expressed as: beds = 0 OR price >= beds * 800. The latter is hard in
  // PostgREST so we filter in JS after fetch (it's cheap on 2000 rows).

  return q;
}
