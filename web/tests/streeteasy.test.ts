/**
 * Tests for the StreetEasy adapter.
 *
 * Unit tests mock global fetch. Live/monitoring tests make real API calls
 * and are gated behind `describe.runIf(RUN_LIVE)` so they only run when
 * the STREETEASY_LIVE env var is set (e.g. `STREETEASY_LIVE=1 npx vitest`).
 *
 * Install vitest first:  npm i -D vitest
 * Run unit tests:        npx vitest run tests/streeteasy.test.ts
 * Run live tests too:    STREETEASY_LIVE=1 npx vitest run tests/streeteasy.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchStreetEasyListings } from "../lib/sources/streeteasy";
import type { SearchParams } from "../lib/sources/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RUN_LIVE = !!process.env.STREETEASY_LIVE;

const defaultParams: SearchParams = {
  city: "Manhattan",
  stateCode: "NY",
};

/** Build a minimal SE GraphQL response with the given nodes. */
function makeSeResponse(
  nodes: Record<string, unknown>[],
  totalCount?: number,
) {
  return {
    data: {
      searchRentals: {
        totalCount: totalCount ?? nodes.length,
        edges: nodes.map((n) => ({ node: n })),
      },
    },
  };
}

/** A valid node with all required fields. */
function validNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "1",
    urlPath: "/rental/1234",
    price: 3000,
    street: "123 Main St",
    unit: "4A",
    areaName: "East Village",
    bedroomCount: 2,
    fullBathroomCount: 1,
    halfBathroomCount: 1,
    geoPoint: { latitude: 40.72, longitude: -73.98 },
    photos: [{ key: "abc123" }, { key: "def456" }],
    leadMedia: { photo: { key: "abc123" } },
    livingAreaSize: 800,
    availableAt: "2026-04-01",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Unit Tests (mocked fetch)
// ---------------------------------------------------------------------------

describe("StreetEasy adapter — unit tests", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  // ---- Photo URL construction (#4) ----------------------------------------

  it("constructs correct Zillow CDN photo URL", async () => {
    const node = validNode();
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeSeResponse([node], 1),
    }) as unknown as typeof fetch;

    const { listings } = await fetchStreetEasyListings(defaultParams);
    expect(listings[0].photo_urls[0]).toBe(
      "https://photos.zillowstatic.com/fp/abc123-se_extra_large_1500_800.webp",
    );
  });

  // ---- Listing filtering (#5) ---------------------------------------------

  it("filters out listings with no urlPath", async () => {
    const nodes = [validNode(), validNode({ urlPath: undefined, id: "2" })];
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeSeResponse(nodes, 2),
    }) as unknown as typeof fetch;

    const { listings } = await fetchStreetEasyListings(defaultParams);
    expect(listings).toHaveLength(1);
  });

  it("filters out listings with price=0", async () => {
    const nodes = [
      validNode(),
      validNode({ price: 0, urlPath: "/rental/9999", id: "2" }),
    ];
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeSeResponse(nodes, 2),
    }) as unknown as typeof fetch;

    const { listings } = await fetchStreetEasyListings(defaultParams);
    expect(listings).toHaveLength(1);
  });

  it("filters out listings with null price", async () => {
    const nodes = [
      validNode(),
      validNode({ price: null, urlPath: "/rental/8888", id: "3" }),
    ];
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeSeResponse(nodes, 2),
    }) as unknown as typeof fetch;

    const { listings } = await fetchStreetEasyListings(defaultParams);
    expect(listings).toHaveLength(1);
  });

  // ---- URL deduplication (#6) ---------------------------------------------

  it("removes duplicate URLs within results", async () => {
    const nodes = [
      validNode({ id: "1", urlPath: "/rental/1234" }),
      validNode({ id: "2", urlPath: "/rental/1234" }), // same URL
      validNode({ id: "3", urlPath: "/rental/5678", price: 4000 }),
    ];
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeSeResponse(nodes, 3),
    }) as unknown as typeof fetch;

    const { listings } = await fetchStreetEasyListings(defaultParams);
    expect(listings).toHaveLength(2);
    const urls = listings.map((l) => l.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  // ---- Incremental stop logic (#7) ----------------------------------------

  it("stops pagination when >70% of results are already known", async () => {
    const existingUrls = new Set([
      "https://streeteasy.com/rental/1",
      "https://streeteasy.com/rental/2",
      "https://streeteasy.com/rental/3",
      "https://streeteasy.com/rental/4",
    ]);

    // Page 1: 4 out of 5 are known (80% > 70% threshold)
    const page1Nodes = [
      validNode({ urlPath: "/rental/1", id: "1" }),
      validNode({ urlPath: "/rental/2", id: "2", price: 2000 }),
      validNode({ urlPath: "/rental/3", id: "3", price: 2500 }),
      validNode({ urlPath: "/rental/4", id: "4", price: 3500 }),
      validNode({ urlPath: "/rental/new1", id: "5", price: 4000 }),
    ];

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeSeResponse(page1Nodes, 200), // totalCount=200 so it would normally paginate
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await fetchStreetEasyListings(defaultParams, undefined, existingUrls);
    // Should only make 1 fetch call (stopped after page 1)
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ---- Address formatting (#8) --------------------------------------------

  it("formats address with unit correctly", async () => {
    const node = validNode({ street: "456 Broadway", unit: "12B" });
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeSeResponse([node], 1),
    }) as unknown as typeof fetch;

    const { listings } = await fetchStreetEasyListings(defaultParams);
    expect(listings[0].address).toBe("456 Broadway #12B");
  });

  it("formats address without unit (null unit)", async () => {
    const node = validNode({ street: "789 Park Ave", unit: null });
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeSeResponse([node], 1),
    }) as unknown as typeof fetch;

    const { listings } = await fetchStreetEasyListings(defaultParams);
    expect(listings[0].address).toBe("789 Park Ave");
  });

  it("formats address without unit (undefined unit)", async () => {
    const node = validNode({ street: "789 Park Ave", unit: undefined });
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeSeResponse([node], 1),
    }) as unknown as typeof fetch;

    const { listings } = await fetchStreetEasyListings(defaultParams);
    expect(listings[0].address).toBe("789 Park Ave");
  });

  // ---- Bath calculation (#9) ----------------------------------------------

  it("calculates baths as full + half*0.5", async () => {
    const node = validNode({ fullBathroomCount: 2, halfBathroomCount: 1 });
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeSeResponse([node], 1),
    }) as unknown as typeof fetch;

    const { listings } = await fetchStreetEasyListings(defaultParams);
    expect(listings[0].baths).toBe(2.5);
  });

  it("handles null bathroom counts", async () => {
    const node = validNode({
      fullBathroomCount: undefined,
      halfBathroomCount: undefined,
    });
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeSeResponse([node], 1),
    }) as unknown as typeof fetch;

    const { listings } = await fetchStreetEasyListings(defaultParams);
    expect(listings[0].baths).toBeNull();
  });

  it("handles only full baths (no half)", async () => {
    const node = validNode({
      fullBathroomCount: 3,
      halfBathroomCount: undefined,
    });
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeSeResponse([node], 1),
    }) as unknown as typeof fetch;

    const { listings } = await fetchStreetEasyListings(defaultParams);
    // fullBathroomCount != null so it enters the branch: (3) + (0)*0.5 = 3
    expect(listings[0].baths).toBe(3);
  });

  // ---- Error handling (#10) -----------------------------------------------

  it("throws descriptive error on non-200 response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    }) as unknown as typeof fetch;

    await expect(
      fetchStreetEasyListings(defaultParams),
    ).rejects.toThrow(/SE API error 403/);
  });

  it("surfaces GraphQL errors", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        errors: [{ message: "PersistedQueryNotFound" }],
      }),
    }) as unknown as typeof fetch;

    await expect(
      fetchStreetEasyListings(defaultParams),
    ).rejects.toThrow(/SE GraphQL error: PersistedQueryNotFound/);
  });

  // ---- Other behavior -------------------------------------------------------

  it("uses leadMedia fallback when photos array is empty", async () => {
    const node = validNode({
      photos: [],
      leadMedia: { photo: { key: "fallback123" } },
    });
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeSeResponse([node], 1),
    }) as unknown as typeof fetch;

    const { listings } = await fetchStreetEasyListings(defaultParams);
    expect(listings[0].photo_urls).toHaveLength(1);
    expect(listings[0].photo_urls[0]).toContain("fallback123");
  });

  it("sets area with areaName when present", async () => {
    const node = validNode({ areaName: "Williamsburg" });
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeSeResponse([node], 1),
    }) as unknown as typeof fetch;

    const { listings } = await fetchStreetEasyListings(defaultParams);
    expect(listings[0].area).toBe("Williamsburg, NY");
  });

  it("defaults area to 'New York, NY' when areaName is missing", async () => {
    const node = validNode({ areaName: undefined });
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeSeResponse([node], 1),
    }) as unknown as typeof fetch;

    const { listings } = await fetchStreetEasyListings(defaultParams);
    expect(listings[0].area).toBe("New York, NY");
  });

  it("sets source to 'streeteasy'", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeSeResponse([validNode()], 1),
    }) as unknown as typeof fetch;

    const { listings } = await fetchStreetEasyListings(defaultParams);
    expect(listings[0].source).toBe("streeteasy");
  });

  it("constructs full URL from urlPath", async () => {
    const node = validNode({ urlPath: "/rental/5555-xyz" });
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeSeResponse([node], 1),
    }) as unknown as typeof fetch;

    const { listings } = await fetchStreetEasyListings(defaultParams);
    expect(listings[0].url).toBe("https://streeteasy.com/rental/5555-xyz");
  });
});

// ---------------------------------------------------------------------------
// Live / Monitoring Tests (real API calls — run with STREETEASY_LIVE=1)
// ---------------------------------------------------------------------------

describe.runIf(RUN_LIVE)("StreetEasy adapter — live monitoring", () => {
  // These tests make REAL HTTP calls to api-v6.streeteasy.com.
  // They are designed to use minimal API calls (3-4 total).

  // We reuse the adapter's internal fetch logic by calling with perPage
  // override — but since perPage is hardcoded, we'll call the full adapter
  // with a narrow city and check results. Alternatively we call the API
  // directly to keep calls minimal.

  const SE_API_URL = "https://api-v6.streeteasy.com/";
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
      totalCount
      edges {
        ... on OrganicRentalEdge {
          node {
            id urlPath price street unit
            photos { key }
          }
        }
      }
    }
  }`;

  async function fetchPage(page: number, perPage: number = 1) {
    const res = await fetch(SE_API_URL, {
      method: "POST",
      headers: SE_HEADERS,
      body: JSON.stringify({
        query: SE_QUERY,
        variables: {
          input: {
            filters: { rentalStatus: "ACTIVE", areas: [100] },
            page,
            perPage,
            sorting: { attribute: "LISTED_AT", direction: "DESCENDING" },
            userSearchToken: crypto.randomUUID(),
            adStrategy: "NONE",
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    return { res, data: await res.json() };
  }

  // (#1) Version hash health check
  it("version hash is valid — API returns 200 with results", async () => {
    const { res, data } = await fetchPage(1, 1);
    expect(res.ok).toBe(true);
    expect(data.errors).toBeUndefined();
    expect(data.data?.searchRentals?.totalCount).toBeGreaterThan(0);
    expect(data.data?.searchRentals?.edges?.length).toBeGreaterThan(0);
  }, 20_000);

  // (#2) Photo CDN health check
  it("photo CDN URL returns 200", async () => {
    const { data } = await fetchPage(1, 1);
    const node = data.data?.searchRentals?.edges?.[0]?.node;
    expect(node).toBeDefined();

    const photoKey = node.photos?.[0]?.key;
    expect(photoKey).toBeDefined();

    const cdnUrl = `https://photos.zillowstatic.com/fp/${photoKey}-se_extra_large_1500_800.webp`;
    const photoRes = await fetch(cdnUrl, { method: "HEAD" });
    expect(photoRes.status).toBe(200);
  }, 20_000);

  // (#3) Pagination returns different listings
  it("page 1 and page 2 return different listing IDs", async () => {
    const { data: page1 } = await fetchPage(1, 1);
    const { data: page2 } = await fetchPage(2, 1);

    const id1 = page1.data?.searchRentals?.edges?.[0]?.node?.id;
    const id2 = page2.data?.searchRentals?.edges?.[0]?.node?.id;

    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
  }, 20_000);
});
