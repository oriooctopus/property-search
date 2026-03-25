/**
 * Populate listings from all sources aligned with the 4 search areas:
 *   - fulton: Lower Manhattan near Fulton St station
 *   - ltrain: Bedford Ave through DeKalb Ave L train corridor
 *   - manhattan: Park Place (Tribeca) to 38th St (Midtown)
 *   - brooklyn: Brooklyn within 35-min subway of 14th St
 *
 * Usage: npx tsx scripts/populate-sources.ts > /tmp/listings.json
 */

import { fetchApartmentsListings } from "../lib/sources/apartments";
import { fetchCraigslistListings } from "../lib/sources/craigslist";
import { fetchRentHopListings } from "../lib/sources/renthop";
import { fetchRealtorListings } from "../lib/sources/realtor";
import { fetchStreetEasyListings } from "../lib/sources/streeteasy";
import { fetchZillowListings } from "../lib/sources/zillow";
import { fetchFacebookMarketplaceListings } from "../lib/sources/facebook-marketplace";
import type { SearchParams, AdapterOutput } from "../lib/sources/types";
import { validateAndNormalize, mergeQualitySummaries, type QualitySummary } from "../lib/sources/pipeline";
import { deduplicateAndComposite } from "../lib/sources/dedup";
import { assignSearchTag } from "../lib/tag-constants";

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

// Common search params: 5+ beds, 2+ baths, $4k-$100k rent
const BASE_PARAMS = { bedsMin: 5, bathsMin: 2, priceMin: 4000, priceMax: 100000 };

// Search configs aligned with the app's 4 filter tabs
const SEARCHES: Array<{ params: SearchParams; tag: string; label: string }> = [
  {
    params: { city: "New York", stateCode: "NY", ...BASE_PARAMS },
    tag: "manhattan",
    label: "Manhattan (Tribeca to Midtown)",
  },
  {
    params: { city: "Brooklyn", stateCode: "NY", ...BASE_PARAMS },
    tag: "brooklyn",
    label: "Brooklyn (subway to 14th St)",
  },
];

// Sources that are NYC-wide (don't need per-city runs)
const NYC_PARAMS: SearchParams = { city: "New York", stateCode: "NY", ...BASE_PARAMS };

interface SourceRun {
  source: string;
  count: number;
  error?: string;
}

async function fetchSource(
  name: string,
  fn: () => Promise<{ listings: AdapterOutput[]; total: number }>,
  tag: string,
): Promise<{ run: SourceRun; listings: AdapterOutput[] }> {
  try {
    console.error(`  Fetching ${name}...`);
    const result = await fn();
    for (const l of result.listings) l.search_tag = tag;
    console.error(`  ${name}: ${result.listings.length} listings`);
    return { run: { source: name, count: result.listings.length }, listings: result.listings };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ${name} ERROR: ${msg}`);
    return { run: { source: name, count: 0, error: msg }, listings: [] };
  }
}

async function main() {
  const runs: SourceRun[] = [];
  const allRaw: AdapterOutput[] = [];
  const qualitySummaries: QualitySummary[] = [];

  // Per-city searches (Realtor + Apartments)
  for (const search of SEARCHES) {
    console.error(`\n=== ${search.label} ===`);

    const realtor = await fetchSource(
      `realtor_${search.tag}`,
      () => fetchRealtorListings(search.params, RAPIDAPI_KEY),
      search.tag,
    );
    runs.push(realtor.run);
    allRaw.push(...realtor.listings);
    await new Promise((r) => setTimeout(r, 1000));

    const apartments = await fetchSource(
      `apartments_${search.tag}`,
      () => fetchApartmentsListings(search.params, RAPIDAPI_KEY),
      search.tag,
    );
    runs.push(apartments.run);
    allRaw.push(...apartments.listings);
    await new Promise((r) => setTimeout(r, 1000));
  }

  // NYC-wide scrapers
  console.error("\n=== NYC-wide sources ===");

  const craigslist = await fetchSource(
    "craigslist",
    () => fetchCraigslistListings(NYC_PARAMS),
    "search_new_york",
  );
  runs.push(craigslist.run);
  allRaw.push(...craigslist.listings);
  await new Promise((r) => setTimeout(r, 1000));

  const renthop = await fetchSource(
    "renthop",
    () => fetchRentHopListings(NYC_PARAMS),
    "search_new_york",
  );
  runs.push(renthop.run);
  allRaw.push(...renthop.listings);
  await new Promise((r) => setTimeout(r, 1000));

  // StreetEasy per borough
  for (const borough of ["Manhattan", "Brooklyn"]) {
    const tag = borough.toLowerCase();
    const se = await fetchSource(
      `streeteasy_${tag}`,
      () => fetchStreetEasyListings({ city: borough, stateCode: "NY", ...BASE_PARAMS }, RAPIDAPI_KEY),
      tag,
    );
    runs.push(se.run);
    allRaw.push(...se.listings);
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Zillow
  const zillow = await fetchSource(
    "zillow",
    () => fetchZillowListings(NYC_PARAMS, RAPIDAPI_KEY),
    "search_new_york",
  );
  runs.push(zillow.run);
  allRaw.push(...zillow.listings);
  await new Promise((r) => setTimeout(r, 1000));

  // Facebook Marketplace
  const facebook = await fetchSource(
    "facebook",
    () => fetchFacebookMarketplaceListings(NYC_PARAMS),
    "search_new_york",
  );
  runs.push(facebook.run);
  allRaw.push(...facebook.listings);

  // Run through pipeline
  console.error("\n=== PIPELINE ===");
  const pipeline = validateAndNormalize(allRaw, "all-sources");
  qualitySummaries.push(pipeline.qualitySummary);
  const merged = mergeQualitySummaries(qualitySummaries);

  // Summary
  console.error("\n=== SUMMARY ===");
  for (const r of runs) {
    console.error(`  ${r.source}: ${r.count}${r.error ? ` (ERROR: ${r.error})` : ""}`);
  }
  console.error(`  RAW TOTAL: ${allRaw.length}`);
  console.error(`  VALIDATED: ${pipeline.listings.length}`);
  console.error(`  REJECTED:  ${pipeline.rejected.length}`);

  // Geo-tag: assign search_tag based on coordinates or neighborhood
  let geoTagged = 0;
  let geoDropped = 0;
  const tagged = pipeline.listings.filter((l) => {
    const tag = assignSearchTag(l.lat, l.lon, l.area);
    if (tag) {
      l.search_tag = tag;
      geoTagged++;
      return true;
    }
    geoDropped++;
    return false;
  });
  console.error(`  GEO-TAGGED: ${geoTagged} (dropped ${geoDropped} outside all areas)`);

  // Deduplicate
  const deduped = deduplicateAndComposite(tagged);
  console.error(`  DEDUPED:   ${deduped.length} (removed ${tagged.length - deduped.length})`);

  if (merged.warnings.length > 0) {
    console.error("  QUALITY WARNINGS:");
    for (const w of merged.warnings) console.error(`    - ${w}`);
  }

  // Output deduplicated JSON
  console.log(JSON.stringify(deduped, null, 2));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
