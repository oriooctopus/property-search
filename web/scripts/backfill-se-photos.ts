/**
 * Backfill StreetEasy listing photos by scraping actual photo URLs from listing pages.
 *
 * StreetEasy serves photos from photos.zillowstatic.com (publicly accessible).
 * Uses apify/web-scraper with residential proxies to render the pages.
 *
 * Usage: npx tsx scripts/backfill-se-photos.ts
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

const APIFY_TOKEN = process.env.APIFY_TOKEN!;
if (!APIFY_TOKEN) {
  console.error("APIFY_TOKEN not set");
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const APIFY_START_URL = "https://api.apify.com/v2/acts/apify~web-scraper/runs";
const POLL_INTERVAL_MS = 10_000;
const MAX_WAIT_MS = 300_000; // 5 min per batch
const BATCH_SIZE = 50;
const MAX_PHOTOS_PER_LISTING = 20;

// The pageFunction that runs inside the Apify browser context
const PAGE_FUNCTION = `
async function pageFunction(context) {
  const { page, request } = context;
  await page.waitForTimeout(3000);
  const photos = await page.evaluate(() => {
    const urls = new Set();
    document.querySelectorAll('img').forEach(img => {
      const src = img.src || img.dataset.src || '';
      if (src.includes('zillowstatic.com') || src.includes('streeteasy')) {
        urls.add(src);
      }
    });
    // Also check picture source elements
    document.querySelectorAll('source').forEach(s => {
      const srcset = s.srcset || '';
      srcset.split(',').forEach(part => {
        const url = part.trim().split(' ')[0];
        if (url.includes('zillowstatic.com')) urls.add(url);
      });
    });
    return [...urls];
  });
  return { url: request.url, photos };
}
`;

interface ScraperResult {
  url?: string;
  photos?: string[];
}

// ---------------------------------------------------------------------------
// Fetch all SE listings with no photos (paginated)
// ---------------------------------------------------------------------------
async function fetchListingsWithoutPhotos(): Promise<Array<{ id: string; url: string }>> {
  const results: Array<{ id: string; url: string }> = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("listings")
      .select("id, url")
      .eq("source", "streeteasy")
      .or("photo_urls.is.null,photo_urls.eq.{}") // NULL or empty array
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error(`Fetch error at offset ${offset}:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;
    results.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return results;
}

// ---------------------------------------------------------------------------
// Run Apify web-scraper for a batch of URLs
// ---------------------------------------------------------------------------
async function runApifyBatch(urls: string[]): Promise<ScraperResult[]> {
  const input = {
    startUrls: urls.map((url) => ({ url })),
    pageFunction: PAGE_FUNCTION,
    proxyConfiguration: {
      useApifyProxy: true,
      apifyProxyGroups: ["RESIDENTIAL"],
    },
    maxRequestsPerCrawl: BATCH_SIZE,
  };

  // Start actor run
  const startRes = await fetch(APIFY_START_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${APIFY_TOKEN}`,
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(30_000),
  });

  if (!startRes.ok) {
    const body = await startRes.text().catch(() => "");
    throw new Error(`Apify start failed ${startRes.status}: ${body.slice(0, 500)}`);
  }

  const runInfo = (await startRes.json()) as { data?: { id?: string; defaultDatasetId?: string } };
  const runId = runInfo.data?.id;
  const datasetId = runInfo.data?.defaultDatasetId;
  if (!runId || !datasetId) {
    throw new Error(`Apify run missing id/datasetId: ${JSON.stringify(runInfo).slice(0, 300)}`);
  }
  console.log(`  Run started: ${runId}, dataset: ${datasetId}`);

  // Poll for completion
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, {
      headers: { Authorization: `Bearer ${APIFY_TOKEN}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!statusRes.ok) continue;
    const statusData = (await statusRes.json()) as { data?: { status?: string } };
    const status = statusData.data?.status;
    console.log(`  Run status: ${status}`);
    if (status === "SUCCEEDED") break;
    if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
      throw new Error(`Apify run ${status}`);
    }
  }

  // Fetch dataset items
  const datasetRes = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?format=json`,
    {
      headers: { Authorization: `Bearer ${APIFY_TOKEN}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!datasetRes.ok) {
    throw new Error(`Apify dataset fetch failed: ${datasetRes.status}`);
  }

  const data = await datasetRes.json();
  if (!Array.isArray(data)) {
    throw new Error(`Unexpected Apify response: ${typeof data}`);
  }

  return data as ScraperResult[];
}

// ---------------------------------------------------------------------------
// Normalize and filter photo URLs
// ---------------------------------------------------------------------------
function normalizePhotos(raw: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const url of raw) {
    if (!url || typeof url !== "string") continue;

    // Prefer se_large_800_400 size if available, otherwise keep as-is
    let normalized = url;
    // Strip query params and size suffixes to deduplicate
    const base = url.split("?")[0];
    if (seen.has(base)) continue;
    seen.add(base);

    // Prefer larger image variants
    if (base.includes("zillowstatic.com")) {
      // Try to get the largest version by replacing size tokens
      normalized = base
        .replace(/\/p_[a-z]\//g, "/p_f/") // full size
        .replace(/\d+x\d+/, "800x400"); // prefer 800x400
    }

    result.push(normalized);
    if (result.length >= MAX_PHOTOS_PER_LISTING) break;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("=== StreetEasy Photo Backfill ===\n");

  // 1. Fetch listings without photos
  console.log("Fetching SE listings without photos...");
  const listings = await fetchListingsWithoutPhotos();
  console.log(`Found ${listings.length} SE listings without photos\n`);

  if (listings.length === 0) {
    console.log("Nothing to backfill!");
    return;
  }

  // Build URL → ID map
  const urlToId = new Map<string, string>();
  for (const l of listings) {
    urlToId.set(l.url, l.id);
  }

  // 2. Process in batches
  const urls = listings.map((l) => l.url);
  let totalUpdated = 0;
  let totalFailed = 0;
  let totalNoPhotos = 0;

  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(urls.length / BATCH_SIZE);
    console.log(`\n--- Batch ${batchNum}/${totalBatches} (${batch.length} URLs) ---`);

    try {
      const results = await runApifyBatch(batch);
      console.log(`  Got ${results.length} results from Apify`);

      for (const result of results) {
        if (!result.url || !result.photos || result.photos.length === 0) {
          totalNoPhotos++;
          continue;
        }

        const photos = normalizePhotos(result.photos);
        if (photos.length === 0) {
          totalNoPhotos++;
          continue;
        }

        const id = urlToId.get(result.url);
        if (!id) {
          // URL might have been redirected — try matching by path
          const matchingUrl = [...urlToId.keys()].find(
            (u) => result.url!.includes(u.replace("https://streeteasy.com", ""))
          );
          if (!matchingUrl) {
            console.log(`  No matching listing for URL: ${result.url}`);
            totalFailed++;
            continue;
          }
        }

        const { error } = await supabase
          .from("listings")
          .update({
            photo_urls: photos,
            photos: photos.length,
          })
          .eq("url", result.url);

        if (error) {
          console.error(`  Update error for ${result.url}: ${error.message}`);
          totalFailed++;
        } else {
          totalUpdated++;
        }
      }

      // Brief pause between batches
      if (i + BATCH_SIZE < urls.length) {
        console.log("  Waiting 5s before next batch...");
        await new Promise((r) => setTimeout(r, 5000));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Batch ${batchNum} error: ${msg}`);
      totalFailed += batch.length;
    }
  }

  // 3. Final stats
  console.log("\n=== RESULTS ===");
  console.log(`  Total SE listings without photos: ${listings.length}`);
  console.log(`  Updated with photos: ${totalUpdated}`);
  console.log(`  No photos found:    ${totalNoPhotos}`);
  console.log(`  Failed:             ${totalFailed}`);

  // Final DB count of SE listings with photos
  const { count } = await supabase
    .from("listings")
    .select("*", { count: "exact", head: true })
    .eq("source", "streeteasy")
    .not("photo_urls", "is", null)
    .gt("photos", 0);
  console.log(`  SE listings with photos in DB: ${count}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
