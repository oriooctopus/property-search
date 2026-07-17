/**
 * "Closest distinct subway lines" query.
 *
 * Distinct from `getClosestStations` (SwipeCard.tsx), which returns the N
 * closest STATIONS — two closest stations can serve the same line (e.g. two
 * different C stops), which produced duplicate line badges in compact UIs
 * that show one line per row ("6 min C, 8 min C, 15 min L").
 *
 * This returns the N closest distinct LINES instead: for each line, only its
 * closest station/time counts. A station serving multiple lines (e.g.
 * "L,G 6 min") contributes an entry for each of its lines at that station's
 * distance — so a single close hub can fill multiple slots at once.
 */

import SUBWAY_STATIONS from "./subway-stations";
import type { SubwayStation } from "./types";

// NYC lat/lon degree-to-miles conversion factors (kept in sync with the
// equivalent constants in components/SwipeCard.tsx and ListingDetail.tsx).
const MI_PER_DEG_LAT = 69;
const MI_PER_DEG_LON = 52;

export interface ClosestLineEntry {
  line: string;
  distMi: number;
  station: SubwayStation;
}

/**
 * Returns the `maxLines` closest distinct subway lines to (lat, lon),
 * sorted ascending by distance. Each line appears at most once, keyed to
 * its closest-serving station.
 */
export function getClosestDistinctLines(
  lat: number,
  lon: number,
  maxLines: number,
  stations: SubwayStation[] = SUBWAY_STATIONS,
): ClosestLineEntry[] {
  const sorted = stations
    .map((station) => {
      const dLat = (station.lat - lat) * MI_PER_DEG_LAT;
      const dLon = (station.lon - lon) * MI_PER_DEG_LON;
      return { station, distMi: Math.sqrt(dLat * dLat + dLon * dLon) };
    })
    .sort((a, b) => a.distMi - b.distMi);

  const seen = new Set<string>();
  const result: ClosestLineEntry[] = [];

  for (const { station, distMi } of sorted) {
    for (const line of station.lines) {
      if (seen.has(line)) continue;
      seen.add(line);
      result.push({ line, distMi, station });
    }
    if (result.length >= maxLines) break;
  }

  return result.slice(0, maxLines);
}
