import {
  Client,
  TravelMode,
  type DirectionsResponse,
} from "@googlemaps/google-maps-services-js";
import "dotenv/config";

import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __distDir = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(__distDir, "..", ".directions-cache.json");

const client = new Client();
const API_KEY = process.env.GOOGLE_MAPS_API_KEY;

if (!API_KEY) {
  console.warn(
    "Warning: GOOGLE_MAPS_API_KEY not set. Distance features will not work."
  );
}

// Disk-backed cache for Google Maps Directions API results
let directionsCache: Record<string, any> = {};
try {
  if (existsSync(CACHE_FILE)) {
    directionsCache = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
  }
} catch {}

function saveCache() {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(directionsCache));
  } catch (e) {
    console.warn("Cache write failed:", e);
  }
}

export function isDirectionsCached(origin: string, destination: string): boolean {
  const bikeKey = `${origin}|${destination}|${TravelMode.bicycling}`;
  const transitKey = `${origin}|${destination}|${TravelMode.transit}`;
  const walkKey = `${origin}|${destination}|${TravelMode.walking}`;
  return bikeKey in directionsCache && transitKey in directionsCache && walkKey in directionsCache;
}

export function getCacheStats(): { size: number } {
  return { size: Object.keys(directionsCache).length };
}

export interface Destination {
  name: string;
  address: string;
  lat?: number;
  lon?: number;
  filterMode?: "biking" | "transit" | "walking";  // which mode to filter on
  maxMinutes?: number;                // max travel time for that mode
  filterGroup?: string;               // destinations in same group use OR logic
}

export interface TravelInfo {
  mode: "bicycling" | "transit";
  distanceMiles: number;
  durationMinutes: number;
  transfers: number | null; // only for transit
  summary: string;
}

export interface NearestSubway {
  stationName: string;
  lines: string[];           // e.g. ["L", "G"]
  walkMinutes: number;
  walkMiles: number;
}

export interface DistanceResult {
  from: string;
  to: string;
  toAddress: string;
  biking: TravelInfo;
  transit: TravelInfo;
  walking: TravelInfo;
  nearestSubway: NearestSubway | null; // extracted from transit directions
}

async function getDirections(
  origin: string,
  destination: string,
  mode: TravelMode
): Promise<DirectionsResponse> {
  if (!API_KEY) throw new Error("GOOGLE_MAPS_API_KEY is not set");

  const cacheKey = `${origin}|${destination}|${mode}`;
  if (directionsCache[cacheKey]) {
    return { data: directionsCache[cacheKey] } as DirectionsResponse;
  }

  const result = await client.directions({
    params: {
      origin,
      destination,
      mode,
      key: API_KEY,
    },
  });

  directionsCache[cacheKey] = result.data;
  saveCache();
  return result;
}


function parseTravelInfo(
  response: DirectionsResponse,
  mode: "bicycling" | "transit" | "walking"
): TravelInfo {
  const route = response.data.routes[0];
  if (!route) {
    return {
      mode,
      distanceMiles: 0,
      durationMinutes: 0,
      transfers: mode === "transit" ? 0 : null,
      summary: "No route found",
    };
  }

  const leg = route.legs[0];
  const distanceMiles = Math.round((leg.distance.value / 1609.34) * 10) / 10;
  const durationMinutes = Math.round(leg.duration.value / 60);

  let transfers: number | null = null;
  let summary = route.summary || "";

  if (mode === "transit") {
    const transitSteps = leg.steps.filter(
      (step) =>
        (step.travel_mode as string).toUpperCase() === "TRANSIT"
    );
    transfers = Math.max(0, transitSteps.length - 1);

    // Build a summary from transit step details
    const lines = transitSteps.map((step) => {
      const detail = step.transit_details;
      if (detail?.line) {
        return detail.line.short_name || detail.line.name || "";
      }
      return "";
    });
    const lineNames = lines.filter(Boolean);
    if (lineNames.length > 0) {
      summary = lineNames.join(" → ");
      if (transfers > 0) {
        summary += ` (${transfers} transfer${transfers > 1 ? "s" : ""})`;
      }
    } else {
      summary = `${durationMinutes} min transit`;
    }
  } else if (mode === "walking") {
    summary = `${distanceMiles} mi, ${durationMinutes} min walking`;
  } else {
    summary = `${distanceMiles} mi, ${durationMinutes} min biking`;
  }

  return { mode, distanceMiles, durationMinutes, transfers, summary };
}

function extractNearestSubway(response: DirectionsResponse): NearestSubway | null {
  const route = response.data.routes[0];
  if (!route) return null;

  const leg = route.legs[0];
  const steps = leg.steps;

  // Find the first SUBWAY/RAIL transit step (not bus)
  // Google Maps vehicle types: SUBWAY, RAIL, HEAVY_RAIL, COMMUTER_TRAIN, etc.
  const subwayTypes = ["SUBWAY", "RAIL", "HEAVY_RAIL", "COMMUTER_TRAIN", "HIGH_SPEED_TRAIN"];
  const firstSubway = steps.find((step) => {
    if ((step.travel_mode as string).toUpperCase() !== "TRANSIT") return false;
    const vehicleType = step.transit_details?.line?.vehicle?.type as string | undefined;
    return vehicleType ? subwayTypes.includes(vehicleType.toUpperCase()) : false;
  });
  if (!firstSubway?.transit_details) return null;

  const dep = firstSubway.transit_details.departure_stop;
  const line = firstSubway.transit_details.line;
  const stationName = dep?.name || "Unknown";
  const lineName = line?.short_name || line?.name || "";

  // Walk to station = all WALKING steps before this subway step
  let walkSeconds = 0;
  let walkMeters = 0;
  for (const step of steps) {
    if (step === firstSubway) break;
    if ((step.travel_mode as string).toUpperCase() === "WALKING") {
      walkSeconds += step.duration.value;
      walkMeters += step.distance.value;
    }
  }

  return {
    stationName,
    lines: lineName ? [lineName] : [],
    walkMinutes: Math.round(walkSeconds / 60),
    walkMiles: Math.round((walkMeters / 1609.34) * 10) / 10,
  };
}

export async function getDistances(
  propertyAddress: string,
  destination: Destination
): Promise<DistanceResult> {
  const [bikingResponse, transitResponse, walkingResponse] = await Promise.all([
    getDirections(propertyAddress, destination.address, TravelMode.bicycling),
    getDirections(propertyAddress, destination.address, TravelMode.transit),
    getDirections(propertyAddress, destination.address, TravelMode.walking),
  ]);

  return {
    from: propertyAddress,
    to: destination.name,
    toAddress: destination.address,
    biking: parseTravelInfo(bikingResponse, "bicycling"),
    transit: parseTravelInfo(transitResponse, "transit"),
    walking: parseTravelInfo(walkingResponse, "walking"),
    nearestSubway: extractNearestSubway(transitResponse),
  };
}

export async function getDistancesForProperty(
  propertyAddress: string,
  destinations: Destination[]
): Promise<DistanceResult[]> {
  // Run sequentially to avoid rate limiting
  const results: DistanceResult[] = [];
  for (const dest of destinations) {
    results.push(await getDistances(propertyAddress, dest));
  }
  return results;
}

/**
 * Get Google Maps walking time between two lat/lon points.
 * Returns duration in minutes, or null if no route found.
 */
export async function getWalkingMinutes(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number
): Promise<number | null> {
  const origin = `${fromLat},${fromLon}`;
  const destination = `${toLat},${toLon}`;
  const response = await getDirections(origin, destination, TravelMode.walking);
  const route = response.data.routes[0];
  if (!route) return null;
  return Math.round(route.legs[0].duration.value / 60);
}

export function formatDistanceResults(results: DistanceResult[]): string {
  const lines: string[] = [];

  // Collect unique subway stations across all directions
  const subways = new Map<string, NearestSubway>();
  for (const r of results) {
    if (r.nearestSubway) {
      const key = r.nearestSubway.stationName;
      const existing = subways.get(key);
      if (!existing || r.nearestSubway.walkMinutes < existing.walkMinutes) {
        // Keep the closer walk time, merge lines
        const mergedLines = existing
          ? [...new Set([...existing.lines, ...r.nearestSubway.lines])]
          : r.nearestSubway.lines;
        subways.set(key, { ...r.nearestSubway, lines: mergedLines });
      } else if (existing) {
        existing.lines = [...new Set([...existing.lines, ...r.nearestSubway.lines])];
      }
    }
  }

  // Show nearest subway station(s)
  if (subways.size > 0) {
    const sorted = [...subways.values()].sort((a, b) => a.walkMinutes - b.walkMinutes);
    for (const s of sorted.slice(0, 2)) { // show up to 2 nearest
      const lineStr = s.lines.length > 0 ? ` (${s.lines.join(", ")})` : "";
      lines.push(`  🚶 ${s.walkMinutes} min walk to ${s.stationName}${lineStr}`);
    }
  }

  // Show distances to each destination
  for (const r of results) {
    lines.push(`  → ${r.to}:`);
    lines.push(
      `    🚲 ${r.biking.distanceMiles} mi, ${r.biking.durationMinutes} min`
    );
    const transitLine = `    🚇 ${r.transit.durationMinutes} min`;
    const transferInfo =
      r.transit.transfers !== null
        ? ` (${r.transit.transfers} transfer${r.transit.transfers !== 1 ? "s" : ""})`
        : "";
    lines.push(`${transitLine}${transferInfo} — ${r.transit.summary}`);
    lines.push(
      `    🚶 ${r.walking.distanceMiles} mi, ${r.walking.durationMinutes} min`
    );
  }

  return lines.join("\n");
}
