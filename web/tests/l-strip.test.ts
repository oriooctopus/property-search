/**
 * Tests for the always-on L-strip location gate.
 *
 * Two halves:
 *  - the pure selection logic in lib/l-strip.ts (station disambiguation by
 *    coordinate, mode/cutoff filtering, the missing-station invariant)
 *  - the route wiring in app/api/listings/search/route.ts (the gate is
 *    applied to every non-wishlist listings query, never to wishlist mode,
 *    and a resolution failure returns 500 with no listings query issued)
 *
 * Run with: npx vitest run tests/l-strip.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  L_STRIP_STOP_IDS,
  L_STRIP_MAX_WALK_MINUTES,
  L_STRIP_COORD_TOLERANCE,
  selectLStripIsochroneIds,
  lStripStations,
  resetLStripCache,
  type IsochroneRow,
} from "../lib/l-strip";
import type { SubwayStation } from "../lib/isochrone/types";

// ---------------------------------------------------------------------------
// Pure selection logic
// ---------------------------------------------------------------------------

// Real coordinates (from subway-stations.ts / live-DB collisions named in
// the brief) so the tolerance check is exercised against genuine data, not
// invented numbers.
const STATIONS: SubwayStation[] = [
  { stopId: "L08", name: "Bedford Av", lat: 40.717304, lon: -73.956872, lines: ["L"] },
  { stopId: "L10", name: "Lorimer St", lat: 40.714063, lon: -73.950275, lines: ["L"] },
  { stopId: "L11", name: "Graham Av", lat: 40.714565, lon: -73.944053, lines: ["L"] },
  { stopId: "L12", name: "Grand St", lat: 40.711926, lon: -73.94067, lines: ["L"] },
  { stopId: "L13", name: "Montrose Av", lat: 40.707739, lon: -73.93985, lines: ["L"] },
  { stopId: "L14", name: "Morgan Av", lat: 40.706152, lon: -73.933147, lines: ["L"] },
  { stopId: "L15", name: "Jefferson St", lat: 40.706607, lon: -73.922913, lines: ["L"] },
  { stopId: "L16", name: "DeKalb Av", lat: 40.703811, lon: -73.918425, lines: ["L"] },
];

function row(overrides: Partial<IsochroneRow>): IsochroneRow {
  return {
    id: 1,
    origin_name: "Bedford Av",
    origin_lat: 40.717304,
    origin_lon: -73.956872,
    travel_mode: "walk",
    cutoff_minutes: 12,
    ...overrides,
  };
}

/** Full 8-row set, one genuine 12-min walk row per station, ids 1..8. */
function fullRowSet(): IsochroneRow[] {
  return STATIONS.map((s, i) =>
    row({ id: i + 1, origin_name: s.name, origin_lat: s.lat, origin_lon: s.lon }),
  );
}

describe("L_STRIP_STOP_IDS / lStripStations", () => {
  it("has exactly the 8 stops Bedford Av through DeKalb Av, in the real subway-stations.ts data", () => {
    expect(L_STRIP_STOP_IDS).toEqual(["L08", "L10", "L11", "L12", "L13", "L14", "L15", "L16"]);
    const stations = lStripStations();
    expect(stations).toHaveLength(8);
    expect(stations.map((s) => s.name)).toEqual([
      "Bedford Av",
      "Lorimer St",
      "Graham Av",
      "Grand St",
      "Montrose Av",
      "Morgan Av",
      "Jefferson St",
      "DeKalb Av",
    ]);
  });
});

describe("selectLStripIsochroneIds", () => {
  it("selects one row per station from a clean full set, sorted unique", () => {
    const ids = selectLStripIsochroneIds(fullRowSet(), STATIONS);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("excludes the Manhattan Grand St collision (B/D line, far coordinates)", () => {
    const rows = [
      ...fullRowSet(),
      row({ id: 99, origin_name: "Grand St", origin_lat: 40.718267, origin_lon: -73.993753 }),
    ];
    const ids = selectLStripIsochroneIds(rows, STATIONS);
    expect(ids).not.toContain(99);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("excludes the B/Q/R DeKalb Av collision (downtown Brooklyn, far coordinates)", () => {
    const rows = [
      ...fullRowSet(),
      row({ id: 99, origin_name: "DeKalb Av", origin_lat: 40.690635, origin_lon: -73.981824 }),
    ];
    const ids = selectLStripIsochroneIds(rows, STATIONS);
    expect(ids).not.toContain(99);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("excludes the J/M Lorimer St collision (Bushwick, far coordinates)", () => {
    const rows = [
      ...fullRowSet(),
      row({ id: 99, origin_name: "Lorimer St", origin_lat: 40.703869, origin_lon: -73.947408 }),
    ];
    const ids = selectLStripIsochroneIds(rows, STATIONS);
    expect(ids).not.toContain(99);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("includes both near-identical Jefferson St coordinate rows", () => {
    const rows = fullRowSet().filter((r) => r.origin_name !== "Jefferson St");
    rows.push(
      row({ id: 50, origin_name: "Jefferson St", origin_lat: 40.706607, origin_lon: -73.922913 }),
      row({ id: 51, origin_name: "Jefferson St", origin_lat: 40.7066, origin_lon: -73.9229 }),
    );
    const ids = selectLStripIsochroneIds(rows, STATIONS);
    expect(ids).toContain(50);
    expect(ids).toContain(51);
  });

  it("excludes cutoff_minutes 11", () => {
    const rows = [row({ id: 1, cutoff_minutes: 11 })];
    expect(() => selectLStripIsochroneIds(rows, [STATIONS[0]])).toThrow(/Bedford Av/);
  });

  it("excludes cutoff_minutes 13", () => {
    const rows = [row({ id: 1, cutoff_minutes: 13 })];
    expect(() => selectLStripIsochroneIds(rows, [STATIONS[0]])).toThrow(/Bedford Av/);
  });

  it("accepts uppercase WALK", () => {
    const rows = [row({ id: 1, travel_mode: "WALK" })];
    const ids = selectLStripIsochroneIds(rows, [STATIONS[0]]);
    expect(ids).toEqual([1]);
  });

  it("excludes bicycle rows", () => {
    const rows = [row({ id: 1, travel_mode: "bicycle" })];
    expect(() => selectLStripIsochroneIds(rows, [STATIONS[0]])).toThrow(/Bedford Av/);
  });

  it("throws naming the station when a station has zero matching rows", () => {
    const rows = fullRowSet().filter((r) => r.origin_name !== "Montrose Av");
    expect(() => selectLStripIsochroneIds(rows, STATIONS)).toThrow(/Montrose Av/);
  });

  it("returns sorted unique ids even when a station has duplicate matching rows", () => {
    const rows = [
      row({ id: 5, origin_name: "Bedford Av", origin_lat: STATIONS[0].lat, origin_lon: STATIONS[0].lon }),
      row({ id: 2, origin_name: "Bedford Av", origin_lat: STATIONS[0].lat, origin_lon: STATIONS[0].lon }),
      row({ id: 2, origin_name: "Bedford Av", origin_lat: STATIONS[0].lat, origin_lon: STATIONS[0].lon }),
    ];
    const ids = selectLStripIsochroneIds(rows, [STATIONS[0]]);
    expect(ids).toEqual([2, 5]);
  });
});

describe("selectLStripIsochroneIds — coordinate tolerance boundary", () => {
  const station = STATIONS[7]; // DeKalb Av

  it("excludes a same-named collision 0.003° away (just outside tolerance)", () => {
    const rows = [
      row({ id: 1, origin_name: station.name, origin_lat: station.lat + 0.003, origin_lon: station.lon }),
    ];
    expect(() => selectLStripIsochroneIds(rows, [station])).toThrow(/DeKalb Av/);
  });

  // A real station's ~40.7 magnitude lat makes `station.lat +
  // L_STRIP_COORD_TOLERANCE` pick up ~1e-15 of float rounding noise, so the
  // recovered delta (row.lat - station.lat) is NOT bit-exactly the
  // tolerance value (verified: 40.703811 + 0.002 - 40.703811 ===
  // 0.0020000000000024443, not 0.002 — and rounding that back to fewer
  // decimal places lands slightly UNDER tolerance instead, which passes
  // under both <= and < and so cannot distinguish them). A zero-magnitude
  // station sidesteps this: subtracting from 0 is an exact no-op, so the
  // recovered delta is bit-identical to whatever was assigned, letting
  // these two tests isolate the `<=` vs `<` in isNearStation from float
  // error entirely.
  const zeroStation: SubwayStation = { stopId: "ZZ", name: "Zero Station", lat: 0, lon: 0, lines: [] };

  it("includes a row exactly at the tolerance boundary (delta === L_STRIP_COORD_TOLERANCE, <=)", () => {
    const rows = [
      row({ id: 1, origin_name: "Zero Station", origin_lat: L_STRIP_COORD_TOLERANCE, origin_lon: 0 }),
    ];
    const ids = selectLStripIsochroneIds(rows, [zeroStation]);
    expect(ids).toEqual([1]);
  });

  it("excludes a row just past the tolerance boundary (delta === L_STRIP_COORD_TOLERANCE + 0.0001)", () => {
    const rows = [
      row({
        id: 1,
        origin_name: "Zero Station",
        origin_lat: L_STRIP_COORD_TOLERANCE + 0.0001,
        origin_lon: 0,
      }),
    ];
    expect(() => selectLStripIsochroneIds(rows, [zeroStation])).toThrow(/Zero Station/);
  });
});

// ---------------------------------------------------------------------------
// Route wiring: app/api/listings/search/route.ts
// ---------------------------------------------------------------------------

const resolveLStripIsochroneIdsMock = vi.fn();

vi.mock("../lib/l-strip", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/l-strip")>();
  return {
    ...actual,
    resolveLStripIsochroneIds: (...args: unknown[]) => resolveLStripIsochroneIdsMock(...args),
  };
});

// resolveCommuteRules is mocked so the "commuteRules present" route branches
// (commute chunk, nearestTo chunk) can be exercised deterministically without
// standing up the full subway-line/address/park resolution machinery. Default
// behavior (set in beforeEach) mirrors the real short-circuit for an empty/
// absent rule list; individual tests override with mockResolvedValueOnce to
// force a non-null id set.
const resolveCommuteRulesMock = vi.fn();

vi.mock("../lib/commute-resolver", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/commute-resolver")>();
  return {
    ...actual,
    resolveCommuteRules: (...args: unknown[]) => resolveCommuteRulesMock(...args),
  };
});

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

/** Chainable stub mimicking the subset of the Supabase query-builder API
 * the route uses. Every from(table) call gets a fresh builder that shares
 * the same `calls` recorder, and resolves (as a thenable, like Supabase's
 * real builder) to `resultsByTable[table]` (default: empty success). */
function makeSupabaseStub(resultsByTable: Record<string, { data: unknown; error: unknown }> = {}) {
  const calls: RecordedCall[] = [];
  const fromCalls: string[] = [];
  const methods = [
    "select", "order", "range", "in", "eq", "neq", "gte", "lte", "is", "not", "or", "ilike",
  ];

  function makeBuilder(table: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};
    for (const m of methods) {
      builder[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        return builder;
      };
    }
    builder.then = (
      resolve: (v: unknown) => unknown,
      reject: (e: unknown) => unknown,
    ) => {
      const result = resultsByTable[table] ?? { data: [], error: null };
      return Promise.resolve(result).then(resolve, reject);
    };
    return builder;
  }

  const client = {
    from: (table: string) => {
      fromCalls.push(table);
      return makeBuilder(table);
    },
  };

  return { client, calls, fromCalls };
}

let stubClient: ReturnType<typeof makeSupabaseStub>["client"] | null = null;

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    if (!stubClient) throw new Error("test forgot to set up the supabase stub before POSTing");
    return stubClient;
  },
}));

async function postSearch(body: Record<string, unknown>) {
  const { POST } = await import("../app/api/listings/search/route");
  const { NextRequest } = await import("next/server");
  const req = new NextRequest("http://localhost/api/listings/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  const json = await res.json();
  return { status: res.status, json };
}

beforeEach(() => {
  resolveLStripIsochroneIdsMock.mockReset();
  resolveCommuteRulesMock.mockReset();
  resolveCommuteRulesMock.mockImplementation(async (rules: unknown) => {
    if (!rules || (rules as unknown[]).length === 0) {
      return { ids: null, meta: {}, message: null };
    }
    return { ids: new Set<number>(), meta: {}, message: null };
  });
  resetLStripCache();
  stubClient = null;
  // getClient() in route.ts throws before ever calling createClient() if
  // these are unset — real values, unused by our mocked client.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
});

/** Minimal valid CommuteRule for tests — content is irrelevant since
 * resolveCommuteRules is fully mocked above; only its presence (non-empty
 * array) matters for the route's `commuteRules ?? null` plumbing. */
const SAMPLE_COMMUTE_RULE = {
  id: "rule-1",
  type: "subway-line",
  lines: ["L"],
  maxMinutes: 20,
  mode: "transit",
};

describe("route: L-strip gate wiring", () => {
  it("a plain search applies the isochrone .in() filter and the !inner embed select", async () => {
    resolveLStripIsochroneIdsMock.mockResolvedValue([101, 102]);
    const stub = makeSupabaseStub({ listings: { data: [], error: null } });
    stubClient = stub.client;

    const { status, json } = await postSearch({ filters: {}, limit: 50 });

    expect(status).toBe(200);
    expect(json.listings).toEqual([]);
    expect(resolveLStripIsochroneIdsMock).toHaveBeenCalledTimes(1);

    const listingsCalls = stub.calls.filter((c) => c.table === "listings");
    const selectCall = listingsCalls.find((c) => c.method === "select");
    expect(selectCall).toBeDefined();
    expect(String(selectCall!.args[0])).toContain("listing_isochrones!inner(isochrone_id)");

    const inCall = listingsCalls.find(
      (c) => c.method === "in" && c.args[0] === "listing_isochrones.isochrone_id",
    );
    expect(inCall).toBeDefined();
    expect(inCall!.args[1]).toEqual([101, 102]);
  });

  it("wishlist mode does NOT apply the gate", async () => {
    const stub = makeSupabaseStub({
      wishlists: { data: [{ id: "wish-1", user_id: null, is_public: true }], error: null },
      wishlist_items: { data: [{ listing_id: 555 }], error: null },
      listings: { data: [], error: null },
    });
    stubClient = stub.client;

    const { status, json } = await postSearch({
      filters: {},
      limit: 50,
      wishlistIds: ["wish-1"],
    });

    expect(status).toBe(200);
    expect(json.listings).toEqual([]);
    // Wishlist mode must never even ask for the L-strip ids.
    expect(resolveLStripIsochroneIdsMock).not.toHaveBeenCalled();

    const listingsCalls = stub.calls.filter((c) => c.table === "listings");
    const selectCall = listingsCalls.find((c) => c.method === "select");
    expect(selectCall).toBeDefined();
    expect(String(selectCall!.args[0])).not.toContain("listing_isochrones");

    const gateInCall = listingsCalls.find(
      (c) => c.method === "in" && c.args[0] === "listing_isochrones.isochrone_id",
    );
    expect(gateInCall).toBeUndefined();
  });

  it("a resolution failure returns 500 and issues no listings query", async () => {
    resolveLStripIsochroneIdsMock.mockRejectedValue(
      new Error("l-strip: no 12-minute walk isochrone found for station \"Montrose Av\" (L13)"),
    );
    const stub = makeSupabaseStub({ listings: { data: [{ id: 1 }], error: null } });
    stubClient = stub.client;

    const { status, json } = await postSearch({ filters: {}, limit: 50 });

    expect(status).toBe(500);
    expect(json.error).toContain("Montrose Av");
    expect(stub.fromCalls).not.toContain("listings");
  });

  it("nearestTo (no commute/wishlist ids) applies the gate on the whole-table range query", async () => {
    resolveLStripIsochroneIdsMock.mockResolvedValue([201, 202]);
    const stub = makeSupabaseStub({ listings: { data: [], error: null } });
    stubClient = stub.client;

    const { status, json } = await postSearch({ filters: {}, nearestTo: { lat: 40.71, lon: -73.95 } });

    expect(status).toBe(200);
    expect(json.listing).toBeNull();

    const listingsCalls = stub.calls.filter((c) => c.table === "listings");
    const selectCall = listingsCalls.find((c) => c.method === "select");
    expect(selectCall).toBeDefined();
    expect(String(selectCall!.args[0])).toContain("listing_isochrones!inner(isochrone_id)");

    const inCall = listingsCalls.find(
      (c) => c.method === "in" && c.args[0] === "listing_isochrones.isochrone_id",
    );
    expect(inCall).toBeDefined();
    expect(inCall!.args[1]).toEqual([201, 202]);
  });

  it("commuteRules on the main (non-nearestTo) page query applies the gate on the commute-chunk query", async () => {
    resolveLStripIsochroneIdsMock.mockResolvedValue([301, 302]);
    resolveCommuteRulesMock.mockResolvedValueOnce({ ids: new Set([1, 2]), meta: {}, message: null });
    const stub = makeSupabaseStub({ listings: { data: [], error: null } });
    stubClient = stub.client;

    const { status, json } = await postSearch({
      filters: {},
      limit: 50,
      commuteRules: [SAMPLE_COMMUTE_RULE],
    });

    expect(status).toBe(200);
    expect(json.listings).toEqual([]);

    const listingsCalls = stub.calls.filter((c) => c.table === "listings");
    const selectCall = listingsCalls.find((c) => c.method === "select");
    expect(selectCall).toBeDefined();
    expect(String(selectCall!.args[0])).toContain("listing_isochrones!inner(isochrone_id)");

    const gateInCall = listingsCalls.find(
      (c) => c.method === "in" && c.args[0] === "listing_isochrones.isochrone_id",
    );
    expect(gateInCall).toBeDefined();
    expect(gateInCall!.args[1]).toEqual([301, 302]);

    // Also confirm this went through the commute id-chunk path, not the
    // unfiltered path — the chunk query filters by listing id too.
    const idChunkCall = listingsCalls.find((c) => c.method === "in" && c.args[0] === "id");
    expect(idChunkCall).toBeDefined();
    expect(new Set(idChunkCall!.args[1] as number[])).toEqual(new Set([1, 2]));
  });

  it("nearestTo + commuteRules together applies the gate on the nearestTo chunk query", async () => {
    resolveLStripIsochroneIdsMock.mockResolvedValue([401, 402]);
    resolveCommuteRulesMock.mockResolvedValueOnce({ ids: new Set([5, 6]), meta: {}, message: null });
    const stub = makeSupabaseStub({ listings: { data: [], error: null } });
    stubClient = stub.client;

    const { status, json } = await postSearch({
      filters: {},
      nearestTo: { lat: 40.71, lon: -73.95 },
      commuteRules: [SAMPLE_COMMUTE_RULE],
    });

    expect(status).toBe(200);
    expect(json.listing).toBeNull();

    const listingsCalls = stub.calls.filter((c) => c.table === "listings");
    const selectCall = listingsCalls.find((c) => c.method === "select");
    expect(selectCall).toBeDefined();
    expect(String(selectCall!.args[0])).toContain("listing_isochrones!inner(isochrone_id)");

    const gateInCall = listingsCalls.find(
      (c) => c.method === "in" && c.args[0] === "listing_isochrones.isochrone_id",
    );
    expect(gateInCall).toBeDefined();
    expect(gateInCall!.args[1]).toEqual([401, 402]);

    const idChunkCall = listingsCalls.find((c) => c.method === "in" && c.args[0] === "id");
    expect(idChunkCall).toBeDefined();
    expect(new Set(idChunkCall!.args[1] as number[])).toEqual(new Set([5, 6]));
  });

  it("strips the listing_isochrones embed from the response while keeping every other field and row count", async () => {
    resolveLStripIsochroneIdsMock.mockResolvedValue([1]);
    const stubRows = [
      { id: 1, address: "123 Main St", price: 3000, beds: 2, listing_isochrones: [{ isochrone_id: 1 }] },
      { id: 2, address: "456 Elm St", price: 3200, beds: 2, listing_isochrones: [{ isochrone_id: 1 }] },
    ];
    const stub = makeSupabaseStub({ listings: { data: stubRows, error: null } });
    stubClient = stub.client;

    const { status, json } = await postSearch({ filters: {}, limit: 50 });

    expect(status).toBe(200);
    expect(json.listings).toHaveLength(stubRows.length);
    for (let i = 0; i < stubRows.length; i++) {
      const returned = json.listings[i];
      expect(returned).not.toHaveProperty("listing_isochrones");
      expect(returned.id).toBe(stubRows[i].id);
      expect(returned.address).toBe(stubRows[i].address);
      expect(returned.price).toBe(stubRows[i].price);
      expect(returned.beds).toBe(stubRows[i].beds);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveLStripIsochroneIds — the DB-facing resolver (never exercised by the
// route-wiring tests above, which mock it out entirely). Uses vi.importActual
// to get the REAL implementation, bypassing the module-level vi.mock() above
// that swaps resolveLStripIsochroneIds for the route tests.
// ---------------------------------------------------------------------------

/** Chainable stub for the `isochrones` table query
 * (`.from("isochrones").select(...).ilike(...).eq(...)`), recording every
 * call. `responses` is consumed one entry per resolved query (i.e. once per
 * resolveLStripIsochroneIds() call that actually hits the DB); the last
 * entry repeats if more calls happen than entries provided. */
function makeIsochroneStub(responses: Array<{ data: unknown; error: unknown }>) {
  let callCount = 0;
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const fromCalls: string[] = [];

  function builder() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    for (const m of ["select", "ilike", "eq"]) {
      b[m] = (...args: unknown[]) => {
        calls.push({ method: m, args });
        return b;
      };
    }
    b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
      const idx = Math.min(callCount, responses.length - 1);
      callCount++;
      return Promise.resolve(responses[idx]).then(resolve, reject);
    };
    return b;
  }

  const client = {
    from: (table: string) => {
      fromCalls.push(table);
      calls.push({ method: "from", args: [table] });
      return builder();
    },
  };

  return { client, calls, fromCalls };
}

/** Real 8-row set (one genuine 12-min walk row per L-strip station, ids
 * 1..8), built from the actual lStripStations() so it stays correct even if
 * subway-stations.ts changes. */
function fullResolverRowSet(): IsochroneRow[] {
  return lStripStations().map((s, i) => ({
    id: i + 1,
    origin_name: s.name,
    origin_lat: s.lat,
    origin_lon: s.lon,
    travel_mode: "walk",
    cutoff_minutes: L_STRIP_MAX_WALK_MINUTES,
  }));
}

describe("resolveLStripIsochroneIds", () => {
  it("a query error rejects the promise and does NOT cache — the next call re-queries", async () => {
    const { resolveLStripIsochroneIds } = await vi.importActual<typeof import("../lib/l-strip")>(
      "../lib/l-strip",
    );
    const stub = makeIsochroneStub([
      { data: null, error: { message: "isochrones table unreachable" } },
      { data: fullResolverRowSet(), error: null },
    ]);

    await expect(resolveLStripIsochroneIds(stub.client)).rejects.toThrow(
      /isochrones table unreachable/,
    );
    expect(stub.fromCalls).toHaveLength(1);

    const ids = await resolveLStripIsochroneIds(stub.client);
    expect(stub.fromCalls).toHaveLength(2);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("caches a success — a second call within the TTL does not hit the DB again", async () => {
    const { resolveLStripIsochroneIds } = await vi.importActual<typeof import("../lib/l-strip")>(
      "../lib/l-strip",
    );
    const stub = makeIsochroneStub([{ data: fullResolverRowSet(), error: null }]);

    const ids1 = await resolveLStripIsochroneIds(stub.client);
    const ids2 = await resolveLStripIsochroneIds(stub.client);

    expect(stub.fromCalls).toHaveLength(1);
    expect(ids2).toEqual(ids1);
  });

  it("queries via .ilike('travel_mode', 'walk').eq('cutoff_minutes', 12)", async () => {
    const { resolveLStripIsochroneIds } = await vi.importActual<typeof import("../lib/l-strip")>(
      "../lib/l-strip",
    );
    const stub = makeIsochroneStub([{ data: fullResolverRowSet(), error: null }]);

    await resolveLStripIsochroneIds(stub.client);

    const ilikeCall = stub.calls.find((c) => c.method === "ilike");
    expect(ilikeCall).toBeDefined();
    expect(ilikeCall!.args).toEqual(["travel_mode", "walk"]);

    const eqCall = stub.calls.find((c) => c.method === "eq");
    expect(eqCall).toBeDefined();
    expect(eqCall!.args).toEqual(["cutoff_minutes", L_STRIP_MAX_WALK_MINUTES]);
  });

  it("rows fetched from the DB go through the coordinate selection end-to-end — a collision is excluded", async () => {
    const { resolveLStripIsochroneIds } = await vi.importActual<typeof import("../lib/l-strip")>(
      "../lib/l-strip",
    );
    const collisionRow: IsochroneRow = {
      id: 999,
      origin_name: "DeKalb Av",
      origin_lat: 40.690635,
      origin_lon: -73.981824,
      travel_mode: "walk",
      cutoff_minutes: L_STRIP_MAX_WALK_MINUTES,
    };
    const stub = makeIsochroneStub([
      { data: [...fullResolverRowSet(), collisionRow], error: null },
    ]);

    const ids = await resolveLStripIsochroneIds(stub.client);

    expect(ids).not.toContain(999);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
