/**
 * Generate walking isochrones from OTP and output SQL INSERT statements.
 * Pipe output to a file, then run via Supabase MCP or psql.
 *
 * Usage: OTP_BASE_URL=http://localhost:9090 npx tsx scripts/generate-isochrones-local.ts > isochrones.sql
 */

import SUBWAY_STATIONS from "../lib/isochrone/subway-stations";

const OTP_BASE_URL = process.env.OTP_BASE_URL ?? "http://localhost:9090";
const ISOCHRONE_PATH = "/otp/traveltime/isochrone";
const MIN_CUTOFF = 1;
const MAX_CUTOFF = 30;

function nextWeekday(): string {
  const d = new Date();
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

async function fetchIsochrone(lat: number, lon: number, minutes: number): Promise<string | null> {
  const date = nextWeekday();
  const url =
    `${OTP_BASE_URL}${ISOCHRONE_PATH}` +
    `?location=${lat},${lon}` +
    `&modes=WALK` +
    `&time=${encodeURIComponent(`${date}T09:00:00-04:00`)}` +
    `&cutoff=PT${minutes}M`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        if (res.status >= 500) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        return null;
      }
      const geojson = await res.json() as { features: Array<{ geometry: object }> };
      if (geojson.features?.length > 0) {
        return JSON.stringify(geojson.features[0].geometry);
      }
      return null;
    } catch {
      if (attempt === 2) return null;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return null;
}

async function main() {
  // Check OTP health
  try {
    const health = await fetch(`${OTP_BASE_URL}/otp/`, { signal: AbortSignal.timeout(5000) });
    if (!health.ok) throw new Error(`OTP returned ${health.status}`);
    console.error("OTP is running");
  } catch {
    console.error(`Cannot connect to OTP at ${OTP_BASE_URL}`);
    process.exit(1);
  }

  const totalExpected = SUBWAY_STATIONS.length * (MAX_CUTOFF - MIN_CUTOFF + 1);
  console.error(`Generating ${MIN_CUTOFF}-${MAX_CUTOFF} min walk isochrones for ${SUBWAY_STATIONS.length} stations (${totalExpected} total)`);

  let generated = 0;
  let failed = 0;
  const startTime = Date.now();

  // Output as JSON lines (one isochrone per line) for batch processing
  for (let si = 0; si < SUBWAY_STATIONS.length; si++) {
    const station = SUBWAY_STATIONS[si];

    for (let minutes = MIN_CUTOFF; minutes <= MAX_CUTOFF; minutes++) {
      const polygonJson = await fetchIsochrone(station.lat, station.lon, minutes);
      if (!polygonJson) {
        failed++;
        continue;
      }

      // Output as JSON line
      const record = {
        origin_name: station.name,
        origin_lat: station.lat,
        origin_lon: station.lon,
        origin_type: "subway_station",
        travel_mode: "walk",
        cutoff_minutes: minutes,
        polygon: polygonJson,
      };
      console.log(JSON.stringify(record));
      generated++;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const total = generated + failed;
    const pct = ((total / totalExpected) * 100).toFixed(1);
    process.stderr.write(`\r[${elapsed}s] ${si + 1}/${SUBWAY_STATIONS.length} stations | ${generated} generated, ${failed} failed (${pct}%)`);
  }

  console.error(`\n\nDone! ${generated} generated, ${failed} failed`);
  console.error(`Total time: ${((Date.now() - startTime) / 1000).toFixed(0)}s`);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
