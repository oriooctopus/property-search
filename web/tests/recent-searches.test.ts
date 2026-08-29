/**
 * Tests for the "recent location searches" validation logic in
 * lib/recent-searches.ts — pure functions, no route/DB needed.
 *
 * Run with: npx vitest run tests/recent-searches.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  validateRecentSearchInput,
  capRecentSearches,
  MAX_LABEL_LENGTH,
  MAX_RECENT_SEARCHES,
  type RecentSearch,
} from "../lib/recent-searches";

const VALID_BODY = {
  label: "Jefferson St",
  sublabel: "L",
  lat: 40.706607,
  lon: -73.922913,
  kind: "address" as const,
};

describe("validateRecentSearchInput — happy path", () => {
  it("accepts a well-formed body", () => {
    const result = validateRecentSearchInput(VALID_BODY);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(VALID_BODY);
    }
  });

  it("accepts a missing/null sublabel as null", () => {
    const { sublabel, ...rest } = VALID_BODY;
    const result = validateRecentSearchInput(rest);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sublabel).toBeNull();

    const resultNull = validateRecentSearchInput({ ...rest, sublabel: null });
    expect(resultNull.ok).toBe(true);
    if (resultNull.ok) expect(resultNull.value.sublabel).toBeNull();
  });
});

describe("validateRecentSearchInput — lat/lon range and type", () => {
  it("rejects lat/lon out of range", () => {
    expect(validateRecentSearchInput({ ...VALID_BODY, lat: 90.1 }).ok).toBe(false);
    expect(validateRecentSearchInput({ ...VALID_BODY, lat: -90.1 }).ok).toBe(false);
    expect(validateRecentSearchInput({ ...VALID_BODY, lon: 180.1 }).ok).toBe(false);
    expect(validateRecentSearchInput({ ...VALID_BODY, lon: -180.1 }).ok).toBe(false);
  });

  it("accepts boundary values", () => {
    expect(validateRecentSearchInput({ ...VALID_BODY, lat: 90, lon: 180 }).ok).toBe(true);
    expect(validateRecentSearchInput({ ...VALID_BODY, lat: -90, lon: -180 }).ok).toBe(true);
  });

  it("rejects NaN and Infinity", () => {
    expect(validateRecentSearchInput({ ...VALID_BODY, lat: NaN }).ok).toBe(false);
    expect(validateRecentSearchInput({ ...VALID_BODY, lat: Infinity }).ok).toBe(false);
    expect(validateRecentSearchInput({ ...VALID_BODY, lon: -Infinity }).ok).toBe(false);
  });

  it("rejects non-numeric strings", () => {
    expect(validateRecentSearchInput({ ...VALID_BODY, lat: "not-a-number" }).ok).toBe(false);
    expect(validateRecentSearchInput({ ...VALID_BODY, lat: "" }).ok).toBe(false);
    expect(validateRecentSearchInput({ ...VALID_BODY, lat: "   " }).ok).toBe(false);
    // trailing garbage after a valid-looking prefix must not be silently truncated
    expect(validateRecentSearchInput({ ...VALID_BODY, lat: "40.7abc" }).ok).toBe(false);
  });

  it("rejects missing lat/lon and other non-numeric types", () => {
    expect(validateRecentSearchInput({ ...VALID_BODY, lat: undefined }).ok).toBe(false);
    expect(validateRecentSearchInput({ ...VALID_BODY, lat: null }).ok).toBe(false);
    expect(validateRecentSearchInput({ ...VALID_BODY, lat: [] }).ok).toBe(false);
    expect(validateRecentSearchInput({ ...VALID_BODY, lat: {} }).ok).toBe(false);
  });

  it("accepts numeric strings that parse cleanly (coercion is deliberate — geocoder/URL params arrive as strings)", () => {
    const result = validateRecentSearchInput({ ...VALID_BODY, lat: "40.706607", lon: "-73.922913" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lat).toBe(40.706607);
      expect(result.value.lon).toBe(-73.922913);
    }
  });
});

describe("validateRecentSearchInput — label", () => {
  it("rejects an empty label", () => {
    expect(validateRecentSearchInput({ ...VALID_BODY, label: "" }).ok).toBe(false);
  });

  it("rejects a whitespace-only label", () => {
    expect(validateRecentSearchInput({ ...VALID_BODY, label: "   " }).ok).toBe(false);
  });

  it("rejects a missing/non-string label", () => {
    expect(validateRecentSearchInput({ ...VALID_BODY, label: undefined }).ok).toBe(false);
    expect(validateRecentSearchInput({ ...VALID_BODY, label: 123 }).ok).toBe(false);
  });

  it("truncates a 500-char label to 200 chars", () => {
    const longLabel = "x".repeat(500);
    const result = validateRecentSearchInput({ ...VALID_BODY, label: longLabel });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.label.length).toBe(MAX_LABEL_LENGTH);
      expect(result.value.label).toBe("x".repeat(200));
    }
  });

  it("trims surrounding whitespace before truncating", () => {
    const result = validateRecentSearchInput({ ...VALID_BODY, label: "  Jefferson St  " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.label).toBe("Jefferson St");
  });
});

describe("validateRecentSearchInput — kind", () => {
  it("accepts 'station' and 'address'", () => {
    expect(validateRecentSearchInput({ ...VALID_BODY, kind: "station" }).ok).toBe(true);
    expect(validateRecentSearchInput({ ...VALID_BODY, kind: "address" }).ok).toBe(true);
  });

  it("rejects kind outside the two literals", () => {
    expect(validateRecentSearchInput({ ...VALID_BODY, kind: "bus" }).ok).toBe(false);
    expect(validateRecentSearchInput({ ...VALID_BODY, kind: "" }).ok).toBe(false);
    expect(validateRecentSearchInput({ ...VALID_BODY, kind: undefined }).ok).toBe(false);
    expect(validateRecentSearchInput({ ...VALID_BODY, kind: 1 }).ok).toBe(false);
  });
});

describe("validateRecentSearchInput — malformed body", () => {
  it("rejects a non-object body", () => {
    expect(validateRecentSearchInput(null).ok).toBe(false);
    expect(validateRecentSearchInput("nope").ok).toBe(false);
    expect(validateRecentSearchInput(42).ok).toBe(false);
    expect(validateRecentSearchInput([]).ok).toBe(false);
  });

  it("rejects a non-string sublabel", () => {
    expect(validateRecentSearchInput({ ...VALID_BODY, sublabel: 5 }).ok).toBe(false);
  });
});

describe("capRecentSearches", () => {
  function makeRows(n: number): RecentSearch[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `id-${i}`,
      label: `label-${i}`,
      sublabel: null,
      lat: 0,
      lon: 0,
      kind: "address" as const,
      createdAt: new Date(2026, 0, i + 1).toISOString(),
    }));
  }

  it("caps the returned list at 8", () => {
    const rows = makeRows(20);
    const capped = capRecentSearches(rows);
    expect(capped.length).toBe(MAX_RECENT_SEARCHES);
    expect(capped).toEqual(rows.slice(0, 8));
  });

  it("passes through a shorter list unchanged", () => {
    const rows = makeRows(3);
    expect(capRecentSearches(rows)).toEqual(rows);
  });

  it("handles an empty list", () => {
    expect(capRecentSearches([])).toEqual([]);
  });
});
