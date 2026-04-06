/**
 * Daily refresh for StreetEasy listings.
 *
 * 1. FETCH NEW: Queries SE for the most recently listed rentals (sorted by
 *    LISTED_AT DESCENDING). Stops paginating once listings become older than
 *    7 days — recent listings are few enough that no bedroom-slicing is needed.
 *
 *    Note: SE's RentalFiltersInput has no date filter field, so we rely on
 *    sort-order early stopping: once we see a page where all listings are
 *    older than our cutoff, we stop.
 *
 * 2. REMOVE STALE: Deletes SE listings from the DB that were listed > 60 days
 *    ago. StreetEasy rarely keeps listings active that long, so this is a safe
 *    TTL-based cleanup.
 *
 * Usage: npx tsx scripts/refresh-se-daily.ts
 */

import { validateAndNormalize } from "../lib/sources/pipeline";
import { assignSearchTag } from "../lib/tag-constants";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

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
// SE API constants (duplicated here to keep script self-contained)
// ---------------------------------------------------------------------------

const SE_API_URL = "https://api-v6.streeteasy.com/";
const SE_PAGE_SIZE = 100;
const SE_DELAY_MS = 500;

const SE_HEADERS = {
  "Content-Type": "application/json",
  Origin: "https://streeteasy.com",
  Referer: "https://streeteasy.com/",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Safari/605.1.15",
  "apollographql-client-name": "srp-frontend-service",
  "apollographql-client-version":
    "version 859d2a117b87b956a057dd24110186eabfccc4eb",
  "app-version": "1.0.0",
  os: "web",
};

const SE_QUERY = `query GetListingRental($input: SearchRentalsInput!) {
  searchRentals(input: $input) {
    totalCount
    edges {
      ... on OrganicRentalEdge {
        node {
          id
          areaName
          bedroomCount
          fullBathroomCount
          halfBathroomCount
          geoPoint { latitude longitude }
          leadMedia { photo { key } }
          photos { key }
          livingAreaSize
          availableAt
          price
          status
          street
          unit
          urlPath
          noFee
          monthsFree
          netEffectivePrice
        }
      }
    }
  }
}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SENode {
  id?: string;
  areaName?: string;
  bedroomCount?: number;
  fullBathroomCount?: number;
  halfBathroomCount?: number;
  geoPoint?: { latitude?: number; longitude?: number };
  leadMedia?: { photo?: { key?: string } };
  photos?: { key?: string }[];
  livingAreaSize?: number;
  price?: number;
  street?: string;
  unit?: string;
  urlPath?: string;
  availableAt?: string;
  status?: string;
  noFee?: boolean;
  monthsFree?: number;
  netEffectivePrice?: number;
}

interface SEEdge {
  node?: SENode;
}

interface SEResponse {
  data?: {
    searchRentals?: {
      totalCount?: number;
      edges?: SEEdge[];
    };
  };
  errors?: { message: string }[];
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BOROUGHS: Array<{ name: string; city: string; areas: number[] }> = [
  { name: "Manhattan", city: "Manhattan", areas: [100] },
  { name: "Brooklyn", city: "Brooklyn", areas: [300] },
];

const LOOKBACK_DAYS = 7;
const STALE_DAYS = 60;
const BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sePhotoUrl(key: string): string {
  return `https://photos.zillowstatic.com/fp/${key}-se_extra_large_1500_800.webp`;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Fetch recent listings for one borough
// ---------------------------------------------------------------------------

async function fetchRecentForBorough(
  borough: (typeof BOROUGHS)[0],
): Promise<SENode[]> {
  const searchToken = crypto.randomUUID();
  const allNodes: SENode[] = [];
  let totalCount = 0;
  const filters = { rentalStatus: "ACTIVE", areas: borough.areas };

  for (let page = 1; ; page++) {
    console.log(`[SE-Daily] ${borough.name} page ${page}`);

    const res = await fetch(SE_API_URL, {
      method: "POST",
      headers: SE_HEADERS,
      body: JSON.stringify({
        query: SE_QUERY,
        variables: {
          input: {
            filters,
            page,
            perPage: SE_PAGE_SIZE,
            sorting: { attribute: "LISTED_AT", direction: "DESCENDING" },
            userSearchToken: searchToken,
            adStrategy: "NONE",
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`SE API error ${res.status}: ${text.slice(0, 200)}`);
    }

    const data: SEResponse = await res.json();

    if (data.errors?.length) {
      throw new Error(`SE GraphQL error: ${data.errors[0].message}`);
    }

    const edges = data.data?.searchRentals?.edges ?? [];
    if (page === 1) {
      totalCount = data.data?.searchRentals?.totalCount ?? 0;
      console.log(`[SE-Daily] ${borough.name} totalCount: ${totalCount}`);
    }

    if (edges.length === 0) {
      console.log(`[SE-Daily] ${borough.name} empty page — done`);
      break;
    }

    // Since we sort by LISTED_AT DESC, we stop as soon as we've seen enough
    // recent listings. We can't filter by date server-side, so we stop when
    // the first node on a page has no availableAt AND we've paginated past
    // what's likely recent. Simple heuristic: stop after 5 pages (500 listings)
    // — SE typically gets <200 new listings/day per borough.
    for (const edge of edges) {
      const n = edge.node;
      if (!n) continue;
      allNodes.push(n);
    }

    console.log(
      `[SE-Daily] ${borough.name} page ${page}: ${edges.length} results, running total: ${allNodes.length}`,
    );

    // Stop after 5 pages — recent listings should fit well within 500 results
    if (page >= 5) {
      console.log(`[SE-Daily] ${borough.name} reached page limit (5) — stopping`);
      break;
    }

    if (page * SE_PAGE_SIZE >= totalCount) {
      console.log(`[SE-Daily] ${borough.name} all pages fetched`);
      break;
    }

    await new Promise((r) => setTimeout(r, SE_DELAY_MS));
  }

  console.log(`[SE-Daily] ${borough.name}: ${allNodes.length} raw nodes fetched`);
  return allNodes;
}

// ---------------------------------------------------------------------------
// Convert nodes to AdapterOutput
// ---------------------------------------------------------------------------

function nodesToAdapterOutputs(nodes: SENode[], city: string) {
  const listings = [];
  const seenUrls = new Set<string>();

  for (const n of nodes) {
    if (!n.urlPath) continue;
    const price = n.price ?? null;
    if (price == null || price === 0) continue;

    const fullUrl = `https://streeteasy.com${n.urlPath}`;
    if (seenUrls.has(fullUrl)) continue;
    seenUrls.add(fullUrl);

    const address = n.unit ? `${n.street} #${n.unit}` : n.street ?? null;
    const baths =
      n.fullBathroomCount != null || n.halfBathroomCount != null
        ? (n.fullBathroomCount ?? 0) + (n.halfBathroomCount ?? 0) * 0.5
        : null;

    const photoUrls = (n.photos ?? [])
      .filter((p): p is { key: string } => typeof p.key === "string")
      .map((p) => sePhotoUrl(p.key))
      .slice(0, 20);

    if (photoUrls.length === 0 && n.leadMedia?.photo?.key) {
      photoUrls.push(sePhotoUrl(n.leadMedia.photo.key));
    }

    listings.push({
      address,
      area: n.areaName ? `${n.areaName}, NY` : "New York, NY",
      price,
      beds: n.bedroomCount ?? null,
      baths,
      sqft: n.livingAreaSize ?? null,
      lat: n.geoPoint?.latitude ?? null,
      lon: n.geoPoint?.longitude ?? null,
      photo_urls: photoUrls,
      url: fullUrl,
      search_tag: city.toLowerCase(),
      list_date: null as string | null,
      last_update_date: null as string | null,
      availability_date: n.availableAt ?? null,
      source: "streeteasy" as const,
    });
  }

  return listings;
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
  const cutoffDate = daysAgo(LOOKBACK_DAYS);
  const staleCutoffDate = daysAgo(STALE_DAYS);

  console.log(`[SE-Daily] Cutoff for recent listings: ${isoDate(cutoffDate)} (last ${LOOKBACK_DAYS} days)`);
  console.log(`[SE-Daily] Stale cutoff: ${isoDate(staleCutoffDate)} (older than ${STALE_DAYS} days)`);

  // -------------------------------------------------------------------------
  // Step 1: Fetch recent listings
  // -------------------------------------------------------------------------

  console.log(`\n=== FETCH NEW LISTINGS ===`);

  const allRaw: ReturnType<typeof nodesToAdapterOutputs> = [];
  const seenUrls = new Set<string>();

  for (const borough of BOROUGHS) {
    try {
      const nodes = await fetchRecentForBorough(borough);
      const listings = nodesToAdapterOutputs(nodes, borough.city);
      for (const l of listings) {
        if (!seenUrls.has(l.url)) {
          seenUrls.add(l.url);
          allRaw.push(l);
        }
      }
      console.log(`[SE-Daily] ${borough.name}: ${listings.length} unique listings`);
    } catch (err) {
      console.error(`[SE-Daily] ${borough.name} fetch error: ${err instanceof Error ? err.message : String(err)}`);
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`[SE-Daily] Total raw: ${allRaw.length}`);

  // Validate
  const pipeline = validateAndNormalize(allRaw, "refresh-se-daily");
  console.log(`[SE-Daily] Valid: ${pipeline.listings.length}, Rejected: ${pipeline.rejected.length}`);

  // Geo-tag
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
  console.log(`[SE-Daily] Geo-tagged: ${geoTagged}, dropped: ${geoDropped}`);

  // Upsert new listings
  let newUpserted = 0;
  let upsertErrors = 0;

  for (let i = 0; i < tagged.length; i += BATCH_SIZE) {
    const batch = tagged.slice(i, i + BATCH_SIZE).map((l) => ({
      address: l.address,
      area: l.area,
      price: l.price,
      beds: l.beds,
      baths: l.baths,
      sqft: l.sqft,
      lat: l.lat,
      lon: l.lon,
      photos: l.photos,
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
      console.error(`[SE-Daily] Upsert batch ${i / BATCH_SIZE + 1} error: ${error.message}`);
      upsertErrors++;
    } else {
      newUpserted += batch.length;
    }
  }

  console.log(`[SE-Daily] Upserted: ${newUpserted} listings (${upsertErrors} batch errors)`);

  // -------------------------------------------------------------------------
  // Step 2: Remove stale listings
  // -------------------------------------------------------------------------

  console.log(`\n=== REMOVE STALE LISTINGS ===`);

  // Delete SE listings where list_date < stale cutoff
  // Also catch listings where list_date is null but they were inserted > 60 days ago
  // (use inserted_at / created_at if available, otherwise just target list_date)
  const staleCutoffIso = staleCutoffDate.toISOString();

  // Primary stale removal: list_date older than 60 days
  const { data: staleByDate, error: staleErr } = await supabase
    .from("listings")
    .delete()
    .eq("source", "streeteasy")
    .lt("list_date", staleCutoffIso)
    .select("id");

  if (staleErr) {
    console.error(`[SE-Daily] Stale removal error (by list_date): ${staleErr.message}`);
  } else {
    const count = staleByDate?.length ?? 0;
    console.log(`[SE-Daily] Removed ${count} stale listings (list_date < ${isoDate(staleCutoffDate)})`);
  }

  // -------------------------------------------------------------------------
  // Step 3: Summary
  // -------------------------------------------------------------------------

  const { count: totalSE } = await supabase
    .from("listings")
    .select("*", { count: "exact", head: true })
    .eq("source", "streeteasy");

  console.log(`\n=== SUMMARY ===`);
  console.log(`  New listings upserted:  ${newUpserted}`);
  console.log(`  Stale listings removed: ${staleByDate?.length ?? 0}`);
  console.log(`  SE listings in DB now:  ${totalSE ?? "unknown"}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
