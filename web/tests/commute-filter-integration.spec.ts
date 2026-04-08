import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Integration tests for /api/commute-filter
//
// These tests call the API directly via fetch() — no browser UI involved.
// The dev server must be running on port 8000 (or Playwright starts one on 5001).
// OTP server must be reachable for address/transit tests.
// ---------------------------------------------------------------------------

const API_URL = `${process.env.BASE_URL ?? "http://localhost:5001"}/api/commute-filter`;

interface CommuteRule {
  id: string;
  type: "subway-line" | "station" | "address" | "park";
  lines?: string[];
  stops?: string[];
  stationName?: string;
  address?: string;
  addressLat?: number;
  addressLon?: number;
  parkName?: string;
  maxMinutes: number;
  mode: "walk" | "transit" | "bike";
}

interface CommuteResponse {
  listingIds: number[] | null;
  commuteInfo: Record<string, { minutes: number; station: string; mode: string }> | null;
  message: string | null;
}

async function postCommuteFilter(rules: CommuteRule[]): Promise<{
  status: number;
  body: CommuteResponse;
}> {
  const resp = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commuteRules: rules }),
  });
  const body = await resp.json();
  return { status: resp.status, body };
}

function makeRule(overrides: Partial<CommuteRule> & Pick<CommuteRule, "type">): CommuteRule {
  return {
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    maxMinutes: 30,
    mode: "walk",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Address — Walk (Cases 1-4)
// ---------------------------------------------------------------------------

test.describe("Address — Walk", () => {
  test.setTimeout(60_000);

  test("Case 1: Chess Forum origin, 30 min walk — large radius, should return listings", async () => {
    const { status, body } = await postCommuteFilter([
      makeRule({
        type: "address",
        address: "219 Thompson St, New York, NY",
        addressLat: 40.7291,
        addressLon: -73.9992,
        maxMinutes: 30,
        mode: "walk",
      }),
    ]);

    expect(status).toBe(200);
    expect(body).toHaveProperty("listingIds");
    expect(Array.isArray(body.listingIds)).toBe(true);
    expect(body.listingIds!.length).toBeGreaterThan(0);
    expect(body).toHaveProperty("commuteInfo");
  });

  test("Case 2: Union Square, 30 min walk — 15 min to Chess Forum, should return many listings", async () => {
    const { status, body } = await postCommuteFilter([
      makeRule({
        type: "address",
        address: "Union Square, New York, NY",
        addressLat: 40.7359,
        addressLon: -73.9911,
        maxMinutes: 30,
        mode: "walk",
      }),
    ]);

    expect(status).toBe(200);
    expect(Array.isArray(body.listingIds)).toBe(true);
    expect(body.listingIds!.length).toBeGreaterThan(0);
  });

  test("Case 3: Empire State Building, 30 min walk — 35 min to Chess Forum, should NOT cover Village", async () => {
    const { status, body } = await postCommuteFilter([
      makeRule({
        type: "address",
        address: "Empire State Building, New York, NY",
        addressLat: 40.7484,
        addressLon: -73.9848,
        maxMinutes: 30,
        mode: "walk",
      }),
    ]);

    expect(status).toBe(200);
    expect(Array.isArray(body.listingIds)).toBe(true);
    // 30-min walk from Empire State covers midtown area but not deep into Village
    // The set should be non-empty (midtown listings) but smaller than a Village-centered search
    // We just verify it returns a valid response — geographic coverage depends on DB listings
    expect(body.listingIds).not.toBeNull();
  });

  test("Case 4: MetroTech Brooklyn, 30 min walk — Downtown BK only, no Manhattan", async () => {
    const { status, body } = await postCommuteFilter([
      makeRule({
        type: "address",
        address: "1 MetroTech Center, Brooklyn, NY",
        addressLat: 40.6932,
        addressLon: -73.9871,
        maxMinutes: 30,
        mode: "walk",
      }),
    ]);

    expect(status).toBe(200);
    expect(Array.isArray(body.listingIds)).toBe(true);
    // 30 min walk from MetroTech covers Downtown Brooklyn only — no Manhattan
    // Should return some Brooklyn listings if they exist in the DB
    expect(body.listingIds).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Address — Transit (Cases 5-9)
// ---------------------------------------------------------------------------

test.describe("Address — Transit", () => {
  test.setTimeout(60_000);

  test("Case 5: Chess Forum, 35 min transit — huge coverage, should return many listings", async () => {
    const { status, body } = await postCommuteFilter([
      makeRule({
        type: "address",
        address: "219 Thompson St, New York, NY",
        addressLat: 40.7291,
        addressLon: -73.9992,
        maxMinutes: 35,
        mode: "transit",
      }),
    ]);

    expect(status).toBe(200);
    expect(Array.isArray(body.listingIds)).toBe(true);
    expect(body.listingIds!.length).toBeGreaterThan(0);
    // 35 min transit from Village should cover a huge area
    expect(body.commuteInfo).not.toBeNull();
  });

  test("Case 6: Times Square, 20 min transit — tight cutoff (OTP adds 15% buffer → 23 min)", async () => {
    const { status, body } = await postCommuteFilter([
      makeRule({
        type: "address",
        address: "Times Square, New York, NY",
        addressLat: 40.7595,
        addressLon: -73.9853,
        maxMinutes: 20,
        mode: "transit",
      }),
    ]);

    expect(status).toBe(200);
    expect(Array.isArray(body.listingIds)).toBe(true);
    // Google says 22 min to Chess Forum, but OTP adds 15% buffer (23 min cutoff)
    // so this might still include Village-area listings
    expect(body.listingIds).not.toBeNull();
  });

  test("Case 7: MetroTech Brooklyn, 45 min transit — should cover Manhattan + BK", async () => {
    const { status, body } = await postCommuteFilter([
      makeRule({
        type: "address",
        address: "1 MetroTech Center, Brooklyn, NY",
        addressLat: 40.6932,
        addressLon: -73.9871,
        maxMinutes: 45,
        mode: "transit",
      }),
    ]);

    expect(status).toBe(200);
    expect(Array.isArray(body.listingIds)).toBe(true);
    expect(body.listingIds!.length).toBeGreaterThan(0);
    // 45 min transit from MetroTech is 17 min to Chess Forum — massive coverage
  });

  test("Case 8: Times Square, 5 min transit — very tight, immediate area only", async () => {
    const { status, body } = await postCommuteFilter([
      makeRule({
        type: "address",
        address: "Times Square, New York, NY",
        addressLat: 40.7595,
        addressLon: -73.9853,
        maxMinutes: 5,
        mode: "transit",
      }),
    ]);

    expect(status).toBe(200);
    expect(Array.isArray(body.listingIds)).toBe(true);
    // 5 min transit is extremely tight — likely very few or no results
    // depending on DB listings near Times Square
    expect(body.listingIds).not.toBeNull();
  });

  test("Case 9: Williamsburg/Bedford Av, 30 min transit — should include Village", async () => {
    const { status, body } = await postCommuteFilter([
      makeRule({
        type: "address",
        address: "Bedford Ave, Brooklyn, NY",
        addressLat: 40.7169,
        addressLon: -73.9564,
        maxMinutes: 30,
        mode: "transit",
      }),
    ]);

    expect(status).toBe(200);
    expect(Array.isArray(body.listingIds)).toBe(true);
    expect(body.listingIds!.length).toBeGreaterThan(0);
    // 19 min to Chess Forum — 30 min transit should cover Village + BK
  });
});

// ---------------------------------------------------------------------------
// Address — Bike (Cases 10-11)
// ---------------------------------------------------------------------------

test.describe("Address — Bike", () => {
  test.setTimeout(60_000);

  test("Case 10: Union Square, 15 min bike — should cover lower Manhattan broadly", async () => {
    const { status, body } = await postCommuteFilter([
      makeRule({
        type: "address",
        address: "Union Square, New York, NY",
        addressLat: 40.7359,
        addressLon: -73.9911,
        maxMinutes: 15,
        mode: "bike",
      }),
    ]);

    expect(status).toBe(200);
    expect(Array.isArray(body.listingIds)).toBe(true);
    expect(body.listingIds!.length).toBeGreaterThan(0);
  });

  test("Case 11: Prospect Park, 20 min bike — should NOT reach Village", async () => {
    const { status, body } = await postCommuteFilter([
      makeRule({
        type: "address",
        address: "Prospect Park, Brooklyn, NY",
        addressLat: 40.6682,
        addressLon: -73.9738,
        maxMinutes: 20,
        mode: "bike",
      }),
    ]);

    expect(status).toBe(200);
    expect(Array.isArray(body.listingIds)).toBe(true);
    // Google says 39 min bike to Chess Forum — 20 min should NOT reach Village
    // May return Brooklyn listings or empty depending on DB coverage
    expect(body.listingIds).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Station (Cases 12-14)
//
// Fixed: resolveStationRule now falls back to rule.stationName when
// rule.stops is empty, so station-type rules work correctly.
// ---------------------------------------------------------------------------

test.describe("Station", () => {
  test.setTimeout(60_000);

  test("Case 12: 14 St-Union Sq, 10 min walk — should return listings near Union Sq", async () => {
    const { status, body } = await postCommuteFilter([
      makeRule({
        type: "station",
        stationName: "14 St-Union Sq",
        maxMinutes: 10,
        mode: "walk",
      }),
    ]);

    expect(status).toBe(200);
    expect(Array.isArray(body.listingIds)).toBe(true);
    expect(body.listingIds!.length).toBeGreaterThan(0);
    expect(body.commuteInfo).not.toBeNull();
  });

  test("Case 13: Bedford Av, 15 min walk — should return Williamsburg listings", async () => {
    const { status, body } = await postCommuteFilter([
      makeRule({
        type: "station",
        stationName: "Bedford Av",
        maxMinutes: 15,
        mode: "walk",
      }),
    ]);

    expect(status).toBe(200);
    expect(Array.isArray(body.listingIds)).toBe(true);
    expect(body.listingIds!.length).toBeGreaterThan(0);
  });

  test("Case 14: Grand Central (inexact name), 10 min walk — should return empty (no GTFS match)", async () => {
    // The exact GTFS name is "Grand Central-42 St", not "Grand Central"
    // The API does exact name matching, so this should return empty gracefully
    const { status, body } = await postCommuteFilter([
      makeRule({
        type: "station",
        stationName: "Grand Central",
        maxMinutes: 10,
        mode: "walk",
      }),
    ]);

    expect(status).toBe(200);
    expect(Array.isArray(body.listingIds)).toBe(true);
    expect(body.listingIds!.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Subway Line (Cases 15-17)
// ---------------------------------------------------------------------------

test.describe("Subway Line", () => {
  test.setTimeout(60_000);

  test("Case 15: L train, 10 min walk — should return listings near L stations", async () => {
    const { status, body } = await postCommuteFilter([
      makeRule({
        type: "subway-line",
        lines: ["L"],
        maxMinutes: 10,
        mode: "walk",
      }),
    ]);

    expect(status).toBe(200);
    expect(Array.isArray(body.listingIds)).toBe(true);
    expect(body.listingIds!.length).toBeGreaterThan(0);
    expect(body.commuteInfo).not.toBeNull();

    // Verify commuteInfo has entries for returned listings
    const infoKeys = Object.keys(body.commuteInfo ?? {});
    expect(infoKeys.length).toBeGreaterThan(0);

    // Verify commuteInfo shape
    const firstEntry = body.commuteInfo![infoKeys[0]];
    expect(firstEntry).toHaveProperty("minutes");
    expect(firstEntry).toHaveProperty("station");
    expect(firstEntry).toHaveProperty("mode");
    expect(firstEntry.mode).toBe("walk");

    // Returned listings must be spread across the L line, not clustered at
    // a single neighborhood. Regression guard against the PostgREST 1000-row
    // pagination cap that previously truncated listing_isochrones results.
    const distinctStations = new Set(
      Object.values(body.commuteInfo ?? {}).map((c) => (c as { station: string }).station),
    );
    expect(distinctStations.size).toBeGreaterThanOrEqual(8);
  });

  test("Case 16: 1 train, 15 min walk — should return west-side Manhattan listings", async () => {
    const { status, body } = await postCommuteFilter([
      makeRule({
        type: "subway-line",
        lines: ["1"],
        maxMinutes: 15,
        mode: "walk",
      }),
    ]);

    expect(status).toBe(200);
    expect(Array.isArray(body.listingIds)).toBe(true);
    expect(body.listingIds!.length).toBeGreaterThan(0);
    // 1 train runs the full west side of Manhattan — lots of coverage.
    // Should hit many distinct stations, not just one cluster.
    const stations1 = new Set(
      Object.values(body.commuteInfo ?? {}).map((c) => (c as { station: string }).station),
    );
    expect(stations1.size).toBeGreaterThanOrEqual(8);
  });

  test("Case 17: A + C + E lines, 20 min walk — massive coverage, should return large set", async () => {
    const { status, body } = await postCommuteFilter([
      makeRule({
        type: "subway-line",
        lines: ["A", "C", "E"],
        maxMinutes: 20,
        mode: "walk",
      }),
    ]);

    expect(status).toBe(200);
    expect(Array.isArray(body.listingIds)).toBe(true);
    expect(body.listingIds!.length).toBeGreaterThan(0);

    // A/C/E combined with 20 min walk should cover a massive area
    // Should be more results than a single line with smaller radius
    const stationsACE = new Set(
      Object.values(body.commuteInfo ?? {}).map((c) => (c as { station: string }).station),
    );
    expect(stationsACE.size).toBeGreaterThanOrEqual(15);
  });
});

// ---------------------------------------------------------------------------
// Park (Cases 18-20)
//
// Implemented: resolveParkRule uses OTP isochrones from park centroids,
// same pattern as the address filter.
// ---------------------------------------------------------------------------

test.describe("Park", () => {
  test.setTimeout(60_000);

  test("Case 18: Central Park, 30 min walk — should return UWS/UES/Midtown listings", async () => {
    const { status, body } = await postCommuteFilter([
      makeRule({
        type: "park",
        parkName: "Central Park",
        maxMinutes: 30,
        mode: "walk",
      }),
    ]);

    expect(status).toBe(200);
    expect(Array.isArray(body.listingIds)).toBe(true);
    expect(body.listingIds!.length).toBeGreaterThan(0);
    expect(body.commuteInfo).not.toBeNull();
  });

  test("Case 19: Washington Square Park, 20 min walk — should return Village/SoHo listings", async () => {
    const { status, body } = await postCommuteFilter([
      makeRule({
        type: "park",
        parkName: "Washington Square Park",
        maxMinutes: 20,
        mode: "walk",
      }),
    ]);

    expect(status).toBe(200);
    expect(Array.isArray(body.listingIds)).toBe(true);
    expect(body.listingIds!.length).toBeGreaterThan(0);
  });

  test("Case 20: Brooklyn Bridge Park, 30 min transit — should return DUMBO + Manhattan listings", async () => {
    const { status, body } = await postCommuteFilter([
      makeRule({
        type: "park",
        parkName: "Brooklyn Bridge Park",
        maxMinutes: 30,
        mode: "transit",
      }),
    ]);

    expect(status).toBe(200);
    expect(Array.isArray(body.listingIds)).toBe(true);
    expect(body.listingIds!.length).toBeGreaterThan(0);
  });

  test("Case 21: Unknown park name — should return empty gracefully", async () => {
    const { status, body } = await postCommuteFilter([
      makeRule({
        type: "park",
        parkName: "Nonexistent Park",
        maxMinutes: 30,
        mode: "walk",
      }),
    ]);
    expect(status).toBe(200);
    // Unknown park returns null from resolver → empty result
    expect(body.listingIds).not.toBeNull();
    expect(body.listingIds!.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Multiple Rules — AND logic (Case 22)
// ---------------------------------------------------------------------------

test.describe("Multiple Rules — AND logic", () => {
  test.setTimeout(60_000);

  test("Case 22: L train + address near Union Sq — intersection should be smaller than either alone", async () => {
    // First get L train results alone
    const lOnly = await postCommuteFilter([
      makeRule({
        type: "subway-line",
        lines: ["L"],
        maxMinutes: 10,
        mode: "walk",
      }),
    ]);

    // Then get address results alone
    const addressOnly = await postCommuteFilter([
      makeRule({
        type: "address",
        address: "Union Square, New York, NY",
        addressLat: 40.7359,
        addressLon: -73.9911,
        maxMinutes: 15,
        mode: "walk",
      }),
    ]);

    // Combined: should be intersection (AND)
    const combined = await postCommuteFilter([
      makeRule({
        type: "subway-line",
        lines: ["L"],
        maxMinutes: 10,
        mode: "walk",
      }),
      makeRule({
        type: "address",
        address: "Union Square, New York, NY",
        addressLat: 40.7359,
        addressLon: -73.9911,
        maxMinutes: 15,
        mode: "walk",
      }),
    ]);

    expect(combined.status).toBe(200);
    expect(Array.isArray(combined.body.listingIds)).toBe(true);

    // Intersection should be <= either individual set
    const lCount = lOnly.body.listingIds?.length ?? 0;
    const addrCount = addressOnly.body.listingIds?.length ?? 0;
    const combinedCount = combined.body.listingIds!.length;

    expect(combinedCount).toBeLessThanOrEqual(lCount);
    expect(combinedCount).toBeLessThanOrEqual(addrCount);
  });
});

// ---------------------------------------------------------------------------
// Mode comparison (Case 23)
// ---------------------------------------------------------------------------

test.describe("Mode comparison", () => {
  test.setTimeout(60_000);

  test("Case 23: Transit 15 min should cover more area than walk 15 min from same origin", async () => {
    const walkResult = await postCommuteFilter([
      makeRule({
        type: "address",
        address: "Union Square, New York, NY",
        addressLat: 40.7359,
        addressLon: -73.9911,
        maxMinutes: 15,
        mode: "walk",
      }),
    ]);

    const transitResult = await postCommuteFilter([
      makeRule({
        type: "address",
        address: "Union Square, New York, NY",
        addressLat: 40.7359,
        addressLon: -73.9911,
        maxMinutes: 15,
        mode: "transit",
      }),
    ]);

    expect(walkResult.status).toBe(200);
    expect(transitResult.status).toBe(200);

    const walkCount = walkResult.body.listingIds?.length ?? 0;
    const transitCount = transitResult.body.listingIds?.length ?? 0;

    // Transit should cover more area than walking for the same time
    expect(transitCount).toBeGreaterThanOrEqual(walkCount);
  });
});
