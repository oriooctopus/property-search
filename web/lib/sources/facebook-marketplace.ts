/**
 * Facebook Marketplace adapter via TaskAGI Facebook Scraper (RapidAPI).
 *
 * Uses the facebook-scraper4.p.rapidapi.com API to search for rental listings.
 *
 * MISSING / UNRELIABLE FIELDS vs Realtor.com:
 *  - beds / baths      (not structured — parsed from description text via regex)
 *  - sqft              (not provided)
 *  - lat / lon         (may not be available)
 *  - list_date         (may be relative like "2 days ago")
 *  - last_update_date  (not provided)
 *  - availability_date (not provided)
 */

import type { RawListing, SearchParams } from "./types";

const RAPIDAPI_HOST = "facebook-scraper4.p.rapidapi.com";

// ---------------------------------------------------------------------------
// Beds / baths extraction from free-text descriptions
// ---------------------------------------------------------------------------

/**
 * Extract bedroom count from description text.
 * Matches patterns like: "3BR", "3 br", "3 bed", "3 bedroom", "3 bedrooms",
 * "three bedroom", etc.
 */
function extractBeds(text: string): number {
  if (!text) return 0;
  const t = text.toLowerCase();

  // Numeric patterns: "3br", "3 br", "3bed", "3 bed", "3 bedroom(s)"
  const numMatch = t.match(/(\d+)\s*(?:br|bed(?:room)?s?)\b/);
  if (numMatch) return parseInt(numMatch[1], 10);

  // Word-number patterns: "three bedroom"
  const wordNums: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    studio: 0,
  };
  for (const [word, num] of Object.entries(wordNums)) {
    if (t.includes(`${word} bed`) || t.includes(`${word} br`)) return num;
  }

  // "studio" standalone
  if (/\bstudio\b/.test(t)) return 0;

  return 0;
}

/**
 * Extract bathroom count from description text.
 * Matches patterns like: "2ba", "2 bath", "2 bathroom(s)", "2.5 bath"
 */
function extractBaths(text: string): number {
  if (!text) return 0;
  const t = text.toLowerCase();

  const numMatch = t.match(/(\d+(?:\.\d+)?)\s*(?:ba(?:th(?:room)?s?)?)\b/);
  if (numMatch) return parseFloat(numMatch[1]);

  return 0;
}

// ---------------------------------------------------------------------------
// API response types (loosely typed — API shape may vary)
// ---------------------------------------------------------------------------

interface FBMarketplaceItem {
  id?: string;
  title?: string;
  description?: string;
  price?: string | number;
  location?: string;
  latitude?: number;
  longitude?: number;
  image?: string;
  images?: string[];
  image_url?: string;
  image_urls?: string[];
  photos?: string[];
  url?: string;
  link?: string;
  created_time?: string;
  posted_at?: string;
  date?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Main fetch function
// ---------------------------------------------------------------------------

export async function fetchFacebookMarketplaceListings(
  params: SearchParams,
  apiKey: string,
): Promise<{ listings: RawListing[]; total: number }> {
  const { city, stateCode, priceMax, priceMin, bedsMin } = params;

  // Build the keyword query for housing/rental listings
  const keyword = `apartment for rent ${city} ${stateCode}`;
  const location = `${city}, ${stateCode}`;

  // Try keyword-based search first (more flexible)
  const url = `https://${RAPIDAPI_HOST}/marketplace-items-by-keyword`;

  const queryParams = new URLSearchParams({
    keyword,
    location,
    category: "propertyrentals",
    limit: "50",
  });

  if (priceMin != null) queryParams.set("min_price", String(priceMin));
  if (priceMax != null) queryParams.set("max_price", String(priceMax));

  let items: FBMarketplaceItem[] = [];

  try {
    const res = await fetch(`${url}?${queryParams.toString()}`, {
      method: "GET",
      headers: {
        "X-RapidAPI-Key": apiKey,
        "X-RapidAPI-Host": RAPIDAPI_HOST,
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.error(`[FacebookMarketplace] API returned ${res.status}: ${res.statusText}`);
      return { listings: [], total: 0 };
    }

    const data = await res.json();

    // The API may return items at the top level or nested under a key
    if (Array.isArray(data)) {
      items = data;
    } else if (data?.results && Array.isArray(data.results)) {
      items = data.results;
    } else if (data?.data && Array.isArray(data.data)) {
      items = data.data;
    } else if (data?.items && Array.isArray(data.items)) {
      items = data.items;
    } else {
      console.warn("[FacebookMarketplace] Unexpected API response shape:", Object.keys(data));
      return { listings: [], total: 0 };
    }
  } catch (err) {
    console.error("[FacebookMarketplace] fetch error:", err);
    return { listings: [], total: 0 };
  }

  const listings: RawListing[] = [];

  for (const item of items) {
    const title = item.title ?? "";
    const description = item.description ?? "";
    const combinedText = `${title} ${description}`;

    // Parse price — could be string like "$1,500" or number
    let price = 0;
    if (typeof item.price === "number") {
      price = item.price;
    } else if (typeof item.price === "string") {
      const parsed = parseInt(item.price.replace(/[^0-9]/g, ""), 10);
      if (!isNaN(parsed)) price = parsed;
    }

    // Skip items with no price (likely not real listings)
    if (price === 0) continue;

    // Extract beds/baths from description since FB has no structured fields
    const beds = extractBeds(combinedText);
    const baths = extractBaths(combinedText);

    // Filter by minimum beds if specified
    if (bedsMin != null && beds > 0 && beds < bedsMin) continue;

    // Photos: collect from various possible fields
    const photoUrls: string[] = [];
    const photoSources = [
      ...(item.images ?? []),
      ...(item.image_urls ?? []),
      ...(item.photos ?? []),
    ];
    if (item.image) photoSources.push(item.image);
    if (item.image_url) photoSources.push(item.image_url);

    for (const src of photoSources) {
      if (typeof src === "string" && src.startsWith("http") && !photoUrls.includes(src)) {
        photoUrls.push(src);
      }
    }

    // Location
    const locationStr = item.location ?? `${city}, ${stateCode}`;

    // Coordinates
    const lat = typeof item.latitude === "number" ? item.latitude : 0;
    const lon = typeof item.longitude === "number" ? item.longitude : 0;

    // URL
    const listingUrl = item.url ?? item.link ?? "";

    // Date — may be absolute or relative
    const dateStr = item.created_time ?? item.posted_at ?? item.date ?? null;

    listings.push({
      address: title || "Facebook Marketplace Listing",
      area: typeof locationStr === "string" ? locationStr : `${city}, ${stateCode}`,
      price,
      beds,
      baths,
      sqft: null, // Not provided by Facebook Marketplace
      lat,
      lon,
      photos: photoUrls.length,
      photo_urls: photoUrls.slice(0, 8),
      url: listingUrl,
      search_tag: `search_${city.toLowerCase().replace(/\s+/g, "_")}`,
      list_date: typeof dateStr === "string" ? dateStr : null,
      last_update_date: null, // Not provided
      availability_date: null, // Not provided
      source: "facebook" as const,
    });
  }

  return { listings, total: listings.length };
}
