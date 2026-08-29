/**
 * Pure-logic tests for lib/station-search.ts — the fuzzy matcher behind the
 * new map-search box (empty-state "search a station or address" input).
 *
 * These run against the REAL 475-station MTA list (lib/isochrone/subway-stations),
 * not a fixture, because the matcher's behavior depends on there being
 * multiple same-named stations (three "103 St" stops on different lines,
 * three "14 St-Union Sq" stops) and on real MTA abbreviation quirks. A
 * synthetic fixture would hide exactly the collisions this matcher exists
 * to handle correctly.
 */

import { describe, it, expect } from "vitest";
import { searchStations, normalizeTokens } from "@/lib/station-search";

describe("normalizeTokens", () => {
  it("lowercases, strips punctuation, and folds spoken-form words to MTA abbreviations", () => {
    expect(normalizeTokens("Jefferson Street")).toEqual(["jefferson", "st"]);
    expect(normalizeTokens("1st Avenue")).toEqual(["1", "av"]);
  });

  it("strips ordinal suffixes from numbers", () => {
    expect(normalizeTokens("14th St")).toEqual(["14", "st"]);
    expect(normalizeTokens("103rd")).toEqual(["103"]);
  });

  it("returns [] for empty or whitespace-only input", () => {
    expect(normalizeTokens("")).toEqual([]);
    expect(normalizeTokens("   ")).toEqual([]);
  });
});

describe("searchStations — the user's literal acceptance case", () => {
  it('"jefferson street" top result is "Jefferson St"', () => {
    const results = searchStations("jefferson street");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].station.name).toBe("Jefferson St");
    expect(results[0].station.lines).toContain("L");
  });
});

describe("searchStations — abbreviation and partial-token matching", () => {
  it('"jefferson st" matches Jefferson St', () => {
    const results = searchStations("jefferson st");
    expect(results[0].station.name).toBe("Jefferson St");
  });

  it('"jeff" (prefix-only) still matches Jefferson St', () => {
    const results = searchStations("jeff");
    expect(results.some((m) => m.station.name === "Jefferson St")).toBe(true);
  });

  it('"14th st union square" matches 14 St-Union Sq', () => {
    const results = searchStations("14th st union square");
    expect(results[0].station.name).toBe("14 St-Union Sq");
  });

  it('"union sq" also matches 14 St-Union Sq', () => {
    const results = searchStations("union sq");
    expect(results.some((m) => m.station.name === "14 St-Union Sq")).toBe(true);
  });

  it('"1st ave" matches 1 Av', () => {
    const results = searchStations("1st ave");
    expect(results[0].station.name).toBe("1 Av");
  });
});

describe("searchStations — no-match and edge inputs", () => {
  it("empty string returns []", () => {
    expect(searchStations("")).toEqual([]);
  });

  it("whitespace-only returns []", () => {
    expect(searchStations("   ")).toEqual([]);
  });

  it("a query matching nothing returns []", () => {
    expect(searchStations("zzzzz")).toEqual([]);
  });
});

describe("searchStations — ranking", () => {
  it('an exact normalised match ("103 st") outranks a station that merely contains the query ("103 St-Corona Plaza")', () => {
    const results = searchStations("103 st", 10);
    const exactIdx = results.findIndex((m) => m.station.name === "103 St");
    const containsIdx = results.findIndex(
      (m) => m.station.name === "103 St-Corona Plaza",
    );
    expect(exactIdx).toBeGreaterThanOrEqual(0);
    expect(containsIdx).toBeGreaterThanOrEqual(0);
    expect(exactIdx).toBeLessThan(containsIdx);
  });
});

describe("searchStations — limit", () => {
  it("respects the limit parameter", () => {
    // "st" matches a very large fraction of the 475-station list (nearly
    // every name contains "St"), so this is a reliable way to prove the
    // limit is enforced rather than merely under-tested by coincidence.
    const results = searchStations("st", 3);
    expect(results.length).toBe(3);

    const resultsDefault = searchStations("st");
    expect(resultsDefault.length).toBe(6); // documented default
  });
});
