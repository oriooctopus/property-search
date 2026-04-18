/**
 * Craigslist NYC apartment scraper via Apify Puppeteer Scraper.
 *
 * Uses the generic apify/web-scraper actor with a custom pageFunction
 * to scrape both search result pages and individual listing pages.
 * The browser-based scraper is required because Craigslist NYC now renders
 * listings dynamically via JavaScript (gallery-card / cl-search-result elements
 * with [data-pid] attributes). A static HTML scraper only sees the fallback.
 * Automatically paginates through all search result pages.
 * Cost is based on compute time (~$0.10-0.20/run) instead of per-result.
 */

import type { AdapterOutput, SearchParams } from "./types";
import { extractBaths, extractBeds, parsePrice } from "./parse-utils";

const APIFY_START_URL =
  "https://api.apify.com/v2/acts/apify~puppeteer-scraper/runs";

const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 1_800_000; // 30 min max (each borough runs independently)

// ---------------------------------------------------------------------------
// pageFunction — runs inside the Puppeteer Scraper (Node.js context with page object)
// ---------------------------------------------------------------------------

const PAGE_FUNCTION = `
async function pageFunction(context) {
  const { page, request, enqueueLinks, log } = context;
  const url = request.url;

  // --- Search results page ---
  if (url.includes('/search/') || url.includes('search=')) {
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
    let totalEnqueued = 0;

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

      log.info('Page ' + pageNum + ': found ' + links.length + ' listing links');
      if (links.length > 0) {
        await enqueueLinks({ urls: links, userData: { isListing: true } });
        totalEnqueued += links.length;
      }

      // Check for next page button
      const nextBtn = await page.$('button.bd-button.cl-next-result');
      if (!nextBtn) {
        log.info('No more pages after page ' + pageNum + '. Total enqueued: ' + totalEnqueued);
        break;
      }

      // Click next and wait for new results to load
      await nextBtn.click();
      await new Promise(r => setTimeout(r, 3000));
      pageNum++;
    }

    return; // Don't push data for search pages
  }

  // --- Individual listing page ---

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
// Apify dataset item shape (matches what pageFunction pushes)
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

// ---------------------------------------------------------------------------
// Main fetch function
// ---------------------------------------------------------------------------

export async function fetchCraigslistListings(
  params: SearchParams,
): Promise<{ listings: AdapterOutput[]; total: number }> {
  const { bedsMin, priceMax, priceMin } = params;

  const token = process.env.APIFY_TOKEN;
  if (!token) {
    throw new Error("APIFY_TOKEN not set — cannot query Craigslist via Apify");
  }

  // Launch each borough as a SEPARATE Apify run in parallel. This avoids the
  // single-run timeout problem: one run with 5 boroughs means 3000+ pages,
  // which exceeds the polling timeout. Parallel runs each handle ~600 listings.
  const CL_BOROUGHS = ["brk", "mnh", "que", "brx", "stn"];
  const queryParams = new URLSearchParams();
  if (priceMin != null) queryParams.set("min_price", String(priceMin));
  if (priceMax != null) queryParams.set("max_price", String(priceMax));
  if (bedsMin != null) queryParams.set("min_bedrooms", String(bedsMin));
  queryParams.set("availabilityMode", "0");

  const qs = queryParams.toString();
  console.log(`[Craigslist] Launching ${CL_BOROUGHS.length} parallel borough runs`);

  // 1. Start one Apify run per borough in parallel
  interface BoroughRun {
    borough: string;
    runId: string;
    datasetId: string;
    done: boolean;
    items: ApifyCLItem[];
  }

  const boroughRuns: BoroughRun[] = [];

  await Promise.all(
    CL_BOROUGHS.map(async (borough) => {
      const startUrl = `https://newyork.craigslist.org/search/${borough}/apa?${qs}`;
      const input = {
        startUrls: [{ url: startUrl }],
        pageFunction: PAGE_FUNCTION,
        proxyConfiguration: { useApifyProxy: true },
        maxRequestsPerCrawl: 1500,
        maxConcurrency: 5,
        waitUntil: ["networkidle2"],
      };

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
          `Apify start failed for borough ${borough} (${startRes.status}): ${body.slice(0, 500)}`,
        );
      }

      const runInfo = (await startRes.json()) as {
        data?: { id?: string; defaultDatasetId?: string };
      };
      const runId = runInfo.data?.id;
      const datasetId = runInfo.data?.defaultDatasetId;
      if (!runId || !datasetId) {
        throw new Error(
          `Apify run missing id/datasetId for borough ${borough}: ${JSON.stringify(runInfo).slice(0, 300)}`,
        );
      }

      console.log(`[Craigslist] Borough ${borough}: run started (${runId})`);
      boroughRuns.push({ borough, runId, datasetId, done: false, items: [] });
    }),
  );

  // 2. Poll all runs in a single loop until all complete or timeout
  const deadline = Date.now() + MAX_WAIT_MS;

  while (Date.now() < deadline) {
    const pending = boroughRuns.filter((r) => !r.done);
    if (pending.length === 0) break;

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    await Promise.all(
      pending.map(async (run) => {
        try {
          const statusRes = await fetch(
            `https://api.apify.com/v2/actor-runs/${run.runId}`,
            {
              headers: { Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (!statusRes.ok) return;

          const statusData = (await statusRes.json()) as {
            data?: { status?: string };
          };
          const status = statusData.data?.status;

          if (status === "SUCCEEDED") {
            // Fetch dataset items immediately
            const datasetRes = await fetch(
              `https://api.apify.com/v2/datasets/${run.datasetId}/items?format=json`,
              {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(30_000),
              },
            );
            if (datasetRes.ok) {
              const data = await datasetRes.json();
              if (Array.isArray(data)) {
                run.items = data as ApifyCLItem[];
              }
            }
            run.done = true;
            console.log(
              `[Craigslist] Borough ${run.borough}: completed, ${run.items.length} items`,
            );
          } else if (
            status === "FAILED" ||
            status === "ABORTED" ||
            status === "TIMED-OUT"
          ) {
            console.error(
              `[Craigslist] Borough ${run.borough}: run ${status}`,
            );
            run.done = true; // Mark done so we don't block other boroughs
          }
        } catch (err) {
          // Non-fatal — will retry on next poll
          console.warn(
            `[Craigslist] Borough ${run.borough}: poll error — ${err}`,
          );
        }
      }),
    );

    // Log overall progress
    const doneCount = boroughRuns.filter((r) => r.done).length;
    console.log(
      `[Craigslist] Progress: ${doneCount}/${boroughRuns.length} boroughs complete`,
    );
  }

  // Warn about any boroughs that didn't finish in time
  const timedOut = boroughRuns.filter((r) => !r.done);
  if (timedOut.length > 0) {
    console.warn(
      `[Craigslist] ${timedOut.length} borough(s) timed out: ${timedOut.map((r) => r.borough).join(", ")}`,
    );
  }

  // 3. Merge items from all borough runs
  const items: ApifyCLItem[] = boroughRuns.flatMap((r) => r.items);
  console.log(
    `[Craigslist] Total raw items from all boroughs: ${items.length}`,
  );

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
      photo_urls: (item.pics ?? []).slice(0, 8),
      url: item.url,
      list_date: item.datetime ?? null,
      last_update_date: null,
      availability_date: item.availableFrom ?? null,
      source: "craigslist" as const,
      external_id: item.id ?? null,
    });
  }

  return { listings, total: listings.length };
}
