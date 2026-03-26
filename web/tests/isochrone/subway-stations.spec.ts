import { test, expect } from "@playwright/test";
import SUBWAY_STATIONS from "../../lib/isochrone/subway-stations";

// ---------------------------------------------------------------------------
// NYC geographic bounds (generous envelope covering all boroughs)
// ---------------------------------------------------------------------------

const NYC_LAT_MIN = 40.4;
const NYC_LAT_MAX = 40.95;
const NYC_LON_MIN = -74.3;
const NYC_LON_MAX = -73.6;

// Valid NYC subway line designations
const VALID_SUBWAY_LINES = new Set([
  "1", "2", "3", "4", "5", "6", "7",
  "A", "B", "C", "D", "E", "F", "G",
  "J", "L", "M", "N", "Q", "R", "S", "W", "Z",
  // Shuttles sometimes labeled differently
  "SIR", "FS", "H",
]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("subway-stations data", () => {
  test("station count is within expected range (50-500)", () => {
    expect(SUBWAY_STATIONS.length).toBeGreaterThanOrEqual(50);
    expect(SUBWAY_STATIONS.length).toBeLessThanOrEqual(500);
  });

  test("all stations have required fields", () => {
    for (const station of SUBWAY_STATIONS) {
      expect(station.stopId).toBeTruthy();
      expect(typeof station.stopId).toBe("string");

      expect(station.name).toBeTruthy();
      expect(typeof station.name).toBe("string");

      expect(typeof station.lat).toBe("number");
      expect(typeof station.lon).toBe("number");

      expect(Array.isArray(station.lines)).toBe(true);
    }
  });

  test("all lat values are within NYC bounds", () => {
    for (const station of SUBWAY_STATIONS) {
      expect(
        station.lat,
        `${station.name} (${station.stopId}) lat ${station.lat} out of NYC bounds`,
      ).toBeGreaterThanOrEqual(NYC_LAT_MIN);
      expect(
        station.lat,
        `${station.name} (${station.stopId}) lat ${station.lat} out of NYC bounds`,
      ).toBeLessThanOrEqual(NYC_LAT_MAX);
    }
  });

  test("all lon values are within NYC bounds", () => {
    for (const station of SUBWAY_STATIONS) {
      expect(
        station.lon,
        `${station.name} (${station.stopId}) lon ${station.lon} out of NYC bounds`,
      ).toBeGreaterThanOrEqual(NYC_LON_MIN);
      expect(
        station.lon,
        `${station.name} (${station.stopId}) lon ${station.lon} out of NYC bounds`,
      ).toBeLessThanOrEqual(NYC_LON_MAX);
    }
  });

  test("no duplicate stopIds", () => {
    const ids = SUBWAY_STATIONS.map((s) => s.stopId);
    const unique = new Set(ids);
    const duplicates = ids.filter((id, idx) => ids.indexOf(id) !== idx);
    expect(
      duplicates,
      `Duplicate stopIds found: ${duplicates.join(", ")}`,
    ).toHaveLength(0);
    expect(unique.size).toBe(SUBWAY_STATIONS.length);
  });

  test("known station 'Times Sq-42nd St' exists", () => {
    const station = SUBWAY_STATIONS.find((s) =>
      s.name.includes("Times Sq-42nd St"),
    );
    expect(station).toBeDefined();
    expect(station!.lines.length).toBeGreaterThanOrEqual(3); // Many lines serve this station
    expect(station!.lines).toContain("1");
    expect(station!.lines).toContain("7");
  });

  test("known station '14th St-Union Sq' exists", () => {
    const station = SUBWAY_STATIONS.find((s) =>
      s.name.includes("14th St-Union Sq"),
    );
    expect(station).toBeDefined();
    expect(station!.lines).toContain("L");
    expect(station!.lines).toContain("4");
    expect(station!.lines).toContain("N");
  });

  test("known station 'Bedford Ave' exists", () => {
    const station = SUBWAY_STATIONS.find((s) =>
      s.name.includes("Bedford Ave"),
    );
    expect(station).toBeDefined();
    expect(station!.lines).toContain("L");
    // Bedford Ave is in north Brooklyn — lat should be ~40.71
    expect(station!.lat).toBeGreaterThan(40.7);
    expect(station!.lat).toBeLessThan(40.73);
  });

  test("known station 'Atlantic Ave-Barclays Ctr' exists", () => {
    const station = SUBWAY_STATIONS.find((s) =>
      s.name.includes("Atlantic Ave"),
    );
    expect(station).toBeDefined();
    expect(station!.lines.length).toBeGreaterThanOrEqual(5); // Major transfer hub
  });

  test("known station 'Fulton St' (major hub) exists", () => {
    const station = SUBWAY_STATIONS.find(
      (s) => s.name === "Fulton St" && s.lines.length > 3,
    );
    expect(station).toBeDefined();
    expect(station!.lines).toContain("A");
    expect(station!.lines).toContain("C");
  });

  test("all stations have non-empty lines arrays", () => {
    for (const station of SUBWAY_STATIONS) {
      expect(
        station.lines.length,
        `${station.name} (${station.stopId}) has empty lines array`,
      ).toBeGreaterThan(0);
    }
  });

  test("all lines contain valid NYC subway line names", () => {
    for (const station of SUBWAY_STATIONS) {
      for (const line of station.lines) {
        expect(
          VALID_SUBWAY_LINES.has(line),
          `${station.name} (${station.stopId}) has invalid line "${line}"`,
        ).toBe(true);
      }
    }
  });

  test("station names are non-trivial (at least 3 characters)", () => {
    for (const station of SUBWAY_STATIONS) {
      expect(
        station.name.length,
        `Station ${station.stopId} has very short name "${station.name}"`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  test("stopIds are non-empty and reasonably short", () => {
    for (const station of SUBWAY_STATIONS) {
      expect(station.stopId.length).toBeGreaterThanOrEqual(1);
      expect(station.stopId.length).toBeLessThanOrEqual(10);
    }
  });

  test("coordinates have reasonable precision (not rounded to whole degrees)", () => {
    for (const station of SUBWAY_STATIONS) {
      // Verify coordinates aren't whole numbers (which would indicate bad data)
      // Some stations may have .0000 in one axis (e.g. -74.0000) which is valid
      const latHasFraction = station.lat % 1 !== 0;
      const lonHasFraction = station.lon % 1 !== 0;
      // At least one axis should have fractional precision
      expect(
        latHasFraction || lonHasFraction,
        `${station.name} (${station.stopId}) has suspiciously round coords: ${station.lat}, ${station.lon}`,
      ).toBe(true);
      // Both lat and lon should not be whole integers
      expect(
        station.lat % 1 === 0 && station.lon % 1 === 0,
        `${station.name} has both axes as whole numbers`,
      ).toBe(false);
    }
  });

  test("no two stations share the exact same coordinates", () => {
    const coordSet = new Set<string>();
    const dupes: string[] = [];
    for (const station of SUBWAY_STATIONS) {
      const key = `${station.lat},${station.lon}`;
      if (coordSet.has(key)) {
        dupes.push(`${station.name} at ${key}`);
      }
      coordSet.add(key);
    }
    expect(
      dupes,
      `Stations with duplicate coordinates: ${dupes.join("; ")}`,
    ).toHaveLength(0);
  });

  test("L train corridor has multiple stations", () => {
    const lStations = SUBWAY_STATIONS.filter((s) => s.lines.includes("L"));
    // The L train has many stops in the data covering Manhattan → Brooklyn
    expect(lStations.length).toBeGreaterThanOrEqual(10);
  });

  test("G train has multiple stations", () => {
    const gStations = SUBWAY_STATIONS.filter((s) => s.lines.includes("G"));
    expect(gStations.length).toBeGreaterThanOrEqual(5);
  });
});
