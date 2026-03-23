/**
 * Realtor.com data source via RapidAPI (existing logic extracted).
 */

import type { RawListing, SearchParams } from "./types";

const RAPIDAPI_HOST = "realty-in-us.p.rapidapi.com";

export async function fetchRealtorListings(
  params: SearchParams,
  apiKey: string,
): Promise<{ listings: RawListing[]; total: number }> {
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
  const listings: RawListing[] = results.map((r: any) => {
    const loc = r.location?.address ?? {};
    const desc = r.description ?? {};
    const coord = loc.coordinate ?? {};
    const href = r.href
      ? r.href.startsWith("http")
        ? r.href
        : `https://www.realtor.com${r.href}`
      : "";

    return {
      address: loc.line ?? "",
      area: `${loc.city ?? city}, ${loc.state_code ?? stateCode}`,
      price: r.list_price ?? 0,
      beds: desc.beds ?? 0,
      baths: (desc.baths_full ?? 0) + (desc.baths_half ?? 0) * 0.5,
      sqft: desc.sqft ?? null,
      lat: coord.lat ?? 0,
      lon: coord.lon ?? 0,
      photos: r.photo_count ?? 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      photo_urls: (r.photos ?? []).slice(0, 6).map((p: any) => p.href),
      url: href,
      search_tag: `search_${city.toLowerCase().replace(/\s+/g, "_")}`,
      list_date: r.list_date ?? null,
      last_update_date: r.last_update_date ?? null,
      availability_date: r.description?.available_date ?? null,
      source: "realtor" as const,
    };
  });

  return { listings, total };
}
