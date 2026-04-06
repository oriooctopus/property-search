/**
 * Incremental source refresh with staleness checks and stale listing cleanup.
 *
 * Only scrapes sources that haven't been updated within the staleness window
 * (default 6 hours, configurable via REFRESH_STALE_HOURS env var).
 *
 * Usage:
 *   npx tsx scripts/refresh-sources.ts          # incremental (skip fresh sources)
 *   npx tsx scripts/refresh-sources.ts --force   # full refresh (ignore staleness)
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
import { createClient } from "@supabase/supabase-js";

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
const FORCE = process.argv.includes("--force");
const STALE_HOURS = Number(process.env.REFRESH_STALE_HOURS) || 6;
const STALE_LISTING_DAYS = 45;

// No API-side filters — all filtering happens client-side
const BASE_PARAMS = {};

const NYC_PARAMS: SearchParams = { city: "New York", stateCode: "NY", ...BASE_PARAMS };

// ---------------------------------------------------------------------------
// Source+city combos (mirrors populate-sources.ts)
// ---------------------------------------------------------------------------

interface SourceCityCombo {
  source: string;
  city: string;
  tag: string;
  label: string;
  fn: () => Promise<{ listings: AdapterOutput[]; total: number }>;
}

function buildCombos(): SourceCityCombo[] {
  const combos: SourceCityCombo[] = [];

  // Per-city: Realtor + Apartments
  for (const { city, tag, label } of [
    { city: "New York", tag: "manhattan", label: "Manhattan" },
    { city: "Brooklyn", tag: "brooklyn", label: "Brooklyn" },
  ]) {
    const params: SearchParams = { city, stateCode: "NY", ...BASE_PARAMS };
    combos.push({
      source: "realtor",
      city: tag,
      tag,
      label: `realtor_${tag}`,
      fn: () => fetchRealtorListings(params, RAPIDAPI_KEY),
    });
    combos.push({
      source: "apartments",
      city: tag,
      tag,
      label: `apartments_${tag}`,
      fn: () => fetchApartmentsListings(params, RAPIDAPI_KEY),
    });
  }

  // NYC-wide sources
  combos.push({
    source: "craigslist",
    city: "nyc",
    tag: "search_new_york",
    label: "craigslist",
    fn: () => fetchCraigslistListings(NYC_PARAMS),
  });
  combos.push({
    source: "renthop",
    city: "nyc",
    tag: "search_new_york",
    label: "renthop",
    fn: () => fetchRentHopListings(NYC_PARAMS),
  });
  combos.push({
    source: "zillow",
    city: "nyc",
    tag: "search_new_york",
    label: "zillow",
    fn: () => fetchZillowListings(NYC_PARAMS, RAPIDAPI_KEY),
  });
  combos.push({
    source: "facebook",
    city: "nyc",
    tag: "search_new_york",
    label: "facebook",
    fn: () => fetchFacebookMarketplaceListings(NYC_PARAMS),
  });

  // StreetEasy per borough
  for (const borough of ["Manhattan", "Brooklyn"]) {
    const tag = borough.toLowerCase();
    combos.push({
      source: "streeteasy",
      city: tag,
      tag,
      label: `streeteasy_${tag}`,
      fn: () => fetchStreetEasyListings({ city: borough, stateCode: "NY", ...BASE_PARAMS }, RAPIDAPI_KEY),
    });
  }

  return combos;
}

// ---------------------------------------------------------------------------
// Staleness check
// ---------------------------------------------------------------------------

interface FreshnessRow {
  source: string;
  city: string;
  last_scraped_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getFreshness(supabase: any): Promise<Map<string, Date>> {
  const { data, error } = await supabase
    .from("source_freshness")
    .select("source, city, last_scraped_at");

  if (error) {
    console.error(`  Warning: could not read source_freshness: ${error.message}`);
    return new Map();
  }

  const map = new Map<string, Date>();
  for (const row of data as FreshnessRow[]) {
    map.set(`${row.source}:${row.city}`, new Date(row.last_scraped_at));
  }
  return map;
}

function isFresh(freshnessMap: Map<string, Date>, source: string, city: string): boolean {
  const key = `${source}:${city}`;
  const lastScraped = freshnessMap.get(key);
  if (!lastScraped) return false;
  const ageMs = Date.now() - lastScraped.getTime();
  const staleMs = STALE_HOURS * 60 * 60 * 1000;
  return ageMs < staleMs;
}

// ---------------------------------------------------------------------------
// Update freshness
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function updateFreshness(
  supabase: any,
  source: string,
  city: string,
  listingsFound: number,
) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("source_freshness")
    .upsert(
      {
        source,
        city,
        last_scraped_at: now,
        listings_found: listingsFound,
        updated_at: now,
      },
      { onConflict: "source,city" },
    );
  if (error) {
    console.error(`  Warning: failed to update source_freshness for ${source}/${city}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Fetch source (same pattern as populate-sources.ts)
// ---------------------------------------------------------------------------

interface SourceRun {
  source: string;
  city: string;
  count: number;
  skipped: boolean;
  error?: string;
}

async function fetchSource(
  combo: SourceCityCombo,
): Promise<{ run: SourceRun; listings: AdapterOutput[] }> {
  try {
    console.error(`  Fetching ${combo.label}...`);
    const result = await combo.fn();
    for (const l of result.listings) l.search_tag = combo.tag;
    console.error(`  ${combo.label}: ${result.listings.length} listings`);
    return {
      run: { source: combo.source, city: combo.city, count: result.listings.length, skipped: false },
      listings: result.listings,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ${combo.label} ERROR: ${msg}`);
    return {
      run: { source: combo.source, city: combo.city, count: 0, skipped: false, error: msg },
      listings: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Delete stale listings
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function deleteStaleListings(supabase: any): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_LISTING_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Count first
  const { count, error: countErr } = await supabase
    .from("listings")
    .select("*", { count: "exact", head: true })
    .lt("created_at", cutoff);

  if (countErr) {
    console.error(`  Error counting stale listings: ${countErr.message}`);
    return 0;
  }

  const staleCount = count ?? 0;
  if (staleCount === 0) return 0;

  const { error: delErr } = await supabase
    .from("listings")
    .delete()
    .lt("created_at", cutoff);

  if (delErr) {
    console.error(`  Error deleting stale listings: ${delErr.message}`);
    return 0;
  }

  return staleCount;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("ERROR: Missing Supabase credentials (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const combos = buildCombos();
  const runs: SourceRun[] = [];
  const allRaw: AdapterOutput[] = [];
  const qualitySummaries: QualitySummary[] = [];

  // Check staleness
  console.error(`\n=== STALENESS CHECK (threshold: ${STALE_HOURS}h, force: ${FORCE}) ===`);
  const freshnessMap = FORCE ? new Map<string, Date>() : await getFreshness(supabase);

  // Scrape sources
  for (const combo of combos) {
    if (!FORCE && isFresh(freshnessMap, combo.source, combo.city)) {
      console.error(`  SKIP ${combo.label} (fresh)`);
      runs.push({ source: combo.source, city: combo.city, count: 0, skipped: true });
      continue;
    }

    const result = await fetchSource(combo);
    runs.push(result.run);
    allRaw.push(...result.listings);

    // Update freshness after each source completes
    await updateFreshness(supabase, combo.source, combo.city, result.run.count);

    // Rate-limit between sources
    await new Promise((r) => setTimeout(r, 1000));
  }

  const scrapedCount = runs.filter((r) => !r.skipped).length;
  if (scrapedCount === 0) {
    console.error("\n  All sources are fresh — nothing to scrape.");
    console.error("  Use --force to override staleness checks.\n");
    printSummary(runs, 0, 0, 0, 0, 0);
    return;
  }

  // Run through pipeline
  console.error("\n=== PIPELINE ===");
  const pipeline = validateAndNormalize(allRaw, "all-sources");
  qualitySummaries.push(pipeline.qualitySummary);
  const merged = mergeQualitySummaries(qualitySummaries);

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

  // Upsert new listings to Supabase
  console.error("\n=== UPSERT ===");
  const BATCH_SIZE = 50;
  let upserted = 0;
  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const batch = deduped.slice(i, i + BATCH_SIZE).map((l) => ({
      address: l.address,
      area: l.area,
      price: l.price,
      beds: l.beds,
      baths: l.baths,
      sqft: l.sqft,
      lat: l.lat,
      lon: l.lon,
      photos: l.photo_urls.length,
      photo_urls: l.photo_urls,
      url: l.url,
      search_tag: l.search_tag,
      list_date: l.list_date,
      last_update_date: l.last_update_date,
      availability_date: l.availability_date,
      source: l.source,
      sources: l.sources ?? [l.source],
      source_urls: l.source_urls ?? { [l.source]: l.url },
    }));
    const { error } = await supabase.from("listings").upsert(batch, { onConflict: "url", ignoreDuplicates: false });
    if (error) {
      console.error(`  Batch ${i} error: ${error.message}`);
    } else {
      upserted += batch.length;
    }
  }
  console.error(`  Upserted: ${upserted}`);

  // Enrich newly upserted listings with isochrone data
  console.error("\n=== ISOCHRONE ENRICHMENT ===");
  const upsertedUrls = deduped.map((l) => l.url);
  const enrichListings: Array<{ listing_id: number; lat: number; lon: number }> = [];
  for (let i = 0; i < upsertedUrls.length; i += 500) {
    const urlBatch = upsertedUrls.slice(i, i + 500);
    const { data: rows } = await supabase
      .from("listings")
      .select("id, lat, lon")
      .in("url", urlBatch);
    if (rows) {
      for (const row of rows) {
        if (row.lat && row.lon) {
          enrichListings.push({ listing_id: row.id, lat: Number(row.lat), lon: Number(row.lon) });
        }
      }
    }
  }

  if (enrichListings.length > 0) {
    const ENRICH_BATCH = 100;
    let enriched = 0;
    for (let i = 0; i < enrichListings.length; i += ENRICH_BATCH) {
      const batch = enrichListings.slice(i, i + ENRICH_BATCH);
      const { error: enrichErr } = await supabase.rpc("batch_enrich_listing_isochrones", {
        p_listings: JSON.stringify(batch),
      });
      if (enrichErr) {
        console.error(`  Enrich batch ${i} error: ${enrichErr.message}`);
      } else {
        enriched += batch.length;
      }
    }
    console.error(`  Enriched ${enriched} listings with isochrone data`);
  } else {
    console.error(`  No listings to enrich`);
  }

  // Cross-batch dedup: fetch all DB listings, run dedup, delete losers
  console.error("\n=== CROSS-BATCH DEDUP ===");
  const { data: allDb, error: fetchErr } = await supabase
    .from("listings")
    .select("*");

  let crossBatchRemoved = 0;
  if (fetchErr || !allDb) {
    console.error(`  Failed to fetch DB listings: ${fetchErr?.message}`);
  } else {
    console.error(`  Fetched ${allDb.length} listings from DB`);

    const dbListings = allDb.map((row) => ({
      ...row,
      lat: Number(row.lat) || 0,
      lon: Number(row.lon) || 0,
      price: Number(row.price) || 0,
      beds: Number(row.beds) || 0,
      baths: Number(row.baths) || 0,
      photos: Number(row.photos) || 0,
      photo_urls: row.photo_urls ?? [],
      sources: row.sources ?? [row.source],
      source_urls: row.source_urls ?? { [row.source]: row.url },
      quality: row.quality ?? { beds: "parsed", baths: "parsed", price: "parsed", geo: "parsed", photos: "parsed" },
    }));

    const afterDedup = deduplicateAndComposite(dbListings);
    const keepUrls = new Set(afterDedup.map((l) => l.url));
    const toDelete = allDb.filter((row) => !keepUrls.has(row.url)).map((row) => row.id);

    if (toDelete.length > 0) {
      const { error: delErr } = await supabase
        .from("listings")
        .delete()
        .in("id", toDelete);
      if (delErr) {
        console.error(`  Delete error: ${delErr.message}`);
      } else {
        crossBatchRemoved = toDelete.length;
        console.error(`  Removed ${toDelete.length} cross-batch duplicates`);
      }
    } else {
      console.error(`  No cross-batch duplicates found`);
    }
  }

  // Delete stale listings (older than 45 days)
  console.error("\n=== STALE LISTING CLEANUP ===");
  const staleDeleted = await deleteStaleListings(supabase);
  console.error(`  Removed ${staleDeleted} listings older than ${STALE_LISTING_DAYS} days`);

  // Final count
  const { count: finalCount } = await supabase.from("listings").select("*", { count: "exact", head: true });
  console.error(`  Final DB count: ${finalCount}`);

  printSummary(runs, upserted, crossBatchRemoved, staleDeleted, finalCount ?? 0, geoDropped);
}

// ---------------------------------------------------------------------------
// Summary table
// ---------------------------------------------------------------------------

function printSummary(
  runs: SourceRun[],
  upserted: number,
  crossBatchRemoved: number,
  staleDeleted: number,
  finalDbCount: number,
  geoDropped: number,
) {
  console.error("\n=== SUMMARY ===");
  console.error("");
  console.error("  Source               City        Status     Listings  ");
  console.error("  ───────────────────  ──────────  ─────────  ──────────");
  for (const r of runs) {
    const source = r.source.padEnd(19);
    const city = r.city.padEnd(10);
    const status = r.skipped ? "skipped" : r.error ? "ERROR" : "scraped";
    const statusPad = status.padEnd(9);
    const count = r.skipped ? "-" : String(r.count);
    console.error(`  ${source}  ${city}  ${statusPad}  ${count}`);
    if (r.error) {
      console.error(`    └─ ${r.error}`);
    }
  }
  console.error("");
  console.error(`  Scraped:    ${runs.filter((r) => !r.skipped).length} sources`);
  console.error(`  Skipped:    ${runs.filter((r) => r.skipped).length} sources (fresh)`);
  console.error(`  Geo-dropped: ${geoDropped} (outside all areas)`);
  console.error(`  Upserted:   ${upserted}`);
  console.error(`  Cross-dedup: ${crossBatchRemoved} removed`);
  console.error(`  Stale cleanup: ${staleDeleted} listings older than ${STALE_LISTING_DAYS} days removed`);
  console.error(`  Final DB:   ${finalDbCount}`);
  console.error("");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
