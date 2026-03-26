/**
 * Parse MTA GTFS stops.txt + routes.txt + stop_times.txt to generate
 * a TypeScript array of NYC subway stations with lines served.
 *
 * Usage:
 *   npx tsx web/scripts/parse-gtfs-stops.ts ./path/to/gtfs/
 *
 * The GTFS directory should contain at minimum:
 *   - stops.txt        (stop ID, name, lat, lon)
 *   - routes.txt       (route ID, short name like "A", "L", etc.)
 *   - trips.txt        (trip ID → route ID mapping)
 *   - stop_times.txt   (which stops each trip serves)
 *
 * Download NYC subway GTFS from:
 *   https://api.mta.info/GTFS_Subway/google_transit.zip
 *
 * Output: prints a TypeScript array to stdout that can replace the
 * contents of web/lib/isochrone/subway-stations.ts.
 */

import { readFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GtfsStop {
  stopId: string;
  name: string;
  lat: number;
  lon: number;
  locationType: number; // 0 = stop, 1 = station (parent)
  parentStation: string;
}

interface GtfsRoute {
  routeId: string;
  shortName: string;
}

// ---------------------------------------------------------------------------
// CSV parsing (simple — GTFS CSVs don't have quoted commas in subway data)
// ---------------------------------------------------------------------------

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseCsv(content: string): Array<Record<string, string>> {
  const lines = content.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.replace(/^\uFEFF/, ""));
  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? "";
    }
    rows.push(row);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const gtfsDir = process.argv[2];
  if (!gtfsDir) {
    console.error("Usage: npx tsx web/scripts/parse-gtfs-stops.ts ./path/to/gtfs/");
    process.exit(1);
  }

  // 1. Parse stops
  const stopsRaw = parseCsv(readFileSync(join(gtfsDir, "stops.txt"), "utf-8"));
  const allStops = new Map<string, GtfsStop>();

  for (const row of stopsRaw) {
    allStops.set(row.stop_id, {
      stopId: row.stop_id,
      name: row.stop_name,
      lat: parseFloat(row.stop_lat),
      lon: parseFloat(row.stop_lon),
      locationType: parseInt(row.location_type || "0", 10),
      parentStation: row.parent_station || "",
    });
  }

  // 2. Parse routes (subway only — route_type = 1)
  //    Normalize short names: GS/FS/H → "S" (shuttles), FX → "F", 6X → "6", 7X → "7"
  const ROUTE_NAME_MAP: Record<string, string> = {
    GS: "S",
    FS: "S",
    H: "S",
    FX: "F",
    "6X": "6",
    "7X": "7",
  };

  const routesRaw = parseCsv(readFileSync(join(gtfsDir, "routes.txt"), "utf-8"));
  const subwayRoutes = new Map<string, GtfsRoute>();

  for (const row of routesRaw) {
    if (row.route_type === "1") {
      const rawName = row.route_short_name || row.route_id;
      const shortName = ROUTE_NAME_MAP[row.route_id] ?? rawName;
      subwayRoutes.set(row.route_id, {
        routeId: row.route_id,
        shortName,
      });
    }
  }

  // 3. Parse trips → build trip_id → route_id mapping
  const tripsRaw = parseCsv(readFileSync(join(gtfsDir, "trips.txt"), "utf-8"));
  const tripToRoute = new Map<string, string>();

  for (const row of tripsRaw) {
    if (subwayRoutes.has(row.route_id)) {
      tripToRoute.set(row.trip_id, row.route_id);
    }
  }

  // 4. Parse stop_times → find which stops are served by which routes
  const stopTimesRaw = parseCsv(
    readFileSync(join(gtfsDir, "stop_times.txt"), "utf-8"),
  );

  // stop_id → Set<route_short_name>
  const stopLines = new Map<string, Set<string>>();

  for (const row of stopTimesRaw) {
    const routeId = tripToRoute.get(row.trip_id);
    if (!routeId) continue;

    const route = subwayRoutes.get(routeId);
    if (!route) continue;

    const stopId = row.stop_id;
    if (!stopLines.has(stopId)) {
      stopLines.set(stopId, new Set());
    }
    stopLines.get(stopId)!.add(route.shortName);
  }

  // 5. Group by parent station (merge child stops into parent)
  // MTA GTFS has child stops like "A15N" (northbound) and "A15S" (southbound)
  // with parent "A15".
  const stationLines = new Map<string, Set<string>>();

  for (const [stopId, lines] of stopLines) {
    const stop = allStops.get(stopId);
    if (!stop) continue;

    // Use parent station if available, otherwise the stop itself
    const parentId = stop.parentStation || stopId;
    if (!stationLines.has(parentId)) {
      stationLines.set(parentId, new Set());
    }
    for (const line of lines) {
      stationLines.get(parentId)!.add(line);
    }
  }

  // 6. Build output — only stations (location_type = 1 or parent stops)
  const output: Array<{
    stopId: string;
    name: string;
    lat: number;
    lon: number;
    lines: string[];
  }> = [];

  for (const [stationId, lines] of stationLines) {
    const station = allStops.get(stationId);
    if (!station) continue;
    if (station.lat === 0 && station.lon === 0) continue;

    output.push({
      stopId: station.stopId,
      name: station.name,
      lat: station.lat,
      lon: station.lon,
      lines: [...lines].sort(),
    });
  }

  // Sort by name for readability
  output.sort((a, b) => a.name.localeCompare(b.name));

  // 7. Print TypeScript output
  console.log(`/**
 * NYC subway station data — auto-generated from MTA GTFS.
 * Generated on: ${new Date().toISOString().split("T")[0]}
 * Stations: ${output.length}
 *
 * Re-generate with:
 *   npx tsx web/scripts/parse-gtfs-stops.ts ./path/to/gtfs/
 */

import type { SubwayStation } from "./types";

const SUBWAY_STATIONS: SubwayStation[] = [`);

  for (const s of output) {
    const linesStr = s.lines.map((l) => `"${l}"`).join(", ");
    console.log(
      `  { stopId: "${s.stopId}", name: "${s.name.replace(/"/g, '\\"')}", lat: ${s.lat}, lon: ${s.lon}, lines: [${linesStr}] },`,
    );
  }

  console.log(`];

export default SUBWAY_STATIONS;`);

  console.error(`\n✅ Generated ${output.length} stations`);
}

main();
