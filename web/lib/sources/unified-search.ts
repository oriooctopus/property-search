/**
 * Unified search: queries all data sources in parallel, merges, and
 * composites duplicate listings into a single entry with the best data
 * from each source.
 */

import type { RawListing, SearchParams, ListingSource } from "./types";
import { fetchRealtorListings } from "./realtor";
import { fetchApartmentsListings } from "./apartments";
import { fetchCraigslistListings } from "./craigslist";
import { fetchRentHopListings } from "./renthop";
import { fetchStreetEasyListings } from "./streeteasy";
import { fetchZillowListings } from "./zillow";

// ---------------------------------------------------------------------------
// Address normalization
// ---------------------------------------------------------------------------

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
  s = words.map((w) => abbrevs[w] ?? w).join(" ");

  return s;
}

// ---------------------------------------------------------------------------
// Geo helpers
// ---------------------------------------------------------------------------

/** Haversine distance in meters between two lat/lon points. */
function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Returns true if the coordinate is a real location (not 0,0 or missing). */
function hasValidCoords(lat: number, lon: number): boolean {
  return lat !== 0 && lon !== 0 && !isNaN(lat) && !isNaN(lon);
}

// ---------------------------------------------------------------------------
// Source priority
// ---------------------------------------------------------------------------

/**
 * Source priority order — lower index = higher priority.
 * Used to pick the "best" field value when compositing duplicates.
 */
const SOURCE_PRIORITY: ListingSource[] = [
  "streeteasy",
  "zillow",
  "realtor",
  "apartments",
  "renthop",
  "craigslist",
];

/** Priority specifically for lat/lon (geocoded sources first). */
const GEO_PRIORITY: ListingSource[] = [
  "zillow",
  "realtor",
  "streeteasy",
  "apartments",
  "renthop",
  "craigslist",
];

function priorityIndex(source: ListingSource, order: ListingSource[]): number {
  const idx = order.indexOf(source);
  return idx === -1 ? order.length : idx;
}

// ---------------------------------------------------------------------------
// Composite deduplication
// ---------------------------------------------------------------------------

/**
 * Determine if two listings represent the same property.
 *
 * Match criteria (either condition is sufficient):
 *  1. Normalized addresses match
 *  2. lat/lon within ~50 m AND price within 10%
 */
function isSameProperty(a: RawListing, b: RawListing): boolean {
  // Address match
  const normA = normalizeAddress(a.address);
  const normB = normalizeAddress(b.address);
  if (normA && normB && normA === normB) return true;

  // Geo + price match
  if (
    hasValidCoords(a.lat, a.lon) &&
    hasValidCoords(b.lat, b.lon) &&
    a.price > 0 &&
    b.price > 0
  ) {
    const dist = haversineMeters(a.lat, a.lon, b.lat, b.lon);
    const priceDiff = Math.abs(a.price - b.price) / Math.max(a.price, b.price);
    if (dist <= 50 && priceDiff <= 0.1) return true;
  }

  return false;
}

/**
 * Pick a field value from the highest-priority source that has a non-empty value.
 */
function pickBest<T>(
  listings: RawListing[],
  getter: (l: RawListing) => T,
  isEmpty: (v: T) => boolean,
  order: ListingSource[] = SOURCE_PRIORITY,
): T {
  // Sort by priority
  const sorted = [...listings].sort(
    (a, b) => priorityIndex(a.source, order) - priorityIndex(b.source, order),
  );
  for (const l of sorted) {
    const val = getter(l);
    if (!isEmpty(val)) return val;
  }
  // Fallback: return the first listing's value
  return getter(listings[0]);
}

/**
 * Compute the mode (most common value) from a list of numbers.
 * If there's a tie, return the lowest.
 */
function priceMode(prices: number[]): number {
  const valid = prices.filter((p) => p > 0);
  if (valid.length === 0) return 0;

  const counts = new Map<number, number>();
  for (const p of valid) {
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }

  let bestPrice = valid[0];
  let bestCount = 0;
  for (const [price, count] of counts) {
    if (count > bestCount || (count === bestCount && price < bestPrice)) {
      bestPrice = price;
      bestCount = count;
    }
  }
  return bestPrice;
}

/**
 * Merge a cluster of duplicate listings into a single composite listing
 * with the best data from each source.
 */
function compositeListings(cluster: RawListing[]): RawListing {
  if (cluster.length === 1) {
    const l = cluster[0];
    l.sources = [l.source];
    l.source_urls = { [l.source]: l.url };
    return l;
  }

  // Collect all sources and their URLs
  const sources: ListingSource[] = [];
  const sourceUrls: Record<string, string> = {};
  for (const l of cluster) {
    if (!sources.includes(l.source)) {
      sources.push(l.source);
    }
    if (l.url && !sourceUrls[l.source]) {
      sourceUrls[l.source] = l.url;
    }
  }

  // Pick address from highest-priority source
  const address = pickBest(
    cluster,
    (l) => l.address,
    (v) => !v || v.length === 0,
  );

  // Pick area from highest-priority source
  const area = pickBest(
    cluster,
    (l) => l.area,
    (v) => !v || v.length === 0,
  );

  // Price: mode, or lowest if tied
  const price = priceMode(cluster.map((l) => l.price));

  // Beds/baths: highest-priority non-zero
  const beds = pickBest(
    cluster,
    (l) => l.beds,
    (v) => v === 0,
  );
  const baths = pickBest(
    cluster,
    (l) => l.baths,
    (v) => v === 0,
  );

  // Sqft: any non-null, prefer higher-priority source
  const sqft = pickBest(
    cluster,
    (l) => l.sqft,
    (v) => v == null || v === 0,
  );

  // Lat/lon: use geo-specific priority, skip 0,0
  const geoListing = pickBest(
    cluster,
    (l) => l,
    (l) => !hasValidCoords(l.lat, l.lon),
    GEO_PRIORITY,
  );
  const lat = hasValidCoords(geoListing.lat, geoListing.lon) ? geoListing.lat : 0;
  const lon = hasValidCoords(geoListing.lat, geoListing.lon) ? geoListing.lon : 0;

  // Photos: union all photo_urls, dedup by URL
  const allPhotoUrls = new Set<string>();
  // Add photos from higher-priority sources first
  const sortedByPriority = [...cluster].sort(
    (a, b) =>
      priorityIndex(a.source, SOURCE_PRIORITY) -
      priorityIndex(b.source, SOURCE_PRIORITY),
  );
  for (const l of sortedByPriority) {
    for (const u of l.photo_urls) {
      if (u) allPhotoUrls.add(u);
    }
  }
  const photoUrls = Array.from(allPhotoUrls);

  // List date: earliest non-null
  const listDates = cluster
    .map((l) => l.list_date)
    .filter((d): d is string => d != null && d.length > 0)
    .sort();
  const listDate = listDates.length > 0 ? listDates[0] : null;

  // Last update date: most recent non-null
  const updateDates = cluster
    .map((l) => l.last_update_date)
    .filter((d): d is string => d != null && d.length > 0)
    .sort()
    .reverse();
  const lastUpdateDate = updateDates.length > 0 ? updateDates[0] : null;

  // Availability date: earliest non-null
  const availDates = cluster
    .map((l) => l.availability_date)
    .filter((d): d is string => d != null && d.length > 0)
    .sort();
  const availabilityDate = availDates.length > 0 ? availDates[0] : null;

  // Primary source/url = highest priority source in the cluster
  const primaryListing = sortedByPriority[0];

  return {
    address,
    area,
    price,
    beds,
    baths,
    sqft,
    lat,
    lon,
    photos: photoUrls.length,
    photo_urls: photoUrls,
    url: primaryListing.url,
    search_tag: primaryListing.search_tag,
    list_date: listDate,
    last_update_date: lastUpdateDate,
    availability_date: availabilityDate,
    source: primaryListing.source,
    sources,
    source_urls: sourceUrls,
  };
}

/**
 * Deduplicate and composite listings from multiple sources.
 *
 * Uses a union-find style clustering: for each listing, check against all
 * existing cluster representatives. If a match is found, add to that cluster.
 * Otherwise, start a new cluster. Then merge each cluster.
 */
function deduplicateAndComposite(listings: RawListing[]): RawListing[] {
  const clusters: RawListing[][] = [];

  for (const listing of listings) {
    const normAddr = normalizeAddress(listing.address);
    if (!normAddr && !hasValidCoords(listing.lat, listing.lon)) {
      // Can't dedup without address or coords — keep as standalone
      clusters.push([listing]);
      continue;
    }

    let merged = false;
    for (const cluster of clusters) {
      // Check against the first listing in the cluster (representative)
      if (isSameProperty(cluster[0], listing)) {
        cluster.push(listing);
        merged = true;
        break;
      }
    }

    if (!merged) {
      clusters.push([listing]);
    }
  }

  return clusters.map(compositeListings);
}

// ---------------------------------------------------------------------------
// Unified search
// ---------------------------------------------------------------------------

export interface UnifiedSearchResult {
  listings: RawListing[];
  totals: {
    realtor: number;
    apartments: number;
    craigslist: number;
    renthop: number;
    streeteasy: number;
    zillow: number;
    merged: number;
    /** How many listings were deduped away during compositing. */
    deduplicated: number;
  };
  errors: string[];
}

/**
 * Query all sources in parallel, merge, and composite-deduplicate.
 */
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
  ] = await Promise.allSettled([
    fetchRealtorListings(params, apiKey),
    fetchApartmentsListings(params, apiKey),
    fetchCraigslistListings(params),
    fetchRentHopListings(params),
    fetchStreetEasyListings(params, apiKey),
    fetchZillowListings(params, apiKey),
  ]);

  let allListings: RawListing[] = [];

  // Helper to process each result
  const processResult = (
    name: string,
    key: keyof typeof totals,
    result: PromiseSettledResult<{ listings: RawListing[]; total: number }>,
  ) => {
    if (result.status === "fulfilled") {
      allListings.push(...result.value.listings);
      totals[key] = result.value.listings.length;
      console.log(`[UnifiedSearch] ${name}: ${result.value.listings.length} listings`);
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

  const totalBefore = allListings.length;
  console.log(
    `[UnifiedSearch] Total before dedup: ${totalBefore} from ${6 - errors.length}/6 sources`,
  );

  // Composite-deduplicate
  allListings = deduplicateAndComposite(allListings);
  totals.merged = allListings.length;
  totals.deduplicated = totalBefore - allListings.length;

  console.log(
    `[UnifiedSearch] After dedup: ${allListings.length} (removed ${totals.deduplicated} duplicates)`,
  );

  return { listings: allListings, totals, errors };
}
