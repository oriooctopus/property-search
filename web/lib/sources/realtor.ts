/**
 * Realtor.com data source via RapidAPI (existing logic extracted).
 */

import type { AdapterOutput, SearchParams } from "./types";
import { extractPhotoUrls, makeSearchTag, parsePrice } from "./parse-utils";

const RAPIDAPI_HOST = "realty-in-us.p.rapidapi.com";
const TIMEOUT_MS = 15_000;

export async function fetchRealtorListings(
  params: SearchParams,
  apiKey: string,
): Promise<{ listings: AdapterOutput[]; total: number }> {
  const { city, stateCode, bedsMin, bathsMin, priceMax, priceMin } = params;

  const apiBody: Record<string, unknown> = {
    limit: 200,
    offset: 0,
    city,
    state_code: stateCode,
    status: ["for_rent"],
    sort: { direction: "desc", field: "list_date" },
  };

  if (bedsMin != null) apiBody.beds = { min: bedsMin };
  if (bathsMin != null) apiBody.baths = { min: bathsMin };
  if (priceMax != null || priceMin != null) {
    const price: Record<string, number> = {};
    if (priceMin != null) price.min = priceMin;
    if (priceMax != null) price.max = priceMax;
    apiBody.list_price = price;
  }

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
  const results: any[] = data?.data?.home_search?.results ?? [];
  const total: number = data?.data?.home_search?.total ?? 0;

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
      search_tag: makeSearchTag(city),
      list_date: r.list_date ?? null,
      last_update_date: r.last_update_date ?? null,
      availability_date: desc.available_date ?? null,
      source: "realtor" as const,
    };
  });

  return { listings, total };
}
