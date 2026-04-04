/**
 * Ground-truth verification: compare OTP/commute-filter results against Google Maps Directions API.
 *
 * Usage:
 *   npx tsx web/scripts/verify-commute-accuracy.ts [options]
 *
 * Options:
 *   --sample-size N       Number of random listings to sample (default: 20)
 *   --api-url URL         Commute filter API base URL (default: http://localhost:5001)
 *   --mode walk|transit|bike  Travel mode to test (default: walk)
 *   --max-minutes N       Cutoff time in minutes (default: 30)
 *   --destinations all|parks|addresses|mixed  Destination set (default: mixed)
 */

import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";

// ---------------------------------------------------------------------------
// Load env files
// ---------------------------------------------------------------------------

// Project root .env (has GOOGLE_MAPS_API_KEY)
config({ path: resolve(__dirname, "../../.env") });
// web/.env.local (has Supabase keys)
config({ path: resolve(__dirname, "../.env.local") });

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function parseArgs(): {
  sampleSize: number;
  apiUrl: string;
  mode: "walk" | "transit" | "bike";
  maxMinutes: number;
  destinations: "all" | "parks" | "addresses" | "mixed";
} {
  const args = process.argv.slice(2);
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length) {
      opts[args[i].replace(/^--/, "")] = args[i + 1];
      i++;
    }
  }
  return {
    sampleSize: parseInt(opts["sample-size"] ?? "20", 10),
    apiUrl: opts["api-url"] ?? "http://localhost:5001",
    mode: (opts["mode"] as "walk" | "transit" | "bike") ?? "walk",
    maxMinutes: parseInt(opts["max-minutes"] ?? "30", 10),
    destinations: (opts["destinations"] as "all" | "parks" | "addresses" | "mixed") ?? "mixed",
  };
}

// ---------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------

interface Destination {
  name: string;
  lat: number;
  lon: number;
  type: "park" | "address";
}

const DESTINATIONS: Destination[] = [
  // Parks
  { name: "Central Park", lat: 40.7743, lon: -73.9773, type: "park" },
  { name: "Washington Square Park", lat: 40.7297, lon: -73.9966, type: "park" },
  { name: "Prospect Park", lat: 40.6682, lon: -73.9738, type: "park" },
  { name: "Brooklyn Bridge Park", lat: 40.7033, lon: -73.9931, type: "park" },
  // Addresses
  { name: "Chess Forum", lat: 40.7291, lon: -73.9992, type: "address" },
  { name: "Times Square", lat: 40.7595, lon: -73.9853, type: "address" },
  { name: "Union Square", lat: 40.7359, lon: -73.9911, type: "address" },
  { name: "MetroTech Brooklyn", lat: 40.6932, lon: -73.9871, type: "address" },
];

function filterDestinations(filter: string): Destination[] {
  switch (filter) {
    case "parks":
      return DESTINATIONS.filter((d) => d.type === "park");
    case "addresses":
      return DESTINATIONS.filter((d) => d.type === "address");
    case "mixed":
      // 2 parks + 2 addresses
      return [
        DESTINATIONS[0], // Central Park
        DESTINATIONS[3], // Brooklyn Bridge Park
        DESTINATIONS[4], // Chess Forum
        DESTINATIONS[6], // Union Square
      ];
    default:
      return DESTINATIONS;
  }
}

// ---------------------------------------------------------------------------
// Google Maps mode mapping
// ---------------------------------------------------------------------------

function googleMapsMode(mode: "walk" | "transit" | "bike"): string {
  switch (mode) {
    case "walk": return "walking";
    case "transit": return "transit";
    case "bike": return "bicycling";
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Listing {
  id: number;
  title: string;
  lat: number;
  lon: number;
}

type Classification = "TRUE_POSITIVE" | "TRUE_NEGATIVE" | "FALSE_POSITIVE" | "FALSE_NEGATIVE";

interface CheckResult {
  listingId: number;
  listingTitle: string;
  listingLat: number;
  listingLon: number;
  destination: string;
  googleMinutes: number | null;
  commuteFilterIncluded: boolean;
  googleSaysInside: boolean | null;
  classification: Classification | "GOOGLE_ERROR";
}

interface DestinationReport {
  destination: string;
  mode: string;
  maxMinutes: number;
  results: CheckResult[];
  truePositive: number;
  trueNegative: number;
  falsePositive: number;
  falseNegative: number;
  googleErrors: number;
  accuracy: number;
}

// ---------------------------------------------------------------------------
// Delay helper
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Google Maps Directions API
// ---------------------------------------------------------------------------

async function getGoogleTravelTime(
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number,
  mode: string,
  apiKey: string,
): Promise<number | null> {
  const url =
    `https://maps.googleapis.com/maps/api/directions/json` +
    `?origin=${originLat},${originLon}` +
    `&destination=${destLat},${destLon}` +
    `&mode=${mode}` +
    `&key=${apiKey}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (data.status !== "OK" || !data.routes?.length) {
      console.warn(`  Google Maps returned status: ${data.status}`);
      return null;
    }

    const durationSec = data.routes[0].legs[0].duration.value;
    return Math.round(durationSec / 60);
  } catch (err) {
    console.warn(`  Google Maps API error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Commute filter API call
// ---------------------------------------------------------------------------

async function callCommuteFilter(
  apiUrl: string,
  dest: Destination,
  maxMinutes: number,
  mode: "walk" | "transit" | "bike",
): Promise<Set<number>> {
  const commuteRule =
    dest.type === "park"
      ? {
          id: `verify-${dest.name}`,
          type: "park" as const,
          parkName: dest.name,
          maxMinutes,
          mode,
        }
      : {
          id: `verify-${dest.name}`,
          type: "address" as const,
          addressLat: dest.lat,
          addressLon: dest.lon,
          address: dest.name,
          maxMinutes,
          mode,
        };

  const body = { commuteRules: [commuteRule] };

  try {
    const res = await fetch(`${apiUrl}/api/commute-filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "(no body)");
      console.error(`  Commute filter API returned ${res.status}: ${text}`);
      return new Set();
    }

    const data = await res.json();
    const ids: number[] = data.listingIds ?? [];
    return new Set(ids);
  } catch (err) {
    console.error(`  Commute filter API error: ${err instanceof Error ? err.message : String(err)}`);
    return new Set();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();
  const TOLERANCE_MINUTES = 2;

  console.log("=== Commute Filter Ground Truth Verification ===");
  console.log(`Mode: ${opts.mode} | Cutoff: ${opts.maxMinutes} min | Sample: ${opts.sampleSize} listings`);
  console.log(`API URL: ${opts.apiUrl}`);
  console.log(`Destinations filter: ${opts.destinations}`);
  console.log(`Tolerance: +/- ${TOLERANCE_MINUTES} min\n`);

  // Validate env
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!googleApiKey) {
    console.error("ERROR: GOOGLE_MAPS_API_KEY not found in .env");
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("ERROR: Supabase env vars not found in .env.local");
    process.exit(1);
  }

  console.log("Supabase URL: " + supabaseUrl.replace(/https?:\/\//, "").split(".")[0] + ".supabase.co");
  console.log("Google Maps API key: ...redacted...\n");

  // Connect to Supabase and fetch random listings
  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log(`Fetching ${opts.sampleSize} random listings with lat/lon...`);

  // Get total count first, then pick random offsets
  const { count, error: countError } = await supabase
    .from("listings")
    .select("id", { count: "exact", head: true })
    .not("lat", "is", null)
    .not("lon", "is", null);

  if (countError || !count) {
    console.error("ERROR: Could not count listings:", countError?.message);
    process.exit(1);
  }

  console.log(`Total listings with lat/lon: ${count}`);

  // Fetch a larger random sample and pick from it
  // Use a random range approach
  const listings: Listing[] = [];
  const seenIds = new Set<number>();
  const maxAttempts = opts.sampleSize * 3;
  let attempts = 0;

  while (listings.length < opts.sampleSize && attempts < maxAttempts) {
    const offset = Math.floor(Math.random() * count);
    const { data, error } = await supabase
      .from("listings")
      .select("id, address, lat, lon")
      .not("lat", "is", null)
      .not("lon", "is", null)
      .range(offset, offset + 9);

    if (error || !data) {
      attempts++;
      continue;
    }

    for (const row of data) {
      if (!seenIds.has(row.id) && row.lat && row.lon && listings.length < opts.sampleSize) {
        seenIds.add(row.id);
        listings.push({
          id: row.id,
          title: (row.address as string) ?? `Listing #${row.id}`,
          lat: row.lat as number,
          lon: row.lon as number,
        });
      }
    }
    attempts++;
  }

  if (listings.length === 0) {
    console.error("ERROR: No listings sampled");
    process.exit(1);
  }

  console.log(`Sampled ${listings.length} listings\n`);

  // Determine destinations
  const destinations = filterDestinations(opts.destinations);
  console.log(`Testing against ${destinations.length} destinations:\n`);
  for (const d of destinations) {
    console.log(`  - ${d.name} (${d.type}) [${d.lat}, ${d.lon}]`);
  }
  console.log();

  const gmMode = googleMapsMode(opts.mode);
  const allReports: DestinationReport[] = [];

  // Process destinations sequentially
  for (const dest of destinations) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`=== Destination: ${dest.name} (${opts.maxMinutes} min ${opts.mode}) ===`);
    console.log(`${"=".repeat(60)}\n`);

    // Step 1: Call commute filter for this destination
    console.log(`Calling commute filter API...`);
    const commuteIncluded = await callCommuteFilter(opts.apiUrl, dest, opts.maxMinutes, opts.mode);
    console.log(`Commute filter returned ${commuteIncluded.size} listing IDs\n`);

    const results: CheckResult[] = [];

    // Step 2: For each listing, call Google Maps
    for (let i = 0; i < listings.length; i++) {
      const listing = listings[i];
      console.log(
        `  Checking listing ${i + 1}/${listings.length}: #${listing.id} "${listing.title.slice(0, 40)}"...`,
      );

      const googleMinutes = await getGoogleTravelTime(
        listing.lat,
        listing.lon,
        dest.lat,
        dest.lon,
        gmMode,
        googleApiKey,
      );

      const commuteFilterIncluded = commuteIncluded.has(listing.id);

      let classification: Classification | "GOOGLE_ERROR";
      let googleSaysInside: boolean | null = null;

      if (googleMinutes === null) {
        classification = "GOOGLE_ERROR";
      } else {
        // Apply tolerance: if Google says 31 min and cutoff is 30, don't penalize
        googleSaysInside = googleMinutes <= opts.maxMinutes + TOLERANCE_MINUTES;

        if (commuteFilterIncluded && googleSaysInside) {
          classification = "TRUE_POSITIVE";
        } else if (!commuteFilterIncluded && !googleSaysInside) {
          classification = "TRUE_NEGATIVE";
        } else if (commuteFilterIncluded && !googleSaysInside) {
          classification = "FALSE_POSITIVE";
        } else {
          classification = "FALSE_NEGATIVE";
        }
      }

      const suffix =
        googleMinutes !== null ? `Google: ${googleMinutes} min, Filter: ${commuteFilterIncluded ? "IN" : "OUT"} => ${classification}` : "Google: ERROR";
      console.log(`    ${suffix}`);

      results.push({
        listingId: listing.id,
        listingTitle: listing.title,
        listingLat: listing.lat,
        listingLon: listing.lon,
        destination: dest.name,
        googleMinutes,
        commuteFilterIncluded,
        googleSaysInside,
        classification,
      });

      // Rate limiting for Google Maps
      await sleep(200);
    }

    // Tally
    const tp = results.filter((r) => r.classification === "TRUE_POSITIVE").length;
    const tn = results.filter((r) => r.classification === "TRUE_NEGATIVE").length;
    const fp = results.filter((r) => r.classification === "FALSE_POSITIVE").length;
    const fn = results.filter((r) => r.classification === "FALSE_NEGATIVE").length;
    const ge = results.filter((r) => r.classification === "GOOGLE_ERROR").length;
    const validChecks = tp + tn + fp + fn;
    const accuracy = validChecks > 0 ? ((tp + tn) / validChecks) * 100 : 0;

    const report: DestinationReport = {
      destination: dest.name,
      mode: opts.mode,
      maxMinutes: opts.maxMinutes,
      results,
      truePositive: tp,
      trueNegative: tn,
      falsePositive: fp,
      falseNegative: fn,
      googleErrors: ge,
      accuracy,
    };
    allReports.push(report);

    // Print destination summary
    console.log(`\n--- Summary: ${dest.name} (${opts.maxMinutes} min ${opts.mode}) ---`);
    console.log(`Sampled ${listings.length} listings, checked against Google Maps\n`);
    console.log(`  TRUE_POSITIVE:   ${tp}  (correctly included)`);
    console.log(`  TRUE_NEGATIVE:  ${tn}  (correctly excluded)`);
    console.log(`  FALSE_POSITIVE:  ${fp}  (included but Google says outside — INACCURATE)`);
    console.log(`  FALSE_NEGATIVE:  ${fn}  (excluded but Google says inside — MISSING)`);
    if (ge > 0) console.log(`  GOOGLE_ERROR:    ${ge}  (could not verify)`);
    console.log(`\n  Accuracy: ${accuracy.toFixed(1)}% (${tp + tn}/${validChecks})`);

    // Print false positives
    const falsePositives = results.filter((r) => r.classification === "FALSE_POSITIVE");
    if (falsePositives.length > 0) {
      console.log(`\n  FALSE POSITIVES (should NOT be included):`);
      for (const r of falsePositives) {
        console.log(
          `    - #${r.listingId} "${r.listingTitle.slice(0, 40)}" (${r.listingLat}, ${r.listingLon}) — Google: ${r.googleMinutes} min, Filter: included`,
        );
      }
    }

    // Print false negatives
    const falseNegatives = results.filter((r) => r.classification === "FALSE_NEGATIVE");
    if (falseNegatives.length > 0) {
      console.log(`\n  FALSE NEGATIVES (should be included):`);
      for (const r of falseNegatives) {
        console.log(
          `    - #${r.listingId} "${r.listingTitle.slice(0, 40)}" (${r.listingLat}, ${r.listingLon}) — Google: ${r.googleMinutes} min, Filter: excluded`,
        );
      }
    }

    if (falsePositives.length === 0 && falseNegatives.length === 0) {
      console.log(`\n  No mismatches!`);
    }
  }

  // ---------------------------------------------------------------------------
  // Aggregate report
  // ---------------------------------------------------------------------------

  console.log(`\n\n${"=".repeat(60)}`);
  console.log(`=== AGGREGATE ===`);
  console.log(`${"=".repeat(60)}\n`);

  const totalTP = allReports.reduce((s, r) => s + r.truePositive, 0);
  const totalTN = allReports.reduce((s, r) => s + r.trueNegative, 0);
  const totalFP = allReports.reduce((s, r) => s + r.falsePositive, 0);
  const totalFN = allReports.reduce((s, r) => s + r.falseNegative, 0);
  const totalGE = allReports.reduce((s, r) => s + r.googleErrors, 0);
  const totalValid = totalTP + totalTN + totalFP + totalFN;
  const totalChecks = totalValid + totalGE;
  const overallAccuracy = totalValid > 0 ? ((totalTP + totalTN) / totalValid) * 100 : 0;
  const fpRate = totalValid > 0 ? (totalFP / totalValid) * 100 : 0;
  const fnRate = totalValid > 0 ? (totalFN / totalValid) * 100 : 0;

  console.log(`Total checks: ${totalChecks} (${listings.length} listings x ${destinations.length} destinations)`);
  console.log(`Valid checks: ${totalValid} (${totalGE} Google errors excluded)`);
  console.log(`Accuracy: ${overallAccuracy.toFixed(1)}%`);
  console.log(`False positive rate: ${fpRate.toFixed(1)}%`);
  console.log(`False negative rate: ${fnRate.toFixed(1)}%`);
  console.log();
  console.log(`  TRUE_POSITIVE:   ${totalTP}`);
  console.log(`  TRUE_NEGATIVE:  ${totalTN}`);
  console.log(`  FALSE_POSITIVE:  ${totalFP}`);
  console.log(`  FALSE_NEGATIVE:  ${totalFN}`);
  if (totalGE > 0) console.log(`  GOOGLE_ERROR:    ${totalGE}`);

  // Per-destination breakdown
  console.log(`\nPer-destination accuracy:`);
  for (const r of allReports) {
    console.log(`  ${r.destination}: ${r.accuracy.toFixed(1)}% (TP=${r.truePositive} TN=${r.trueNegative} FP=${r.falsePositive} FN=${r.falseNegative})`);
  }

  // ---------------------------------------------------------------------------
  // Save full results to JSON
  // ---------------------------------------------------------------------------

  const outputPath = resolve(__dirname, "verify-results.json");
  const output = {
    timestamp: new Date().toISOString(),
    config: {
      sampleSize: opts.sampleSize,
      mode: opts.mode,
      maxMinutes: opts.maxMinutes,
      toleranceMinutes: TOLERANCE_MINUTES,
      apiUrl: opts.apiUrl,
      destinationsFilter: opts.destinations,
    },
    sampledListings: listings.map((l) => ({ id: l.id, title: l.title, lat: l.lat, lon: l.lon })),
    reports: allReports,
    aggregate: {
      totalChecks,
      validChecks: totalValid,
      accuracy: overallAccuracy,
      falsePositiveRate: fpRate,
      falseNegativeRate: fnRate,
      truePositive: totalTP,
      trueNegative: totalTN,
      falsePositive: totalFP,
      falseNegative: totalFN,
      googleErrors: totalGE,
    },
  };

  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nFull results saved to: ${outputPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
