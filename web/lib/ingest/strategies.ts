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
// Facebook Marketplace disabled to save Apify costs — re-enable when needed
// import { fetchFacebookMarketplaceListings } from "../sources/facebook-marketplace";
import { sendIngestAlert } from "./alert";

// ---------------------------------------------------------------------------
// Shared source dispatch
// ---------------------------------------------------------------------------

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY ?? "";

const NYC_PARAMS: SearchParams = { city: "New York", stateCode: "NY" };

// Below this many unique URLs discovered in Craigslist Phase 1, something is
// wrong (bot-block or a genuine anomaly) — alert rather than silently
// upserting a trickle. Real runs typically discover 1,000+ URLs.
const CL_DISCOVERY_FLOOR = 300;

/** Runs a single adapter by name. Returns raw AdapterOutput[] with source tag. */
async function runAdapter(source: ListingSource, supabase?: SupabaseClient): Promise<AdapterOutput[]> {
  switch (source) {
    case "craigslist": {
      // NOTE: do NOT pass bedroom params here. Scoping the craigslist search
      // with min/max_bedrooms made craigslist return 0 URLs to the Apify
      // scraper (bot-blocked on the parameterized search from proxy IPs), even
      // though the same URL works in a normal browser — it broke fetching
      // entirely. The pipeline's region + 2–4BR gate still filters post-scrape.
      // Brooklyn-only (Manhattan dropped) is still applied inside the adapter.
      //
      // PRICE params are safe, unlike bedroom params: verified live 2026-07-05
      // (control search 153 URLs vs min_price/max_price search 1654 URLs, both
      // SUCCEEDED — no bot-block). A generous band around the 2–4BR gate cuts
      // detail-scrapes of room-shares/scams (<$1200) and ultra-luxury (>$15k),
      // which Phase 2 pays Apify compute to visit only to be dropped by the
      // pipeline gates anyway.
      const res = await fetchCraigslistListings(
        { ...NYC_PARAMS, priceMin: 1200, priceMax: 15000 },
        { supabase },
      );
      if (res.discovered < CL_DISCOVERY_FLOOR || res.blocked) {
        const reason = res.blocked
          ? "bot-block/CAPTCHA detected on the search page"
          : "no block detected — appears to be a genuine low/zero-result day";
        console.error(
          `[Craigslist] ALERT: discovery ${res.discovered} URLs is below floor ${CL_DISCOVERY_FLOOR} (blocked=${res.blocked}). Reason: ${reason}. Continuing run — upserting whatever was found.`,
        );
        // Fire-and-forget: alert is informational, must never block the run.
        sendIngestAlert(
          "[Dwelligence] Craigslist discovery floor alert",
          `Craigslist Phase 1 discovered ${res.discovered} unique URLs (floor: ${CL_DISCOVERY_FLOOR}).\n\n` +
            `Blocked: ${res.blocked ? "YES" : "no"} — ${reason}.\n\n` +
            `The ingest run is continuing and will upsert the ${res.listings.length} new listing(s) found.`,
        ).catch(() => {});
      }
      return res.listings;
    }
    // Facebook Marketplace disabled to save Apify costs — re-enable when needed
    // case "facebook-marketplace": {
    //   const res = await fetchFacebookMarketplaceListings(NYC_PARAMS);
    //   return res.listings;
    // }
    case "facebook-marketplace":
      throw new Error("facebook-marketplace adapter is disabled — re-enable in strategies.ts and types.ts");
    case "streeteasy": {
      // "Brooklyn" resolves to the target region's neighborhood area codes
      // (TARGET_AREA_CODES in pipeline.ts), so the SE server returns only
      // in-region listings. Manhattan is intentionally not fetched.
      const boroughs = ["Brooklyn"] as const;
      const results = await Promise.all(
        boroughs.map((borough) =>
          fetchStreetEasyListings(
            { city: borough, stateCode: "NY" },
            RAPIDAPI_KEY,
          ).then((res) => ({ borough, res })),
        ),
      );
      const out: AdapterOutput[] = [];
      const allWarnings: string[] = [];
      for (const { borough, res } of results) {
        out.push(...res.listings);
        if (res.warnings.length > 0) {
          allWarnings.push(`${borough}: ${res.warnings.join("; ")}`);
        }
      }
      if (allWarnings.length > 0) {
        console.warn(`[StreetEasy] PARTIAL FETCH WARNING: ${allWarnings.join("; ")}. Returning ${out.length} partial results for upsert.`);
        // Fire-and-forget alert so partial results still get upserted
        sendIngestAlert(
          "[Dwelligence] StreetEasy partial fetch",
          `StreetEasy fetch was partial. ${out.length} listings returned.\n\nWarnings:\n${allWarnings.join("\n")}`,
        ).catch(() => {});
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
    return runAdapter(source as ListingSource, deps.supabase);
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
    return runAdapter(source as ListingSource, deps.supabase);
  }
}
