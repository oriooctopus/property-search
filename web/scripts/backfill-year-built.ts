/**
 * Backfill year_built from NYC PLUTO data (via NYC Open Data / Socrata API).
 *
 * For each listing missing year_built that has lat/lon, queries the PLUTO
 * dataset to find the nearest tax lot within 50 meters and extracts yearbuilt.
 *
 * Usage: npx tsx scripts/backfill-year-built.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, "..", ".env.local");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx);
  const val = trimmed.slice(eqIdx + 1);
  if (!process.env[key]) process.env[key] = val;
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const PLUTO_API_URL = "https://data.cityofnewyork.us/resource/64uk-42ks.json";
const BATCH_SIZE = 50;
const DELAY_BETWEEN_BATCHES_MS = 1000;
const DELAY_BETWEEN_REQUESTS_MS = 200;

// ---------------------------------------------------------------------------
// Fetch listings missing year_built
// ---------------------------------------------------------------------------

interface ListingToEnrich {
  id: number;
  lat: number;
  lon: number;
  address: string;
}

async function fetchListingsToEnrich(): Promise<ListingToEnrich[]> {
  const results: ListingToEnrich[] = [];
  let offset = 0;
  const PAGE = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("listings")
      .select("id, lat, lon, address")
      .is("year_built", null)
      .not("lat", "is", null)
      .not("lon", "is", null)
      .range(offset, offset + PAGE - 1);

    if (error) {
      console.error(`Fetch error at offset ${offset}:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;
    results.push(...(data as ListingToEnrich[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  return results;
}

// ---------------------------------------------------------------------------
// Query PLUTO API for year built
// ---------------------------------------------------------------------------

interface PlutoResult {
  yearbuilt?: string;
  address?: string;
  bbl?: string;
}

interface PlutoRecord {
  yearbuilt?: string;
  address?: string;
  bbl?: string;
  latitude?: string | number;
  longitude?: string | number;
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function queryPlutoYearBuilt(
  lat: number,
  lon: number,
): Promise<number | null> {
  // Fetch records within a bounding box (~0.002° = ~200m)
  const margin = 0.002;
  const latMin = lat - margin;
  const latMax = lat + margin;
  const lonMin = lon - margin;
  const lonMax = lon + margin;

  const url =
    `${PLUTO_API_URL}?$where=latitude>${latMin} AND latitude<${latMax} AND longitude>${lonMin} AND longitude<${lonMax}` +
    `&$select=yearbuilt,latitude,longitude&$limit=100`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    if (res.status === 429) {
      console.warn("  Rate limited by PLUTO API, slowing down...");
      await new Promise((r) => setTimeout(r, 5000));
      return null;
    }
    return null;
  }

  const data: PlutoRecord[] = await res.json();
  if (!data || data.length === 0) return null;

  // Find the nearest record within 50 meters
  let nearest: PlutoRecord | null = null;
  let nearestDistance = 50; // 50 meter threshold

  for (const record of data) {
    if (!record.yearbuilt) continue;
    const recLat = typeof record.latitude === 'string' ? parseFloat(record.latitude) : record.latitude;
    const recLon = typeof record.longitude === 'string' ? parseFloat(record.longitude) : record.longitude;

    if (!Number.isFinite(recLat) || !Number.isFinite(recLon)) continue;

    const distance = haversineDistance(lat, lon, recLat, recLon);
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Year Built Backfill (PLUTO) ===\n");

  console.log("Fetching listings missing year_built...");
  const listings = await fetchListingsToEnrich();
  console.log(`Found ${listings.length} listings to enrich\n`);

  if (listings.length === 0) {
    console.log("Nothing to backfill!");
    return;
  }

  let totalUpdated = 0;
  let totalNotFound = 0;
  let totalErrors = 0;

  const totalBatches = Math.ceil(listings.length / BATCH_SIZE);

  for (let i = 0; i < listings.length; i += BATCH_SIZE) {
    const batch = listings.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    console.log(
      `\n--- Batch ${batchNum}/${totalBatches} (${batch.length} listings) ---`,
    );

    for (const listing of batch) {
      try {
        const yearBuilt = await queryPlutoYearBuilt(listing.lat, listing.lon);

        if (yearBuilt === null) {
          totalNotFound++;
          continue;
        }

        const { error } = await supabase
          .from("listings")
          .update({ year_built: yearBuilt })
          .eq("id", listing.id);

        if (error) {
          console.error(
            `  Update error for id=${listing.id}: ${error.message}`,
          );
          totalErrors++;
        } else {
          totalUpdated++;
        }

        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_REQUESTS_MS));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `  Error for id=${listing.id} (${listing.address}): ${msg}`,
        );
        totalErrors++;
      }
    }

    console.log(
      `  Progress: ${totalUpdated} updated, ${totalNotFound} not found, ${totalErrors} errors`,
    );

    // Pause between batches
    if (i + BATCH_SIZE < listings.length) {
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
    }
  }

  console.log("\n=== RESULTS ===");
  console.log(`  Total listings processed: ${listings.length}`);
  console.log(`  Updated with year_built:  ${totalUpdated}`);
  console.log(`  Not found in PLUTO:       ${totalNotFound}`);
  console.log(`  Errors:                   ${totalErrors}`);

  // Final count
  const { count } = await supabase
    .from("listings")
    .select("*", { count: "exact", head: true })
    .not("year_built", "is", null);
  console.log(`  Total listings with year_built in DB: ${count}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
