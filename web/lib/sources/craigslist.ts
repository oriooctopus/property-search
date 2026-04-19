/**
 * Craigslist NYC apartment scraper via Apify Puppeteer Scraper.
 *
 * Uses the generic apify/web-scraper actor with a custom pageFunction
 * to scrape both search result pages and individual listing pages.
 * The browser-based scraper is required because Craigslist NYC now renders
 * listings dynamically via JavaScript (gallery-card / cl-search-result elements
 * with [data-pid] attributes). A static HTML scraper only sees the fallback.
 * Automatically paginates through all search result pages.
 *
 * Incremental mode (when supabase client is provided):
 * 1. Phase 1 — Search-page scan (~$0.10): scrapes search result pages only,
 *    extracting listing URLs without visiting individual pages.
 * 2. DB check: queries Supabase for which URLs already exist.
 * 3. Bumps last_seen_at for existing URLs.
 * 4. Phase 2 — Detail scrape: only visits NEW listing pages for full data.
 * 5. Returns only new listings for the upsert pipeline.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdapterOutput, SearchParams } from "./types";
import { extractBaths, extractBeds, parsePrice } from "./parse-utils";

const APIFY_START_URL =
  "https://api.apify.com/v2/acts/apify~puppeteer-scraper/runs";

const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 3_600_000; // 60 min max (detail scrape for ~1000 URLs needs ~50 min)

// ---------------------------------------------------------------------------
// SEARCH_ONLY_PAGE_FUNCTION — only scrapes search result pages, extracts URLs
// ---------------------------------------------------------------------------

const SEARCH_ONLY_PAGE_FUNCTION = `
async function pageFunction(context) {
  const { page, request, log } = context;
  const url = request.url;

  // Only handle search result pages
  if (!url.includes('/search/') && !url.includes('search=')) {
    log.warning('Unexpected non-search URL: ' + url);
    return;
  }

  // Wait for JS-rendered results
  try {
    await page.waitForSelector('[data-pid], .gallery-card, .cl-search-result', { timeout: 15000 });
  } catch (e) {
    log.warning('No search results found on page: ' + url);
    return;
  }

  // CL paginates at ~200 results per page via a "next" button (cl-next-result).
  // Loop: extract links from current page, click next, repeat until no more pages.
  let pageNum = 1;
  let totalFound = 0;

  while (true) {
    // Scroll to load any lazy content
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(r => setTimeout(r, 1000));
    }

    // Extract listing links
    const links = await page.evaluate(() => {
      const found = [];
      document.querySelectorAll('[data-pid] a[href], .gallery-card a[href], .cl-search-result a[href]').forEach(a => {
        const href = a.getAttribute('href');
        if (href && /\\/\\d+\\.html/.test(href)) {
          found.push(href.startsWith('http') ? href : 'https://newyork.craigslist.org' + href);
        }
      });
      return [...new Set(found)];
    });

    log.info('Page ' + pageNum + ': found ' + links.length + ' listing URLs');
    if (links.length > 0) {
      // Push each URL as data (NOT enqueueLinks — we don't visit them)
      for (const link of links) {
        await context.pushData({ url: link });
      }
      totalFound += links.length;
    }

    // Check for next page button
    const nextBtn = await page.$('button.bd-button.cl-next-result');
    if (!nextBtn) {
      log.info('No more pages after page ' + pageNum + '. Total URLs found: ' + totalFound);
      break;
    }

    // Scroll into view and click via JS (Puppeteer's native click fails
    // when the button is off-screen or overlapped)
    await page.evaluate(el => { el.scrollIntoView(); el.click(); }, nextBtn);
    await new Promise(r => setTimeout(r, 3000));
    pageNum++;
  }
}
`;

// ---------------------------------------------------------------------------
// DETAIL_PAGE_FUNCTION — only handles individual listing pages
// ---------------------------------------------------------------------------

const DETAIL_PAGE_FUNCTION = `
async function pageFunction(context) {
  const { page, request, log } = context;
  const url = request.url;

  // Wait for content to load
  try {
    await page.waitForSelector('#postingbody, .posting-title, span#titletextonly', { timeout: 10000 });
  } catch (e) {
    log.warning('Listing page did not load expected content: ' + url);
  }

  const data = await page.evaluate(() => {
    // Try JSON-LD structured data
    let ld = null;
    document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
      try {
        const parsed = JSON.parse(el.textContent || '');
        if (parsed && (parsed['@type'] || parsed.name)) {
          ld = parsed;
        }
      } catch (e) { /* ignore */ }
    });

    const titleEl = document.querySelector('span#titletextonly, .postingtitletext');
    const titleTag = document.querySelector('title');
    const title = (ld && ld.name)
      || (titleEl ? titleEl.textContent.trim() : '')
      || (titleTag ? titleTag.textContent.split('|')[0].trim() : '');

    const priceEl = document.querySelector('span.price');
    const priceText = priceEl ? priceEl.textContent.trim() : '';

    // Location
    let locationStr = '';
    if (ld && ld.address) {
      if (typeof ld.address === 'string') {
        locationStr = ld.address;
      } else if (ld.address.streetAddress) {
        const parts = [ld.address.streetAddress, ld.address.addressLocality, ld.address.addressRegion].filter(Boolean);
        locationStr = parts.join(', ');
      }
    }
    if (!locationStr) {
      const smallEl = document.querySelector('small');
      const mapAddrEl = document.querySelector('div.mapaddress');
      locationStr = (smallEl ? smallEl.textContent.replace(/[()]/g, '').trim() : '')
        || (mapAddrEl ? mapAddrEl.textContent.trim() : '')
        || '';
    }

    // Lat/lng
    let lat = '';
    let lng = '';
    if (ld && ld.latitude) {
      lat = String(ld.latitude);
      lng = String(ld.longitude || '');
    } else if (ld && ld.geo) {
      lat = String(ld.geo.latitude || '');
      lng = String(ld.geo.longitude || '');
    }
    if (!lat) {
      const mapEl = document.querySelector('div#map');
      if (mapEl) {
        lat = mapEl.getAttribute('data-latitude') || '';
        lng = mapEl.getAttribute('data-longitude') || '';
      }
    }

    // Beds/baths from JSON-LD
    let ldBeds = '';
    let ldBaths = '';
    if (ld) {
      if (ld.numberOfBedrooms != null) ldBeds = String(ld.numberOfBedrooms);
      if (ld.numberOfBathroomsTotal != null) ldBaths = String(ld.numberOfBathroomsTotal);
    }

    // Photos
    const photos = [];
    document.querySelectorAll('a.thumb, div.gallery img, img[src*="images.craigslist"]').forEach(el => {
      const src = el.getAttribute('href') || el.getAttribute('src') || '';
      if (src && src.includes('craigslist')) {
        const fullSize = src.replace(/_\\d+x\\d+\\./, '_600x450.');
        photos.push(fullSize);
      }
    });

    // Post body
    const postBodyEl = document.querySelector('section#postingbody');
    const postBody = postBodyEl
      ? postBodyEl.textContent.trim().replace(/QR Code Link to This Post/gi, '').trim()
      : '';

    // Datetime
    const timeEl = document.querySelector('time.date.timeago, time.posting-info-date');
    const datetime = timeEl ? (timeEl.getAttribute('datetime') || '') : '';

    // Availability date
    const availEl = document.querySelector('span.housing_movein_now, span.availabilitytext');
    const availText = availEl ? availEl.textContent.trim() : '';
    const availMatch = availText.match(/available\\s+(\\S+)/i);
    const availableFrom = availMatch ? availMatch[1] : '';

    // Housing info
    const housingEl = document.querySelector('span.shared-line-bubble, span.housing');
    const housingSpan = housingEl ? housingEl.textContent : '';

    // Post ID from URL
    const idMatch = window.location.href.match(/(\\d+)\\.html/);
    const postId = idMatch ? idMatch[1] : '';

    return {
      url: window.location.href,
      title,
      price: priceText,
      location: locationStr,
      latitude: lat,
      longitude: lng,
      pics: photos,
      post: postBody,
      datetime,
      availableFrom,
      housing: housingSpan,
      ldBeds,
      ldBaths,
      id: postId,
    };
  });

  await context.pushData(data);
}
`;

// ---------------------------------------------------------------------------
// Apify dataset item shape (matches what DETAIL_PAGE_FUNCTION pushes)
// ---------------------------------------------------------------------------

interface ApifyCLItem {
  id?: string;
  url?: string;
  title?: string;
  datetime?: string;
  location?: string;
  price?: string;
  longitude?: string;
  latitude?: string;
  post?: string;
  pics?: string[];
  housing?: string;
  availableFrom?: string;
  ldBeds?: string;
  ldBaths?: string;
  [key: string]: unknown;
}

/** Shape returned by SEARCH_ONLY_PAGE_FUNCTION */
interface ApifySearchItem {
  url?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Apify helper functions
// ---------------------------------------------------------------------------

interface ApifyRunResult {
  runId: string;
  datasetId: string;
}

/** Starts an Apify puppeteer-scraper run, returns runId + datasetId. */
async function launchApifyRun(
  token: string,
  input: Record<string, unknown>,
): Promise<ApifyRunResult> {
  const startRes = await fetch(APIFY_START_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(30_000),
  });

  if (!startRes.ok) {
    const body = await startRes.text().catch(() => "");
    throw new Error(
      `Apify start failed (${startRes.status}): ${body.slice(0, 500)}`,
    );
  }

  const runInfo = (await startRes.json()) as {
    data?: { id?: string; defaultDatasetId?: string };
  };
  const runId = runInfo.data?.id;
  const datasetId = runInfo.data?.defaultDatasetId;
  if (!runId || !datasetId) {
    throw new Error(
      `Apify run missing id/datasetId: ${JSON.stringify(runInfo).slice(0, 300)}`,
    );
  }

  return { runId, datasetId };
}

/** Polls an Apify run until it reaches a terminal state or timeout. Returns the final status. */
async function pollApifyRun(
  token: string,
  runId: string,
  maxWaitMs: number,
): Promise<string> {
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    try {
      const statusRes = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!statusRes.ok) continue;

      const statusData = (await statusRes.json()) as {
        data?: { status?: string };
      };
      const status = statusData.data?.status;

      if (
        status === "SUCCEEDED" ||
        status === "FAILED" ||
        status === "ABORTED" ||
        status === "TIMED-OUT"
      ) {
        return status;
      }
    } catch {
      // Non-fatal — will retry on next poll
    }
  }

  return "TIMED-OUT";
}

/** Fetches all items from an Apify dataset. */
async function fetchDatasetItems<T>(
  token: string,
  datasetId: string,
): Promise<T[]> {
  const datasetRes = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?format=json`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!datasetRes.ok) return [];

  const data = await datasetRes.json();
  return Array.isArray(data) ? (data as T[]) : [];
}

// ---------------------------------------------------------------------------
// Main fetch function
// ---------------------------------------------------------------------------

export async function fetchCraigslistListings(
  params: SearchParams,
  opts?: { supabase?: SupabaseClient },
): Promise<{ listings: AdapterOutput[]; total: number }> {
  const { bedsMin, priceMax, priceMin } = params;

  const token = process.env.APIFY_TOKEN;
  if (!token) {
    throw new Error("APIFY_TOKEN not set — cannot query Craigslist via Apify");
  }

  const CL_BOROUGHS = ["brk", "mnh", "que", "brx", "stn"];
  const queryParams = new URLSearchParams();
  if (priceMin != null) queryParams.set("min_price", String(priceMin));
  if (priceMax != null) queryParams.set("max_price", String(priceMax));
  if (bedsMin != null) queryParams.set("min_bedrooms", String(bedsMin));
  queryParams.set("availabilityMode", "0");

  const qs = queryParams.toString();
  const supabase = opts?.supabase;

  // =========================================================================
  // Phase 1 — Search-page scan (discover listing URLs without visiting them)
  // =========================================================================
  console.log(
    `[Craigslist] Phase 1: search-page scan across ${CL_BOROUGHS.length} boroughs`,
  );

  const searchRuns: Array<{
    borough: string;
    runId: string;
    datasetId: string;
  }> = [];

  // Launch one search-only Apify run per borough in parallel
  await Promise.all(
    CL_BOROUGHS.map(async (borough) => {
      const startUrl = `https://newyork.craigslist.org/search/${borough}/apa?${qs}`;
      const input = {
        startUrls: [{ url: startUrl }],
        pageFunction: SEARCH_ONLY_PAGE_FUNCTION,
        proxyConfiguration: { useApifyProxy: true },
        maxRequestsPerCrawl: 50,
        maxConcurrency: 3,
        waitUntil: ["networkidle2"],
      };

      const { runId, datasetId } = await launchApifyRun(token, input);
      console.log(
        `[Craigslist] Phase 1 — borough ${borough}: run started (${runId})`,
      );
      searchRuns.push({ borough, runId, datasetId });
    }),
  );

  // Poll all search runs until complete
  const searchRunStatuses = await Promise.all(
    searchRuns.map(async (run) => {
      const status = await pollApifyRun(token, run.runId, MAX_WAIT_MS);
      console.log(
        `[Craigslist] Phase 1 — borough ${run.borough}: ${status}`,
      );
      return { ...run, status };
    }),
  );

  // Collect all discovered URLs from search datasets
  const allDiscoveredUrls: string[] = [];
  await Promise.all(
    searchRunStatuses
      .filter((r) => r.status === "SUCCEEDED")
      .map(async (run) => {
        const items = await fetchDatasetItems<ApifySearchItem>(
          token,
          run.datasetId,
        );
        const urls = items
          .map((item) => item.url)
          .filter((u): u is string => !!u);
        console.log(
          `[Craigslist] Phase 1 — borough ${run.borough}: ${urls.length} URLs discovered`,
        );
        allDiscoveredUrls.push(...urls);
      }),
  );

  // Deduplicate URLs across boroughs
  const uniqueUrls = [...new Set(allDiscoveredUrls)];
  console.log(
    `[Craigslist] Phase 1 complete: ${uniqueUrls.length} unique URLs discovered (${allDiscoveredUrls.length} total before dedup)`,
  );

  // Warn about boroughs that failed
  const failedBoroughs = searchRunStatuses.filter(
    (r) => r.status !== "SUCCEEDED",
  );
  if (failedBoroughs.length > 0) {
    console.warn(
      `[Craigslist] Phase 1: ${failedBoroughs.length} borough(s) failed: ${failedBoroughs.map((r) => `${r.borough} (${r.status})`).join(", ")}`,
    );
  }

  if (uniqueUrls.length === 0) {
    console.log("[Craigslist] No URLs discovered — nothing to do");
    return { listings: [], total: 0 };
  }

  // =========================================================================
  // DB check — filter to only new URLs (if supabase is available)
  // =========================================================================
  let urlsToFetch: string[];

  if (supabase) {
    console.log(
      `[Craigslist] Checking DB for existing URLs (${uniqueUrls.length} to check)`,
    );

    // Query existing URLs in batches of 100 (CL URLs are long and
    // 500 exceeds PostgREST's URL length limit for .in() queries)
    const BATCH_SIZE = 100;
    const existingUrls = new Set<string>();

    for (let i = 0; i < uniqueUrls.length; i += BATCH_SIZE) {
      const chunk = uniqueUrls.slice(i, i + BATCH_SIZE);
      const { data, error } = await supabase
        .from("listings")
        .select("url")
        .eq("source", "craigslist")
        .in("url", chunk);

      if (error) {
        console.warn(
          `[Craigslist] DB query error (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${error.message}`,
        );
        continue;
      }
      if (data) {
        for (const row of data) {
          existingUrls.add(row.url);
        }
      }
    }

    // Bump last_seen_at for existing URLs
    if (existingUrls.size > 0) {
      console.log(
        `[Craigslist] Bumping last_seen_at for ${existingUrls.size} existing listings`,
      );
      const existingUrlArray = [...existingUrls];
      for (let i = 0; i < existingUrlArray.length; i += BATCH_SIZE) {
        const chunk = existingUrlArray.slice(i, i + BATCH_SIZE);
        const { error } = await supabase
          .from("listings")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("source", "craigslist")
          .in("url", chunk);

        if (error) {
          console.warn(
            `[Craigslist] last_seen_at bump error (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${error.message}`,
          );
        }
      }
    }

    // Filter to only new URLs
    urlsToFetch = uniqueUrls.filter((u) => !existingUrls.has(u));
    console.log(
      `[Craigslist] Found ${uniqueUrls.length} total URLs, ${existingUrls.size} already in DB, ${urlsToFetch.length} new to fetch`,
    );
  } else {
    // No supabase — fetch all discovered URLs (standalone mode)
    urlsToFetch = uniqueUrls;
    console.log(
      `[Craigslist] No supabase client — fetching all ${urlsToFetch.length} URLs`,
    );
  }

  // =========================================================================
  // Phase 2 — Detail scrape (only new listing pages)
  // =========================================================================
  if (urlsToFetch.length === 0) {
    console.log(
      "[Craigslist] Phase 2: no new listings to fetch — all existing listings had last_seen_at bumped",
    );
    return { listings: [], total: 0 };
  }

  console.log(
    `[Craigslist] Phase 2: fetching ${urlsToFetch.length} new listing details`,
  );

  const detailInput = {
    startUrls: urlsToFetch.map((url) => ({ url })),
    pageFunction: DETAIL_PAGE_FUNCTION,
    proxyConfiguration: { useApifyProxy: true },
    maxRequestsPerCrawl: urlsToFetch.length + 100,
    maxConcurrency: 10,
    waitUntil: ["networkidle2"],
  };

  const { runId: detailRunId, datasetId: detailDatasetId } =
    await launchApifyRun(token, detailInput);
  console.log(
    `[Craigslist] Phase 2: detail run started (${detailRunId}) for ${urlsToFetch.length} URLs`,
  );

  const detailStatus = await pollApifyRun(token, detailRunId, MAX_WAIT_MS);
  console.log(`[Craigslist] Phase 2: detail run ${detailStatus}`);

  if (detailStatus !== "SUCCEEDED") {
    console.error(
      `[Craigslist] Phase 2: detail run ${detailStatus} — returning empty`,
    );
    return { listings: [], total: 0 };
  }

  const items = await fetchDatasetItems<ApifyCLItem>(token, detailDatasetId);
  console.log(
    `[Craigslist] Phase 2: ${items.length} detail items retrieved`,
  );

  // =========================================================================
  // Map detail items to AdapterOutput[]
  // =========================================================================
  const listings: AdapterOutput[] = [];

  for (const item of items) {
    if (!item.url || !item.title) continue;

    const price = parsePrice(item.price);
    if (price == null || price === 0) continue;

    // Prefer JSON-LD beds/baths, fall back to text extraction
    const ldBedsNum = item.ldBeds ? parseFloat(item.ldBeds) : NaN;
    const ldBathsNum = item.ldBaths ? parseFloat(item.ldBaths) : NaN;
    const combinedText = `${item.title} ${item.housing ?? ""} ${item.post ?? ""}`;
    const beds = !isNaN(ldBedsNum) ? ldBedsNum : extractBeds(combinedText);
    const baths = !isNaN(ldBathsNum) ? ldBathsNum : extractBaths(combinedText);

    const lat = item.latitude ? parseFloat(item.latitude) : null;
    const lon = item.longitude ? parseFloat(item.longitude) : null;

    listings.push({
      address: item.location || item.title,
      area: item.location || "New York, NY",
      price,
      beds,
      baths,
      sqft: null,
      lat: lat && !isNaN(lat) ? lat : null,
      lon: lon && !isNaN(lon) ? lon : null,
      photo_urls: (item.pics ?? []).slice(0, 8).map((url: string) => url.replace(/_\d+x\d+\./, '_600x450.')),
      url: item.url,
      list_date: item.datetime ?? null,
      last_update_date: null,
      availability_date: item.availableFrom ?? null,
      source: "craigslist" as const,
      external_id: item.id ?? null,
    });
  }

  console.log(
    `[Craigslist] Done: ${listings.length} new listings ready for pipeline`,
  );

  return { listings, total: listings.length };
}
