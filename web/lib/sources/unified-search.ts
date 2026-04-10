/**
 * Unified search: queries all active data sources in parallel, runs them
 * through the validation pipeline, then deduplicates via the dedup module.
 *
 * Active sources: streeteasy, craigslist, facebook-marketplace.
 */

import type {
  AdapterOutput,
  ListingSource,
  SearchParams,
  ValidatedListing,
} from "./types";
import { fetchCraigslistListings } from "./craigslist";
import { fetchStreetEasyListings } from "./streeteasy";
import { fetchFacebookMarketplaceListings } from "./facebook-marketplace";
import {
  validateAndNormalize,
  mergeQualitySummaries,
  type QualitySummary,
} from "./pipeline";
import { deduplicateAndComposite } from "./dedup";

export interface UnifiedSearchResult {
  listings: ValidatedListing[];
  totals: Record<ListingSource, number> & {
    merged: number;
    deduplicated: number;
  };
  errors: string[];
  qualitySummary: QualitySummary;
}

export async function unifiedSearch(
  params: SearchParams,
  apiKey: string,
): Promise<UnifiedSearchResult> {
  const errors: string[] = [];
  const totals: UnifiedSearchResult["totals"] = {
    streeteasy: 0,
    craigslist: 0,
    "facebook-marketplace": 0,
    merged: 0,
    deduplicated: 0,
  };

  const [streeteasyResult, craigslistResult, facebookResult] =
    await Promise.allSettled([
      fetchStreetEasyListings(params, apiKey),
      fetchCraigslistListings(params),
      fetchFacebookMarketplaceListings(params),
    ]);

  const qualitySummaries: QualitySummary[] = [];
  let allListings: ValidatedListing[] = [];

  const processResult = (
    name: string,
    key: ListingSource,
    result: PromiseSettledResult<{ listings: AdapterOutput[]; total: number }>,
  ) => {
    if (result.status === "fulfilled") {
      const { listings: validated, qualitySummary } = validateAndNormalize(
        result.value.listings,
        name,
      );
      allListings.push(...validated);
      totals[key] = validated.length;
      qualitySummaries.push(qualitySummary);
      console.log(`[UnifiedSearch] ${name}: ${validated.length} listings`);
    } else {
      const msg = `${name}: ${result.reason?.message ?? "Unknown error"}`;
      errors.push(msg);
      console.error(`[UnifiedSearch] ${msg}`);
    }
  };

  processResult("StreetEasy", "streeteasy", streeteasyResult);
  processResult("Craigslist", "craigslist", craigslistResult);
  processResult("Facebook Marketplace", "facebook-marketplace", facebookResult);

  const qualitySummary = mergeQualitySummaries(qualitySummaries);

  const totalBefore = allListings.length;
  console.log(
    `[UnifiedSearch] Total before dedup: ${totalBefore} from ${3 - errors.length}/3 sources`,
  );

  allListings = deduplicateAndComposite(allListings);
  totals.merged = allListings.length;
  totals.deduplicated = totalBefore - allListings.length;

  console.log(
    `[UnifiedSearch] After dedup: ${allListings.length} (removed ${totals.deduplicated} duplicates)`,
  );

  return { listings: allListings, totals, errors, qualitySummary };
}
