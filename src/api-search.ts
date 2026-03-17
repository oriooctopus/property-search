import "dotenv/config";

export interface ApiListing {
  propertyId: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lon: number;
  price: number;
  beds: number;
  baths: number;
  bathsFull: number;
  bathsHalf: number;
  sqft: number | null;
  type: string;
  url: string;
  broker: string;
  soldDate: string | null;
  soldPrice: number | null;
  photoCount: number;
}

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = "realty-in-us.p.rapidapi.com";

interface SearchParams {
  city: string;
  stateCode: string;
  status?: "for_sale" | "for_rent" | "sold";
  bedsMin?: number;
  bathsMin?: number;
  priceMax?: number;
  priceMin?: number;
  limit?: number;
  offset?: number;
}

export async function searchProperties(params: SearchParams): Promise<{
  listings: ApiListing[];
  total: number;
}> {
  if (!RAPIDAPI_KEY) throw new Error("RAPIDAPI_KEY not set in .env");

  const body: Record<string, unknown> = {
    limit: params.limit ?? 200,
    offset: params.offset ?? 0,
    city: params.city,
    state_code: params.stateCode,
    status: [params.status ?? "for_sale"],
    sort: { direction: "desc", field: params.status === "sold" ? "sold_date" : "list_date" },
  };

  if (params.bedsMin != null) body.beds = { min: params.bedsMin };
  if (params.bathsMin != null) body.baths = { min: params.bathsMin };
  if (params.priceMax != null || params.priceMin != null) {
    const price: Record<string, number> = {};
    if (params.priceMin != null) price.min = params.priceMin;
    if (params.priceMax != null) price.max = params.priceMax;
    body.list_price = price;
  }

  const res = await fetch(`https://${RAPIDAPI_HOST}/properties/v3/list`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-RapidAPI-Key": RAPIDAPI_KEY,
      "X-RapidAPI-Host": RAPIDAPI_HOST,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const results = data?.data?.home_search?.results ?? [];
  const total = data?.data?.home_search?.total ?? 0;

  const listings: ApiListing[] = results.map((r: any) => {
    const loc = r.location?.address ?? {};
    const desc = r.description ?? {};
    const coord = loc.coordinate ?? {};
    return {
      propertyId: r.property_id ?? "",
      address: loc.line ?? "",
      city: loc.city ?? "",
      state: loc.state_code ?? "",
      zip: loc.postal_code ?? "",
      lat: coord.lat ?? 0,
      lon: coord.lon ?? 0,
      price: r.list_price ?? 0,
      beds: desc.beds ?? 0,
      baths: (desc.baths_full ?? 0) + (desc.baths_half ?? 0) * 0.5,
      bathsFull: desc.baths_full ?? 0,
      bathsHalf: desc.baths_half ?? 0,
      sqft: desc.sqft ?? null,
      type: desc.type ?? "",
      url: r.href
        ? r.href.startsWith("http") ? r.href : `https://www.realtor.com${r.href}`
        : "",
      broker: r.branding?.[0]?.name ?? "",
      soldDate: r.last_sold_date ?? null,
      soldPrice: r.last_sold_price ?? null,
      photoCount: r.photo_count ?? 0,
    };
  });

  return { listings, total };
}

/** Fetch all pages up to maxResults */
export async function searchAllProperties(
  params: SearchParams,
  maxResults = 500
): Promise<ApiListing[]> {
  const pageSize = Math.min(maxResults, 200); // API max per request
  const first = await searchProperties({ ...params, limit: pageSize, offset: 0 });
  console.log(`  API: ${first.total} total results, fetched ${first.listings.length}`);

  const all = [...first.listings];
  let offset = pageSize;

  while (all.length < Math.min(first.total, maxResults)) {
    const batch = await searchProperties({
      ...params,
      limit: Math.min(pageSize, maxResults - all.length),
      offset,
    });
    if (batch.listings.length === 0) break;
    all.push(...batch.listings);
    offset += batch.listings.length;
    console.log(`  API: fetched ${all.length}/${Math.min(first.total, maxResults)}`);
  }

  return all;
}
