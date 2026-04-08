/**
 * Zillow data source via RapidAPI (Real-Time Zillow Data by OpenWebNinja).
 *
 * API host: real-time-zillow-data.p.rapidapi.com
 * Supports nationwide rental search.
 */

import type { AdapterOutput, SearchParams } from "./types";
import { extractPhotoUrls, parsePrice } from "./parse-utils";

const RAPIDAPI_HOST = "real-time-zillow-data.p.rapidapi.com";
const TIMEOUT_MS = 15_000;

export async function fetchZillowListings(
  params: SearchParams,
  apiKey: string,
): Promise<{ listings: AdapterOutput[]; total: number }> {
  const { city, stateCode, bedsMin, priceMax, priceMin } = params;

  const queryParams = new URLSearchParams();
  queryParams.set("location", `${city}, ${stateCode}`);
  queryParams.set("home_type", "Apartments");
  queryParams.set("status", "forRent");
  queryParams.set("sort", "Newest");

  if (bedsMin != null) queryParams.set("beds_min", String(bedsMin));
  if (priceMin != null) queryParams.set("price_min", String(priceMin));
  if (priceMax != null) queryParams.set("price_max", String(priceMax));

  const url = `https://${RAPIDAPI_HOST}/propertyByArea?${queryParams.toString()}`;
  console.log(`[Zillow] Fetching: ${url}`);

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "X-RapidAPI-Key": apiKey,
      "X-RapidAPI-Host": RAPIDAPI_HOST,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zillow API error ${res.status}: ${text}`);
  }

  const data = await res.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: any[] =
    data?.results ?? data?.props ?? data?.properties ?? data?.data ?? [];
  const total: number =
    data?.totalResultCount ?? data?.total ?? results.length;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listings: AdapterOutput[] = results.map((r: any) => {
    const address =
      r.streetAddress ?? r.address ?? r.addressStreet ?? r.formattedAddress ?? null;
    const cityName = r.city ?? r.addressCity ?? city;
    const state = r.state ?? r.addressState ?? stateCode;
    const rawPrice = r.price ?? r.rentZestimate ?? r.zestimate ?? r.unformattedPrice ?? null;
    const beds = r.bedrooms ?? r.beds ?? null;
    const baths = r.bathrooms ?? r.baths ?? null;
    const sqft = r.livingArea ?? r.sqft ?? r.area ?? r.lotAreaValue ?? null;
    const lat = r.latitude ?? r.lat ?? null;
    const lon = r.longitude ?? r.lng ?? r.lon ?? null;

    // Zillow has multiple photo sources — combine them
    const photoUrls: string[] = [];
    if (r.imgSrc) photoUrls.push(r.imgSrc);
    const carouselUrls = extractPhotoUrls(r.carouselPhotos ?? [], 7);
    const imageUrls = extractPhotoUrls(r.images ?? [], 8);
    for (const u of [...carouselUrls, ...imageUrls]) {
      if (!photoUrls.includes(u)) photoUrls.push(u);
    }

    const listingUrl =
      r.detailUrl ?? r.url ?? r.hdpUrl ??
      (r.zpid ? `https://www.zillow.com/homedetails/${r.zpid}_zpid/` : "");
    const fullUrl = listingUrl.startsWith("http")
      ? listingUrl
      : listingUrl
        ? `https://www.zillow.com${listingUrl}`
        : "";

    return {
      address,
      area: `${cityName}, ${state}`,
      price: parsePrice(rawPrice),
      beds,
      baths,
      sqft: sqft ? Number(sqft) : null,
      lat,
      lon,
      photo_urls: photoUrls.slice(0, 10),
      url: fullUrl,
      list_date: r.datePosted ?? r.listDate ?? r.timeOnZillow ?? null,
      last_update_date: r.dateSold ?? r.lastUpdated ?? null,
      availability_date: r.availableDate ?? null,
      source: "zillow" as const,
    };
  });

  console.log(`[Zillow] Found ${listings.length} listings (total: ${total})`);
  return { listings, total };
}
