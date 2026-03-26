import { test, expect } from "@playwright/test";
import {
  getNearestSubwayStations,
  getListingIsochrones,
  getListingsInIsochrone,
  enrichListingWithIsochrones,
  batchEnrichListings,
} from "../../lib/isochrone/query";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUPABASE_URL = "http://localhost:54321";
const SERVICE_KEY = "fake-service-role-key";

// ---------------------------------------------------------------------------
// Sample RPC responses
// ---------------------------------------------------------------------------

const FIND_CONTAINING_RESPONSE = [
  { station_stop_id: "R17", station_name: "14th St-Union Sq", cutoff_minutes: 5, mode: "WALK" },
  { station_stop_id: "R17", station_name: "14th St-Union Sq", cutoff_minutes: 10, mode: "WALK" },
  { station_stop_id: "R17", station_name: "14th St-Union Sq", cutoff_minutes: 15, mode: "WALK" },
  { station_stop_id: "L06", station_name: "Bedford Ave", cutoff_minutes: 8, mode: "WALK" },
  { station_stop_id: "L06", station_name: "Bedford Ave", cutoff_minutes: 12, mode: "WALK" },
  { station_stop_id: "D20", station_name: "Bleecker St-Lafayette St", cutoff_minutes: 12, mode: "WALK" },
];

const LISTING_ISOCHRONES_RESPONSE = [
  { isochrone_id: 101, station_stop_id: "R17", station_name: "14th St-Union Sq", cutoff_minutes: 5, mode: "WALK" },
  { isochrone_id: 102, station_stop_id: "L06", station_name: "Bedford Ave", cutoff_minutes: 8, mode: "WALK" },
];

const LISTINGS_IN_ISOCHRONE_RESPONSE = [
  { listing_id: 1001 },
  { listing_id: 1002 },
  { listing_id: 1003 },
];

// ---------------------------------------------------------------------------
// Fetch interceptor for Supabase RPC calls
// ---------------------------------------------------------------------------

function createSupabaseMock(
  rpcResponses: Record<string, unknown>,
  errorResponses?: Record<string, string>,
) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();

    // Supabase RPC calls go to /rest/v1/rpc/<function_name>
    const rpcMatch = url.match(/\/rest\/v1\/rpc\/(\w+)/);
    if (rpcMatch) {
      const funcName = rpcMatch[1];

      if (errorResponses?.[funcName]) {
        return new Response(
          JSON.stringify({ message: errorResponses[funcName] }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      if (funcName in (rpcResponses ?? {})) {
        return new Response(JSON.stringify(rpcResponses[funcName]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response("Not Found", { status: 404 });
  };
}

// ---------------------------------------------------------------------------
// Tests: getNearestSubwayStations
// ---------------------------------------------------------------------------

test.describe("query – getNearestSubwayStations", () => {
  let originalFetch: typeof globalThis.fetch;

  test.beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  });

  test.afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns results sorted by walk time ascending", async () => {
    globalThis.fetch = createSupabaseMock({
      find_containing_isochrones: FIND_CONTAINING_RESPONSE,
    });

    const results = await getNearestSubwayStations(40.735, -73.99);
    expect(results.length).toBeGreaterThan(0);

    for (let i = 1; i < results.length; i++) {
      expect(results[i].walkMinutes).toBeGreaterThanOrEqual(results[i - 1].walkMinutes);
    }
  });

  test("picks tightest (smallest) band per station", async () => {
    globalThis.fetch = createSupabaseMock({
      find_containing_isochrones: FIND_CONTAINING_RESPONSE,
    });

    const results = await getNearestSubwayStations(40.735, -73.99);

    // Union Sq appears with 5, 10, 15 minute bands — should pick 5
    const unionSq = results.find((r) => r.station.stopId === "R17");
    expect(unionSq).toBeDefined();
    expect(unionSq!.walkMinutes).toBe(5);

    // Bedford Ave appears with 8, 12 minute bands — should pick 8
    const bedfordAve = results.find((r) => r.station.stopId === "L06");
    expect(bedfordAve).toBeDefined();
    expect(bedfordAve!.walkMinutes).toBe(8);

    // Bleecker appears with only 12 minute band
    const bleecker = results.find((r) => r.station.stopId === "D20");
    expect(bleecker).toBeDefined();
    expect(bleecker!.walkMinutes).toBe(12);
  });

  test("returns empty array when no stations are nearby", async () => {
    globalThis.fetch = createSupabaseMock({
      find_containing_isochrones: [],
    });

    const results = await getNearestSubwayStations(40.5, -74.2);
    expect(results).toEqual([]);
  });

  test("returns empty array when RPC returns null data", async () => {
    globalThis.fetch = createSupabaseMock({
      find_containing_isochrones: null,
    });

    const results = await getNearestSubwayStations(40.5, -74.2);
    expect(results).toEqual([]);
  });

  test("throws on RPC error", async () => {
    globalThis.fetch = createSupabaseMock(
      {},
      { find_containing_isochrones: "function does not exist" },
    );

    await expect(getNearestSubwayStations(40.735, -73.99)).rejects.toThrow(
      /find_containing_isochrones failed/,
    );
  });

  test("includes station metadata from subway-stations lookup", async () => {
    globalThis.fetch = createSupabaseMock({
      find_containing_isochrones: [
        { station_stop_id: "R17", station_name: "14th St-Union Sq", cutoff_minutes: 5, mode: "WALK" },
      ],
    });

    const results = await getNearestSubwayStations(40.735, -73.99);
    expect(results).toHaveLength(1);

    const station = results[0].station;
    expect(station.stopId).toBe("R17");
    expect(station.name).toBe("14th St-Union Sq");
    expect(station.lines).toContain("L");
    expect(station.lines).toContain("4");
    expect(station.lat).toBeGreaterThan(0);
    expect(station.lon).toBeLessThan(0);
  });

  test("falls back to minimal station data for unknown stopId", async () => {
    globalThis.fetch = createSupabaseMock({
      find_containing_isochrones: [
        { station_stop_id: "UNKNOWN99", station_name: "Ghost Station", cutoff_minutes: 7, mode: "WALK" },
      ],
    });

    const results = await getNearestSubwayStations(40.735, -73.99);
    expect(results).toHaveLength(1);

    expect(results[0].station.stopId).toBe("UNKNOWN99");
    expect(results[0].station.name).toBe("Ghost Station");
    expect(results[0].station.lines).toEqual([]);
    expect(results[0].walkMinutes).toBe(7);
  });

  test("deduplicates stations correctly with varied cutoffs", async () => {
    globalThis.fetch = createSupabaseMock({
      find_containing_isochrones: [
        { station_stop_id: "R17", station_name: "14th St-Union Sq", cutoff_minutes: 15, mode: "WALK" },
        { station_stop_id: "R17", station_name: "14th St-Union Sq", cutoff_minutes: 3, mode: "WALK" },
        { station_stop_id: "R17", station_name: "14th St-Union Sq", cutoff_minutes: 10, mode: "WALK" },
      ],
    });

    const results = await getNearestSubwayStations(40.735, -73.99);
    // Only one entry for R17, with the smallest cutoff
    expect(results).toHaveLength(1);
    expect(results[0].walkMinutes).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Tests: getListingIsochrones
// ---------------------------------------------------------------------------

test.describe("query – getListingIsochrones", () => {
  let originalFetch: typeof globalThis.fetch;

  test.beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  });

  test.afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns correct IsochroneInfo format", async () => {
    globalThis.fetch = createSupabaseMock({
      get_listing_isochrones: LISTING_ISOCHRONES_RESPONSE,
    });

    const results = await getListingIsochrones(42);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      isochroneId: 101,
      stationStopId: "R17",
      stationName: "14th St-Union Sq",
      cutoffMinutes: 5,
      mode: "WALK",
    });
    expect(results[1]).toEqual({
      isochroneId: 102,
      stationStopId: "L06",
      stationName: "Bedford Ave",
      cutoffMinutes: 8,
      mode: "WALK",
    });
  });

  test("returns empty array when listing has no isochrones", async () => {
    globalThis.fetch = createSupabaseMock({
      get_listing_isochrones: [],
    });

    const results = await getListingIsochrones(99999);
    expect(results).toEqual([]);
  });

  test("returns empty array when RPC returns null", async () => {
    globalThis.fetch = createSupabaseMock({
      get_listing_isochrones: null,
    });

    const results = await getListingIsochrones(99999);
    expect(results).toEqual([]);
  });

  test("throws on RPC error", async () => {
    globalThis.fetch = createSupabaseMock(
      {},
      { get_listing_isochrones: "relation does not exist" },
    );

    await expect(getListingIsochrones(42)).rejects.toThrow(
      /get_listing_isochrones failed/,
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: getListingsInIsochrone
// ---------------------------------------------------------------------------

test.describe("query – getListingsInIsochrone", () => {
  let originalFetch: typeof globalThis.fetch;

  test.beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  });

  test.afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns listing IDs for an isochrone polygon", async () => {
    globalThis.fetch = createSupabaseMock({
      get_listings_in_isochrone: LISTINGS_IN_ISOCHRONE_RESPONSE,
    });

    const ids = await getListingsInIsochrone(101);
    expect(ids).toEqual([1001, 1002, 1003]);
  });

  test("returns empty array when no listings in isochrone", async () => {
    globalThis.fetch = createSupabaseMock({
      get_listings_in_isochrone: [],
    });

    const ids = await getListingsInIsochrone(999);
    expect(ids).toEqual([]);
  });

  test("throws on RPC error", async () => {
    globalThis.fetch = createSupabaseMock(
      {},
      { get_listings_in_isochrone: "permission denied" },
    );

    await expect(getListingsInIsochrone(101)).rejects.toThrow(
      /get_listings_in_isochrone failed/,
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: enrichListingWithIsochrones
// ---------------------------------------------------------------------------

test.describe("query – enrichListingWithIsochrones", () => {
  let originalFetch: typeof globalThis.fetch;

  test.beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  });

  test.afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("calls enrich RPC with correct parameters", async () => {
    let capturedBody: unknown = null;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/rest/v1/rpc/enrich_listing_isochrones")) {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify(null), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("OK", { status: 200 });
    };

    await enrichListingWithIsochrones(42, 40.735, -73.99);

    expect(capturedBody).toEqual({
      p_listing_id: 42,
      p_lat: 40.735,
      p_lon: -73.99,
    });
  });

  test("throws on RPC error", async () => {
    globalThis.fetch = createSupabaseMock(
      {},
      { enrich_listing_isochrones: "listing not found" },
    );

    await expect(
      enrichListingWithIsochrones(42, 40.735, -73.99),
    ).rejects.toThrow(/enrich_listing_isochrones failed/);
  });

  test("completes without error on success", async () => {
    globalThis.fetch = createSupabaseMock({
      enrich_listing_isochrones: null,
    });

    // Should not throw
    await enrichListingWithIsochrones(42, 40.735, -73.99);
  });
});

// ---------------------------------------------------------------------------
// Tests: batchEnrichListings
// ---------------------------------------------------------------------------

test.describe("query – batchEnrichListings", () => {
  let originalFetch: typeof globalThis.fetch;

  test.beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  });

  test.afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns immediately for empty array without calling RPC", async () => {
    let rpcCalled = false;

    globalThis.fetch = async () => {
      rpcCalled = true;
      return new Response("OK", { status: 200 });
    };

    await batchEnrichListings([]);
    expect(rpcCalled).toBe(false);
  });

  test("passes correct JSON structure to batch RPC", async () => {
    let capturedBody: unknown = null;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/rest/v1/rpc/batch_enrich_listing_isochrones")) {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify(null), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("OK", { status: 200 });
    };

    await batchEnrichListings([
      { id: 1, lat: 40.73, lon: -73.99 },
      { id: 2, lat: 40.74, lon: -73.98 },
      { id: 3, lat: 40.75, lon: -73.97 },
    ]);

    expect(capturedBody).toEqual({
      p_listings: [
        { listing_id: 1, lat: 40.73, lon: -73.99 },
        { listing_id: 2, lat: 40.74, lon: -73.98 },
        { listing_id: 3, lat: 40.75, lon: -73.97 },
      ],
    });
  });

  test("throws on RPC error", async () => {
    globalThis.fetch = createSupabaseMock(
      {},
      { batch_enrich_listing_isochrones: "batch operation failed" },
    );

    await expect(
      batchEnrichListings([{ id: 1, lat: 40.73, lon: -73.99 }]),
    ).rejects.toThrow(/batch_enrich_listing_isochrones failed/);
  });

  test("handles single listing in batch", async () => {
    let capturedBody: unknown = null;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/rest/v1/rpc/batch_enrich_listing_isochrones")) {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify(null), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("OK", { status: 200 });
    };

    await batchEnrichListings([{ id: 42, lat: 40.735, lon: -73.99 }]);

    expect(capturedBody).toEqual({
      p_listings: [{ listing_id: 42, lat: 40.735, lon: -73.99 }],
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: Missing env vars
// ---------------------------------------------------------------------------

test.describe("query – missing env vars", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalUrl: string | undefined;
  let originalKey: string | undefined;

  test.beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  test.afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    else delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (originalKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  test("throws when SUPABASE_SERVICE_ROLE_KEY is missing", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    await expect(getNearestSubwayStations(40.735, -73.99)).rejects.toThrow(
      /Missing/,
    );
  });

  test("throws when NEXT_PUBLIC_SUPABASE_URL is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;

    await expect(getNearestSubwayStations(40.735, -73.99)).rejects.toThrow(
      /Missing/,
    );
  });
});
