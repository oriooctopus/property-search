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
 *  - transit_summary   (not provided — but Realtor doesn't reliably provide it either)
 */

import type { RawListing, SearchParams } from "./types";

const RAPIDAPI_HOST = "apartments-com1.p.rapidapi.com";

export async function fetchApartmentsListings(
  params: SearchParams,
  apiKey: string,
): Promise<{ listings: RawListing[]; total: number }> {
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
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apartments.com API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  // The API returns an array of properties (or { properties: [...] })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: any[] = Array.isArray(data) ? data : (data?.properties ?? data?.data ?? []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listings: RawListing[] = results.map((r: any) => {
    const lat = r.latitude ?? r.location?.lat ?? r.geo?.lat ?? 0;
    const lon = r.longitude ?? r.location?.lng ?? r.location?.lon ?? r.geo?.lng ?? 0;
    const address = r.address ?? r.streetAddress ?? r.location?.address ?? "";
    const cityName = r.city ?? r.location?.city ?? city;
    const state = r.state ?? r.location?.state ?? stateCode;
    const price = r.price ?? r.rent ?? r.min_rent ?? r.rentRange?.min ?? 0;
    const beds = r.bedrooms ?? r.beds ?? r.min_bedrooms ?? 0;
    const baths = r.bathrooms ?? r.baths ?? r.min_bathrooms ?? 0;
    const photoUrls: string[] = (r.photos ?? r.images ?? r.photo_urls ?? [])
      .slice(0, 6)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((p: any) => (typeof p === "string" ? p : p.url ?? p.href ?? ""))
      .filter(Boolean);
    const url = r.url ?? r.link ?? r.detail_url ?? "";

    return {
      address,
      area: `${cityName}, ${state}`,
      price: typeof price === "string" ? parseInt(price.replace(/[^0-9]/g, ""), 10) || 0 : price,
      beds: typeof beds === "string" ? parseInt(beds, 10) || 0 : beds,
      baths: typeof baths === "string" ? parseFloat(baths) || 0 : baths,
      sqft: null, // NOT PROVIDED by Apartments.com
      lat,
      lon,
      photos: photoUrls.length,
      photo_urls: photoUrls,
      url,
      search_tag: `search_${city.toLowerCase().replace(/\s+/g, "_")}`,
      list_date: r.listed_date ?? r.list_date ?? null,
      last_update_date: null, // NOT PROVIDED
      availability_date: null, // NOT PROVIDED
      source: "apartments" as const,
    };
  });

  return { listings, total: listings.length };
}
