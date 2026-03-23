/**
 * Unified search: queries all data sources in parallel, merges, and deduplicates.
 */

import type { RawListing, SearchParams } from "./types";
import { fetchRealtorListings } from "./realtor";
import { fetchApartmentsListings } from "./apartments";
import { fetchCraigslistListings } from "./craigslist";
import { fetchRentHopListings } from "./renthop";

/**
 * Normalize an address string for deduplication comparison.
 * Lowercases, strips punctuation, collapses whitespace,
 * and expands common abbreviations.
 */
function normalizeAddress(addr: string): string {
  let s = addr.toLowerCase().trim();

  // Remove apartment/unit suffixes like "apt 3", "#4B", "unit 5"
  s = s.replace(/\s*(apt|unit|suite|ste|#)\s*\S+/gi, "");

  // Expand common abbreviations
  const abbrevs: Record<string, string> = {
    st: "street",
    ave: "avenue",
    blvd: "boulevard",
    dr: "drive",
    ln: "lane",
    rd: "road",
    ct: "court",
    pl: "place",
    cir: "circle",
    pkwy: "parkway",
    hwy: "highway",
    n: "north",
    s: "south",
    e: "east",
    w: "west",
  };

  // Strip all punctuation
  s = s.replace(/[.,#\-']/g, " ");

  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();

  // Expand abbreviations (word-boundary aware)
  const words = s.split(" ");
  s = words
    .map((w) => abbrevs[w] ?? w)
    .join(" ");

  return s;
}

/**
 * Deduplicate listings by normalized address.
 * When duplicates are found, prefer the listing with more data (more photos, has sqft, etc.).
 */
function deduplicateListings(listings: RawListing[]): RawListing[] {
  const seen = new Map<string, RawListing>();

  for (const listing of listings) {
    const key = normalizeAddress(listing.address);
    if (!key) continue;

    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, listing);
      continue;
    }

    // Score each listing: prefer more complete data
    const score = (l: RawListing) => {
      let s = 0;
      if (l.sqft) s += 2;
      if (l.lat !== 0 && l.lon !== 0) s += 3;
      if (l.baths > 0) s += 1;
      if (l.photos > 0) s += 1;
      if (l.photo_urls.length > 0) s += l.photo_urls.length;
      if (l.list_date) s += 1;
      if (l.last_update_date) s += 1;
      if (l.availability_date) s += 1;
      return s;
    };

    if (score(listing) > score(existing)) {
      seen.set(key, listing);
    }
  }

  return Array.from(seen.values());
}

export interface UnifiedSearchResult {
  listings: RawListing[];
  totals: {
    realtor: number;
    apartments: number;
    craigslist: number;
    renthop: number;
    merged: number;
  };
  errors: string[];
}

/**
 * Query all sources in parallel, merge, and deduplicate.
 */
export async function unifiedSearch(
  params: SearchParams,
  apiKey: string,
): Promise<UnifiedSearchResult> {
  const errors: string[] = [];
  const totals = { realtor: 0, apartments: 0, craigslist: 0, renthop: 0, merged: 0 };

  // Fire all requests concurrently
  const [realtorResult, apartmentsResult, craigslistResult, renthopResult] =
    await Promise.allSettled([
      fetchRealtorListings(params, apiKey),
      fetchApartmentsListings(params, apiKey),
      fetchCraigslistListings(params),
      fetchRentHopListings(params),
    ]);

  let allListings: RawListing[] = [];

  if (realtorResult.status === "fulfilled") {
    allListings.push(...realtorResult.value.listings);
    totals.realtor = realtorResult.value.listings.length;
  } else {
    errors.push(`Realtor.com: ${realtorResult.reason?.message ?? "Unknown error"}`);
  }

  if (apartmentsResult.status === "fulfilled") {
    allListings.push(...apartmentsResult.value.listings);
    totals.apartments = apartmentsResult.value.listings.length;
  } else {
    errors.push(`Apartments.com: ${apartmentsResult.reason?.message ?? "Unknown error"}`);
  }

  if (craigslistResult.status === "fulfilled") {
    allListings.push(...craigslistResult.value.listings);
    totals.craigslist = craigslistResult.value.listings.length;
  } else {
    errors.push(`Craigslist: ${craigslistResult.reason?.message ?? "Unknown error"}`);
  }

  if (renthopResult.status === "fulfilled") {
    allListings.push(...renthopResult.value.listings);
    totals.renthop = renthopResult.value.listings.length;
  } else {
    errors.push(`RentHop: ${renthopResult.reason?.message ?? "Unknown error"}`);
  }

  // Deduplicate by normalized address
  allListings = deduplicateListings(allListings);
  totals.merged = allListings.length;

  return { listings: allListings, totals, errors };
}
