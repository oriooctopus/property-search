/**
 * Realtor.com data source via RapidAPI (existing logic extracted).
 */

import type { AdapterOutput, SearchParams } from "./types";
import { extractPhotoUrls, parsePrice } from "./parse-utils";

const RAPIDAPI_HOST = "realty-in-us.p.rapidapi.com";
const TIMEOUT_MS = 15_000;
const PAGE_SIZE = 200;
const MAX_PAGES = 5; // Up to 1000 listings per city
const DETAIL_BATCH_SIZE = 5;
const DETAIL_DELAY_MS = 200;

/** Fetch full photos for a single property via the detail endpoint (GET). */
async function fetchDetailPhotos(
  propertyId: string,
  apiKey: string,
): Promise<string[]> {
  try {
    const res = await fetch(
      `https://${RAPIDAPI_HOST}/properties/v3/detail?property_id=${propertyId}`,
      {
        method: "GET",
        headers: {
          "X-RapidAPI-Key": apiKey,
          "X-RapidAPI-Host": RAPIDAPI_HOST,
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return [];
    const data = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const photos: any[] = data?.data?.home?.photos ?? [];
    return photos
      .map((p: { href?: string }) => p.href)
      .filter((u): u is string => typeof u === "string" && u.length > 0)
      .map((u) => u.replace(/s\.jpg$/, "od-w1024_h768.jpg"))
      .slice(0, 20);
  } catch {
    return [];
  }
}

/** Batch-fetch detail photos for listings that only got primary_photo. */
async function backfillPhotos(
  listings: AdapterOutput[],
  results: { property_id?: string; [key: string]: unknown }[],
  apiKey: string,
): Promise<void> {
  const needsPhotos = listings
    .map((l, i) => ({ listing: l, propertyId: results[i]?.property_id, idx: i }))
    .filter((item): item is { listing: AdapterOutput; propertyId: string; idx: number } =>
      item.listing.photo_urls.length <= 1 && typeof item.propertyId === "string",
    );

  console.log(`[Realtor] Backfilling photos for ${needsPhotos.length}/${listings.length} listings`);

  for (let i = 0; i < needsPhotos.length; i += DETAIL_BATCH_SIZE) {
    const batch = needsPhotos.slice(i, i + DETAIL_BATCH_SIZE);
    const photoResults = await Promise.all(
      batch.map(({ propertyId }) => fetchDetailPhotos(propertyId, apiKey)),
    );
    for (let j = 0; j < batch.length; j++) {
      if (photoResults[j].length > 0) {
        batch[j].listing.photo_urls = photoResults[j];
      }
    }
    if (i + DETAIL_BATCH_SIZE < needsPhotos.length) {
      await new Promise((r) => setTimeout(r, DETAIL_DELAY_MS));
    }
  }
}

export async function fetchRealtorListings(
  params: SearchParams,
  apiKey: string,
): Promise<{ listings: AdapterOutput[]; total: number }> {
  const { city, stateCode, bedsMin, bathsMin, priceMax, priceMin } = params;

  const baseBody: Record<string, unknown> = {
    limit: PAGE_SIZE,
    offset: 0,
    city,
    state_code: stateCode,
    status: ["for_rent"],
    sort: { direction: "desc", field: "list_date" },
  };

  if (bedsMin != null) baseBody.beds = { min: bedsMin };
  if (bathsMin != null) baseBody.baths = { min: bathsMin };
  if (priceMax != null || priceMin != null) {
    const price: Record<string, number> = {};
    if (priceMin != null) price.min = priceMin;
    if (priceMax != null) price.max = priceMax;
    baseBody.list_price = price;
  }

  // Paginate through results
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: any[] = [];
  let total = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const apiBody = { ...baseBody, offset: page * PAGE_SIZE };
    console.log(`[Realtor] Fetching page ${page + 1} (offset ${apiBody.offset})`);

    const res = await fetch(`https://${RAPIDAPI_HOST}/properties/v3/list`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-RapidAPI-Key": apiKey,
        "X-RapidAPI-Host": RAPIDAPI_HOST,
      },
      body: JSON.stringify(apiBody),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Realtor API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pageResults: any[] = data?.data?.home_search?.results ?? [];
    if (page === 0) total = data?.data?.home_search?.total ?? 0;

    results.push(...pageResults);
    console.log(`[Realtor] Page ${page + 1}: ${pageResults.length} results (${results.length}/${total} total)`);

    // Stop if we got everything or this page was empty/short
    if (pageResults.length < PAGE_SIZE || results.length >= total) break;

    // Rate limit between pages
    await new Promise((r) => setTimeout(r, 500));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listings: AdapterOutput[] = results.map((r: any) => {
    const loc = r.location?.address ?? {};
    const desc = r.description ?? {};
    const coord = loc.coordinate ?? {};
    const href = r.href
      ? r.href.startsWith("http")
        ? r.href
        : `https://www.realtor.com${r.href}`
      : "";

    // Photo extraction with Realtor-specific URL upgrade
    const photosArr = r.photos ?? [];
    let photoUrls = extractPhotoUrls(photosArr, 10);
    if (photoUrls.length === 0 && r.primary_photo?.href) {
      photoUrls = [r.primary_photo.href];
    }
    // Upgrade rdcpix.com thumbnails to 1024px
    photoUrls = photoUrls.map((u) => u.replace(/s\.jpg$/, "od-w1024_h768.jpg"));

    const bathsFull = desc.baths_full ?? null;
    const bathsHalf = desc.baths_half ?? null;
    const baths = bathsFull != null || bathsHalf != null
      ? (bathsFull ?? 0) + (bathsHalf ?? 0) * 0.5
      : null;

    return {
      address: loc.line ?? null,
      area: `${loc.city ?? city}, ${loc.state_code ?? stateCode}`,
      price: parsePrice(r.list_price),
      beds: desc.beds ?? null,
      baths,
      sqft: desc.sqft ?? null,
      lat: coord.lat ?? null,
      lon: coord.lon ?? null,
      photo_urls: photoUrls,
      url: href,
      list_date: r.list_date ?? null,
      last_update_date: r.last_update_date ?? null,
      availability_date: desc.available_date ?? null,
      source: "realtor" as const,
    };
  });

  // Backfill full photo galleries for listings that only got primary_photo
  await backfillPhotos(listings, results, apiKey);

  return { listings, total };
}
