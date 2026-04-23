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

/**
 * Extract a normalized unit identifier from an address string or URL.
 *
 * Tries the address first (matches `#1A`, `Apt 2`, `Unit 3B`, `Suite 5`, `Ste 5`),
 * then for StreetEasy falls back to the final path segment of the URL
 * (e.g. `/building/355-grove-street-brooklyn/1a` → `1a`).
 *
 * Returns a lowercase alnum-only token, or null if nothing resembling a unit
 * could be extracted.
 */
export function normalizeUnit(
  address: string | null,
  url?: string | null,
  source?: string | null,
): string | null {
  const fromAddr = address
    ? address.match(/(?:#|\b(?:apt|unit|suite|ste)\b)[.\s#-]*([a-z0-9][a-z0-9\s-]*)/i)
    : null;
  if (fromAddr && fromAddr[1]) {
    const cleaned = fromAddr[1].toLowerCase().replace(/[^a-z0-9]/g, "");
    if (cleaned) return cleaned;
  }

  // StreetEasy URL fallback
  const isSE = source === "streeteasy" || (!!url && url.includes("streeteasy.com"));
  if (isSE && url) {
    try {
      const path = new URL(url).pathname;
      // Last non-empty path segment
      const segs = path.split("/").filter((s) => s.length > 0);
      const last = segs[segs.length - 1];
      // Only accept if the segment looks like a unit id (short, alphanumeric)
      // and is NOT a building slug (which contains hyphens + words).
      if (last && !/[a-z]{3,}-[a-z]{3,}/.test(last)) {
        const cleaned = last.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (cleaned && cleaned.length <= 8) return cleaned;
      }
    } catch {
      // not a valid URL — ignore
    }
  }

  return null;
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
  "craigslist",
  "facebook-marketplace",
];

const GEO_PRIORITY: ListingSource[] = [
  "streeteasy",
  "craigslist",
  "facebook-marketplace",
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
  if (a.source === "facebook-marketplace" || b.source === "facebook-marketplace") return false;

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
  // Photo cap raised from 20 → 60 to match the adapter + validator caps. SE
  // listings can carry up to ~60 photos and the 20-cap was truncating ~21%
  // of them; the new cap keeps composite-merged clusters in step.
  const photoUrls = Array.from(allPhotoUrls).slice(0, 60);

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

  // Pick the longest non-empty description across the cluster (more text =
  // more useful in the detail view). SE may have richer copy than CL etc.
  let description: string | null = null;
  for (const l of cluster) {
    const d = l.description ?? null;
    if (d && (!description || d.length > description.length)) description = d;
  }

  // For concession-related fields, prefer the primary (highest-priority)
  // source's values — mixing concessions across sources is meaningless since
  // each source describes its own promotion. If the primary doesn't have
  // them, fall back to any cluster member that does.
  function firstNonNull<T>(getter: (l: ValidatedListing) => T | null | undefined): T | null {
    const fromPrimary = getter(primaryListing);
    if (fromPrimary != null) return fromPrimary;
    for (const l of sortedByPriority) {
      const v = getter(l);
      if (v != null) return v;
    }
    return null;
  }
  const grossPrice = firstNonNull((l) => l.gross_price);
  const netEffective = firstNonNull((l) => l.net_effective_price);
  const monthsFree = firstNonNull((l) => l.concession_months_free);

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
    list_date: listDate,
    last_update_date: lastUpdateDate,
    availability_date: availabilityDate,
    source: primaryListing.source,
    sources,
    source_urls: sourceUrls,
    description,
    gross_price: grossPrice,
    net_effective_price: netEffective,
    concession_months_free: monthsFree,
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
  // Pass 1: greedy clustering using the existing isSameProperty matcher
  // (tier 1 street exact / tier 2 geo+price / tier 3,4 same-source). This
  // produces street-level clusters that may span multiple units.
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
    if (!merged) clusters.push([listing]);
  }

  // Pass 2: split each cluster into unit-aware sub-clusters.
  //
  // Rules:
  //  - Rows with the SAME known unit group together.
  //  - Rows with DIFFERENT known units must NEVER merge (separate sub-clusters).
  //  - Rows with null unit fold into ONE non-null sub-cluster (prefer the
  //    largest); if no non-null sub-cluster exists, all nulls stay together.
  const refined: ValidatedListing[][] = [];
  for (const cluster of clusters) {
    if (cluster.length === 1) {
      refined.push(cluster);
      continue;
    }

    const byUnit = new Map<string, ValidatedListing[]>();
    const nulls: ValidatedListing[] = [];
    for (const l of cluster) {
      const unit = normalizeUnit(l.address, l.url, l.source);
      if (unit == null) {
        nulls.push(l);
      } else {
        if (!byUnit.has(unit)) byUnit.set(unit, []);
        byUnit.get(unit)!.push(l);
      }
    }

    if (byUnit.size === 0) {
      // All nulls — keep together
      refined.push(nulls);
      continue;
    }

    const subclusters = Array.from(byUnit.values());
    if (nulls.length > 0) {
      // Fold nulls into the largest non-null sub-cluster
      subclusters.sort((a, b) => b.length - a.length);
      subclusters[0].push(...nulls);
    }
    for (const sub of subclusters) refined.push(sub);
  }

  return refined.map(compositeListings);
}
