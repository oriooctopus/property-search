import { describe, it, expect } from "vitest";
import { geoSort } from "../geo-sort";

// Helper to build minimal GeoSortable objects.
function pt(id: number, lat: number | null, lon: number | null) {
  return { id, lat, lon };
}

describe("geoSort", () => {
  it("returns an empty array unchanged", () => {
    expect(geoSort([])).toEqual([]);
  });

  it("returns a single-item array unchanged", () => {
    const input = [pt(1, 40.7, -74.0)];
    expect(geoSort(input)).toEqual(input);
  });

  it("appends null-coord listings at the end in original order", () => {
    const a = pt(1, 40.7, -74.0);
    const b = pt(2, null, null);
    const c = pt(3, null, null);
    const d = pt(4, 40.71, -74.01);

    const result = geoSort([a, b, c, d]);

    // b and c have null coords — they must be last, in original relative order.
    expect(result[result.length - 2]).toEqual(b);
    expect(result[result.length - 1]).toEqual(c);

    // a and d (valid coords) come first.
    const validIds = result.slice(0, 2).map((x) => x.id);
    expect(validIds).toContain(1);
    expect(validIds).toContain(4);
  });

  it("orders three collinear points by geographic proximity", () => {
    // Three points on a horizontal line: west → center → east.
    // Starting from west, nearest chain should go west → center → east.
    const west   = pt(1, 40.0, -74.0);
    const center = pt(2, 40.0, -73.5);
    const east   = pt(3, 40.0, -73.0);

    // Input order deliberately scrambled.
    const result = geoSort([west, east, center]);

    // Seed is west (first in input).
    // Nearest to west is center; nearest to center is east.
    expect(result.map((x) => x.id)).toEqual([1, 2, 3]);
  });

  it("walks through one cluster before jumping to a distant cluster", () => {
    // Cluster A: tightly packed near (40.7, -74.0)
    const a1 = pt(1, 40.700, -74.000);
    const a2 = pt(2, 40.701, -74.001);
    const a3 = pt(3, 40.702, -74.002);

    // Cluster B: tightly packed far away near (41.5, -73.0)
    const b1 = pt(4, 41.500, -73.000);
    const b2 = pt(5, 41.501, -73.001);
    const b3 = pt(6, 41.502, -73.002);

    // Interleave the two clusters so naive ordering would alternate.
    const result = geoSort([a1, b1, a2, b2, a3, b3]);
    const ids = result.map((x) => x.id);

    // The algorithm starts at a1 (first in input).
    // All of cluster A should appear before any of cluster B, or vice versa —
    // the key property is that the two clusters are not interleaved.
    const clusterAIndices = [1, 2, 3].map((id) => ids.indexOf(id));
    const clusterBIndices = [4, 5, 6].map((id) => ids.indexOf(id));

    const maxA = Math.max(...clusterAIndices);
    const minB = Math.min(...clusterBIndices);

    // Every A comes before every B (since we seed from a1 which is in A).
    expect(maxA).toBeLessThan(minB);
  });
});
