/**
 * Realtor.com data source via Apify actor (replaces RapidAPI wrapper).
 *
 * Uses the Apify realtor scraper to fetch rental listings from Realtor.com
 * search pages. Supports filtering by city, state, beds, baths, and price.
 */

import type { AdapterOutput, SearchParams } from "./types";
import { extractPhotoUrls, parsePrice } from "./parse-utils";

const APIFY_START_URL = "https://api.apify.com/v2/acts/epctex~realtor-scraper/runs";

const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 300_000; // 5 min max

// ---------------------------------------------------------------------------
// Apify response shape for Realtor.com listings
// ---------------------------------------------------------------------------

interface ApifyRealtorItem {
  id?: string;
  url?: string;
  title?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  price?: string | number;
  beds?: string | number;
  baths?: string | number;
  sqft?: string | number;
  latitude?: string | number;
  longitude?: string | number;
  photos?: string[];
  listDate?: string;
  lastUpdate?: string;
  availableDate?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Main fetch function
// ---------------------------------------------------------------------------

export async function fetchRealtorListings(
  params: SearchParams,
  maxItems?: number,
): Promise<{ listings: AdapterOutput[]; total: number }> {
  const { city, stateCode, bedsMin, bathsMin, priceMax, priceMin } = params;

  const token = process.env.APIFY_TOKEN;
  if (!token) {
    throw new Error("APIFY_TOKEN not set — cannot query Realtor via Apify");
  }

  // Build Realtor.com search URL with filters
  const searchUrl = buildRealtorSearchUrl(city, stateCode, bedsMin, bathsMin, priceMin, priceMax);

  const input = {
    startUrls: [{ url: searchUrl }],
    maxItems: maxItems ?? 100,
    maxConcurrency: 4,
  };

  console.log(`[Realtor] Starting Apify actor run for ${searchUrl}`);

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
  console.log(`[Realtor] Run started: ${runId}, dataset: ${datasetId}`);

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
    console.log(`[Realtor] Run status: ${status}`);
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
    throw new Error(`Unexpected Apify response: ${typeof data}`);
  }

  const items: ApifyRealtorItem[] = data;
  console.log(`[Realtor] Apify returned ${items.length} raw items`);

  // 4. Map Apify response to AdapterOutput
  const listings: AdapterOutput[] = [];

  for (const item of items) {
    if (!item.url || !item.address) continue;

    const price = parsePrice(item.price);
    if (price == null || price === 0) continue;

    // Parse beds and baths from Apify response
    const beds = item.beds != null ? parseInt(String(item.beds), 10) : null;
    const baths = item.baths != null ? parseFloat(String(item.baths)) : null;

    // Parse sqft
    const sqft = item.sqft != null ? parseInt(String(item.sqft), 10) : null;

    // Parse coordinates
    const lat = item.latitude != null ? parseFloat(String(item.latitude)) : null;
    const lon = item.longitude != null ? parseFloat(String(item.longitude)) : null;

    // Handle photos: extract URLs and upgrade rdcpix.com thumbnails to 1024px
    let photoUrls = extractPhotoUrls(item.photos ?? [], 20);
    photoUrls = photoUrls.map((u) => u.replace(/s\.jpg$/, "od-w1024_h768.jpg"));

    // Construct area from city/state
    const area = item.city && item.state ? `${item.city}, ${item.state}` : `${city}, ${stateCode}`;

    listings.push({
      address: item.address,
      area,
      price,
      beds: beds != null && !isNaN(beds) ? beds : null,
      baths: baths != null && !isNaN(baths) ? baths : null,
      sqft: sqft != null && !isNaN(sqft) ? sqft : null,
      lat: lat != null && !isNaN(lat) ? lat : null,
      lon: lon != null && !isNaN(lon) ? lon : null,
      photo_urls: photoUrls,
      url: item.url,
      list_date: item.listDate ?? null,
      last_update_date: item.lastUpdate ?? null,
      availability_date: item.availableDate ?? null,
      source: "realtor" as const,
    });
  }

  return { listings, total: listings.length };
}

// ---------------------------------------------------------------------------
// Helper: Build Realtor.com search URL
// ---------------------------------------------------------------------------

function buildRealtorSearchUrl(
  city: string,
  stateCode: string,
  bedsMin?: number,
  bathsMin?: number,
  priceMin?: number,
  priceMax?: number,
): string {
  const params = new URLSearchParams();

  // City and state
  params.set("location", `${city}, ${stateCode}`);

  // Listing type = rentals
  params.set("status", "for-rent");

  // Bed/bath filters
  if (bedsMin != null) params.set("beds_min", String(bedsMin));
  if (bathsMin != null) params.set("baths_min", String(bathsMin));

  // Price filters
  if (priceMin != null) params.set("price_min", String(priceMin));
  if (priceMax != null) params.set("price_max", String(priceMax));

  // Realtor.com base URL for rental search
  return `https://www.realtor.com/apartments/search?${params.toString()}`;
}
