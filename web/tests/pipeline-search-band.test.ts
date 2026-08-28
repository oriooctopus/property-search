/**
 * Ingest gate tests for the target search band (bedrooms + price).
 *
 * The band is enforced in lib/sources/pipeline.ts and is the reason a
 * listing outside it never reaches the DB, regardless of source. These tests
 * drive the public entry point (validateAndNormalize) rather than the private
 * rejectReason, so they cover the path ingest actually takes.
 *
 * Run with: npx vitest run tests/pipeline-search-band.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  BEDS_MAX,
  BEDS_MIN,
  PRICE_MAX,
  PRICE_MIN,
  validateAndNormalize,
} from "../lib/sources/pipeline";
import type { AdapterOutput } from "../lib/sources/types";

// Jefferson St (L) — inside both the NYC bbox and the target-region bounds,
// so region gating never fires and only the band under test decides.
const JEFFERSON_LAT = 40.7069;
const JEFFERSON_LON = -73.9226;

function listing(overrides: Partial<AdapterOutput>): AdapterOutput {
  return {
    address: "123 Jefferson St",
    area: "Bushwick",
    price: 4000,
    beds: 2,
    baths: 1,
    sqft: 700,
    lat: JEFFERSON_LAT,
    lon: JEFFERSON_LON,
    photo_urls: ["https://images.craigslist.org/a.jpg"],
    url: "https://newyork.craigslist.org/brk/apa/d/x/1.html",
    list_date: "2026-08-01",
    last_update_date: null,
    availability_date: null,
    source: "craigslist",
    ...overrides,
  };
}

/** Reject reason for a single listing, or null if it was accepted. */
function reasonFor(overrides: Partial<AdapterOutput>): string | null {
  const res = validateAndNormalize([listing(overrides)], "craigslist");
  if (res.listings.length === 1) return null;
  expect(res.rejected).toHaveLength(1);
  return res.rejected[0].reason;
}

describe("target search band constants", () => {
  it("is 1-2 bedrooms, $3000-$5000", () => {
    expect([BEDS_MIN, BEDS_MAX]).toEqual([1, 2]);
    expect([PRICE_MIN, PRICE_MAX]).toEqual([3000, 5000]);
  });
});

describe("bedroom gate", () => {
  it("accepts 1BR", () => {
    expect(reasonFor({ beds: 1 })).toBeNull();
  });

  it("accepts 2BR", () => {
    expect(reasonFor({ beds: 2 })).toBeNull();
  });

  it("rejects studios", () => {
    expect(reasonFor({ beds: 0 })).toBe("bedrooms outside 1-2");
  });

  // 3BR and 4BR were accepted under the old 2-4 gate — these are the
  // regression cases for the narrowing.
  it("rejects 3BR", () => {
    expect(reasonFor({ beds: 3 })).toBe("bedrooms outside 1-2");
  });

  it("rejects 4BR", () => {
    expect(reasonFor({ beds: 4 })).toBe("bedrooms outside 1-2");
  });

  it("rejects unknown bedroom count", () => {
    expect(reasonFor({ beds: null })).toBe("bedrooms outside 1-2");
  });
});

describe("price gate", () => {
  it("accepts the exact lower bound", () => {
    expect(reasonFor({ price: PRICE_MIN })).toBeNull();
  });

  it("accepts the exact upper bound", () => {
    expect(reasonFor({ price: PRICE_MAX })).toBeNull();
  });

  // Both of these passed the old pipeline, which only required price > 0.
  it("rejects a listing one dollar under the floor", () => {
    expect(reasonFor({ price: PRICE_MIN - 1 })).toBe("price outside 3000-5000");
  });

  it("rejects a listing one dollar over the ceiling", () => {
    expect(reasonFor({ price: PRICE_MAX + 1 })).toBe("price outside 3000-5000");
  });

  it("still rejects a zero price as invalid, not as out-of-band", () => {
    expect(reasonFor({ price: 0 })).toBe("no valid price");
  });
});

describe("gate ordering", () => {
  it("reports the bedroom reason when both bedrooms and price are out of band", () => {
    expect(reasonFor({ beds: 4, price: 9000 })).toBe("bedrooms outside 1-2");
  });

  it("counts every out-of-band listing in the rejected total", () => {
    const res = validateAndNormalize(
      [
        listing({ beds: 1, price: 3200 }),
        listing({ beds: 2, price: 4800 }),
        listing({ beds: 3, price: 4000 }),
        listing({ beds: 2, price: 7500 }),
      ],
      "craigslist",
    );
    expect(res.listings).toHaveLength(2);
    expect(res.qualitySummary.totalRejected).toBe(2);
  });
});
