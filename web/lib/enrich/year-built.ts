/**
 * NYC PLUTO year-built lookup.
 *
 * Extracted from scripts/backfill-year-built.ts so the orchestrator
 * enrich-year-built phase and the legacy backfill script share one
 * implementation.
 *
 * Given a lat/lon in NYC, queries the Socrata PLUTO dataset for tax lots
 * within a ~200m bounding box, finds the nearest within 50m, and returns
 * its `yearbuilt`. Returns null on no match, rate-limit, or network error.
 */

const PLUTO_API_URL = "https://data.cityofnewyork.us/resource/64uk-42ks.json";

interface PlutoRecord {
  yearbuilt?: string;
  address?: string;
  bbl?: string;
  latitude?: string | number;
  longitude?: string | number;
}

function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function lookupYearBuiltForCoords(
  lat: number,
  lon: number,
): Promise<number | null> {
  const margin = 0.002; // ~200m
  const latMin = lat - margin;
  const latMax = lat + margin;
  const lonMin = lon - margin;
  const lonMax = lon + margin;

  const url =
    `${PLUTO_API_URL}?$where=latitude>${latMin} AND latitude<${latMax} AND longitude>${lonMin} AND longitude<${lonMax}` +
    `&$select=yearbuilt,latitude,longitude&$limit=100`;

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch {
    return null;
  }

  if (!res.ok) {
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 5000));
    }
    return null;
  }

  const data = (await res.json()) as PlutoRecord[];
  if (!data || data.length === 0) return null;

  let nearest: PlutoRecord | null = null;
  let nearestDistance = 50;

  for (const record of data) {
    if (!record.yearbuilt) continue;
    const recLat =
      typeof record.latitude === "string"
        ? parseFloat(record.latitude)
        : record.latitude;
    const recLon =
      typeof record.longitude === "string"
        ? parseFloat(record.longitude)
        : record.longitude;
    if (!Number.isFinite(recLat) || !Number.isFinite(recLon)) continue;

    const distance = haversineDistance(lat, lon, recLat as number, recLon as number);
    if (distance < nearestDistance) {
      nearest = record;
      nearestDistance = distance;
    }
  }

  if (!nearest || !nearest.yearbuilt) return null;
  const year = parseInt(nearest.yearbuilt, 10);
  if (isNaN(year) || year <= 0) return null;
  return year;
}
