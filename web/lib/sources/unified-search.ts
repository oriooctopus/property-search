/**
 * Unified search: queries all data sources in parallel, runs them through
 * the validation pipeline, then deduplicates via the dedup module.
 */

import type { AdapterOutput, SearchParams, ValidatedListing } from "./types";
import { fetchRealtorListings } from "./realtor";
import { fetchApartmentsListings } from "./apartments";
import { fetchCraigslistListings } from "./craigslist";
import { fetchRentHopListings } from "./renthop";
import { fetchStreetEasyListings } from "./streeteasy";
import { fetchZillowListings } from "./zillow";
import { fetchFacebookMarketplaceListings } from "./facebook-marketplace";
import {
  validateAndNormalize,
  mergeQualitySummaries,
  type QualitySummary,
} from "./pipeline";
import { deduplicateAndComposite } from "./dedup";

// ---------------------------------------------------------------------------
// Unified search
// ---------------------------------------------------------------------------

export interface UnifiedSearchResult {
  listings: ValidatedListing[];
  totals: {
    realtor: number;
    apartments: number;
    craigslist: number;
    renthop: number;
    streeteasy: number;
    zillow: number;
    facebook: number;
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
  const totals = {
    realtor: 0,
    apartments: 0,
    craigslist: 0,
    renthop: 0,
    streeteasy: 0,
    zillow: 0,
    facebook: 0,
    merged: 0,
    deduplicated: 0,
  };

  // Fire all requests concurrently
  const [
    realtorResult,
    apartmentsResult,
    craigslistResult,
    renthopResult,
    streeteasyResult,
    zillowResult,
    facebookResult,
  ] = await Promise.allSettled([
    fetchRealtorListings(params, apiKey),
    fetchApartmentsListings(params, apiKey),
    fetchCraigslistListings(params),
    fetchRentHopListings(params),
    fetchStreetEasyListings(params, apiKey),
    fetchZillowListings(params, apiKey),
    fetchFacebookMarketplaceListings(params),
  ]);

  // Process each result through the pipeline
  const qualitySummaries: QualitySummary[] = [];
  let allListings: ValidatedListing[] = [];

  const processResult = (
    name: string,
    key: keyof typeof totals,
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

  processResult("Realtor.com", "realtor", realtorResult);
  processResult("Apartments.com", "apartments", apartmentsResult);
  processResult("Craigslist", "craigslist", craigslistResult);
  processResult("RentHop", "renthop", renthopResult);
  processResult("StreetEasy", "streeteasy", streeteasyResult);
  processResult("Zillow", "zillow", zillowResult);
  processResult("Facebook Marketplace", "facebook", facebookResult);

  const qualitySummary = mergeQualitySummaries(qualitySummaries);

  const totalBefore = allListings.length;
  console.log(
    `[UnifiedSearch] Total before dedup: ${totalBefore} from ${7 - errors.length}/7 sources`,
  );

  // Composite-deduplicate
  allListings = deduplicateAndComposite(allListings);
  totals.merged = allListings.length;
  totals.deduplicated = totalBefore - allListings.length;

  console.log(
    `[UnifiedSearch] After dedup: ${allListings.length} (removed ${totals.deduplicated} duplicates)`,
  );

  return { listings: allListings, totals, errors, qualitySummary };
}
