/**
 * Unit tests for getClosestDistinctLines — the "closest N distinct subway
 * lines" query used by the compact nearby-subway indicator on listing cards.
 *
 * Run with: npx vitest run tests/isochrone/nearest-lines.spec.ts
 */

import { describe, it, expect } from "vitest";
import { getClosestDistinctLines } from "../../lib/isochrone/nearest-lines";
import type { SubwayStation } from "../../lib/isochrone/types";

// A tiny synthetic station set, ordered here for readability only — the
// helper sorts by computed distance, not array order.
const STATIONS: SubwayStation[] = [
  // Closest: 6 min-ish walk, C only.
  { stopId: "C1", name: "C Station A", lat: 40.001, lon: -73.999, lines: ["C"] },
  // Slightly farther: 8 min-ish walk, C only — same line as C1, should be dropped.
  { stopId: "C2", name: "C Station B", lat: 40.002, lon: -73.998, lines: ["C"] },
  // Farthest: 15 min-ish walk, L only.
  { stopId: "L1", name: "L Station", lat: 40.01, lon: -73.99, lines: ["L"] },
];

// A hub station serving two lines at once.
const HUB_STATIONS: SubwayStation[] = [
  { stopId: "HUB", name: "Hub", lat: 40.001, lon: -73.999, lines: ["L", "G"] },
  { stopId: "G2", name: "G Station", lat: 40.005, lon: -73.995, lines: ["G"] },
  { stopId: "A1", name: "A Station", lat: 40.008, lon: -73.992, lines: ["A"] },
];

describe("getClosestDistinctLines", () => {
  it("drops a farther duplicate of the same line, keeping the closer one", () => {
    const result = getClosestDistinctLines(40, -74, 2, STATIONS);
    expect(result.map((r) => r.line)).toEqual(["C", "L"]);
    expect(result[0].station.stopId).toBe("C1"); // the closer C, not C2
  });

  it("never returns duplicate lines", () => {
    const result = getClosestDistinctLines(40, -74, 5, STATIONS);
    const lines = result.map((r) => r.line);
    expect(new Set(lines).size).toBe(lines.length);
    expect(lines).toEqual(["C", "L"]); // only 2 distinct lines exist in the fixture
  });

  it("is sorted ascending by distance", () => {
    const result = getClosestDistinctLines(40, -74, 5, STATIONS);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].distMi).toBeGreaterThanOrEqual(result[i - 1].distMi);
    }
  });

  it("a hub station covers multiple lines at its own distance", () => {
    const result = getClosestDistinctLines(40, -74, 2, HUB_STATIONS);
    expect(result.map((r) => r.line).sort()).toEqual(["G", "L"]);
    // Both lines resolve to the same closest station (the hub).
    expect(result.every((r) => r.station.stopId === "HUB")).toBe(true);
  });

  it("respects the maxLines cap", () => {
    const result = getClosestDistinctLines(40, -74, 1, HUB_STATIONS);
    expect(result).toHaveLength(1);
  });

  it("returns an empty array when given no stations", () => {
    expect(getClosestDistinctLines(40, -74, 2, [])).toEqual([]);
  });
});
