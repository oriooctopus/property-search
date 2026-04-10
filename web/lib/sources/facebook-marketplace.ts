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
import { extractBaths, extractBeds, parsePrice } from "./parse-utils";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Supabase storage client for persisting Facebook CDN photos
// ---------------------------------------------------------------------------

function getStorageClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * Download a Facebook CDN photo and re-upload it to Supabase Storage.
 * Returns the permanent public URL, or null on failure.
 */
async function persistPhoto(
  cdnUrl: string,
  listingId: string,
  index: number,
): Promise<string | null> {
  try {
    const sb = getStorageClient();
    if (!sb) return null;

    const res = await fetch(cdnUrl, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpg";
    const buffer = Buffer.from(await res.arrayBuffer());
    const path = `facebook/${listingId}/${index}.${ext}`;

    const { error } = await sb.storage
      .from("listing-photos")
      .upload(path, buffer, { contentType, upsert: true });
    if (error) {
      console.warn(`[FacebookMarketplace] Storage upload failed for ${listingId}:`, error.message);
      return null;
    }

    const { data } = sb.storage.from("listing-photos").getPublicUrl(path);
    return data.publicUrl;
  } catch (err) {
    console.warn(
      `[FacebookMarketplace] Photo persist failed for ${listingId}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

const APIFY_START_URL =
  "https://api.apify.com/v2/acts/apify~facebook-marketplace-scraper/runs";

const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 300_000; // 5 min max wait for actor run

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
    resultsLimit: 200,
  };

  console.log(`[FacebookMarketplace] Starting Apify actor run for ${fbUrl.toString()}`);

  // 1. Start the actor run (async)
  const startRes = await fetch(APIFY_START_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(30_000),
  });

  if (!startRes.ok) {
    const body = await startRes.text().catch(() => "");
    throw new Error(`Apify start failed ${startRes.status}: ${body.slice(0, 500)}`);
  }

  const runInfo = (await startRes.json()) as { data?: { id?: string; defaultDatasetId?: string } };
  const runId = runInfo.data?.id;
  const datasetId = runInfo.data?.defaultDatasetId;
  if (!runId || !datasetId) {
    throw new Error(`Apify run missing id/datasetId: ${JSON.stringify(runInfo).slice(0, 300)}`);
  }
  console.log(`[FacebookMarketplace] Run started: ${runId}, dataset: ${datasetId}`);

  // 2. Poll for completion
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!statusRes.ok) continue;
    const statusData = (await statusRes.json()) as { data?: { status?: string } };
    const status = statusData.data?.status;
    console.log(`[FacebookMarketplace] Run status: ${status}`);
    if (status === "SUCCEEDED") break;
    if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
      throw new Error(`Apify run ${status}`);
    }
  }

  // 3. Fetch dataset items
  const datasetRes = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?format=json`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!datasetRes.ok) {
    throw new Error(`Apify dataset fetch failed: ${datasetRes.status}`);
  }

  const data = await datasetRes.json();

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

    // Photo URL from primary_listing_photo — persist to Supabase Storage
    const photoUrls: string[] = [];
    const fbPhotoUrl = item.primary_listing_photo?.photo_image_url;
    if (fbPhotoUrl && item.id) {
      const permanentUrl = await persistPhoto(fbPhotoUrl, item.id, 0);
      if (permanentUrl) {
        photoUrls.push(permanentUrl);
      }
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
      list_date: null,
      last_update_date: null,
      availability_date: null,
      source: "facebook-marketplace" as const,
      external_id: item.id ?? null,
    });
  }

  return { listings, total: listings.length };
}
