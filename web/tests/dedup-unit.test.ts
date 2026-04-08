/**
 * Unit-aware dedup tests.
 *
 * Covers the composite street+unit dedup behavior added in Phase A:
 *  - same street + same unit → merge
 *  - same street + different known units → do NOT merge
 *  - same street + one null unit → merge (null folds into known)
 *  - same street + both null → merge
 *  - StreetEasy urlPath fallback for unit extraction
 *
 * Run with: npx vitest run tests/dedup-unit.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  deduplicateAndComposite,
  normalizeUnit,
} from "../lib/sources/dedup";
import type { ValidatedListing, ListingSource } from "../lib/sources/types";

function makeListing(
  overrides: Partial<ValidatedListing> & { url: string; address: string },
): ValidatedListing {
  const base: ValidatedListing = {
    address: overrides.address,
    area: "Brooklyn, NY",
    price: 3000,
    beds: 1,
    baths: 1,
    sqft: null,
    lat: 40.7,
    lon: -73.95,
    photos: 0,
    photo_urls: [],
    url: overrides.url,
    list_date: null,
    last_update_date: null,
    availability_date: null,
    source: (overrides.source as ListingSource) ?? ("streeteasy" as ListingSource),
    quality: {
      beds: "api",
      baths: "api",
      price: "api",
      geo: "api",
      photos: "missing",
    },
  };
  return { ...base, ...overrides };
}

describe("normalizeUnit", () => {
  it("extracts #1A from address", () => {
    expect(normalizeUnit("355 Grove Street #1A")).toBe("1a");
  });

  it("extracts Apt 2 from address", () => {
    expect(normalizeUnit("355 Grove Street Apt 2")).toBe("2");
  });

  it("extracts Unit 3B from address", () => {
    expect(normalizeUnit("355 Grove Street Unit 3B")).toBe("3b");
  });

  it("extracts Ste 5 from address", () => {
    expect(normalizeUnit("355 Grove Street Ste 5")).toBe("5");
  });

  it("normalizes to lowercase alnum — `#1-A` → `1a`", () => {
    expect(normalizeUnit("355 Grove Street #1-A")).toBe("1a");
  });

  it("returns null when no unit present", () => {
    expect(normalizeUnit("355 Grove Street")).toBeNull();
  });

  it("extracts unit from StreetEasy urlPath when address has none", () => {
    expect(
      normalizeUnit(
        "355 Grove Street",
        "https://streeteasy.com/building/355-grove-street-brooklyn/1a",
        "streeteasy",
      ),
    ).toBe("1a");
  });

  it("does not treat a building slug as a unit", () => {
    // No unit suffix in URL → final segment is building slug → should be null
    expect(
      normalizeUnit(
        "355 Grove Street",
        "https://streeteasy.com/building/355-grove-street-brooklyn",
        "streeteasy",
      ),
    ).toBeNull();
  });
});

describe("deduplicateAndComposite — unit-aware clustering", () => {
  it("same street + same unit → merge", () => {
    const result = deduplicateAndComposite([
      makeListing({
        address: "355 Grove Street #1A",
        url: "https://streeteasy.com/building/355-grove-street-brooklyn/1a",
        source: "streeteasy",
      }),
      makeListing({
        address: "355 Grove Street Apt 1A",
        url: "https://craigslist.org/xyz/1",
        source: "craigslist",
      }),
    ]);
    expect(result).toHaveLength(1);
  });

  it("same street + different known units → do NOT merge", () => {
    const result = deduplicateAndComposite([
      makeListing({
        address: "355 Grove Street #1A",
        url: "https://streeteasy.com/building/355-grove-street-brooklyn/1a",
        source: "streeteasy",
      }),
      makeListing({
        address: "355 Grove Street #2B",
        url: "https://streeteasy.com/building/355-grove-street-brooklyn/2b",
        source: "streeteasy",
      }),
    ]);
    expect(result).toHaveLength(2);
  });

  it("same street + one null unit → merge (null folds into known)", () => {
    const result = deduplicateAndComposite([
      makeListing({
        address: "355 Grove Street #1A",
        url: "https://streeteasy.com/building/355-grove-street-brooklyn/1a",
        source: "streeteasy",
      }),
      makeListing({
        address: "355 Grove Street",
        url: "https://craigslist.org/xyz/2",
        source: "craigslist",
      }),
    ]);
    expect(result).toHaveLength(1);
  });

  it("same street + both null units → merge", () => {
    const result = deduplicateAndComposite([
      makeListing({
        address: "355 Grove Street",
        url: "https://craigslist.org/xyz/a",
        source: "craigslist",
      }),
      makeListing({
        address: "355 Grove Street",
        url: "https://craigslist.org/xyz/b",
        source: "craigslist",
      }),
    ]);
    expect(result).toHaveLength(1);
  });

  it("StreetEasy urlPath extraction: address without unit but url has /1a", () => {
    // Two SE rows at same street: one street-only address, one with different
    // unit via URL. They should NOT merge (different known units after URL
    // extraction fills in the null side).
    const seA = makeListing({
      address: "355 Grove Street",
      url: "https://streeteasy.com/building/355-grove-street-brooklyn/1a",
      source: "streeteasy",
    });
    const seB = makeListing({
      address: "355 Grove Street",
      url: "https://streeteasy.com/building/355-grove-street-brooklyn/2b",
      source: "streeteasy",
    });

    // First, confirm unit extraction from URL works for both:
    expect(normalizeUnit(seA.address, seA.url, seA.source)).toBe("1a");
    expect(normalizeUnit(seB.address, seB.url, seB.source)).toBe("2b");

    const result = deduplicateAndComposite([seA, seB]);
    expect(result).toHaveLength(2);
  });
});
