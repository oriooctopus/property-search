/**
 * Full initial populate for StreetEasy listings.
 *
 * Strategy: fully adaptive, data-driven slicing.
 *
 *   1. Probe borough total (no filters).
 *      - If ≤ SE_CAP: fetch directly, done.
 *      - If > SE_CAP: discover bedroom distribution.
 *
 *   2. Auto-discover bedroom range: probe bed=0, bed=1, bed=2, …
 *      until two consecutive empty results. The final bucket captures
 *      everything above the last non-empty count (e.g., "5+").
 *
 *   3. For each discovered bedroom bucket:
 *      - If ≤ SE_CAP: fetch directly.
 *      - If > SE_CAP: recursively bisect by price until all leaf
 *        slices are under the cap.
 *
 * No hardcoded bedroom buckets, no hardcoded price tiers.
 * The script adapts to whatever the API reports.
 *
 * Usage: npx tsx scripts/populate-se-full.ts
 */

import { paginateSlice, nodesToListings, probeTotalCount } from "../lib/sources/streeteasy";
import type { SENode } from "../lib/sources/streeteasy";
import { validateAndNormalize } from "../lib/sources/pipeline";
import { assignSearchTag } from "../lib/tag-constants";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { HttpsProxyAgent } from "https-proxy-agent";
import https from "https";

// ---------------------------------------------------------------------------
// Load .env.local
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Proxy fetch
// ---------------------------------------------------------------------------

const APIFY_PROXY_URL = process.env.APIFY_PROXY_URL ?? '';

function makeProxyFetch(): typeof fetch {
  const agent = new HttpsProxyAgent(APIFY_PROXY_URL);
  return (input: RequestInfo | URL, init?: RequestInit) =>
    new Promise((resolve, reject) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const bodyStr = init?.body as string | undefined;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const req = https.request(url, { method: init?.method ?? "GET", headers, agent }, (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c));
        res.on("end", () => {
          resolve(new Response(data, {
            status: res.statusCode ?? 200,
            headers: res.headers as HeadersInit,
          }));
        });
      });
      req.on("error", reject);
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
}

const proxyFetch = makeProxyFetch();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BOROUGHS: Array<{ name: string; areas: number[] }> = [
  { name: "Manhattan", areas: [100] },
  { name: "Brooklyn",  areas: [300] },
];

// Conservative cap — SE silently stops around 1,100; we bisect before hitting it.
const SE_CAP = 950;

// Sentinel for price bisection math. The top leaf slice uses no upper bound
// to capture any ultra-luxury outliers above this value.
const SE_MAX_PRICE = 30_000;

const BATCH_SIZE = 50;
const PAGE_DELAY_MS  = 2_000;   // between pages inside paginateSlice
const PROBE_DELAY_MS = 1_500;   // before each lightweight probe
const FETCH_DELAY_MS = 10_000;  // extra pause before starting a full pagination

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildBaseFilters(
  areas: number[],
  bedroomFilter?: Record<string, number>,
  priceMin?: number,
  priceMax?: number | null,
): Record<string, unknown> {
  const filters: Record<string, unknown> = { rentalStatus: "ACTIVE", areas };

  if (bedroomFilter) filters.bedrooms = bedroomFilter;

  if (priceMin !== undefined || priceMax !== undefined) {
    const priceRange: Record<string, number> = {};
    if (priceMin !== undefined && priceMin > 0) priceRange.lowerBound = priceMin;
    if (priceMax !== undefined && priceMax !== null) priceRange.upperBound = priceMax;
    if (Object.keys(priceRange).length > 0) filters.price = priceRange;
  }

  return filters;
}

// ---------------------------------------------------------------------------
// Bedroom auto-discovery
// ---------------------------------------------------------------------------

interface BedroomBucket {
  lower: number;
  upper: number | null; // null = no upper bound ("N+")
  label: string;
  count: number;
}

/**
 * Probes individual bedroom counts (0, 1, 2, …) until two consecutive zeros.
 * Returns a list of buckets with their live counts.
 * The final non-empty count becomes an open-ended "N+" bucket.
 */
async function discoverBedroomBuckets(areas: number[]): Promise<BedroomBucket[]> {
  const buckets: BedroomBucket[] = [];
  let consecutiveZeros = 0;
  let lastNonZero = -1;

  for (let bed = 0; consecutiveZeros < 2; bed++) {
    await delay(PROBE_DELAY_MS);
    const filters = buildBaseFilters(areas, { lowerBound: bed, upperBound: bed });
    const count = await probeTotalCount(areas, filters, proxyFetch);
    console.log(`    bed=${bed}: ${count}`);

    if (count === 0) {
      consecutiveZeros++;
    } else {
      consecutiveZeros = 0;
      lastNonZero = bed;
      buckets.push({ lower: bed, upper: bed, label: bed === 0 ? "studio" : `${bed}br`, count });
    }
  }

  // Upgrade the last bucket to open-ended ("N+") to catch anything higher
  if (buckets.length > 0) {
    const last = buckets[buckets.length - 1];
    // Probe the open-ended version to get its true count
    await delay(PROBE_DELAY_MS);
    const openFilters = buildBaseFilters(areas, { lowerBound: lastNonZero });
    const openCount = await probeTotalCount(areas, openFilters, proxyFetch);
    last.upper = null;
    last.label = `${lastNonZero}br+`;
    last.count = openCount;
    console.log(`    bed=${lastNonZero}+ (open-ended): ${openCount}`);
  }

  return buckets;
}

// ---------------------------------------------------------------------------
// Recursive price bisection
// ---------------------------------------------------------------------------

/**
 * Fetches all listings for a given filter set.
 * If count > SE_CAP, recursively splits the price range in half.
 *
 * priceMin: lower bound in dollars (0 = no lower bound applied)
 * priceMax: upper bound in dollars (null = no upper bound)
 */
async function fetchSliceRecursive(
  areas: number[],
  bedroomFilter: Record<string, number> | undefined,
  priceMin: number,
  priceMax: number | null,
  label: string,
  depth: number,
  allNodes: SENode[],
  seenUrls: Set<string>,
): Promise<number> {
  const indent = "  ".repeat(depth + 2);
  const priceLabel = priceMax !== null
    ? `$${priceMin.toLocaleString()}–$${priceMax.toLocaleString()}`
    : priceMin > 0 ? `$${priceMin.toLocaleString()}+` : "any price";

  const filters = buildBaseFilters(areas, bedroomFilter, priceMin, priceMax);

  await delay(PROBE_DELAY_MS);
  const totalCount = await probeTotalCount(areas, filters, proxyFetch);
  console.log(`${indent}[${label}] ${priceLabel}: ${totalCount}`);

  if (totalCount === 0) return 0;

  if (totalCount <= SE_CAP) {
    await delay(FETCH_DELAY_MS);
    const result = await paginateSlice(areas, filters, `${label} ${priceLabel}`, PAGE_DELAY_MS, proxyFetch);
    let added = 0;
    for (const n of result.nodes) {
      const url = n.urlPath ? `https://streeteasy.com${n.urlPath}` : null;
      if (url && !seenUrls.has(url)) { seenUrls.add(url); allNodes.push(n); added++; }
    }
    console.log(`${indent}  → added ${added} (${result.nodes.length - added} dupes)`);
    return added;
  }

  // Over cap — bisect price range
  const effectiveMax = priceMax ?? SE_MAX_PRICE;
  if (priceMin >= effectiveMax) {
    // Cannot bisect further (single price point). Statistically impossible for rentals.
    console.warn(`${indent}  WARNING: cannot bisect at $${priceMin} — accepting partial fetch`);
    await delay(FETCH_DELAY_MS);
    const result = await paginateSlice(areas, filters, `${label} ${priceLabel}`, PAGE_DELAY_MS, proxyFetch);
    let added = 0;
    for (const n of result.nodes) {
      const url = n.urlPath ? `https://streeteasy.com${n.urlPath}` : null;
      if (url && !seenUrls.has(url)) { seenUrls.add(url); allNodes.push(n); added++; }
    }
    return added;
  }

  const mid = Math.floor((priceMin + effectiveMax) / 2);
  console.log(`${indent}  → ${totalCount} > ${SE_CAP}, bisecting at $${mid.toLocaleString()}`);

  const lower = await fetchSliceRecursive(areas, bedroomFilter, priceMin, mid,      label, depth + 1, allNodes, seenUrls);
  const upper = await fetchSliceRecursive(areas, bedroomFilter, mid + 1, priceMax,  label, depth + 1, allNodes, seenUrls);
  return lower + upper;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  const allNodes: SENode[] = [];
  const seenUrls = new Set<string>();

  for (const borough of BOROUGHS) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`BOROUGH: ${borough.name}`);
    console.log("=".repeat(60));

    // Step 1: probe borough total
    await delay(PROBE_DELAY_MS);
    const boroughFilters = buildBaseFilters(borough.areas);
    const boroughTotal = await probeTotalCount(borough.areas, boroughFilters, proxyFetch);
    console.log(`  Total active listings: ${boroughTotal}`);

    if (boroughTotal <= SE_CAP) {
      // Small enough to fetch in one shot — no bedroom splitting needed
      console.log(`  Under cap — fetching all directly`);
      await delay(FETCH_DELAY_MS);
      const result = await paginateSlice(borough.areas, boroughFilters, borough.name, PAGE_DELAY_MS, proxyFetch);
      for (const n of result.nodes) {
        const url = n.urlPath ? `https://streeteasy.com${n.urlPath}` : null;
        if (url && !seenUrls.has(url)) { seenUrls.add(url); allNodes.push(n); }
      }
      console.log(`  Added ${result.nodes.length} listings`);
      continue;
    }

    // Step 2: auto-discover bedroom distribution
    console.log(`\n  Discovering bedroom distribution...`);
    const bedroomBuckets = await discoverBedroomBuckets(borough.areas);
    console.log(`\n  Found ${bedroomBuckets.length} bedroom buckets:`);
    for (const b of bedroomBuckets) {
      console.log(`    ${b.label.padEnd(8)} ${b.count}`);
    }

    // Step 3: fetch each bedroom bucket (with price bisection if needed)
    for (const bucket of bedroomBuckets) {
      const bedroomFilter: Record<string, number> = { lowerBound: bucket.lower };
      if (bucket.upper !== null) bedroomFilter.upperBound = bucket.upper;

      const label = `${borough.name}/${bucket.label}`;
      console.log(`\n  --- ${label} (${bucket.count} listings) ---`);

      const before = allNodes.length;
      await fetchSliceRecursive(
        borough.areas,
        bedroomFilter,
        0,    // priceMin
        null, // priceMax — unbounded; bisection uses SE_MAX_PRICE for math
        label,
        0,
        allNodes,
        seenUrls,
      );
      console.log(`  ${bucket.label} total: ${allNodes.length - before} new unique`);
    }
  }

  // ---------------------------------------------------------------------------
  // Pipeline: validate → geo-tag → dedup → upsert
  // ---------------------------------------------------------------------------

  console.log(`\n${"=".repeat(60)}`);
  console.log(`PIPELINE: ${allNodes.length} raw nodes`);
  console.log("=".repeat(60));

  const rawListings = nodesToListings(allNodes, "New York");
  const pipeline = validateAndNormalize(rawListings, "populate-se-full");
  console.log(`  Valid: ${pipeline.listings.length}, Rejected: ${pipeline.rejected.length}`);

  let geoTagged = 0, geoDropped = 0;
  const tagged = pipeline.listings.filter((l) => {
    const tag = assignSearchTag(l.lat, l.lon, l.area);
    if (tag) { l.search_tag = tag; geoTagged++; return true; }
    geoDropped++;
    return false;
  });
  console.log(`  Geo-tagged: ${geoTagged}, dropped: ${geoDropped}`);

  const urlDeduped = new Map<string, typeof tagged[0]>();
  for (const l of tagged) urlDeduped.set(l.url, l);
  const finalListings = Array.from(urlDeduped.values());
  console.log(`  Final: ${finalListings.length}`);

  console.log(`\n=== UPSERT ===`);
  let upserted = 0, upsertErrors = 0;

  for (let i = 0; i < finalListings.length; i += BATCH_SIZE) {
    const batch = finalListings.slice(i, i + BATCH_SIZE).map((l) => ({
      address: l.address,
      area: l.area,
      price: l.price,
      beds: l.beds,
      baths: l.baths,
      sqft: l.sqft,
      lat: l.lat,
      lon: l.lon,
      photos: l.photo_urls?.length ?? 0,
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

    const { error } = await supabase
      .from("listings")
      .upsert(batch, { onConflict: "url", ignoreDuplicates: false });

    if (error) {
      console.error(`  Batch ${Math.floor(i / BATCH_SIZE) + 1} error: ${error.message}`);
      upsertErrors++;
    } else {
      upserted += batch.length;
      if ((Math.floor(i / BATCH_SIZE) + 1) % 10 === 0) {
        console.log(`  Progress: ${upserted}/${finalListings.length}...`);
      }
    }
  }

  console.log(`  Upserted: ${upserted}, Errors: ${upsertErrors}`);

  const { count } = await supabase
    .from("listings")
    .select("*", { count: "exact", head: true })
    .eq("source", "streeteasy");
  console.log(`\nSE listings in DB: ${count ?? "unknown"}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
