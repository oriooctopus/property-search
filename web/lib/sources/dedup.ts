/**
 * Deduplication and composite merging for property listings.
 *
 * Matches duplicate listings across sources using 4 tiers:
 *  1. Exact normalized address
 *  2. Geo proximity (≤50m) + price (±10%)
 *  3. Exact normalized title + same price + same beds
 *  4. Same source + same beds + same price + same area
 *
 * When merging, picks best data from each source using priority order.
 * For same-source clusters (e.g., CL reposts), prefers the newest listing.
 */

import type { ListingSource, ValidatedListing } from "./types";

// ---------------------------------------------------------------------------
// Address & title normalization
// ---------------------------------------------------------------------------

const STREET_ABBREVS: Record<string, string> = {
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

/** Normalize a street address for dedup comparison. */
export function normalizeAddress(addr: string): string {
  let s = addr.toLowerCase().trim();
  s = s.replace(/\s*(apt|unit|suite|ste|#)\s*\S+/gi, "");
  s = s.replace(/[.,#\-']/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  const words = s.split(" ");
  return words.map((w) => STREET_ABBREVS[w] ?? w).join(" ");
}

// Emoji regex: covers most common emoji ranges
const EMOJI_RE =
  /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;

/** Normalize a listing title for comparison (strips emojis, noise, collapses whitespace). */
export function normalizeTitle(title: string): string {
  let s = title.toLowerCase();
  s = s.replace(EMOJI_RE, "");
  s = s.replace(/[^\w\s]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Does this string look like a real street address?
 *
 * Real: "123 Main St", "456 W 53rd St", "86-79 Palo Alto St"
 * NOT real: "2 Beds 1 Bath - Apartment", "HUGE 5 bed...", "Studio 1 Bath"
 *
 * Requires a street number followed by a word that isn't a common
 * listing keyword (bed, bath, beds, baths, br, ba, studio, retail).
 */
export function hasRealAddress(addr: string): boolean {
  if (!addr) return false;
  const s = addr.trim();
  // Must start with a street number, then a non-listing-keyword word
  const match = s.match(/^(\d[\d\-]*)\s+(\S+)/i);
  if (!match) return false;
  const secondWord = match[2].toLowerCase();
  const listingKeywords = new Set([
    "bed", "beds", "bedroom", "bedrooms", "br",
    "bath", "baths", "bathroom", "bathrooms", "ba",
    "studio", "retail", "office", "parking",
  ]);
  return !listingKeywords.has(secondWord);
}

/** Normalize an area string for comparison. */
function normalizeArea(area: string): string {
  return area.toLowerCase().trim().replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Geo helpers
// ---------------------------------------------------------------------------

function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hasValidCoords(lat: number, lon: number): boolean {
  return lat !== 0 && lon !== 0 && !isNaN(lat) && !isNaN(lon);
}

// ---------------------------------------------------------------------------
// Source priority
// ---------------------------------------------------------------------------

const SOURCE_PRIORITY: ListingSource[] = [
  "streeteasy",
  "zillow",
  "realtor",
  "apartments",
  "renthop",
  "craigslist",
  "facebook",
];

const GEO_PRIORITY: ListingSource[] = [
  "zillow",
  "realtor",
  "streeteasy",
  "apartments",
  "renthop",
  "craigslist",
  "facebook",
];

function priorityIndex(source: ListingSource, order: ListingSource[]): number {
  const idx = order.indexOf(source);
  return idx === -1 ? order.length : idx;
}

// ---------------------------------------------------------------------------
// Matching tiers
// ---------------------------------------------------------------------------

function priceWithinPercent(a: number, b: number, pct: number): boolean {
  if (a <= 0 || b <= 0) return false;
  return Math.abs(a - b) / Math.max(a, b) <= pct;
}

/**
 * Determine if two listings represent the same property.
 *
 * Tier 1: Exact normalized address match
 * Tier 2: Geo proximity (≤50m) + price (±10%)
 * Tier 3: Exact normalized title + same price + same beds (for non-address sources)
 * Tier 4: Same source + same beds + same price + same area
 */
function isSameProperty(a: ValidatedListing, b: ValidatedListing): boolean {
  // Skip Facebook entirely — generic titles make matching unreliable
  if (a.source === "facebook" || b.source === "facebook") return false;

  // Tier 1: Exact normalized address (only when both are real street addresses)
  const normA = normalizeAddress(a.address);
  const normB = normalizeAddress(b.address);
  if (
    normA &&
    normB &&
    normA === normB &&
    hasRealAddress(a.address) &&
    hasRealAddress(b.address)
  ) {
    return true;
  }

  // Tier 2: Geo proximity + price
  if (
    hasValidCoords(a.lat, a.lon) &&
    hasValidCoords(b.lat, b.lon) &&
    a.price > 0 &&
    b.price > 0
  ) {
    const dist = haversineMeters(a.lat, a.lon, b.lat, b.lon);
    if (dist <= 50 && priceWithinPercent(a.price, b.price, 0.1)) return true;
  }

  // Tier 3: Exact title match + same beds + exact price
  // For same-source listings that use titles as addresses (CL reposts).
  // Requires same source to avoid merging different properties from different
  // platforms that happen to have the same generic title.
  if (
    a.source === b.source &&
    (!hasRealAddress(a.address) || !hasRealAddress(b.address))
  ) {
    const titleA = normalizeTitle(a.address);
    const titleB = normalizeTitle(b.address);
    if (
      titleA &&
      titleB &&
      titleA === titleB &&
      a.beds === b.beds &&
      a.price === b.price
    ) {
      return true;
    }
  }

  // Tier 4: Same source + same beds + price within 3% + same area
  // Catches CL reposts with slightly different titles or minor price changes.
  // Requires beds > 0 to avoid merging unrelated commercial/retail listings.
  if (
    a.source === b.source &&
    a.source !== "facebook" && // FB generic titles are too unreliable for this
    a.beds === b.beds &&
    a.beds > 0 &&
    priceWithinPercent(a.price, b.price, 0.03) &&
    normalizeArea(a.area) === normalizeArea(b.area)
  ) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Composite merging
// ---------------------------------------------------------------------------

function pickBest<T>(
  listings: ValidatedListing[],
  getter: (l: ValidatedListing) => T,
  isEmpty: (v: T, l: ValidatedListing) => boolean,
  order: ListingSource[] = SOURCE_PRIORITY,
): T {
  const sorted = [...listings].sort(
    (a, b) => priorityIndex(a.source, order) - priorityIndex(b.source, order),
  );
  for (const l of sorted) {
    const val = getter(l);
    if (!isEmpty(val, l)) return val;
  }
  return getter(listings[0]);
}

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
 * Pick the primary listing for URL selection.
 * For same-source clusters (e.g., CL reposts), prefer the newest by list_date.
 * For cross-source clusters, prefer the highest-priority source.
 */
function pickPrimaryListing(
  cluster: ValidatedListing[],
): ValidatedListing {
  const uniqueSources = new Set(cluster.map((l) => l.source));

  if (uniqueSources.size === 1) {
    // Same-source cluster (CL reposts) — prefer newest
    const withDates = cluster.filter((l) => l.list_date != null && l.list_date.length > 0);
    if (withDates.length > 0) {
      return withDates.sort((a, b) => (b.list_date ?? "").localeCompare(a.list_date ?? ""))[0];
    }
    return cluster[0];
  }

  // Cross-source — prefer highest-priority source
  return [...cluster].sort(
    (a, b) => priorityIndex(a.source, SOURCE_PRIORITY) - priorityIndex(b.source, SOURCE_PRIORITY),
  )[0];
}

function compositeListings(cluster: ValidatedListing[]): ValidatedListing {
  if (cluster.length === 1) {
    const l = cluster[0];
    l.sources = [l.source];
    l.source_urls = { [l.source]: l.url };
    return l;
  }

  const sources: ListingSource[] = [];
  const sourceUrls: Record<string, string> = {};
  // Group by source, pick newest URL per source
  const bySource = new Map<ListingSource, ValidatedListing[]>();
  for (const l of cluster) {
    if (!sources.includes(l.source)) sources.push(l.source);
    if (!bySource.has(l.source)) bySource.set(l.source, []);
    bySource.get(l.source)!.push(l);
  }
  for (const [src, listings] of bySource) {
    // Pick the newest URL for each source
    const withDates = listings.filter((l) => l.url && l.list_date);
    if (withDates.length > 0) {
      withDates.sort((a, b) => (b.list_date ?? "").localeCompare(a.list_date ?? ""));
      sourceUrls[src] = withDates[0].url;
    } else {
      const first = listings.find((l) => l.url);
      if (first) sourceUrls[src] = first.url;
    }
  }

  const sortedByPriority = [...cluster].sort(
    (a, b) =>
      priorityIndex(a.source, SOURCE_PRIORITY) -
      priorityIndex(b.source, SOURCE_PRIORITY),
  );

  const address = pickBest(
    cluster,
    (l) => l.address,
    (v) => !v || v.length === 0,
  );

  const area = pickBest(
    cluster,
    (l) => l.area,
    (v) => !v || v.length === 0,
  );

  const price = priceMode(cluster.map((l) => l.price));

  const beds = pickBest(
    cluster,
    (l) => l.beds,
    (v, l) => v === 0 && l.quality.beds === "missing",
  );
  const baths = pickBest(
    cluster,
    (l) => l.baths,
    (v, l) => v === 0 && l.quality.baths === "missing",
  );

  const sqft = pickBest(
    cluster,
    (l) => l.sqft,
    (v) => v == null || v === 0,
  );

  const geoListing = pickBest(
    cluster,
    (l) => l,
    (l) => !hasValidCoords(l.lat, l.lon),
    GEO_PRIORITY,
  );
  const lat = hasValidCoords(geoListing.lat, geoListing.lon) ? geoListing.lat : 0;
  const lon = hasValidCoords(geoListing.lat, geoListing.lon) ? geoListing.lon : 0;

  const allPhotoUrls = new Set<string>();
  for (const l of sortedByPriority) {
    for (const u of l.photo_urls) {
      if (u) allPhotoUrls.add(u);
    }
  }
  const photoUrls = Array.from(allPhotoUrls).slice(0, 20);

  const listDates = cluster
    .map((l) => l.list_date)
    .filter((d): d is string => d != null && d.length > 0)
    .sort();
  const listDate = listDates.length > 0 ? listDates[0] : null;

  const updateDates = cluster
    .map((l) => l.last_update_date)
    .filter((d): d is string => d != null && d.length > 0)
    .sort()
    .reverse();
  const lastUpdateDate = updateDates.length > 0 ? updateDates[0] : null;

  const availDates = cluster
    .map((l) => l.availability_date)
    .filter((d): d is string => d != null && d.length > 0)
    .sort();
  const availabilityDate = availDates.length > 0 ? availDates[0] : null;

  const primaryListing = pickPrimaryListing(cluster);

  const qualityPriority = ["api", "parsed", "missing"] as const;
  const bestQuality = (field: keyof ValidatedListing["quality"]) => {
    let best = "missing" as ValidatedListing["quality"][typeof field];
    for (const l of sortedByPriority) {
      const q = l.quality[field];
      if (qualityPriority.indexOf(q) < qualityPriority.indexOf(best)) {
        best = q;
      }
    }
    return best;
  };

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
    quality: {
      beds: bestQuality("beds"),
      baths: bestQuality("baths"),
      price: bestQuality("price"),
      geo: bestQuality("geo"),
      photos: bestQuality("photos"),
    },
  };
}

// ---------------------------------------------------------------------------
// Main dedup entry point
// ---------------------------------------------------------------------------

/**
 * Deduplicate and composite listings from multiple sources.
 *
 * Uses greedy clustering: for each listing, check against existing cluster
 * representatives. If a match is found, add to that cluster. Otherwise,
 * start a new cluster. Then merge each cluster.
 */
export function deduplicateAndComposite(
  listings: ValidatedListing[],
): ValidatedListing[] {
  const clusters: ValidatedListing[][] = [];

  for (const listing of listings) {
    let merged = false;
    for (const cluster of clusters) {
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
