/**
 * Verify listing detail commute display by comparing the app's /api/trip-plan
 * endpoint against Google Maps Directions API.
 *
 * Usage:
 *   npx tsx web/scripts/verify-detail-commute.ts --api-url http://localhost:8000
 */

import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";

// Import subway station data
import SUBWAY_STATIONS from "../lib/isochrone/subway-stations";

// ---------------------------------------------------------------------------
// Load env files
// ---------------------------------------------------------------------------

// Project root .env (has GOOGLE_MAPS_API_KEY)
config({ path: resolve(__dirname, "../../.env") });
// web/.env.local (has Supabase keys)
config({ path: resolve(__dirname, "../.env.local") });

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!GOOGLE_MAPS_API_KEY) throw new Error("Missing GOOGLE_MAPS_API_KEY in .env");
if (!SUPABASE_URL || !SUPABASE_ANON_KEY)
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in web/.env.local");

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(): { apiUrl: string } {
  const args = process.argv.slice(2);
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length) {
      opts[args[i].replace(/^--/, "")] = args[i + 1];
      i++;
    }
  }
  return { apiUrl: opts["api-url"] ?? "http://localhost:8000" };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TestCase {
  id: number;
  name: string;
  category: "subway-walk" | "address-transit" | "park" | "edge";
  listingQuery: { latMin: number; latMax: number; lonMin: number; lonMax: number };
  destination: { lat: number; lon: number; name: string };
  googleMode: "walking" | "transit" | "bicycling";
  tripPlanMode: string;
  expectedStationPattern?: string;
  tolerance: number;
  expectWalkOnly?: boolean;
}

interface Listing {
  id: number;
  address: string;
  lat: number;
  lon: number;
}

interface TripLeg {
  type: "walk" | "transit" | "transfer";
  duration: number;
  from: string;
  to: string;
  route?: string;
  distance?: number;
}

interface TripPlanResponse {
  totalDuration: number;
  legs: TripLeg[];
  error?: string;
}

interface CaseResult {
  caseId: number;
  caseName: string;
  category: string;
  listing: Listing | null;
  destination: { lat: number; lon: number; name: string };
  googleMinutes: number | null;
  tripPlanMinutes: number | null;
  tripPlanLegs: TripLeg[] | null;
  deltaMinutes: number | null;
  tolerance: number;
  withinTolerance: boolean | null;
  walkOnlyCheck: boolean | null; // null = N/A, true = pass, false = fail
  expectWalkOnly: boolean;
  status: "PASS" | "FAIL" | "SKIP";
  notes: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findStation(name: string): { lat: number; lon: number; name: string } | null {
  const s = SUBWAY_STATIONS.find((st) => st.name === name);
  if (!s) return null;
  return { lat: s.lat, lon: s.lon, name: s.name };
}

function findFirstStationOnLine(line: string): { lat: number; lon: number; name: string } | null {
  const s = SUBWAY_STATIONS.find((st) => st.lines.includes(line));
  if (!s) return null;
  return { lat: s.lat, lon: s.lon, name: s.name };
}

/** Haversine distance in meters. */
function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Supabase listing lookup
// ---------------------------------------------------------------------------

async function findListing(query: TestCase["listingQuery"]): Promise<Listing | null> {
  const { data, error } = await supabase
    .from("listings")
    .select("id, address, lat, lon")
    .gte("lat", query.latMin)
    .lte("lat", query.latMax)
    .gte("lon", query.lonMin)
    .lte("lon", query.lonMax)
    .not("lat", "is", null)
    .not("lon", "is", null)
    .limit(10);

  if (error || !data || data.length === 0) return null;
  // Pick a random one
  const idx = Math.floor(Math.random() * data.length);
  return data[idx] as Listing;
}

// ---------------------------------------------------------------------------
// Google Maps Directions API
// ---------------------------------------------------------------------------

async function googleDirections(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  mode: "walking" | "transit" | "bicycling",
): Promise<number | null> {
  const url =
    `https://maps.googleapis.com/maps/api/directions/json` +
    `?origin=${fromLat},${fromLon}` +
    `&destination=${toLat},${toLon}` +
    `&mode=${mode}` +
    `&key=${GOOGLE_MAPS_API_KEY}`;

  try {
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.status !== "OK" || !data.routes?.length) {
      console.error(`  Google Maps error: ${data.status} — ${data.error_message ?? ""}`);
      return null;
    }
    const durationSec = data.routes[0].legs[0].duration.value;
    return Math.round(durationSec / 60);
  } catch (e) {
    console.error(`  Google Maps fetch error: ${e}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Trip Plan API
// ---------------------------------------------------------------------------

async function callTripPlan(
  apiUrl: string,
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  mode: string,
): Promise<TripPlanResponse | null> {
  const url =
    `${apiUrl}/api/trip-plan` +
    `?fromLat=${fromLat}&fromLon=${fromLon}` +
    `&toLat=${toLat}&toLon=${toLon}` +
    `&mode=${encodeURIComponent(mode)}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error(`  Trip plan ${resp.status}: ${body}`);
      return null;
    }
    return (await resp.json()) as TripPlanResponse;
  } catch (e) {
    console.error(`  Trip plan fetch error: ${e}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Test case definitions
// ---------------------------------------------------------------------------

function buildTestCases(): TestCase[] {
  // Subway line stations
  const bedfordAv = findStation("Bedford Av") ?? { lat: 40.7169, lon: -73.9564, name: "Bedford Av" };
  const oneAv = findStation("1 Av") ?? { lat: 40.7310, lon: -73.9816, name: "1 Av" };
  const st86_1 = SUBWAY_STATIONS.find((s) => s.name === "86 St" && s.lines.includes("1"));
  const st86 = st86_1 ? { lat: st86_1.lat, lon: st86_1.lon, name: st86_1.name } : { lat: 40.7888, lon: -73.9765, name: "86 St" };
  const w4st = findStation("W 4 St-Wash Sq") ?? { lat: 40.7322, lon: -73.9982, name: "W 4 St-Wash Sq" };
  const greenpointAv = findStation("Greenpoint Av") ?? { lat: 40.7314, lon: -73.9544, name: "Greenpoint Av" };

  // Helper: widen box around a center point (±0.008 lat, ±0.01 lon ≈ 800m)
  const box = (lat: number, lon: number, dLat = 0.008, dLon = 0.01) => ({
    latMin: lat - dLat, latMax: lat + dLat, lonMin: lon - dLon, lonMax: lon + dLon,
  });

  const cases: TestCase[] = [
    // --- Subway-walk cases (1-5) ---
    {
      id: 1, name: "L train walk — Williamsburg to Bedford Av", category: "subway-walk",
      listingQuery: box(40.714, -73.960),
      destination: bedfordAv, googleMode: "walking", tripPlanMode: "WALK",
      expectedStationPattern: "Bedford", tolerance: 3, expectWalkOnly: true,
    },
    {
      id: 2, name: "L train walk — East Village to 1 Av", category: "subway-walk",
      listingQuery: box(40.728, -73.983),
      destination: oneAv, googleMode: "walking", tripPlanMode: "WALK",
      expectedStationPattern: "1 Av", tolerance: 3, expectWalkOnly: true,
    },
    {
      id: 3, name: "1 train walk — UWS to 86 St", category: "subway-walk",
      listingQuery: box(40.789, -73.976),
      destination: st86, googleMode: "walking", tripPlanMode: "WALK",
      expectedStationPattern: "86 St", tolerance: 3, expectWalkOnly: true,
    },
    {
      id: 4, name: "A/C/E walk — West Village to W 4 St", category: "subway-walk",
      listingQuery: box(40.733, -74.000),
      destination: w4st, googleMode: "walking", tripPlanMode: "WALK",
      expectedStationPattern: "W 4 St", tolerance: 3, expectWalkOnly: true,
    },
    {
      id: 5, name: "G train walk — Greenpoint to Greenpoint Av", category: "subway-walk",
      listingQuery: box(40.730, -73.953),
      destination: greenpointAv, googleMode: "walking", tripPlanMode: "WALK",
      expectedStationPattern: "Greenpoint", tolerance: 3, expectWalkOnly: true,
    },

    // --- Address-transit cases (6-12) ---
    {
      id: 6, name: "Chess Forum from UWS (transit)", category: "address-transit",
      listingQuery: box(40.789, -73.976),
      destination: { lat: 40.7291, lon: -73.9992, name: "Chess Forum" },
      googleMode: "transit", tripPlanMode: "TRANSIT,WALK", tolerance: 5,
    },
    {
      id: 7, name: "Chess Forum from East Village (transit)", category: "address-transit",
      listingQuery: box(40.728, -73.983),
      destination: { lat: 40.7291, lon: -73.9992, name: "Chess Forum" },
      googleMode: "transit", tripPlanMode: "TRANSIT,WALK", tolerance: 5,
    },
    {
      id: 8, name: "Times Square from Chelsea (transit)", category: "address-transit",
      listingQuery: box(40.747, -73.997),
      destination: { lat: 40.7595, lon: -73.9853, name: "Times Square" },
      googleMode: "transit", tripPlanMode: "TRANSIT,WALK", tolerance: 5,
    },
    {
      id: 9, name: "MetroTech from Midtown (transit)", category: "address-transit",
      listingQuery: box(40.755, -73.983),
      destination: { lat: 40.6932, lon: -73.9871, name: "MetroTech" },
      googleMode: "transit", tripPlanMode: "TRANSIT,WALK", tolerance: 5,
    },
    {
      id: 10, name: "Union Square from Gramercy (walk)", category: "address-transit",
      listingQuery: box(40.738, -73.983),
      destination: { lat: 40.7359, lon: -73.9911, name: "Union Square" },
      googleMode: "walking", tripPlanMode: "WALK", tolerance: 3,
    },
    {
      id: 11, name: "Chess Forum from Village (bike)", category: "address-transit",
      listingQuery: box(40.733, -74.000),
      destination: { lat: 40.7291, lon: -73.9992, name: "Chess Forum" },
      googleMode: "bicycling", tripPlanMode: "BICYCLE", tolerance: 3,
    },
    {
      id: 12, name: "Union Square from Brooklyn (transit)", category: "address-transit",
      listingQuery: box(40.680, -73.975, 0.012, 0.015),
      destination: { lat: 40.7359, lon: -73.9911, name: "Union Square" },
      googleMode: "transit", tripPlanMode: "TRANSIT,WALK", tolerance: 5,
    },

    // --- Park cases (13-17) ---
    {
      id: 13, name: "Central Park from UWS (walk)", category: "park",
      listingQuery: box(40.780, -73.980),
      destination: { lat: 40.7743, lon: -73.9773, name: "Central Park" },
      googleMode: "walking", tripPlanMode: "WALK", tolerance: 3,
    },
    {
      id: 14, name: "Central Park from Midtown (walk)", category: "park",
      listingQuery: box(40.760, -73.983),
      destination: { lat: 40.7743, lon: -73.9773, name: "Central Park" },
      googleMode: "walking", tripPlanMode: "WALK", tolerance: 3,
    },
    {
      id: 15, name: "Washington Sq Park from SoHo (walk)", category: "park",
      listingQuery: box(40.724, -73.997),
      destination: { lat: 40.7297, lon: -73.9966, name: "Washington Sq Park" },
      googleMode: "walking", tripPlanMode: "WALK", tolerance: 3,
    },
    {
      id: 16, name: "Prospect Park from Park Slope (walk)", category: "park",
      listingQuery: box(40.673, -73.977, 0.010, 0.012),
      destination: { lat: 40.6682, lon: -73.9738, name: "Prospect Park" },
      googleMode: "walking", tripPlanMode: "WALK", tolerance: 3,
    },
    {
      id: 17, name: "Brooklyn Bridge Park from FiDi (transit)", category: "park",
      listingQuery: box(40.710, -74.008, 0.008, 0.012),
      destination: { lat: 40.7033, lon: -73.9931, name: "Brooklyn Bridge Park" },
      googleMode: "transit", tripPlanMode: "TRANSIT,WALK", tolerance: 5,
    },

    // --- Edge cases (18-20) ---
    {
      id: 18, name: "Edge: very close (<3 min walk)", category: "edge",
      // Listing very near Union Square — should be walk-only
      listingQuery: box(40.736, -73.991, 0.003, 0.004),
      destination: { lat: 40.7359, lon: -73.9911, name: "Union Square" },
      googleMode: "walking", tripPlanMode: "TRANSIT,WALK", tolerance: 3,
      expectWalkOnly: true,
    },
    {
      id: 19, name: "Edge: far listing (~25-30 min transit)", category: "edge",
      // Washington Heights / Harlem to Midtown
      listingQuery: box(40.815, -73.948, 0.012, 0.012),
      destination: { lat: 40.7595, lon: -73.9853, name: "Times Square" },
      googleMode: "transit", tripPlanMode: "TRANSIT,WALK", tolerance: 5,
    },
    {
      id: 20, name: "Edge: Williamsburg near L and G — nearest station check", category: "edge",
      // Near both L and G lines in Williamsburg
      listingQuery: box(40.714, -73.953, 0.008, 0.012),
      destination: bedfordAv, // L station
      googleMode: "walking", tripPlanMode: "WALK", tolerance: 3,
    },
  ];

  return cases;
}

// ---------------------------------------------------------------------------
// Run a single test case
// ---------------------------------------------------------------------------

async function runCase(tc: TestCase, apiUrl: string): Promise<CaseResult> {
  console.log(`\n=== Case ${tc.id}: ${tc.name} ===`);

  // 1. Find a listing
  const listing = await findListing(tc.listingQuery);
  if (!listing) {
    console.log(`  SKIP — no listing found in bounding box`);
    return {
      caseId: tc.id, caseName: tc.name, category: tc.category,
      listing: null, destination: tc.destination,
      googleMinutes: null, tripPlanMinutes: null, tripPlanLegs: null,
      deltaMinutes: null, tolerance: tc.tolerance,
      withinTolerance: null, walkOnlyCheck: null,
      expectWalkOnly: tc.expectWalkOnly ?? false,
      status: "SKIP", notes: "No listing found in bounding box",
    };
  }
  console.log(`Listing: #${listing.id} "${listing.address}" (${listing.lat}, ${listing.lon})`);
  console.log(`Destination: ${tc.destination.name} (${tc.destination.lat}, ${tc.destination.lon})`);

  // For edge case 20: also check G station distance
  if (tc.id === 20) {
    const gStation = SUBWAY_STATIONS.find((s) => s.name === "Greenpoint Av" && s.lines.includes("G"));
    const lStation = SUBWAY_STATIONS.find((s) => s.name === "Bedford Av" && s.lines.includes("L"));
    if (gStation && lStation) {
      const distL = distanceMeters(listing.lat, listing.lon, lStation.lat, lStation.lon);
      const distG = distanceMeters(listing.lat, listing.lon, gStation.lat, gStation.lon);
      console.log(`  Distance to Bedford Av (L): ${Math.round(distL)}m`);
      console.log(`  Distance to Greenpoint Av (G): ${Math.round(distG)}m`);
      console.log(`  Nearest: ${distL < distG ? "Bedford Av (L)" : "Greenpoint Av (G)"}`);
    }
  }

  // 2. Google Maps directions
  await sleep(200);
  const googleMin = await googleDirections(
    listing.lat, listing.lon,
    tc.destination.lat, tc.destination.lon,
    tc.googleMode,
  );
  console.log(`\n  Google Maps (${tc.googleMode}): ${googleMin !== null ? `${googleMin} min` : "ERROR"}`);

  // 3. Trip plan API
  const tripPlan = await callTripPlan(
    apiUrl,
    listing.lat, listing.lon,
    tc.destination.lat, tc.destination.lon,
    tc.tripPlanMode,
  );
  const tpMinutes = tripPlan?.totalDuration ?? null;
  const tpLegs = tripPlan?.legs ?? null;

  if (tpMinutes !== null) {
    console.log(`  Trip Plan API: ${tpMinutes} min`);
    if (tpLegs) {
      const legSummary = tpLegs
        .map((l) => `${l.type === "walk" ? "Walk" : l.type === "transit" ? l.route ?? "Transit" : "Transfer"} ${l.duration} min`)
        .join(" → ");
      console.log(`    Legs: ${legSummary}`);
    }
  } else {
    console.log(`  Trip Plan API: ERROR${tripPlan?.error ? ` (${tripPlan.error})` : ""}`);
  }

  // 4. Compare
  let delta: number | null = null;
  let withinTolerance: boolean | null = null;
  if (googleMin !== null && tpMinutes !== null) {
    delta = tpMinutes - googleMin;
    withinTolerance = Math.abs(delta) <= tc.tolerance;
    console.log(`\n  Delta: ${delta > 0 ? "+" : ""}${delta} min ${withinTolerance ? "(within" : "(OVER"} ±${tc.tolerance} min tolerance)`);
  }

  // 5. Walk-only check
  let walkOnlyCheck: boolean | null = null;
  if (tc.expectWalkOnly && tpLegs) {
    const hasTransit = tpLegs.some((l) => l.type === "transit");
    walkOnlyCheck = !hasTransit;
    console.log(`  Walk-only check: ${walkOnlyCheck ? "PASS (walk-only)" : `FAIL (has transit legs)`}`);
  }

  // Determine overall status
  let status: "PASS" | "FAIL" | "SKIP" = "PASS";
  const notes: string[] = [];

  if (googleMin === null && tpMinutes === null) {
    status = "SKIP";
    notes.push("Both APIs failed");
  } else if (googleMin === null) {
    status = "SKIP";
    notes.push("Google Maps failed");
  } else if (tpMinutes === null) {
    status = "FAIL";
    notes.push("Trip plan API failed");
  } else {
    if (withinTolerance === false) {
      status = "FAIL";
      notes.push(`Duration delta ${delta! > 0 ? "+" : ""}${delta} min exceeds ±${tc.tolerance}`);
    }
    if (tc.expectWalkOnly && walkOnlyCheck === false) {
      status = "FAIL";
      notes.push("Trip plan includes transit legs (should be walk-only)");
    }
  }

  console.log(`  Status: ${status}${notes.length ? ` — ${notes.join("; ")}` : ""}`);

  return {
    caseId: tc.id, caseName: tc.name, category: tc.category,
    listing, destination: tc.destination,
    googleMinutes: googleMin, tripPlanMinutes: tpMinutes, tripPlanLegs: tpLegs,
    deltaMinutes: delta, tolerance: tc.tolerance,
    withinTolerance, walkOnlyCheck,
    expectWalkOnly: tc.expectWalkOnly ?? false,
    status, notes: notes.join("; "),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { apiUrl } = parseArgs();
  console.log(`Trip Plan API: ${apiUrl}`);
  console.log(`Google Maps API key: ${GOOGLE_MAPS_API_KEY?.slice(0, 8)}...`);
  console.log(`Supabase URL: ${SUPABASE_URL}`);
  console.log(`\nRunning 20 test cases...\n`);

  const cases = buildTestCases();
  const results: CaseResult[] = [];

  for (const tc of cases) {
    const result = await runCase(tc, apiUrl);
    results.push(result);
  }

  // --- Summary ---
  console.log(`\n${"=".repeat(60)}`);
  console.log(`=== SUMMARY ===`);
  console.log(`${"=".repeat(60)}`);

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;

  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);
  console.log(`Skipped: ${skipped}/${results.length}`);

  const failures = results.filter((r) => r.status === "FAIL");
  if (failures.length > 0) {
    console.log(`\nFAILURES:`);
    // Group failures by notes pattern
    const grouped: Record<string, number[]> = {};
    for (const f of failures) {
      const key = f.notes || "Unknown";
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(f.caseId);
    }
    for (const [note, ids] of Object.entries(grouped)) {
      console.log(`  Cases ${ids.join(", ")}: ${note}`);
    }
  }

  // Save results JSON
  const outputPath = resolve(__dirname, "verify-detail-results.json");
  writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to ${outputPath}`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
