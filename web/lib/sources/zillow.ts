/**
 * Zillow data source via RapidAPI (Real-Time Zillow Data by OpenWebNinja).
 *
 * API host: real-time-zillow-data.p.rapidapi.com
 * Supports nationwide rental search.
 */

import type { RawListing, SearchParams } from "./types";

const RAPIDAPI_HOST = "real-time-zillow-data.p.rapidapi.com";
const TIMEOUT_MS = 15_000;

export async function fetchZillowListings(
  params: SearchParams,
  apiKey: string,
): Promise<{ listings: RawListing[]; total: number }> {
  const { city, stateCode, bedsMin, priceMax, priceMin } = params;

  try {
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
      console.error(`[Zillow] API error ${res.status}: ${text}`);
      return { listings: [], total: 0 };
    }

    const data = await res.json();

    // The API returns properties under different possible keys
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: any[] =
      data?.results ?? data?.props ?? data?.properties ?? data?.data ?? [];
    const total: number =
      data?.totalResultCount ?? data?.total ?? results.length;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const listings: RawListing[] = results.map((r: any) => {
      const address =
        r.streetAddress ??
        r.address ??
        r.addressStreet ??
        r.formattedAddress ??
        "";
      const cityName = r.city ?? r.addressCity ?? city;
      const state = r.state ?? r.addressState ?? stateCode;
      const price =
        r.price ??
        r.rentZestimate ??
        r.zestimate ??
        r.unformattedPrice ??
        0;
      const beds = r.bedrooms ?? r.beds ?? 0;
      const baths = r.bathrooms ?? r.baths ?? 0;
      const sqft =
        r.livingArea ?? r.sqft ?? r.area ?? r.lotAreaValue ?? null;
      const lat = r.latitude ?? r.lat ?? 0;
      const lon = r.longitude ?? r.lng ?? r.lon ?? 0;

      // Photos — Zillow often provides imgSrc or an images array
      const photoUrls: string[] = [];
      if (r.imgSrc) photoUrls.push(r.imgSrc);
      if (r.carouselPhotos && Array.isArray(r.carouselPhotos)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        r.carouselPhotos.slice(0, 7).forEach((p: any) => {
          const url = typeof p === "string" ? p : p.url ?? p.src ?? "";
          if (url) photoUrls.push(url);
        });
      }
      if (r.images && Array.isArray(r.images)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        r.images.slice(0, 8).forEach((p: any) => {
          const url = typeof p === "string" ? p : p.url ?? p.src ?? "";
          if (url && !photoUrls.includes(url)) photoUrls.push(url);
        });
      }

      const listingUrl =
        r.detailUrl ??
        r.url ??
        r.hdpUrl ??
        (r.zpid ? `https://www.zillow.com/homedetails/${r.zpid}_zpid/` : "");
      const fullUrl = listingUrl.startsWith("http")
        ? listingUrl
        : listingUrl
          ? `https://www.zillow.com${listingUrl}`
          : "";

      // Parse price if it's a string like "$3,500/mo"
      const numericPrice =
        typeof price === "string"
          ? parseInt(price.replace(/[^0-9]/g, ""), 10) || 0
          : price;

      return {
        address,
        area: `${cityName}, ${state}`,
        price: numericPrice,
        beds,
        baths,
        sqft: sqft ? Number(sqft) : null,
        lat,
        lon,
        photos: photoUrls.length,
        photo_urls: photoUrls.slice(0, 8),
        url: fullUrl,
        search_tag: `search_${city.toLowerCase().replace(/\s+/g, "_")}`,
        list_date: r.datePosted ?? r.listDate ?? r.timeOnZillow ?? null,
        last_update_date: r.dateSold ?? r.lastUpdated ?? null,
        availability_date: r.availableDate ?? null,
        source: "zillow" as const,
      };
    });

    console.log(`[Zillow] Found ${listings.length} listings (total: ${total})`);
    return { listings, total };
  } catch (err) {
    console.error("[Zillow] Fetch error:", err);
    return { listings: [], total: 0 };
  }
}
