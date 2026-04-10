/**
 * StreetEasy data source via direct GraphQL API.
 *
 * Calls api-v6.streeteasy.com directly — no Apify, no per-result fees.
 * Proper page/perPage pagination with totalCount.
 *
 * Photos: photo keys converted to Zillow CDN URLs
 * (photos.zillowstatic.com) which are publicly accessible.
 */

import type { AdapterOutput, SearchParams } from "./types";

const SE_API_URL = "https://api-v6.streeteasy.com/";
const SE_PAGE_SIZE = 100;
const SE_DELAY_MS = 3000; // delay between pages to avoid rate limiting

// Area codes: Manhattan=100, Brooklyn=300
const AREA_CODES: Record<string, number[]> = {
  manhattan: [100],
  brooklyn: [300],
  "new york": [100],
};

const SE_HEADERS = {
  "Content-Type": "application/json",
  Origin: "https://streeteasy.com",
  Referer: "https://streeteasy.com/",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Safari/605.1.15",
  "apollographql-client-name": "srp-frontend-service",
  "apollographql-client-version":
    "version 859d2a117b87b956a057dd24110186eabfccc4eb",
  "app-version": "1.0.0",
  os: "web",
};

const SE_QUERY = `query GetListingRental($input: SearchRentalsInput!) {
  searchRentals(input: $input) {
    search { criteria }
    totalCount
    edges {
      ... on OrganicRentalEdge {
        node {
          id
          areaName
          bedroomCount
          buildingType
          fullBathroomCount
          halfBathroomCount
          geoPoint { latitude longitude }
          leadMedia { photo { key } }
          photos { key }
          livingAreaSize
          availableAt
          price
          sourceGroupLabel
          status
          street
          unit
          urlPath
          noFee
          monthsFree
          netEffectivePrice
        }
      }
    }
  }
}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SENode {
  id?: string;
  areaName?: string;
  bedroomCount?: number;
  fullBathroomCount?: number;
  halfBathroomCount?: number;
  geoPoint?: { latitude?: number; longitude?: number };
  leadMedia?: { photo?: { key?: string } };
  photos?: { key?: string }[];
  livingAreaSize?: number;
  price?: number;
  street?: string;
  unit?: string;
  urlPath?: string;
  availableAt?: string;
  status?: string;
  noFee?: boolean;
  monthsFree?: number;
  netEffectivePrice?: number;
}

interface SEEdge {
  node?: SENode;
}

interface SEResponse {
  data?: {
    searchRentals?: {
      totalCount?: number;
      edges?: SEEdge[];
    };
  };
  errors?: { message: string }[];
}

// ---------------------------------------------------------------------------
// Photo URL
// ---------------------------------------------------------------------------

function sePhotoUrl(key: string): string {
  return `https://photos.zillowstatic.com/fp/${key}-se_extra_large_1500_800.webp`;
}

// ---------------------------------------------------------------------------
// Main fetch function
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Filter options for sliced queries
// ---------------------------------------------------------------------------

export interface SEFilterOptions {
  /** Filter to specific bedroom counts (each value becomes a separate range query). */
  bedrooms?: number[];
  /** Maximum price (inclusive). Uses SE's IntegerRangeInput upperBound. */
  maxPrice?: number;
  /** Minimum price (inclusive). Uses SE's IntegerRangeInput lowerBound. */
  minPrice?: number;
  /**
   * Not supported by SE API — kept for interface compatibility only.
   * The SE RentalFiltersInput has no date field; use sort-order stopping logic instead.
   */
  listedSince?: string;
}

function buildFilters(
  areas: number[],
  bedroomCount?: number,
  minPrice?: number,
  maxPrice?: number,
): Record<string, unknown> {
  const filters: Record<string, unknown> = { rentalStatus: "ACTIVE", areas };
  if (bedroomCount !== undefined) {
    filters.bedrooms = { lowerBound: bedroomCount, upperBound: bedroomCount };
  }
  if (minPrice !== undefined || maxPrice !== undefined) {
    const priceRange: Record<string, number> = {};
    if (minPrice !== undefined) priceRange.lowerBound = minPrice;
    if (maxPrice !== undefined) priceRange.upperBound = maxPrice;
    filters.price = priceRange;
  }
  return filters;
}

// ---------------------------------------------------------------------------
// Lightweight probe — fetches only page 1 to get totalCount without full pagination
// ---------------------------------------------------------------------------

export async function probeTotalCount(
  areas: number[],
  filters: Record<string, unknown>,
  fetchFn: typeof fetch = fetch,
): Promise<number> {
  const res = await fetchFn(SE_API_URL, {
    method: "POST",
    headers: SE_HEADERS,
    body: JSON.stringify({
      query: SE_QUERY,
      variables: {
        input: {
          filters,
          page: 1,
          perPage: 1,
          sorting: { attribute: "LISTED_AT", direction: "DESCENDING" },
          userSearchToken: crypto.randomUUID(),
          adStrategy: "NONE",
        },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SE probe error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data: SEResponse = await res.json();
  if (data.errors?.length) throw new Error(`SE probe GraphQL error: ${data.errors[0].message}`);
  return data.data?.searchRentals?.totalCount ?? 0;
}

// Core paginator — fetches all pages for a single filter combination
// ---------------------------------------------------------------------------

async function paginateSlice(
  areas: number[],
  filters: Record<string, unknown>,
  label: string,
  delayMs: number = SE_DELAY_MS,
  fetchFn: typeof fetch = fetch,
): Promise<{ nodes: SENode[]; totalCount: number }> {
  const searchToken = crypto.randomUUID();
  const allNodes: SENode[] = [];
  let totalCount = 0;

  for (let page = 1; ; page++) {
    console.log(`[StreetEasy] ${label} page ${page}`);

    const res = await fetchFn(SE_API_URL, {
      method: "POST",
      headers: SE_HEADERS,
      body: JSON.stringify({
        query: SE_QUERY,
        variables: {
          input: {
            filters,
            page,
            perPage: SE_PAGE_SIZE,
            sorting: { attribute: "LISTED_AT", direction: "DESCENDING" },
            userSearchToken: searchToken,
            adStrategy: "NONE",
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`SE API error ${res.status}: ${text.slice(0, 200)}`);
    }

    const data: SEResponse = await res.json();

    if (data.errors?.length) {
      throw new Error(`SE GraphQL error: ${data.errors[0].message}`);
    }

    const edges = data.data?.searchRentals?.edges ?? [];
    if (page === 1) {
      totalCount = data.data?.searchRentals?.totalCount ?? 0;
      console.log(`[StreetEasy] ${label} totalCount: ${totalCount}`);
    }

    if (edges.length === 0) {
      console.log(`[StreetEasy] ${label} empty page — done`);
      break;
    }

    for (const edge of edges) {
      if (edge.node) allNodes.push(edge.node);
    }

    if (page * SE_PAGE_SIZE >= totalCount) {
      console.log(`[StreetEasy] ${label} all pages fetched`);
      break;
    }

    await new Promise((r) => setTimeout(r, delayMs));
  }

  return { nodes: allNodes, totalCount };
}

// ---------------------------------------------------------------------------
// Node → AdapterOutput converter
// ---------------------------------------------------------------------------

function nodesToListings(nodes: SENode[], city: string): AdapterOutput[] {
  const listings: AdapterOutput[] = [];
  const seenUrls = new Set<string>();

  for (const n of nodes) {
    if (!n.urlPath) continue;
    const price = n.price ?? null;
    if (price == null || price === 0) continue;

    const fullUrl = `https://streeteasy.com${n.urlPath}`;
    if (seenUrls.has(fullUrl)) continue;
    seenUrls.add(fullUrl);

    const address = n.unit ? `${n.street} #${n.unit}` : n.street ?? null;
    const baths =
      n.fullBathroomCount != null || n.halfBathroomCount != null
        ? (n.fullBathroomCount ?? 0) + (n.halfBathroomCount ?? 0) * 0.5
        : null;

    const photoUrls = (n.photos ?? [])
      .filter((p): p is { key: string } => typeof p.key === "string")
      .map((p) => sePhotoUrl(p.key))
      .slice(0, 20);

    if (photoUrls.length === 0 && n.leadMedia?.photo?.key) {
      photoUrls.push(sePhotoUrl(n.leadMedia.photo.key));
    }

    listings.push({
      address,
      area: n.areaName ? `${n.areaName}, NY` : "New York, NY",
      price,
      beds: n.bedroomCount ?? null,
      baths,
      sqft: n.livingAreaSize ?? null,
      lat: n.geoPoint?.latitude ?? null,
      lon: n.geoPoint?.longitude ?? null,
      photo_urls: photoUrls,
      url: fullUrl,
      list_date: null,
      last_update_date: null,
      availability_date: n.availableAt ?? null,
      source: "streeteasy" as const,
      external_id: n.id ?? null,
    });
  }

  return listings;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const SE_BEDROOM_SLICES = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const SE_SLICE_DELAY_MS = 5_000; // delay between bedroom slices

export async function fetchStreetEasyListings(
  params: SearchParams,
  _apiKey?: string,
  existingUrls?: Set<string>,
): Promise<{ listings: AdapterOutput[]; total: number }> {
  const { city } = params;
  const cityLower = city.toLowerCase();
  const areas = AREA_CODES[cityLower] ?? AREA_CODES["new york"];
  const known = existingUrls ?? new Set<string>();

  const allNodes: SENode[] = [];
  const seenUrlPaths = new Set<string>();
  let grandTotal = 0;

  for (const bedrooms of SE_BEDROOM_SLICES) {
    const label = bedrooms === 0 ? "studio" : `${bedrooms}BR`;
    const filters = buildFilters(areas, bedrooms);

    // Probe totalCount first to skip empty slices
    let sliceTotal: number;
    try {
      sliceTotal = await probeTotalCount(areas, filters);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[StreetEasy] ${label} probe failed: ${msg}`);
      if (msg.includes("403")) {
        console.error(`[StreetEasy] Rate limited — returning what we have so far`);
        break; // Stop all slices, return partial results
      }
      continue; // Skip this slice on other errors
    }
    if (sliceTotal === 0) {
      console.log(`[StreetEasy] ${label}: 0 listings — skipping`);
      continue;
    }

    grandTotal += sliceTotal;
    console.log(`[StreetEasy] ${label}: ${sliceTotal} listings — fetching`);

    if (sliceTotal > 1100) {
      console.warn(
        `[StreetEasy] WARNING: ${label} has ${sliceTotal} listings, exceeds ~1,100 cap. Some may be missed.`,
      );
    }

    // Paginate this bedroom slice with incremental early-stop logic
    const searchToken = crypto.randomUUID();
    let rateLimited = false;

    for (let page = 1; ; page++) {
      console.log(`[StreetEasy] ${label} page ${page}`);

      let res: Response;
      try {
        res = await fetch(SE_API_URL, {
          method: "POST",
          headers: SE_HEADERS,
          body: JSON.stringify({
            query: SE_QUERY,
            variables: {
              input: {
                filters,
                page,
                perPage: SE_PAGE_SIZE,
                sorting: { attribute: "LISTED_AT", direction: "DESCENDING" },
                userSearchToken: searchToken,
                adStrategy: "NONE",
              },
            },
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[StreetEasy] ${label} page ${page} fetch error: ${msg}`);
        break;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error(`[StreetEasy] ${label} page ${page} HTTP ${res.status}: ${text.slice(0, 200)}`);
        if (res.status === 403) {
          rateLimited = true;
        }
        break;
      }

      const data: SEResponse = await res.json();

      if (data.errors?.length) {
        console.error(`[StreetEasy] ${label} GraphQL error: ${data.errors[0].message}`);
        break;
      }

      const edges = data.data?.searchRentals?.edges ?? [];

      if (edges.length === 0) {
        console.log(`[StreetEasy] ${label} empty page — done`);
        break;
      }

      let newCount = 0;
      for (const edge of edges) {
        const n = edge.node;
        if (!n?.urlPath) continue;
        // Deduplicate across bedroom slices
        if (seenUrlPaths.has(n.urlPath)) continue;
        seenUrlPaths.add(n.urlPath);

        const fullUrl = `https://streeteasy.com${n.urlPath}`;
        if (!known.has(fullUrl)) newCount++;
        allNodes.push(n);
      }

      console.log(
        `[StreetEasy] ${label} page ${page}: ${edges.length} results, ${newCount} new`,
      );

      // Incremental early-stop: if >70% are already known, stop this slice
      if (known.size > 0 && newCount < edges.length * 0.3) {
        console.log(
          `[StreetEasy] ${label} caught up with existing data — stopping slice`,
        );
        break;
      }

      if (page * SE_PAGE_SIZE >= sliceTotal) {
        console.log(`[StreetEasy] ${label} all pages fetched`);
        break;
      }

      await new Promise((r) => setTimeout(r, SE_DELAY_MS));
    }

    if (rateLimited) {
      console.error(`[StreetEasy] Rate limited on ${label} — returning partial results`);
      break; // Stop all slices
    }

    // Delay between bedroom slices to avoid rate limiting
    await new Promise((r) => setTimeout(r, SE_SLICE_DELAY_MS));
  }

  console.log(
    `[StreetEasy] All slices done: ${allNodes.length} raw results (API reported ${grandTotal} total)`,
  );

  const listings = nodesToListings(allNodes, city);
  console.log(
    `[StreetEasy] ${listings.length} unique listings (${allNodes.length - listings.length} dupes removed)`,
  );

  return { listings, total: listings.length };
}

// ---------------------------------------------------------------------------
// Exported helpers for populate/refresh scripts
// ---------------------------------------------------------------------------

export { buildFilters, paginateSlice, nodesToListings };
