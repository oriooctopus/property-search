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

import { fetchCraigslistListings, type PageFunctionRunner } from "../sources/craigslist";
import { createLocalRunner, type LocalCraigslistRunner } from "../sources/craigslist-local";
import { PRICE_MAX, PRICE_MIN } from "../sources/pipeline";
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
// wrong (bot-block, a variant miss, or a genuine anomaly) — alert rather than
// silently upserting a trickle. A healthy single-page scrape post-redesign
// (see the comment in lib/sources/craigslist.ts's SEARCH_ONLY_PAGE_FUNCTION —
// CL's redesign killed pagination, so ONE search page is now the entire
// discovery budget) typically yields 200-400 URLs; 0 means a block or variant
// miss, so 100 leaves real margin without being noisy on normal variance.
//
// REMOVED 2026-08-28 (incident): this used to ALSO compare `discovered`
// against a fraction of sapi.craigslist.org's totalResultCount (ground truth
// for the query's FULL live result count). That comparison is structurally
// wrong, not just mistuned — CL has no working pagination (see the redesign
// comment above), so a single search page can NEVER reach even 50% of sapi's
// full count once that count is more than ~2x a healthy page's size, and it
// fired for real on a normal run (258 discovered vs. a computed floor of
// 1404, i.e. 50% of sapi's totalResultCount=2809) — this would have emailed
// every single day. sapi's total is still logged for context (see
// craigslistDiscoveryAlertReason's caller), just no longer part of the
// alert DECISION.
const CL_DISCOVERY_FLOOR = 100;

/**
 * Pure decision function for whether a Craigslist Phase 1 result is worth
 * alerting on — factored out from runAdapter so it's testable without a real
 * fetchCraigslistListings run (no browser, no network). Returns a
 * human-readable reason string, or null when nothing is wrong. Deliberately
 * takes only the 3 fields the decision actually uses (not the full
 * fetchCraigslistListings return type) so a caller can't accidentally make
 * sapi's totalResultCount influence this again — see the REMOVED comment
 * above for why that specific regression must not come back.
 */
export function craigslistDiscoveryAlertReason(res: {
  discovered: number;
  blocked: boolean;
  staticVariantMissing: boolean;
}): string | null {
  if (res.blocked) {
    return "bot-block/CAPTCHA detected on the search page (or sapi returned totalResultCount>0 with 0 items)";
  }
  if (res.staticVariantMissing) {
    return "neither DOM variant (static list nor JS gallery) yielded any search-result cards after retries";
  }
  if (res.discovered < CL_DISCOVERY_FLOOR) {
    return `only ${res.discovered} URLs discovered, below the floor of ${CL_DISCOVERY_FLOOR} — no block detected, but this is too few for a healthy day`;
  }
  return null;
}

/**
 * Decides whether Craigslist Phase 1/2 execution should switch from the paid
 * Apify actor to the local headless-Playwright runner (see
 * lib/sources/craigslist-local.ts) — same pageFunction strings, same
 * post-processing, just a different runner. Exact-string match only (H9 in
 * the QA scenarios): "LOCAL"/"true"/"1"/anything else keeps the Apify
 * default, so a typo'd env var can't silently switch modes. `create` is
 * injected (rather than calling createLocalRunner directly) purely so tests
 * can assert the gate decision without launching a real browser or touching
 * the production lock file — see H6 in tests/craigslist-local.test.ts, which
 * regression-tests this against the gate silently widening (e.g. to
 * `|| "LOCAL"`).
 */
/**
 * True when Craigslist fetching should run in "local" mode — this box's own
 * residential IP doing direct HTTP, as opposed to the paid Apify actor /
 * GitHub Actions path. Exact-string match only (H9 in the QA scenarios),
 * same reasoning as selectCraigslistRunner's own gate below: a typo'd env
 * var must not silently switch behavior.
 *
 * Shared by selectCraigslistRunner (which runner fetches Craigslist search/
 * detail pages) and lib/ingest/phases/verify-stale.ts (whether the
 * verify-stale pass against Craigslist must be throttled the same way — see
 * the 2026-08-28 incident where an un-throttled local verify-stale burst,
 * 500 direct fetches at concurrency 10 in 5.8s, got this box's IP
 * bot-blocked about 30 minutes later). One predicate, two call sites, so
 * they can never drift apart on what "local" means.
 */
export function isCraigslistLocalMode(env: NodeJS.ProcessEnv): boolean {
  return env.CRAIGSLIST_FETCHER === "local";
}

export function selectCraigslistRunner(
  env: NodeJS.ProcessEnv,
  create: () => PageFunctionRunner,
): PageFunctionRunner | undefined {
  return isCraigslistLocalMode(env) ? create() : undefined;
}

/** Runs a single adapter by name. Returns raw AdapterOutput[] with source tag. */
async function runAdapter(source: ListingSource, supabase?: SupabaseClient): Promise<AdapterOutput[]> {
  switch (source) {
    case "craigslist": {
      // NOTE: do NOT pass bedroom params here. Scoping the craigslist search
      // with min/max_bedrooms made craigslist return 0 URLs to the Apify
      // scraper (bot-blocked on the parameterized search from proxy IPs), even
      // though the same URL works in a normal browser — it broke fetching
      // entirely. The pipeline's region + bedroom gate still filters post-scrape.
      // Brooklyn-only (Manhattan dropped) is still applied inside the adapter.
      //
      // PRICE params are safe, unlike bedroom params: verified live 2026-07-05
      // (control search 153 URLs vs min_price/max_price search 1654 URLs, both
      // SUCCEEDED — no bot-block). Send the pipeline's exact price band so
      // Phase 2 doesn't pay Apify compute to detail-scrape rows the pipeline
      // gate drops anyway.
      // localRunner captures the concrete LocalCraigslistRunner (which has
      // .close(), unlike the generic PageFunctionRunner selectCraigslistRunner
      // returns) so the finally block below can still release the browser +
      // lock file — selectCraigslistRunner's return type is intentionally the
      // narrower PageFunctionRunner (its only job is the env-gate decision).
      let localRunner: LocalCraigslistRunner | undefined;
      const runner = selectCraigslistRunner(process.env, () => {
        localRunner = createLocalRunner();
        return localRunner;
      });
      console.log(`[Craigslist] fetcher=${runner ? "local (playwright)" : "apify"}`);
      let res;
      try {
        res = await fetchCraigslistListings(
          { ...NYC_PARAMS, priceMin: PRICE_MIN, priceMax: PRICE_MAX },
          { supabase, runner },
        );
      } finally {
        // Always close the local runner's browser + release its lock file,
        // even if fetchCraigslistListings threw (e.g. CraigslistNetworkError)
        // — QA B1/B2: no zombie chromium, no stuck lock, on any error path.
        await localRunner?.close();
      }
      const alertReason = craigslistDiscoveryAlertReason(res);
      if (alertReason) {
        // sapi's totalResultCount is logged here for CONTEXT only — it no
        // longer influences the alert decision itself (see the REMOVED
        // comment on CL_DISCOVERY_FLOOR above).
        console.error(
          `[Craigslist] ALERT: ${alertReason} (discovered=${res.discovered}, blocked=${res.blocked}, sapi totalResultCount=${res.sapiTotalResultCount ?? "unavailable"}). Continuing run — upserting whatever was found.`,
        );
        // Fire-and-forget: alert is informational, must never block the run.
        // sendIngestAlert applies its own 24h per-subject cooldown (see
        // lib/ingest/alert.ts) so this doesn't re-email on every ingest
        // cycle while the condition persists — rules/alerting.md MANDATORY
        // "one message per problem, never one per occurrence".
        sendIngestAlert(
          "[Dwelligence] Craigslist discovery floor alert",
          `Craigslist Phase 1: ${alertReason}.\n\n` +
            `Discovered: ${res.discovered} URLs (sapi totalResultCount: ${res.sapiTotalResultCount ?? "unavailable"}, for context only).\n` +
            `Blocked: ${res.blocked ? "YES" : "no"}.\n\n` +
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
