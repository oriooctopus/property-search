/**
 * Facebook Marketplace adapter via Apify Facebook Marketplace Scraper.
 *
 * Uses the apify~facebook-marketplace-scraper actor with startUrls pointing
 * to Facebook Marketplace search URLs. Runs synchronously and returns
 * dataset items directly.
 *
 * MISSING / UNRELIABLE FIELDS vs Realtor.com:
 *  - sqft              (not provided)
 *  - lat / lon         (not provided in listing-level data)
 *  - list_date         (not provided)
 *  - last_update_date  (not provided)
 *  - availability_date (not provided)
 */

import type { AdapterOutput, SearchParams } from "./types";
import { extractBaths, extractBeds, makeSearchTag, parsePrice } from "./parse-utils";

const APIFY_RUN_URL =
  "https://api.apify.com/v2/acts/apify~facebook-marketplace-scraper/run-sync-get-dataset-items";

const TIMEOUT_MS = 45_000; // Must fit within Vercel's 60s maxDuration

// Facebook Marketplace city slugs for URL construction
const CITY_SLUGS: Record<string, string> = {
  "new york": "nyc",
  "los angeles": "la",
  chicago: "chicago",
  houston: "houston",
  phoenix: "phoenix",
  philadelphia: "philly",
  "san antonio": "sanantonio",
  "san diego": "sandiego",
  dallas: "dallas",
  austin: "austin",
  miami: "miami",
  denver: "denver",
  seattle: "seattle",
  boston: "boston",
  nashville: "nashville",
  portland: "portland",
  atlanta: "atlanta",
  "san francisco": "sanfrancisco",
};

// ---------------------------------------------------------------------------
// Apify response shape (based on real API responses)
// ---------------------------------------------------------------------------

interface ApifyFBItem {
  id?: string;
  marketplace_listing_title?: string;
  custom_title?: string;
  listing_price?: {
    formatted_amount?: string;
    amount?: string;
    amount_with_offset_in_currency?: string;
  };
  location?: {
    reverse_geocode?: {
      city?: string;
      state?: string;
      city_page?: {
        display_name?: string;
      };
    };
  };
  primary_listing_photo?: {
    photo_image_url?: string;
    id?: string;
  };
  listingUrl?: string;
  custom_sub_titles_with_rendering_flags?: Array<{
    subtitle?: string;
  }>;
  is_sold?: boolean;
  is_pending?: boolean;
  is_hidden?: boolean;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Main fetch function
// ---------------------------------------------------------------------------

export async function fetchFacebookMarketplaceListings(
  params: SearchParams,
): Promise<{ listings: AdapterOutput[]; total: number }> {
  const { city, stateCode, priceMax, priceMin, bedsMin } = params;

  const token = process.env.APIFY_TOKEN;
  if (!token) {
    throw new Error("APIFY_TOKEN not set — cannot query Facebook Marketplace");
  }

  // Build the Facebook Marketplace search URL
  const cityKey = city.toLowerCase();
  const slug = CITY_SLUGS[cityKey] ?? city.toLowerCase().replace(/\s+/g, "");

  const fbUrl = new URL(`https://www.facebook.com/marketplace/${slug}/propertyrentals`);
  if (priceMin != null) fbUrl.searchParams.set("minPrice", String(priceMin));
  if (priceMax != null) fbUrl.searchParams.set("maxPrice", String(priceMax));
  if (bedsMin != null && bedsMin > 0) {
    fbUrl.searchParams.set("query", `${bedsMin} bedroom`);
  }

  const input = {
    startUrls: [{ url: fbUrl.toString() }],
    maxItems: 50,
  };

  console.log(`[FacebookMarketplace] Starting Apify actor run for ${fbUrl.toString()}`);
  const res = await fetch(APIFY_RUN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Apify returned ${res.status}: ${res.statusText} — ${body.slice(0, 500)}`,
    );
  }

  const data = await res.json();

  if (!Array.isArray(data)) {
    throw new Error(
      `Unexpected Apify response shape: ${typeof data === "object" ? Object.keys(data as Record<string, unknown>).join(",") : typeof data}`,
    );
  }

  const items: ApifyFBItem[] = data;
  console.log(`[FacebookMarketplace] Apify returned ${items.length} raw items`);

  const listings: AdapterOutput[] = [];

  for (const item of items) {
    // Skip sold, pending, or hidden items
    if (item.is_sold || item.is_pending || item.is_hidden) continue;

    const title = item.marketplace_listing_title ?? "";
    const customTitle = item.custom_title ?? "";
    const combinedText = `${title} ${customTitle}`;

    // Parse price from structured price object
    const rawPrice = item.listing_price?.amount
      ?? item.listing_price?.formatted_amount
      ?? null;
    const price = parsePrice(rawPrice);

    // Skip items with no price
    if (price == null) continue;

    // Extract beds/baths using shared utilities
    const beds = extractBeds(combinedText);
    const baths = extractBaths(combinedText);

    // Filter by minimum beds if specified
    if (bedsMin != null && beds != null && beds > 0 && beds < bedsMin) continue;

    // Photo URL from primary_listing_photo
    const photoUrls: string[] = [];
    if (item.primary_listing_photo?.photo_image_url) {
      photoUrls.push(item.primary_listing_photo.photo_image_url);
    }

    // Location from reverse_geocode
    const geo = item.location?.reverse_geocode;
    const locationStr = geo?.city_page?.display_name
      ?? (geo?.city && geo?.state ? `${geo.city}, ${geo.state}` : `${city}, ${stateCode}`);

    // Build address from subtitles (street info)
    const subtitles = (item.custom_sub_titles_with_rendering_flags ?? [])
      .map((s) => s.subtitle)
      .filter(Boolean) as string[];
    const address = title || subtitles.join(", ") || null;

    const listingUrl = item.listingUrl ?? "";

    // Skip listings without URLs — can't link or dedup
    if (!listingUrl) continue;

    listings.push({
      address,
      area: locationStr,
      price,
      beds,
      baths,
      sqft: null,
      lat: null,
      lon: null,
      photo_urls: photoUrls,
      url: listingUrl,
      search_tag: makeSearchTag(city),
      list_date: null,
      last_update_date: null,
      availability_date: null,
      source: "facebook" as const,
    });
  }

  return { listings, total: listings.length };
}
