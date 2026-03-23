/**
 * Populate listings from Apartments.com, Craigslist, and RentHop.
 *
 * Usage: npx tsx scripts/populate-sources.ts
 *
 * Outputs JSON results to stdout for each source.
 */

import { fetchApartmentsListings } from "../lib/sources/apartments";
import { fetchCraigslistListings } from "../lib/sources/craigslist";
import { fetchRentHopListings } from "../lib/sources/renthop";
import { fetchRealtorListings } from "../lib/sources/realtor";
import type { SearchParams, RawListing } from "../lib/sources/types";

// Load env from .env.local
import { readFileSync } from "fs";
import { resolve } from "path";

import { fileURLToPath } from "url";
import { dirname } from "path";
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

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY!;

// Search configs matching the existing 4 search areas
const SEARCHES: Array<{ params: SearchParams; tag: string }> = [
  {
    params: { city: "Brooklyn", stateCode: "NY", bedsMin: 5, bathsMin: 2, priceMin: 4000, priceMax: 100000 },
    tag: "brooklyn",
  },
  {
    params: { city: "New York", stateCode: "NY", bedsMin: 5, bathsMin: 2, priceMin: 4000, priceMax: 100000 },
    tag: "manhattan",
  },
];

interface SourceResult {
  source: string;
  count: number;
  error?: string;
  listings: RawListing[];
}

async function main() {
  const allResults: SourceResult[] = [];
  const allListings: RawListing[] = [];

  for (const search of SEARCHES) {
    console.error(`\n=== Searching: ${search.params.city}, ${search.params.stateCode} (tag: ${search.tag}) ===`);

    // Apartments.com
    try {
      console.error("  Fetching Apartments.com...");
      const result = await fetchApartmentsListings(search.params, RAPIDAPI_KEY);
      // Override search_tag
      for (const l of result.listings) l.search_tag = search.tag;
      console.error(`  Apartments.com: ${result.listings.length} listings`);
      allResults.push({ source: `apartments_${search.tag}`, count: result.listings.length, listings: result.listings });
      allListings.push(...result.listings);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Apartments.com ERROR: ${msg}`);
      allResults.push({ source: `apartments_${search.tag}`, count: 0, error: msg, listings: [] });
    }

    // Small delay
    await new Promise((r) => setTimeout(r, 1000));

    // Realtor.com (to refresh)
    try {
      console.error("  Fetching Realtor.com...");
      const result = await fetchRealtorListings(search.params, RAPIDAPI_KEY);
      for (const l of result.listings) l.search_tag = search.tag;
      console.error(`  Realtor.com: ${result.listings.length} listings`);
      allResults.push({ source: `realtor_${search.tag}`, count: result.listings.length, listings: result.listings });
      allListings.push(...result.listings);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Realtor.com ERROR: ${msg}`);
      allResults.push({ source: `realtor_${search.tag}`, count: 0, error: msg, listings: [] });
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  // Craigslist (NYC-wide, not per city)
  try {
    console.error("\n  Fetching Craigslist (NYC-wide)...");
    const result = await fetchCraigslistListings({ city: "New York", stateCode: "NY", bedsMin: 5, priceMin: 4000, priceMax: 100000 });
    console.error(`  Craigslist: ${result.listings.length} listings`);
    allResults.push({ source: "craigslist", count: result.listings.length, listings: result.listings });
    allListings.push(...result.listings);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  Craigslist ERROR: ${msg}`);
    allResults.push({ source: "craigslist", count: 0, error: msg, listings: [] });
  }

  await new Promise((r) => setTimeout(r, 1000));

  // RentHop (NYC-wide)
  try {
    console.error("\n  Fetching RentHop (NYC-wide)...");
    const result = await fetchRentHopListings({ city: "New York", stateCode: "NY", bedsMin: 5, priceMin: 4000, priceMax: 100000 });
    console.error(`  RentHop: ${result.listings.length} listings`);
    allResults.push({ source: "renthop", count: result.listings.length, listings: result.listings });
    allListings.push(...result.listings);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  RentHop ERROR: ${msg}`);
    allResults.push({ source: "renthop", count: 0, error: msg, listings: [] });
  }

  // Summary
  console.error("\n=== SUMMARY ===");
  for (const r of allResults) {
    console.error(`  ${r.source}: ${r.count} listings${r.error ? ` (ERROR: ${r.error})` : ""}`);
  }
  console.error(`  TOTAL: ${allListings.length} listings`);

  // Output JSON to stdout for processing
  console.log(JSON.stringify(allListings, null, 2));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
