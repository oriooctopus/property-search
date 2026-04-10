/**
 * FetchStrategy implementations.
 *
 * Daily vs full refresh are injected strategies, NOT branches inside the
 * orchestrator. The orchestrator just calls `strategy.fetchSource(src, deps)`.
 *
 * - StalenessGatedFetch: honors `source_freshness` + REFRESH_STALE_HOURS.
 *   Ported from refresh-sources.ts.
 * - FullBisectionFetch: direct full fetches for every adapter. For StreetEasy
 *   it delegates to lib/sources/streeteasy-bisection.ts which performs the
 *   recursive bedroom + price bisection required to get past SE's ~1,100
 *   result-per-query cap.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdapterOutput, ListingSource, SearchParams } from "../sources/types";
import type { FetchDeps, FetchStrategy } from "./types";

import { fetchCraigslistListings } from "../sources/craigslist";
import { fetchStreetEasyListings } from "../sources/streeteasy";
import { fetchStreetEasyFullBisection } from "../sources/streeteasy-bisection";
import { fetchFacebookMarketplaceListings } from "../sources/facebook-marketplace";

// ---------------------------------------------------------------------------
// Shared source dispatch
// ---------------------------------------------------------------------------

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY ?? "";

const NYC_PARAMS: SearchParams = { city: "New York", stateCode: "NY" };

/** Runs a single adapter by name. Returns raw AdapterOutput[] with source tag. */
async function runAdapter(source: ListingSource): Promise<AdapterOutput[]> {
  switch (source) {
    case "craigslist": {
      const res = await fetchCraigslistListings(NYC_PARAMS);
      return res.listings;
    }
    case "facebook-marketplace": {
      const res = await fetchFacebookMarketplaceListings(NYC_PARAMS);
      return res.listings;
    }
    case "streeteasy": {
      const out: AdapterOutput[] = [];
      for (const borough of ["Manhattan", "Brooklyn"]) {
        const res = await fetchStreetEasyListings(
          { city: borough, stateCode: "NY" },
          RAPIDAPI_KEY,
        );
        out.push(...res.listings);
      }
      return out;
    }
    default: {
      const never: never = source;
      throw new Error(`Unknown source: ${never as string}`);
    }
  }
}

// ---------------------------------------------------------------------------
// StalenessGatedFetch
// ---------------------------------------------------------------------------

const STALE_HOURS = Number(process.env.REFRESH_STALE_HOURS) || 6;

interface FreshnessRow {
  source: string;
  city: string;
  last_scraped_at: string;
}

async function getFreshnessForSource(
  supabase: SupabaseClient,
  source: string,
): Promise<Date | null> {
  const { data, error } = await supabase
    .from("source_freshness")
    .select("source, city, last_scraped_at")
    .eq("source", source);

  if (error || !data || data.length === 0) return null;
  // Use the oldest last_scraped_at across cities — if ANY city is stale,
  // refetch the source. Matches refresh-sources.ts semantics loosely.
  let oldest: Date | null = null;
  for (const row of data as FreshnessRow[]) {
    const d = new Date(row.last_scraped_at);
    if (!oldest || d < oldest) oldest = d;
  }
  return oldest;
}

export class StalenessGatedFetch implements FetchStrategy {
  name = "staleness-gated";

  async fetchSource(
    source: string,
    deps: FetchDeps,
  ): Promise<AdapterOutput[]> {
    const oldest = await getFreshnessForSource(deps.supabase, source);
    if (oldest) {
      const ageMs = Date.now() - oldest.getTime();
      const staleMs = STALE_HOURS * 60 * 60 * 1000;
      if (ageMs < staleMs) {
        console.log(
          `[fetch] ${source}: fresh (age ${(ageMs / 3600000).toFixed(1)}h < ${STALE_HOURS}h) — skipping`,
        );
        return [];
      }
    }
    return runAdapter(source as ListingSource);
  }
}

// ---------------------------------------------------------------------------
// FullBisectionFetch
// ---------------------------------------------------------------------------

export class FullBisectionFetch implements FetchStrategy {
  name = "full-bisection";

  async fetchSource(
    source: string,
    deps: FetchDeps,
  ): Promise<AdapterOutput[]> {
    if (source === "streeteasy") {
      if (deps.dryRun) {
        console.log(
          "[fetch] streeteasy (full-bisection): dry-run — skipping actual bisection fetch",
        );
        return [];
      }
      const apifyProxyUrl = process.env.APIFY_PROXY_URL ?? "";
      return fetchStreetEasyFullBisection({ apifyProxyUrl });
    }
    // Craigslist and Facebook Marketplace don't have meaningful full-bisection
    // equivalents — they're already single-shot Apify actor runs. Fall back to
    // the normal adapter so full-bisection mode still works for them.
    return runAdapter(source as ListingSource);
  }
}
