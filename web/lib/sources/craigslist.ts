/**
 * Craigslist NYC apartment scraper via Apify (ivanvs/craigslist-scraper).
 *
 * Uses the Apify actor with proxy support to bypass CL's bot protection.
 * Returns photos, lat/lng, and availability dates directly.
 */

import type { AdapterOutput, SearchParams } from "./types";
import { extractBaths, extractBeds, parsePrice } from "./parse-utils";

// maxItems is a platform-level run option (not an actor input param), so it's
// appended as a query parameter on the run URL to cap pay-per-result costs.
const CL_MAX_ITEMS = 50;
const APIFY_START_URL =
  `https://api.apify.com/v2/acts/ivanvs~craigslist-scraper-pay-per-result/runs?maxItems=${CL_MAX_ITEMS}`;

const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 300_000; // 5 min max

// ---------------------------------------------------------------------------
// Apify response shape for housing listings
// ---------------------------------------------------------------------------

interface ApifyCLItem {
  id?: string;
  url?: string;
  title?: string;
  datetime?: string;
  location?: string;
  category?: string;
  price?: string;
  longitude?: string;
  latitude?: string;
  post?: string;
  pics?: string[];
  amenities?: string[];
  availableFrom?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Main fetch function
// ---------------------------------------------------------------------------

export async function fetchCraigslistListings(
  params: SearchParams,
): Promise<{ listings: AdapterOutput[]; total: number }> {
  const { city, bedsMin, priceMax, priceMin } = params;

  const token = process.env.APIFY_TOKEN;
  if (!token) {
    throw new Error("APIFY_TOKEN not set — cannot query Craigslist via Apify");
  }

  // Build Craigslist search URL with filters
  const queryParams = new URLSearchParams();
  if (priceMin != null) queryParams.set("min_price", String(priceMin));
  if (priceMax != null) queryParams.set("max_price", String(priceMax));
  if (bedsMin != null) queryParams.set("min_bedrooms", String(bedsMin));
  queryParams.set("availabilityMode", "0");

  const clUrl = `https://newyork.craigslist.org/search/apa?${queryParams.toString()}#search=1~list~0~0`;

  const input = {
    urls: [{ url: clUrl }],
    proxyConfiguration: { useApifyProxy: true },
    maxAge: 30,
    maxConcurrency: 4,
  };

  console.log(`[Craigslist] Starting Apify actor run for ${clUrl}`);

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
  console.log(`[Craigslist] Run started: ${runId}, dataset: ${datasetId}`);

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
    console.log(`[Craigslist] Run status: ${status}`);
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

  const items: ApifyCLItem[] = data;
  console.log(`[Craigslist] Apify returned ${items.length} raw items`);

  const listings: AdapterOutput[] = [];

  for (const item of items) {
    if (!item.url || !item.title) continue;

    const price = parsePrice(item.price);
    if (price == null || price === 0) continue;

    // Extract beds/baths from title + post body
    const combinedText = `${item.title} ${item.post ?? ""}`;
    const beds = extractBeds(combinedText);
    const baths = extractBaths(combinedText);

    const lat = item.latitude ? parseFloat(item.latitude) : null;
    const lon = item.longitude ? parseFloat(item.longitude) : null;

    listings.push({
      address: item.title,
      area: item.location || "New York, NY",
      price,
      beds,
      baths,
      sqft: null,
      lat: lat && !isNaN(lat) ? lat : null,
      lon: lon && !isNaN(lon) ? lon : null,
      photo_urls: (item.pics ?? []).slice(0, 8),
      url: item.url,
      list_date: item.datetime ?? null,
      last_update_date: null,
      availability_date: item.availableFrom ?? null,
      source: "craigslist" as const,
      external_id: item.id ?? null,
    });
  }

  return { listings, total: listings.length };
}
