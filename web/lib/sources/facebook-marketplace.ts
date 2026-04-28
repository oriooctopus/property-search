// Disabled 2026-04-28 — user retired FB Marketplace from active ingest.
// The adapter is kept for reference; do not call it from the pipeline.
// FB-Marketplace is excluded from ALL_SOURCES, SCRAPER_SOURCES, and
// VERIFY_SOURCES. Strategies.ts throws if it's somehow invoked.
/**
 * Facebook Marketplace adapter via Apify Facebook Marketplace Scraper.
 *
 * Uses the apify~facebook-marketplace-scraper actor with startUrls pointing
 * to Facebook Marketplace search URLs. Two-phase scrape:
 *   1. Search scrape — gets listing URLs from the feed (~400 items)
 *   2. Detail scrape — hits each listing URL to get coordinates, full photos,
 *      and description
 *
 * After detail scrape, listings are filtered by a NYC 5-borough bounding box
 * to reject anything outside the city.
 *
 * MISSING / UNRELIABLE FIELDS vs Realtor.com:
 *  - sqft              (not provided)
 *  - list_date         (not provided)
 *  - last_update_date  (not provided)
 *  - availability_date (not provided)
 */

import type { AdapterOutput, SearchParams } from "./types";
import { extractBaths, extractBeds, parsePrice } from "./parse-utils";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// NYC 5-borough bounding box
// ---------------------------------------------------------------------------

const NYC_BOUNDS = {
  latMin: 40.49,
  latMax: 40.92,
  lonMin: -74.26,
  lonMax: -73.68,
} as const;

function isInNYC(lat: number, lon: number): boolean {
  return (
    lat >= NYC_BOUNDS.latMin &&
    lat <= NYC_BOUNDS.latMax &&
    lon >= NYC_BOUNDS.lonMin &&
    lon <= NYC_BOUNDS.lonMax
  );
}

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
const DETAIL_MAX_WAIT_MS = 600_000; // 10 min for detail scrape (many pages)

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
// Apify response shapes
// ---------------------------------------------------------------------------

/** Shape returned by the search/feed scrape (listing cards). */
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

/** Shape returned by the detail page scrape (individual listing pages). */
interface ApifyFBDetailItem {
  id?: string;
  listingTitle?: string;
  description?: { text?: string };
  listingPrice?: { amount?: string; currency?: string };
  location?: {
    latitude?: number;
    longitude?: number;
    reverse_geocode_detailed?: {
      city?: string;
      state?: string;
      postal_code?: string;
    };
  };
  listingPhotos?: Array<{
    image?: { uri?: string; height?: number; width?: number };
    id?: string;
  }>;
  itemUrl?: string;
  details?: Array<{
    section_type?: string;
    pdp_fields?: unknown[];
  }>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Apify helpers
// ---------------------------------------------------------------------------

/**
 * Start an Apify actor run and wait for it to complete.
 * Returns the dataset items as a JSON array.
 */
async function runApifyActor(
  input: Record<string, unknown>,
  token: string,
  label: string,
  maxWaitMs: number = MAX_WAIT_MS,
): Promise<unknown[]> {
  console.log(`[FacebookMarketplace] Starting Apify actor run: ${label}`);

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
    throw new Error(`Apify start failed (${label}) ${startRes.status}: ${body.slice(0, 500)}`);
  }

  const runInfo = (await startRes.json()) as { data?: { id?: string; defaultDatasetId?: string } };
  const runId = runInfo.data?.id;
  const datasetId = runInfo.data?.defaultDatasetId;
  if (!runId || !datasetId) {
    throw new Error(`Apify run missing id/datasetId (${label}): ${JSON.stringify(runInfo).slice(0, 300)}`);
  }
  console.log(`[FacebookMarketplace] ${label} run started: ${runId}, dataset: ${datasetId}`);

  // Poll for completion
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!statusRes.ok) continue;
    const statusData = (await statusRes.json()) as { data?: { status?: string } };
    const status = statusData.data?.status;
    console.log(`[FacebookMarketplace] ${label} status: ${status}`);
    if (status === "SUCCEEDED") break;
    if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
      throw new Error(`Apify run ${status} (${label})`);
    }
  }

  // Fetch dataset items
  const datasetRes = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?format=json`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!datasetRes.ok) {
    throw new Error(`Apify dataset fetch failed (${label}): ${datasetRes.status}`);
  }

  const data = await datasetRes.json();
  if (!Array.isArray(data)) {
    throw new Error(
      `Unexpected Apify response shape (${label}): ${typeof data === "object" ? Object.keys(data as Record<string, unknown>).join(",") : typeof data}`,
    );
  }

  return data;
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

  // -----------------------------------------------------------------------
  // Phase 1: Search scrape — get listing URLs from the feed
  // -----------------------------------------------------------------------

  const searchInput = {
    startUrls: [{ url: fbUrl.toString() }],
    resultsLimit: 400,
  };

  const searchData = await runApifyActor(searchInput, token, "search-scrape");
  const searchItems: ApifyFBItem[] = searchData as ApifyFBItem[];
  console.log(`[FacebookMarketplace] Search scrape returned ${searchItems.length} raw items`);

  // Collect listing URLs for detail scrape, filtering out sold/pending/hidden
  // and items without URLs or IDs
  const listingUrls: Array<{ url: string }> = [];
  const searchItemById = new Map<string, ApifyFBItem>();

  for (const item of searchItems) {
    if (item.is_sold || item.is_pending || item.is_hidden) continue;
    if (!item.listingUrl || !item.id) continue;
    listingUrls.push({ url: item.listingUrl });
    searchItemById.set(item.id, item);
  }

  console.log(`[FacebookMarketplace] ${listingUrls.length} valid listing URLs for detail scrape`);

  if (listingUrls.length === 0) {
    return { listings: [], total: 0 };
  }

  // -----------------------------------------------------------------------
  // Dedup: skip detail scraping for URLs already in the database
  // -----------------------------------------------------------------------

  let newUrls = listingUrls;
  const existingUrls: string[] = [];

  const sb = getStorageClient();
  if (sb) {
    try {
      // Fetch all existing FB marketplace URLs from the DB
      const allSearchUrls = listingUrls.map((u) => u.url);
      const { data: existingRows, error } = await sb
        .from("listings")
        .select("url")
        .eq("source", "facebook-marketplace")
        .in("url", allSearchUrls);

      if (!error && existingRows) {
        const existingUrlSet = new Set(existingRows.map((r: { url: string }) => r.url));
        newUrls = listingUrls.filter((u) => !existingUrlSet.has(u.url));
        for (const u of listingUrls) {
          if (existingUrlSet.has(u.url)) existingUrls.push(u.url);
        }

        console.log(
          `[FacebookMarketplace] Dedup: ${existingUrls.length} already in DB, ${newUrls.length} new — detail-scraping new only`,
        );

        // Bump last_seen_at for existing listings so cleanup-stale doesn't
        // mark them as stale. The upsert phase only touches rows in the
        // adapter output, so we do a direct UPDATE here.
        if (existingUrls.length > 0) {
          const now = new Date().toISOString();
          // Supabase .in() has a limit; batch in chunks of 200
          for (let i = 0; i < existingUrls.length; i += 200) {
            const chunk = existingUrls.slice(i, i + 200);
            const { error: updateErr } = await sb
              .from("listings")
              .update({ last_seen_at: now })
              .in("url", chunk);
            if (updateErr) {
              console.warn(
                `[FacebookMarketplace] Failed to bump last_seen_at for ${chunk.length} existing URLs:`,
                updateErr.message,
              );
            }
          }
          console.log(
            `[FacebookMarketplace] Bumped last_seen_at for ${existingUrls.length} existing listings`,
          );
        }
      } else if (error) {
        console.warn(
          `[FacebookMarketplace] Dedup query failed, detail-scraping all URLs:`,
          error.message,
        );
      }
    } catch (err) {
      console.warn(
        `[FacebookMarketplace] Dedup check failed, detail-scraping all URLs:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (newUrls.length === 0) {
    console.log(`[FacebookMarketplace] All ${listingUrls.length} URLs already in DB — skipping detail scrape`);
    return { listings: [], total: 0 };
  }

  // -----------------------------------------------------------------------
  // Phase 2: Detail scrape — get coordinates, full photos, description
  // -----------------------------------------------------------------------

  const detailInput = {
    startUrls: newUrls,
  };

  const detailData = await runApifyActor(detailInput, token, "detail-scrape", DETAIL_MAX_WAIT_MS);
  const detailItems: ApifyFBDetailItem[] = detailData as ApifyFBDetailItem[];
  console.log(`[FacebookMarketplace] Detail scrape returned ${detailItems.length} items`);

  // Index detail items by ID for easy lookup
  const detailById = new Map<string, ApifyFBDetailItem>();
  for (const detail of detailItems) {
    if (detail.id) {
      detailById.set(detail.id, detail);
    }
  }

  // -----------------------------------------------------------------------
  // Phase 3: Merge search + detail data, filter by bounding box, persist photos
  // -----------------------------------------------------------------------

  const listings: AdapterOutput[] = [];
  let skippedNoCoords = 0;
  let skippedOutsideNYC = 0;

  for (const [id, searchItem] of searchItemById) {
    const detail = detailById.get(id);

    // Get coordinates from detail page
    const lat = detail?.location?.latitude;
    const lon = detail?.location?.longitude;

    // Skip listings without coordinates (some detail pages don't return them)
    if (lat == null || lon == null) {
      skippedNoCoords++;
      continue;
    }

    // Filter by NYC 5-borough bounding box
    if (!isInNYC(lat, lon)) {
      skippedOutsideNYC++;
      continue;
    }

    // Use detail title if available, fall back to search title
    const title = detail?.listingTitle
      ?? searchItem.marketplace_listing_title
      ?? "";
    const customTitle = searchItem.custom_title ?? "";
    const combinedText = `${title} ${customTitle}`;

    // Parse price — prefer detail page price, fall back to search price
    const rawPrice = detail?.listingPrice?.amount
      ?? searchItem.listing_price?.amount
      ?? searchItem.listing_price?.formatted_amount
      ?? null;
    const price = parsePrice(rawPrice);

    // Skip items with no price
    if (price == null) continue;

    // Extract beds/baths using shared utilities
    const beds = extractBeds(combinedText);
    const baths = extractBaths(combinedText);

    // Filter by minimum beds if specified
    if (bedsMin != null && beds != null && beds > 0 && beds < bedsMin) continue;

    // Persist ALL photos from detail page's listingPhotos array
    const photoUrls: string[] = [];
    const detailPhotos = detail?.listingPhotos ?? [];

    if (detailPhotos.length > 0) {
      // Use all photos from the detail page
      const photoPromises = detailPhotos.map((photo, index) => {
        const uri = photo.image?.uri;
        if (!uri) return Promise.resolve(null);
        return persistPhoto(uri, id, index);
      });
      const results = await Promise.all(photoPromises);
      for (const url of results) {
        if (url) photoUrls.push(url);
      }
    } else {
      // Fall back to single primary_listing_photo from search
      const fbPhotoUrl = searchItem.primary_listing_photo?.photo_image_url;
      if (fbPhotoUrl) {
        const permanentUrl = await persistPhoto(fbPhotoUrl, id, 0);
        if (permanentUrl) photoUrls.push(permanentUrl);
      }
    }

    // Location string from detail or search
    const detailGeo = detail?.location?.reverse_geocode_detailed;
    const searchGeo = searchItem.location?.reverse_geocode;
    const locationStr = detailGeo?.city && detailGeo?.state
      ? `${detailGeo.city}, ${detailGeo.state}`
      : searchGeo?.city_page?.display_name
        ?? (searchGeo?.city && searchGeo?.state ? `${searchGeo.city}, ${searchGeo.state}` : `${city}, ${stateCode}`);

    // Build address from title or subtitles
    const subtitles = (searchItem.custom_sub_titles_with_rendering_flags ?? [])
      .map((s) => s.subtitle)
      .filter(Boolean) as string[];
    const address = title || subtitles.join(", ") || null;

    const listingUrl = detail?.itemUrl ?? searchItem.listingUrl ?? "";
    if (!listingUrl) continue;

    listings.push({
      address,
      area: locationStr,
      price,
      beds,
      baths,
      sqft: null,
      lat,
      lon,
      photo_urls: photoUrls,
      url: listingUrl,
      list_date: null,
      last_update_date: null,
      availability_date: null,
      source: "facebook-marketplace" as const,
      external_id: id,
    });
  }

  console.log(
    `[FacebookMarketplace] Final: ${listings.length} listings ` +
    `(skipped ${skippedNoCoords} no-coords, ${skippedOutsideNYC} outside NYC)`,
  );

  return { listings, total: listings.length };
}
