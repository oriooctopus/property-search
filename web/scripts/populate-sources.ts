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
import { fetchRealtorListings } from "../lib/sources/realtor-apify";
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

// No API-side filters — all filtering happens client-side
const BASE_PARAMS = {};

// Search configs aligned with the app's 4 filter tabs
const SEARCHES: Array<{ params: SearchParams; tag: string; label: string }> = [
  {
    params: { city: "New York", stateCode: "NY", ...BASE_PARAMS },
    tag: "manhattan",
    label: "Manhattan (all)",
  },
  {
    params: { city: "Brooklyn", stateCode: "NY", ...BASE_PARAMS },
    tag: "brooklyn",
    label: "Brooklyn (all)",
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

  // Per-city searches (Apartments only - Realtor disabled)
  for (const search of SEARCHES) {
    console.error(`\n=== ${search.label} ===`);

    // Realtor disabled 2026-04-05
    // const realtor = await fetchSource(
    //   `realtor_${search.tag}`,
    //   () => fetchRealtorListings(search.params),
    //   search.tag,
    // );
    // runs.push(realtor.run);
    // allRaw.push(...realtor.listings);
    // await new Promise((r) => setTimeout(r, 1000));

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

  // StreetEasy per borough — direct GraphQL API with page/perPage pagination (free)
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

  // Upsert new listings to Supabase
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("  No Supabase credentials — outputting JSON only");
    console.log(JSON.stringify(deduped, null, 2));
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

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
  // Fetch IDs + coords for all upserted listings (they may be new or updated)
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
    // Batch in groups of 100 to avoid oversized RPC payloads
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
  // Supabase default limit is 1000 — must paginate for larger DBs
  const allDb: Record<string, unknown>[] = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data: page, error: pageErr } = await supabase
      .from("listings")
      .select("*")
      .range(offset, offset + PAGE - 1);
    if (pageErr || !page) {
      console.error(`  Fetch error at offset ${offset}: ${pageErr?.message}`);
      break;
    }
    allDb.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  const fetchErr = allDb.length === 0 ? { message: "No listings fetched" } : null;

  if (fetchErr || !allDb) {
    console.error(`  Failed to fetch DB listings: ${fetchErr?.message}`);
    return;
  }

  console.error(`  Fetched ${allDb.length} listings from DB`);

  // Convert DB rows to ValidatedListing shape for dedup
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
      console.error(`  Removed ${toDelete.length} cross-batch duplicates`);
    }
  } else {
    console.error(`  No cross-batch duplicates found`);
  }

  // Final count
  const { count } = await supabase.from("listings").select("*", { count: "exact", head: true });
  console.error(`  Final DB count: ${count}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
