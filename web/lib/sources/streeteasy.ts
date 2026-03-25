/**
 * StreetEasy data source via RapidAPI.
 *
 * API host: streeteasy-api.p.rapidapi.com
 * NYC-only rental listings.
 */

import type { AdapterOutput, SearchParams } from "./types";
import { extractPhotoUrls, makeSearchTag, parsePrice } from "./parse-utils";

const RAPIDAPI_HOST = "streeteasy-api.p.rapidapi.com";
const TIMEOUT_MS = 15_000;

export async function fetchStreetEasyListings(
  params: SearchParams,
  apiKey: string,
): Promise<{ listings: AdapterOutput[]; total: number }> {
  const { city, stateCode, bedsMin, priceMax, priceMin } = params;

  // StreetEasy is NYC-only — skip if not targeting New York
  const isNYC =
    city.toLowerCase().includes("new york") ||
    city.toLowerCase().includes("nyc") ||
    city.toLowerCase().includes("manhattan") ||
    city.toLowerCase().includes("brooklyn") ||
    city.toLowerCase().includes("queens") ||
    (stateCode.toUpperCase() === "NY" &&
      ["bronx", "staten island"].some((b) =>
        city.toLowerCase().includes(b),
      ));

  if (!isNYC && stateCode.toUpperCase() !== "NY") {
    console.log("[StreetEasy] Skipping — not a NYC search");
    return { listings: [], total: 0 };
  }

  // Build query params for the active-rentals endpoint
  const queryParams = new URLSearchParams();
  queryParams.set("limit", "200");
  queryParams.set("offset", "0");

  // Map city to StreetEasy area codes
  const areaMap: Record<string, string> = {
    manhattan: "100",
    brooklyn: "200",
    queens: "300",
    bronx: "400",
    "staten island": "500",
  };

  const cityLower = city.toLowerCase();
  const matchedArea = Object.entries(areaMap).find(([key]) =>
    cityLower.includes(key),
  );
  if (matchedArea) {
    queryParams.set("areas", matchedArea[1]);
  }

  if (priceMin != null) queryParams.set("minPrice", String(priceMin));
  if (priceMax != null) queryParams.set("maxPrice", String(priceMax));
  if (bedsMin != null) queryParams.set("minBeds", String(bedsMin));

  const url = `https://${RAPIDAPI_HOST}/rentals/search?${queryParams.toString()}`;
  console.log(`[StreetEasy] Fetching: ${url}`);

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
    throw new Error(`StreetEasy API error ${res.status}: ${text}`);
  }

  const data = await res.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: any[] =
    data?.listings ?? data?.results ?? data?.data ?? [];
  const total: number =
    data?.total ?? data?.totalResults ?? results.length;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listings: AdapterOutput[] = results.map((r: any) => {
    const address =
      r.address ?? r.streetAddress ?? r.street_address ?? r.title ?? null;
    const neighborhood =
      r.neighborhood ?? r.area ?? r.location ?? "New York";
    const rawPrice = r.price ?? r.rent ?? r.monthlyRent ?? r.listPrice ?? null;
    const beds = r.beds ?? r.bedrooms ?? r.bedroomCount ?? null;
    const baths = r.baths ?? r.bathrooms ?? r.bathroomCount ?? null;
    const sqft = r.sqft ?? r.squareFeet ?? r.size ?? r.area_sqft ?? null;
    const lat = r.latitude ?? r.lat ?? r.location?.lat ?? r.geo?.lat ?? null;
    const lon = r.longitude ?? r.lng ?? r.lon ?? r.location?.lng ?? r.geo?.lng ?? null;

    const photoUrls = extractPhotoUrls(
      r.photos ?? r.images ?? r.photoUrls ?? r.media ?? [],
    );

    const listingUrl =
      r.url ?? r.link ?? r.detailUrl ??
      (r.id ? `https://streeteasy.com/building/${r.id}` : "");

    return {
      address,
      area: `${neighborhood}, NY`,
      price: parsePrice(rawPrice),
      beds,
      baths,
      sqft: sqft ? Number(sqft) : null,
      lat,
      lon,
      photo_urls: photoUrls,
      url: listingUrl,
      search_tag: makeSearchTag(city),
      list_date: r.listDate ?? r.list_date ?? r.listedAt ?? null,
      last_update_date: r.lastUpdated ?? r.updated_at ?? null,
      availability_date: r.availableDate ?? r.available_date ?? null,
      source: "streeteasy" as const,
    };
  });

  console.log(`[StreetEasy] Found ${listings.length} listings (total: ${total})`);
  return { listings, total };
}
