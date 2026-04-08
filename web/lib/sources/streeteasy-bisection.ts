/**
 * StreetEasy full-bisection fetch.
 *
 * Extracted from the old scripts/populate-sources.ts as part of PR 2 of the
 * ingest pipeline cleanup. Used by FullBisectionFetch in lib/ingest/strategies.ts
 * for full SE backfills.
 *
 * Flow (per borough):
 *   1. Probe borough totalCount. If <= SE_CAP, paginate directly.
 *   2. Otherwise, discover bedroom buckets by probing bed=0,1,2,... until
 *      two consecutive zero buckets (last bucket is open-ended).
 *   3. For each bedroom bucket, recursively bisect by price until every
 *      slice is <= SE_CAP, then paginate each slice.
 *   4. Dedupe by urlPath across all slices.
 *
 * The SE API caps at ~1,100 results per query (project memory
 * `project_streeteasy_pagination.md`) — bisection is how we get past that.
 */

import https from "https";
import { HttpsProxyAgent } from "https-proxy-agent";

import {
  paginateSlice,
  probeTotalCount,
  nodesToListings,
  type SENode,
} from "./streeteasy";
import type { AdapterOutput } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BOROUGHS: Array<{ name: string; areas: number[] }> = [
  { name: "Manhattan", areas: [100] },
  { name: "Brooklyn", areas: [300] },
];

const SE_CAP = 950;
const SE_MAX_PRICE = 30_000;
const PAGE_DELAY_MS = 2_000;
const PROBE_DELAY_MS = 1_500;
const FETCH_DELAY_MS = 10_000;

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Proxy fetch
// ---------------------------------------------------------------------------

function makeProxyFetch(apifyProxyUrl: string): typeof fetch {
  const agent = new HttpsProxyAgent(apifyProxyUrl);
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    new Promise((resolve, reject) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const bodyStr = init?.body as string | undefined;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const req = https.request(
        url,
        { method: init?.method ?? "GET", headers, agent },
        (res) => {
          let data = "";
          res.on("data", (c: Buffer) => (data += c));
          res.on("end", () => {
            resolve(
              new Response(data, {
                status: res.statusCode ?? 200,
                headers: res.headers as HeadersInit,
              }),
            );
          });
        },
      );
      req.on("error", reject);
      if (bodyStr) req.write(bodyStr);
      req.end();
    })) as typeof fetch;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

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
    if (priceMax !== undefined && priceMax !== null)
      priceRange.upperBound = priceMax;
    if (Object.keys(priceRange).length > 0) filters.price = priceRange;
  }
  return filters;
}

// ---------------------------------------------------------------------------
// Bedroom bucket discovery
// ---------------------------------------------------------------------------

interface BedroomBucket {
  lower: number;
  upper: number | null;
  label: string;
  count: number;
}

async function discoverBedroomBuckets(
  areas: number[],
  proxyFetch: typeof fetch,
  log: (msg: string) => void,
): Promise<BedroomBucket[]> {
  const buckets: BedroomBucket[] = [];
  let consecutiveZeros = 0;
  let lastNonZero = -1;

  for (let bed = 0; consecutiveZeros < 2; bed++) {
    await delay(PROBE_DELAY_MS);
    const filters = buildBaseFilters(areas, { lowerBound: bed, upperBound: bed });
    const count = await probeTotalCount(areas, filters, proxyFetch);
    log(`    bed=${bed}: ${count}`);
    if (count === 0) {
      consecutiveZeros++;
    } else {
      consecutiveZeros = 0;
      lastNonZero = bed;
      buckets.push({
        lower: bed,
        upper: bed,
        label: bed === 0 ? "studio" : `${bed}br`,
        count,
      });
    }
  }

  if (buckets.length > 0) {
    const last = buckets[buckets.length - 1];
    await delay(PROBE_DELAY_MS);
    const openFilters = buildBaseFilters(areas, { lowerBound: lastNonZero });
    const openCount = await probeTotalCount(areas, openFilters, proxyFetch);
    last.upper = null;
    last.label = `${lastNonZero}br+`;
    last.count = openCount;
    log(`    bed=${lastNonZero}+ (open-ended): ${openCount}`);
  }

  return buckets;
}

// ---------------------------------------------------------------------------
// Recursive price bisection
// ---------------------------------------------------------------------------

async function fetchSliceRecursive(
  areas: number[],
  bedroomFilter: Record<string, number> | undefined,
  priceMin: number,
  priceMax: number | null,
  label: string,
  depth: number,
  allNodes: SENode[],
  seenUrls: Set<string>,
  proxyFetch: typeof fetch,
  log: (msg: string) => void,
): Promise<number> {
  const indent = "  ".repeat(depth + 2);
  const priceLabel =
    priceMax !== null
      ? `$${priceMin.toLocaleString()}–$${priceMax.toLocaleString()}`
      : priceMin > 0
        ? `$${priceMin.toLocaleString()}+`
        : "any price";

  const filters = buildBaseFilters(areas, bedroomFilter, priceMin, priceMax);

  await delay(PROBE_DELAY_MS);
  const totalCount = await probeTotalCount(areas, filters, proxyFetch);
  log(`${indent}[${label}] ${priceLabel}: ${totalCount}`);

  if (totalCount === 0) return 0;

  if (totalCount <= SE_CAP) {
    await delay(FETCH_DELAY_MS);
    const result = await paginateSlice(
      areas,
      filters,
      `${label} ${priceLabel}`,
      PAGE_DELAY_MS,
      proxyFetch,
    );
    let added = 0;
    for (const n of result.nodes) {
      const url = n.urlPath ? `https://streeteasy.com${n.urlPath}` : null;
      if (url && !seenUrls.has(url)) {
        seenUrls.add(url);
        allNodes.push(n);
        added++;
      }
    }
    log(`${indent}  → added ${added} (${result.nodes.length - added} dupes)`);
    return added;
  }

  const effectiveMax = priceMax ?? SE_MAX_PRICE;
  if (priceMin >= effectiveMax) {
    log(`${indent}  WARNING: cannot bisect at $${priceMin} — accepting partial fetch`);
    await delay(FETCH_DELAY_MS);
    const result = await paginateSlice(
      areas,
      filters,
      `${label} ${priceLabel}`,
      PAGE_DELAY_MS,
      proxyFetch,
    );
    let added = 0;
    for (const n of result.nodes) {
      const url = n.urlPath ? `https://streeteasy.com${n.urlPath}` : null;
      if (url && !seenUrls.has(url)) {
        seenUrls.add(url);
        allNodes.push(n);
        added++;
      }
    }
    return added;
  }

  const mid = Math.floor((priceMin + effectiveMax) / 2);
  log(`${indent}  → ${totalCount} > ${SE_CAP}, bisecting at $${mid.toLocaleString()}`);

  const lower = await fetchSliceRecursive(
    areas,
    bedroomFilter,
    priceMin,
    mid,
    label,
    depth + 1,
    allNodes,
    seenUrls,
    proxyFetch,
    log,
  );
  const upper = await fetchSliceRecursive(
    areas,
    bedroomFilter,
    mid + 1,
    priceMax,
    label,
    depth + 1,
    allNodes,
    seenUrls,
    proxyFetch,
    log,
  );
  return lower + upper;
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export interface StreetEasyBisectionDeps {
  /** Apify proxy URL (e.g. process.env.APIFY_PROXY_URL). Required. */
  apifyProxyUrl: string;
  /** Optional progress callback. Defaults to console.log. */
  onProgress?: (msg: string) => void;
}

/**
 * Full StreetEasy fetch via recursive bedroom + price bisection over the
 * Apify proxy. Handles the ~1,100 result-per-query cap by splitting queries
 * until every slice fits under SE_CAP.
 *
 * Returns normalized AdapterOutput[] (via nodesToListings).
 */
export async function fetchStreetEasyFullBisection(
  deps: StreetEasyBisectionDeps,
): Promise<AdapterOutput[]> {
  if (!deps.apifyProxyUrl) {
    throw new Error(
      "fetchStreetEasyFullBisection: apifyProxyUrl is required (set APIFY_PROXY_URL)",
    );
  }
  const log = deps.onProgress ?? ((m: string) => console.log(m));
  const proxyFetch = makeProxyFetch(deps.apifyProxyUrl);

  const seNodes: SENode[] = [];
  const seenUrls = new Set<string>();

  for (const borough of BOROUGHS) {
    log(`\n${"=".repeat(60)}`);
    log(`BOROUGH: ${borough.name}`);
    log("=".repeat(60));

    await delay(PROBE_DELAY_MS);
    const boroughFilters = buildBaseFilters(borough.areas);
    const boroughTotal = await probeTotalCount(
      borough.areas,
      boroughFilters,
      proxyFetch,
    );
    log(`  Total active listings: ${boroughTotal}`);

    if (boroughTotal <= SE_CAP) {
      log(`  Under cap — fetching all directly`);
      await delay(FETCH_DELAY_MS);
      const result = await paginateSlice(
        borough.areas,
        boroughFilters,
        borough.name,
        PAGE_DELAY_MS,
        proxyFetch,
      );
      for (const n of result.nodes) {
        const url = n.urlPath ? `https://streeteasy.com${n.urlPath}` : null;
        if (url && !seenUrls.has(url)) {
          seenUrls.add(url);
          seNodes.push(n);
        }
      }
      log(`  Added ${result.nodes.length} listings`);
      continue;
    }

    log(`\n  Discovering bedroom distribution...`);
    const bedroomBuckets = await discoverBedroomBuckets(
      borough.areas,
      proxyFetch,
      log,
    );
    log(`\n  Found ${bedroomBuckets.length} bedroom buckets:`);
    for (const b of bedroomBuckets) {
      log(`    ${b.label.padEnd(8)} ${b.count}`);
    }

    for (const bucket of bedroomBuckets) {
      const bedroomFilter: Record<string, number> = { lowerBound: bucket.lower };
      if (bucket.upper !== null) bedroomFilter.upperBound = bucket.upper;

      const label = `${borough.name}/${bucket.label}`;
      log(`\n  --- ${label} (${bucket.count} listings) ---`);

      const before = seNodes.length;
      await fetchSliceRecursive(
        borough.areas,
        bedroomFilter,
        0,
        null,
        label,
        0,
        seNodes,
        seenUrls,
        proxyFetch,
        log,
      );
      log(`  ${bucket.label} total: ${seNodes.length - before} new unique`);
    }
  }

  const listings = nodesToListings(seNodes, "New York");
  log(
    `  StreetEasy: ${listings.length} listings from ${BOROUGHS.map((b) => b.name).join(", ")}`,
  );
  return listings;
}
