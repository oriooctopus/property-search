/**
 * Generate walking or biking isochrones for all NYC subway stations (1-30 min).
 * Stores results in Supabase PostGIS isochrones table.
 *
 * Usage:
 *   npx tsx scripts/generate-isochrones.ts              # walk (default)
 *   npx tsx scripts/generate-isochrones.ts --mode=walk   # explicit walk
 *   npx tsx scripts/generate-isochrones.ts --mode=bike   # bicycle
 *
 * Requires: OTP running at OTP_BASE_URL (default http://localhost:9090)
 */

import { createClient } from "@supabase/supabase-js";
import SUBWAY_STATIONS from "../lib/isochrone/subway-stations";

const OTP_BASE_URL = process.env.OTP_BASE_URL ?? "http://localhost:9090";
const ISOCHRONE_PATH = "/otp/traveltime/isochrone";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Parse --mode=walk|bike CLI argument
type TravelMode = "walk" | "bike";
const VALID_MODES: TravelMode[] = ["walk", "bike"];
const OTP_MODE_MAP: Record<TravelMode, string> = {
  walk: "WALK",
  bike: "BICYCLE",
};

function parseMode(): TravelMode {
  const modeArg = process.argv.find((a) => a.startsWith("--mode="));
  if (!modeArg) return "walk";
  const value = modeArg.split("=")[1] as TravelMode;
  if (!VALID_MODES.includes(value)) {
    console.error(`Invalid mode "${value}". Valid modes: ${VALID_MODES.join(", ")}`);
    process.exit(1);
  }
  return value;
}

const MODE = parseMode();
const OTP_MODE = OTP_MODE_MAP[MODE];

// Use next weekday at 9am for consistent isochrones
function nextWeekday(): string {
  const d = new Date();
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

async function fetchIsochrone(lat: number, lon: number, minutes: number): Promise<GeoJSON.Polygon | null> {
  const date = nextWeekday();
  const url =
    `${OTP_BASE_URL}${ISOCHRONE_PATH}` +
    `?location=${lat},${lon}` +
    `&modes=${OTP_MODE}` +
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
        console.warn(`  OTP ${res.status} for ${lat},${lon} @ ${minutes}min`);
        return null;
      }
      const geojson = await res.json() as { type: string; features: Array<{ geometry: GeoJSON.Polygon }> };
      if (geojson.features?.length > 0) {
        return geojson.features[0].geometry;
      }
      return null;
    } catch (err) {
      if (attempt === 2) {
        console.warn(`  Failed after 3 attempts: ${lat},${lon} @ ${minutes}min`);
        return null;
      }
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return null;
}

async function main() {
  console.log(`Mode: ${MODE} (OTP mode: ${OTP_MODE})`);

  // Check OTP health
  try {
    const health = await fetch(`${OTP_BASE_URL}/otp/`, { signal: AbortSignal.timeout(5000) });
    if (!health.ok) throw new Error(`OTP returned ${health.status}`);
    console.log("OTP is running");
  } catch {
    console.error(`Cannot connect to OTP at ${OTP_BASE_URL}`);
    process.exit(1);
  }

  // Check what's already generated
  const { count } = await supabase
    .from("isochrones")
    .select("*", { count: "exact", head: true })
    .eq("origin_type", "subway_station")
    .eq("travel_mode", MODE);

  console.log(`${count ?? 0} subway ${MODE} isochrones already in DB`);

  const minCutoff = 1;
  const maxCutoff = 30;
  const totalExpected = SUBWAY_STATIONS.length * (maxCutoff - minCutoff + 1);
  console.log(`Generating ${minCutoff}-${maxCutoff} min ${MODE} isochrones for ${SUBWAY_STATIONS.length} stations (${totalExpected} total)`);

  let generated = 0;
  let skipped = 0;
  let failed = 0;
  const startTime = Date.now();

  for (let si = 0; si < SUBWAY_STATIONS.length; si++) {
    const station = SUBWAY_STATIONS[si];

    // Check which cutoffs already exist for this specific station (by name + lat/lon)
    const { data: existing } = await supabase
      .from("isochrones")
      .select("cutoff_minutes")
      .eq("origin_name", station.name)
      .eq("origin_lat", station.lat)
      .eq("origin_lon", station.lon)
      .eq("travel_mode", MODE)
      .eq("origin_type", "subway_station");

    const existingCutoffs = new Set((existing ?? []).map(r => r.cutoff_minutes));

    for (let minutes = minCutoff; minutes <= maxCutoff; minutes++) {
      if (existingCutoffs.has(minutes)) {
        skipped++;
        continue;
      }

      const polygon = await fetchIsochrone(station.lat, station.lon, minutes);
      if (!polygon) {
        failed++;
        continue;
      }

      const { error } = await supabase.from("isochrones").upsert({
        origin_name: station.name,
        origin_lat: station.lat,
        origin_lon: station.lon,
        origin_type: "subway_station",
        travel_mode: MODE,
        cutoff_minutes: minutes,
        polygon: JSON.stringify(polygon),
        otp_params: { mode: OTP_MODE, cutoff: `PT${minutes}M` },
      }, { onConflict: "origin_name,origin_lat,origin_lon,travel_mode,cutoff_minutes" });

      if (error) {
        console.warn(`  DB error for ${station.name} @ ${minutes}min: ${error.message}`);
        failed++;
      } else {
        generated++;
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const total = generated + skipped + failed;
    const pct = ((total / totalExpected) * 100).toFixed(1);
    process.stdout.write(`\r[${elapsed}s] ${si + 1}/${SUBWAY_STATIONS.length} stations | ${generated} generated, ${skipped} skipped, ${failed} failed (${pct}%)`);
  }

  console.log(`\n\nDone! ${generated} generated, ${skipped} skipped, ${failed} failed`);
  console.log(`Total time: ${((Date.now() - startTime) / 1000).toFixed(0)}s`);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
