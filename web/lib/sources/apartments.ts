/**
 * Apartments.com data source via RapidAPI.
 *
 * Uses the "apartments-com1" API on RapidAPI.
 * Host: apartments-com1.p.rapidapi.com
 *
 * MISSING FIELDS vs Realtor.com:
 *  - sqft              (not provided by Apartments.com API)
 *  - last_update_date  (not provided)
 *  - availability_date (not provided)
 */

import type { AdapterOutput, SearchParams } from "./types";
import { extractPhotoUrls, makeSearchTag, parsePrice } from "./parse-utils";

const RAPIDAPI_HOST = "apartments-com1.p.rapidapi.com";
const TIMEOUT_MS = 15_000;

export async function fetchApartmentsListings(
  params: SearchParams,
  apiKey: string,
): Promise<{ listings: AdapterOutput[]; total: number }> {
  const { city, stateCode, bedsMin, bathsMin, priceMax, priceMin } = params;

  const queryParams = new URLSearchParams();
  queryParams.set("location", `${city}, ${stateCode}`);
  queryParams.set("min_price", String(priceMin ?? 0));
  if (priceMax != null) queryParams.set("max_price", String(priceMax));
  if (bedsMin != null) queryParams.set("min_bedrooms", String(bedsMin));
  if (bathsMin != null) queryParams.set("min_bathrooms", String(bathsMin));

  const res = await fetch(
    `https://${RAPIDAPI_HOST}/properties?${queryParams.toString()}`,
    {
      method: "GET",
      headers: {
        "X-RapidAPI-Key": apiKey,
        "X-RapidAPI-Host": RAPIDAPI_HOST,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apartments.com API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: any[] = Array.isArray(data) ? data : (data?.properties ?? data?.data ?? []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listings: AdapterOutput[] = results.map((r: any) => {
    const lat = r.latitude ?? r.location?.lat ?? r.geo?.lat ?? null;
    const lon = r.longitude ?? r.location?.lng ?? r.location?.lon ?? r.geo?.lng ?? null;
    const address = r.address ?? r.streetAddress ?? r.location?.address ?? null;
    const cityName = r.city ?? r.location?.city ?? city;
    const state = r.state ?? r.location?.state ?? stateCode;
    const rawPrice = r.price ?? r.rent ?? r.min_rent ?? r.rentRange?.min ?? null;
    const rawBeds = r.bedrooms ?? r.beds ?? r.min_bedrooms ?? null;
    const rawBaths = r.bathrooms ?? r.baths ?? r.min_bathrooms ?? null;
    const photoUrls = extractPhotoUrls(r.photos ?? r.images ?? r.photo_urls ?? []);
    const url = r.url ?? r.link ?? r.detail_url ?? "";

    return {
      address,
      area: `${cityName}, ${state}`,
      price: parsePrice(rawPrice),
      beds: rawBeds != null ? (typeof rawBeds === "string" ? parseInt(rawBeds, 10) || null : rawBeds) : null,
      baths: rawBaths != null ? (typeof rawBaths === "string" ? parseFloat(rawBaths) || null : rawBaths) : null,
      sqft: null,
      lat,
      lon,
      photo_urls: photoUrls,
      url,
      search_tag: makeSearchTag(city),
      list_date: r.listed_date ?? r.list_date ?? null,
      last_update_date: null,
      availability_date: null,
      source: "apartments" as const,
    };
  });

  return { listings, total: listings.length };
}
