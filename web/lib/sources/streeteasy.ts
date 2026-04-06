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
import { makeSearchTag } from "./parse-utils";

const SE_API_URL = "https://api-v6.streeteasy.com/";
const SE_PAGE_SIZE = 100;
const SE_DELAY_MS = 500; // delay between pages to avoid rate limiting

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
  yearBuilt?: number;
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
      search_tag: makeSearchTag(city),
      list_date: null,
      last_update_date: null,
      availability_date: n.availableAt ?? null,
      source: "streeteasy" as const,
      year_built: n.yearBuilt ?? null,
    });
  }

  return listings;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchStreetEasyListings(
  params: SearchParams,
  _apiKey?: string,
  existingUrls?: Set<string>,
): Promise<{ listings: AdapterOutput[]; total: number }> {
  const { city } = params;
  const cityLower = city.toLowerCase();
  const areas = AREA_CODES[cityLower] ?? AREA_CODES["new york"];
  const known = existingUrls ?? new Set<string>();

  const filters = buildFilters(areas);

  // For incremental mode, use the raw paginator with early-stop logic
  const searchToken = crypto.randomUUID();
  const allNodes: SENode[] = [];
  let totalCount = 0;

  for (let page = 1; ; page++) {
    console.log(`[StreetEasy] Fetching page ${page} (areas: ${areas})`);

    const res = await fetch(SE_API_URL, {
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
      console.log(`[StreetEasy] Total: ${totalCount} active listings`);
    }

    if (edges.length === 0) {
      console.log(`[StreetEasy] Empty page — done`);
      break;
    }

    let newCount = 0;
    for (const edge of edges) {
      const n = edge.node;
      if (!n?.urlPath) continue;
      const fullUrl = `https://streeteasy.com${n.urlPath}`;
      if (!known.has(fullUrl)) newCount++;
      allNodes.push(n);
    }

    console.log(`[StreetEasy] Page ${page}: ${edges.length} results, ${newCount} new`);

    // Stop if >70% are already known (incremental mode caught up)
    if (known.size > 0 && newCount < edges.length * 0.3) {
      console.log(`[StreetEasy] Caught up with existing data — stopping`);
      break;
    }

    if (page * SE_PAGE_SIZE >= totalCount) {
      console.log(`[StreetEasy] All pages fetched`);
      break;
    }

    await new Promise((r) => setTimeout(r, SE_DELAY_MS));
  }

  console.log(`[StreetEasy] ${allNodes.length} raw results`);

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
