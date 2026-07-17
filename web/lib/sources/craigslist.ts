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

export const SEARCH_ONLY_PAGE_FUNCTION = `
async function pageFunction(context) {
  const { page, request, log } = context;
  const url = request.url;

  // Markers that distinguish a Craigslist bot-block/CAPTCHA interstitial from a
  // normal (possibly zero-result) search page. "automatically blocked" is CL's
  // documented rate-limit message, reported verbatim by multiple scraping
  // guides (e.g. https://marsproxies.com/blog/craigslist-ip-block-guide/ and
  // https://proxywing.com/blog/craigslist-ip-blocked-causes-fixes-and-ban-prevention-guide).
  // "captcha"/"recaptcha" cover CL's documented reCAPTCHA challenge
  // (https://www.craigslist.org/about/help/captcha). "robot"/"denied" cover the
  // generic anti-bot interstitial copy scrapers commonly report. Kept as one
  // const so both the detection check and any future log/debug code share the
  // same list.
  const CL_BLOCK_MARKERS = [
    'automatically blocked',
    'access denied',
    'blocked',
    'denied',
    'are you a robot',
    'verify you are human',
    'captcha',
    'recaptcha',
  ];

  // Only handle search result pages
  if (!url.includes('/search/') && !url.includes('search=')) {
    log.warning('Unexpected non-search URL: ' + url);
    return;
  }

  // Wait for results. CL serves a static, server-rendered result list
  // (li.cl-static-search-result, with plain a[href] children) BEFORE any
  // client JS runs — this is CL's no-JS fallback markup, well documented and
  // widely used by scrapers, and unlike the JS gallery it paginates honestly
  // via the ?s=<offset> param. The JS-gallery selectors are kept here only so
  // bot-block/zero-result detection below still fires on either DOM variant.
  try {
    await page.waitForSelector(
      'li.cl-static-search-result, .cl-static-search-result, [data-pid], .gallery-card, .cl-search-result',
      { timeout: 15000 },
    );
  } catch (e) {
    // Results never appeared. Previously this silently returned, which made
    // a bot-blocked run indistinguishable from a genuine zero-results page
    // on the Node side (both looked like a SUCCEEDED run with 0 items).
    // Inspect the page and push the distinction into the dataset instead.
    const title = await page.title().catch(() => '');
    const bodyText = await page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
    const combined = (title + ' ' + bodyText).slice(0, 3000).toLowerCase();
    const isBlocked = CL_BLOCK_MARKERS.some(marker => combined.includes(marker));

    if (isBlocked) {
      log.error('BOT BLOCK DETECTED on search page: ' + url + ' — title: "' + title + '"');
      return {
        blocked: true,
        url,
        blockTitle: title,
        blockSnippet: bodyText.slice(0, 300),
      };
    }

    // Not a block page. Check whether CL still rendered the normal search
    // shell (a genuine zero-results page) vs. something unrecognized that
    // isn't a block but also isn't a normal shell (e.g. a layout change).
    const hasSearchShell = await page.evaluate(() => !!document.querySelector('#searchform, .filter-column, .cl-app-anchor')).catch(() => false);
    log.warning('No search results found on page (hasSearchShell=' + hasSearchShell + '): ' + url);
    return { zeroResults: true, hasSearchShell, url, title };
  }

  // CL has REDESIGNED (diagnosed live via a throwaway Apify pageFunction dump,
  // runs V1InMG2MqlxXNy4oC / oybP1S0NbQVjPSejk / VlB0GniPstruC3TdV):
  //   - Search URLs now redirect newyork.craigslist.org/search/<brc>/apa to
  //     www.craigslist.org/search/subarea/<brc>?cat=apa (Puppeteer follows the
  //     redirect transparently; fetchCraigslistListings below now constructs
  //     the canonical form directly instead of relying on the hop).
  //   - Listing URLs are now https://www.craigslist.org/view/d/<slug>/<token>
  //     — no .html suffix, no numeric id anywhere (confirmed: no data-pid on
  //     the search card OR the detail page, no id in the detail page's
  //     JSON-LD, og:url/canonical both equal the same opaque /view/d/ url).
  //   - CL now serves ONE OF TWO DOM variants PER REQUEST, observed to differ
  //     between concurrent identical requests: (a) a static server-rendered
  //     list — li.cl-static-search-result > a[href], one per listing, present
  //     before any client JS runs; (b) a client-rendered "gallery" variant
  //     reached via a #search=<id>~gallery~<n> hash route, whose real markup
  //     we have NOT captured — a diagnostic run found 0 elements matching the
  //     old [data-pid]/.gallery-card/.cl-search-result selectors there, i.e.
  //     those selectors are stale AND unverified against the redesign. Rather
  //     than guess at unverified gallery markup, we reload (up to 3x) to try
  //     to land on the static variant, and fail loudly if we can't.
  //   - The old ?s=<offset> pagination param is now DEAD: appending s=120
  //     after the redirect produced the byte-identical page-1 result set
  //     (confirmed via a direct diagnostic request), and 6 rounds of
  //     scroll-to-bottom over ~12s did not grow the static list past its
  //     initial count either (no infinite scroll). No <link rel="next"> or
  //     next/prev control was found in either variant (the only "next"-ish
  //     control found was an unrelated "next day" date-filter button). No
  //     working pagination mechanism was found within the diagnostic budget —
  //     rather than invent one, this scrapes the single static result set
  //     per request and logs its true size; lib/ingest/strategies.ts's
  //     CL_DISCOVERY_FLOOR alert will correctly flag under-discovery for
  //     follow-up investigation instead of us papering over the gap here.
  // CL's internal search API (sapi.craigslist.org) returns the ENTIRE result
  // set for a query in one response — confirmed live: 2,748 items for a
  // 2-4BR Brooklyn search, items.length === totalResultCount, no pagination
  // needed at all. It 403s when called directly (no browser context), so it
  // must be fetch()ed from inside the page via page.evaluate — which is safe
  // to do here since we're already on a craigslist.org origin.
  //
  // Item tuple shape: [postingId, secondaryId, hasPic, price,
  // "beds:baths~lat~lng", token, [featureIds]]. The 6-char sapi token does
  // NOT match the 22-char /view/d/ URL token — there is no shared key between
  // an sapi item and a scraped static-page URL. A live Apify test (2 real
  // postingIds x 3 URL-pattern candidates: /brk/apa/d/x/<id>.html,
  // /apa/<id>.html, /brk/apa/<id>.html) confirmed ALL 404 — postingId does
  // NOT resolve to a working detail URL post-redesign. So sapi CANNOT replace
  // the static-page scrape as the URL/detail-fetch source; it is used here
  // purely as a completeness signal: totalResultCount for discovery-floor
  // alerting (lib/ingest/strategies.ts), and an in-region count (bbox mirrors
  // lib/sources/pipeline.ts's REGION_LAT_MIN/MAX/LON_MIN/MAX) logged as a
  // diagnostic gap indicator. It does NOT reduce Phase 2 detail-fetch volume
  // (no key to join sapi items to scraped URLs) — the precise in-region gate
  // still runs in normalize, unchanged.
  function buildSapiUrl(searchUrl) {
    const u = new URL(searchUrl);
    const boroughMatch = u.pathname.match(/\\/search\\/subarea\\/([a-z]+)/);
    const borough = boroughMatch ? boroughMatch[1] : 'brk';
    const params = new URLSearchParams();
    params.set('cat', 'apa');
    params.set('searchPath', 'subarea/' + borough);
    params.set('lang', 'en');
    params.set('cc', 'us');
    ['min_price', 'max_price', 'min_bedrooms', 'max_bedrooms'].forEach(k => {
      const v = u.searchParams.get(k);
      if (v != null) params.set(k, v);
    });
    params.set('batch', '0-' + Date.now() + '-0-1-0');
    return 'https://sapi.craigslist.org/web/v8/postings/search/full?' + params.toString();
  }

  const sapiUrl = buildSapiUrl(url);
  const sapiRaw = await page.evaluate(async (u) => {
    try {
      const res = await fetch(u, { headers: { Accept: 'application/json' } });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (e) { /* not json */ }
      return { status: res.status, json, textSnippet: text.slice(0, 300) };
    } catch (e) {
      return { error: e.message };
    }
  }, sapiUrl);

  let sapiTotalResultCount = null;
  let sapiInRegionCount = null;
  let sapiBlocked = false;

  if (sapiRaw.error || sapiRaw.status !== 200 || !sapiRaw.json) {
    sapiBlocked = true;
    log.error('SAPI call failed/blocked: status=' + sapiRaw.status + ' error=' + sapiRaw.error + ' snippet=' + (sapiRaw.textSnippet || '') + ' url=' + sapiUrl);
  } else {
    const sapiItems = (sapiRaw.json.data && sapiRaw.json.data.items) || [];
    const total = (sapiRaw.json.data && sapiRaw.json.data.totalResultCount != null) ? sapiRaw.json.data.totalResultCount : null;
    sapiTotalResultCount = total;
    if (total != null && total > 0 && sapiItems.length === 0) {
      sapiBlocked = true;
      log.error('SAPI returned totalResultCount=' + total + ' but 0 items — treating as blocked: ' + sapiUrl);
    } else {
      // In-region diagnostic count. Bbox mirrors lib/sources/pipeline.ts
      // REGION_LAT_MIN/MAX/LON_MIN/MAX — kept as literals here since this
      // pageFunction string can't import from the app's TS modules.
      const REGION_LAT_MIN = 40.655;
      const REGION_LAT_MAX = 40.74;
      const REGION_LON_MIN = -74.02;
      const REGION_LON_MAX = -73.895;
      let inRegion = 0;
      sapiItems.forEach(item => {
        const geoStr = item[4];
        if (typeof geoStr === 'string') {
          const parts = geoStr.split('~');
          const lat = parseFloat(parts[1]);
          const lng = parseFloat(parts[2]);
          if (!isNaN(lat) && !isNaN(lng) && lat >= REGION_LAT_MIN && lat <= REGION_LAT_MAX && lng >= REGION_LON_MIN && lng <= REGION_LON_MAX) {
            inRegion++;
          }
        }
      });
      sapiInRegionCount = inRegion;
      log.info('SAPI: totalResultCount=' + total + ' items=' + sapiItems.length + ' inRegion(bbox)=' + inRegion);
    }
  }

  const MAX_VARIANT_RETRIES = 3;

  // NOTE: page.evaluate can only return JSON-serializable values across the
  // browser/Node boundary — DOM elements do NOT survive the trip (they
  // serialize to empty objects with no .getAttribute etc). Extract the
  // hrefs as plain strings INSIDE the evaluate callback, not the elements.
  function extractStaticHrefs() {
    return Array.from(document.querySelectorAll('li.cl-static-search-result > a[href]'))
      .map(a => a.getAttribute('href'))
      .filter(Boolean);
  }

  let cardCount = 0;
  let firstHref = null;
  let hrefs = [];

  for (let attempt = 1; attempt <= MAX_VARIANT_RETRIES; attempt++) {
    hrefs = await page.evaluate(extractStaticHrefs);
    cardCount = hrefs.length;
    if (cardCount > 0) {
      firstHref = hrefs[0] || null;
      if (attempt > 1) {
        log.info('Static result variant found on reload attempt ' + attempt + ' (' + cardCount + ' cards).');
      }
      break;
    }
    if (attempt < MAX_VARIANT_RETRIES) {
      log.warning('Static results missing (attempt ' + attempt + '/' + MAX_VARIANT_RETRIES + ') — CL served the unverified gallery DOM variant for this request. Reloading to retry for the static variant.');
      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (e) {
        log.warning('Reload failed: ' + e.message);
      }
    }
  }

  if (cardCount === 0) {
    log.error('Static results missing after ' + MAX_VARIANT_RETRIES + ' attempts — DOM variant changed and the gallery fallback is unverified. Reporting zero results rather than guessing at stale selectors: ' + url);
    return {
      zeroResults: true,
      hasSearchShell: true,
      staticVariantMissing: true,
      url,
      title: await page.title().catch(() => ''),
      sapiTotalResultCount,
      sapiInRegionCount,
      sapiBlocked,
    };
  }

  // Match both the new opaque /view/d/<slug>/<token> scheme and the legacy
  // <id>.html scheme, in case CL serves either depending on region/cohort.
  const links = [...new Set(
    hrefs
      .filter(href => /\\/view\\/d\\//.test(href) || /\\d+\\.html$/.test(href))
      .map(href => (href.startsWith('http') ? href : 'https://www.craigslist.org' + href)),
  )];

  log.info('Page 1: ' + cardCount + ' cards, ' + links.length + ' links, first href ' + firstHref);

  for (const link of links) {
    await context.pushData({ url: link });
  }

  log.info('Done: ' + links.length + ' total URLs found (single-page scrape — no working pagination mechanism found, see comment above). SAPI total=' + sapiTotalResultCount + ' inRegion=' + sapiInRegionCount);

  // This summary row is the function's return value, auto-pushed by the
  // actor as ONE additional dataset record alongside the per-link pushData
  // rows above (see the DETAIL_PAGE_FUNCTION comment on this actor behavior).
  // It has no \`url\` field so it's naturally excluded when
  // fetchCraigslistListings collects discovered URLs, and is instead read
  // separately for the sapi completeness/discovery-floor signal.
  return {
    sapiSummary: true,
    linksCount: links.length,
    sapiTotalResultCount,
    sapiInRegionCount,
    sapiBlocked,
  };
}
`;

// ---------------------------------------------------------------------------
// DETAIL_PAGE_FUNCTION — only handles individual listing pages
// ---------------------------------------------------------------------------

export const DETAIL_PAGE_FUNCTION = `
async function pageFunction(context) {
  const { page, request, log } = context;
  const url = request.url;

  // Wait for content to load. CL's redesign (see the diagnostic-run comment
  // in SEARCH_ONLY_PAGE_FUNCTION above) confirmed script[type="application/
  // ld+json"] and span.price are present on the new detail-page DOM — kept
  // as the primary wait targets, with the old selectors as an OR-fallback in
  // case some listings still render the classic markup.
  try {
    await page.waitForSelector(
      'script[type="application/ld+json"], span.price, #postingbody, .posting-title, span#titletextonly',
      { timeout: 10000 },
    );
  } catch (e) {
    // Do NOT fall through to pushData on a failed load. Previously this
    // logged a warning and continued to extraction anyway, pushing a
    // mostly-empty row for the failed attempt. That is the root cause of the
    // detail-scrape double-push bug (Phase 2 dataset counts ~2x the URL
    // count): when the Apify actor's own retry logic re-runs a request for
    // an unrelated reason (bad proxy session, slow network-idle, etc.), the
    // failed attempt's garbage row AND the eventual successful retry's row
    // both land in the dataset — one URL, two items. Throwing here instead
    // lets the actor's retry mechanism own the request cleanly: exactly one
    // dataset row per URL, whichever attempt actually succeeds.
    log.error('Listing page did not load expected content, throwing for clean retry: ' + url);
    throw new Error('Listing content did not load: ' + url);
  }

  const data = await page.evaluate(() => {
    // Try JSON-LD structured data. CL's redesigned detail page emits TWO
    // ld+json blocks — a BreadcrumbList and an "Apartment" schema carrying
    // name/price/address/lat-lng/beds/baths — confirmed via a diagnostic
    // dump (see SEARCH_ONLY_PAGE_FUNCTION comment above). Prefer the
    // Apartment block explicitly rather than relying on DOM order (last
    // matching script wins), so this doesn't silently break if CL reorders
    // or adds more ld+json blocks.
    let ld = null;
    document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
      try {
        const parsed = JSON.parse(el.textContent || '');
        if (!parsed) return;
        if (parsed['@type'] === 'Apartment') {
          ld = parsed;
        } else if (!ld && (parsed['@type'] || parsed.name)) {
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
      // h2.street-address is the redesigned DOM's address element (confirmed
      // via diagnostic dump); small/div.mapaddress kept as fallback for the
      // classic DOM.
      const streetAddrEl = document.querySelector('h2.street-address');
      const smallEl = document.querySelector('small');
      const mapAddrEl = document.querySelector('div.mapaddress');
      locationStr = (streetAddrEl ? streetAddrEl.textContent.trim() : '')
        || (smallEl ? smallEl.textContent.replace(/[()]/g, '').trim() : '')
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

    // Photos. Normalize every URL to the 1200x900 variant. Craigslist thumbnails
    // carry a suffix letter (e.g. _50x50c.jpg for "cropped"), so the size token
    // is _\d+x\d+[a-z]* — without the [a-z]* the c-suffixed thumbnails slip
    // through un-upgraded and render blurry. The same image is scraped from both
    // the <a.thumb> href and the thumbnail <img>, so normalizing makes the twins
    // identical; dedup at the DB-row build.
    const photos = [];
    document.querySelectorAll('a.thumb, div.gallery img, img[src*="images.craigslist"]').forEach(el => {
      const src = el.getAttribute('href') || el.getAttribute('src') || '';
      if (src && src.includes('craigslist')) {
        const fullSize = src.replace(/_\\d+x\\d+[a-z]*\\./i, '_1200x900.');
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

    // Post ID from URL. The redesigned /view/d/<slug>/<token> URL scheme has
    // NO numeric id anywhere — confirmed via diagnostic dump: no data-pid
    // attribute on the detail page, no id field in the ld+json Apartment
    // block, og:url/canonical both just echo the same opaque view URL. So
    // there is no stable numeric identity to recover here at all; the
    // opaque token (last URL path segment) is the closest thing to a stable
    // id and is used as external_id. This does NOT affect DB dedup — the
    // upsert pipeline's identity-redirect (lib/sources/identity.ts,
    // dedupIdentity: true in lib/ingest/phases/upsert.ts) keys off
    // address/beds/price, not url or external_id, specifically because CL
    // post ids/urls already churned on reposts before this redesign.
    const viewMatch = window.location.href.match(/\\/view\\/d\\/[^/]+\\/([^/?#]+)/);
    const legacyMatch = window.location.href.match(/(\\d+)\\.html/);
    const postId = (viewMatch && viewMatch[1]) || (legacyMatch && legacyMatch[1]) || '';

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

  // Return the object instead of calling context.pushData(data) here. The
  // apify/puppeteer-scraper actor auto-pushes ONE dataset record per
  // pageFunction invocation from whatever it returns, merged with request
  // metadata (#error/#debug) — this is documented actor behavior, not a bug.
  // The previous code called pushData(data) explicitly AND still returned
  // nothing, so the actor's own auto-push contributed a second, mostly-empty
  // {#error, #debug} row per URL on top of our real one: exactly the
  // "154 raw items for 77 URLs" 2x seen in production. Returning here means
  // there is exactly one record per invocation, carrying our real fields.
  return data;
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
  /** Set when the search page rendered a bot-block/CAPTCHA interstitial. */
  blocked?: boolean;
  blockTitle?: string;
  blockSnippet?: string;
  /** Set when the page loaded normally but showed a genuine zero-results state. */
  zeroResults?: boolean;
  hasSearchShell?: boolean;
  /**
   * The pageFunction's own return value — the actor auto-pushes it as one
   * extra dataset record per invocation (see the DETAIL_PAGE_FUNCTION
   * comment on this actor behavior). It carries the sapi.craigslist.org
   * completeness signal (see SEARCH_ONLY_PAGE_FUNCTION): sapi returns the
   * FULL result set in one call, so totalResultCount is ground truth for
   * discovery-floor alerting, independent of what the static-page scrape
   * above managed to extract. Has no `url`, so it's naturally excluded when
   * collecting discovered URLs.
   */
  sapiSummary?: boolean;
  linksCount?: number;
  sapiTotalResultCount?: number | null;
  sapiInRegionCount?: number | null;
  sapiBlocked?: boolean;
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
): Promise<{
  listings: AdapterOutput[];
  total: number;
  /** Unique URLs discovered in Phase 1, before the DB new/existing filter. */
  discovered: number;
  /** True if any borough's Phase 1 search page hit a bot-block/CAPTCHA interstitial. */
  blocked: boolean;
  /**
   * Sum across boroughs of sapi.craigslist.org's totalResultCount (the FULL
   * live result count for the query, independent of what the static-page
   * scrape managed to extract) — null if every borough's sapi call failed.
   * Ground truth for discovery-floor alerting; see lib/ingest/strategies.ts.
   */
  sapiTotalResultCount: number | null;
}> {
  const { bedsMin, bedsMax, priceMax, priceMin } = params;

  const token = process.env.APIFY_TOKEN;
  if (!token) {
    throw new Error("APIFY_TOKEN not set — cannot query Craigslist via Apify");
  }

  // Brooklyn only — the target region is entirely in Brooklyn, so we don't scan
  // Manhattan (saves a paid Apify search run; it returned 0 in-region anyway).
  // Full list: ["brk", "mnh", "que", "brx", "stn"]
  const CL_BOROUGHS = ["brk"];
  // Scope the SEARCH server-side so we detail-scrape far fewer out-of-scope
  // listings (the detail scrape is the Apify cost). min/max_bedrooms filter to
  // the 2–4BR band before Phase 2; the pipeline's region gate then trims the
  // remaining out-of-neighborhood listings (craigslist search has no usable
  // neighborhood-code filter, and its radius can't fit this region's shape).
  const queryParams = new URLSearchParams();
  if (priceMin != null) queryParams.set("min_price", String(priceMin));
  if (priceMax != null) queryParams.set("max_price", String(priceMax));
  if (bedsMin != null) queryParams.set("min_bedrooms", String(bedsMin));
  if (bedsMax != null) queryParams.set("max_bedrooms", String(bedsMax));
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
      // Canonical URL scheme (see the redesign comment inside
      // SEARCH_ONLY_PAGE_FUNCTION above): CL redirects the old
      // newyork.craigslist.org/search/<borough>/apa form to this one, so we
      // construct it directly rather than relying on the redirect hop.
      const startUrl = `https://www.craigslist.org/search/subarea/${borough}?cat=apa&${qs}`;
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
  const blockedBoroughs: string[] = [];
  let sapiTotalResultCount: number | null = null;
  let sapiSawAnyValue = false;
  await Promise.all(
    searchRunStatuses
      .filter((r) => r.status === "SUCCEEDED")
      .map(async (run) => {
        const items = await fetchDatasetItems<ApifySearchItem>(
          token,
          run.datasetId,
        );
        const blockedItems = items.filter((item) => item.blocked || item.sapiBlocked);
        if (blockedItems.length > 0) {
          blockedBoroughs.push(run.borough);
          console.error(
            `[Craigslist] BOT BLOCK DETECTED — borough ${run.borough}: ${blockedItems.length} blocked page(s). ` +
              `Sample: title="${blockedItems[0].blockTitle ?? ""}" snippet="${(blockedItems[0].blockSnippet ?? "").slice(0, 150)}"`,
          );
        }
        const urls = items
          .map((item) => item.url)
          .filter((u): u is string => !!u);
        console.log(
          `[Craigslist] Phase 1 — borough ${run.borough}: ${urls.length} URLs discovered` +
            (blockedItems.length > 0 ? " (BOT-BLOCKED run — treat as unreliable, not a genuine zero-result day)" : ""),
        );
        allDiscoveredUrls.push(...urls);

        // sapiSummary is the pageFunction's own return value — see the field
        // comment on ApifySearchItem. Sum it in (single borough today, but
        // written to generalize if CL_BOROUGHS grows again).
        const sapiItem = items.find((item) => item.sapiSummary);
        if (sapiItem && sapiItem.sapiTotalResultCount != null) {
          sapiTotalResultCount = (sapiTotalResultCount ?? 0) + sapiItem.sapiTotalResultCount;
          sapiSawAnyValue = true;
          console.log(
            `[Craigslist] Phase 1 — borough ${run.borough}: sapi totalResultCount=${sapiItem.sapiTotalResultCount} inRegion(bbox)=${sapiItem.sapiInRegionCount ?? "?"} vs ${urls.length} scraped URLs`,
          );
        } else {
          console.warn(
            `[Craigslist] Phase 1 — borough ${run.borough}: sapi summary missing or failed — no completeness signal for this borough.`,
          );
        }
      }),
  );

  const blocked = blockedBoroughs.length > 0;
  if (!sapiSawAnyValue) sapiTotalResultCount = null;

  // Deduplicate URLs across boroughs
  const uniqueUrls = [...new Set(allDiscoveredUrls)];
  console.log(
    `[Craigslist] Phase 1 complete: ${uniqueUrls.length} unique URLs discovered (${allDiscoveredUrls.length} total before dedup)${blocked ? ` — BOT-BLOCKED boroughs: ${blockedBoroughs.join(", ")}` : ""}`,
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
    return { listings: [], total: 0, discovered: 0, blocked, sapiTotalResultCount };
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
    return { listings: [], total: 0, discovered: uniqueUrls.length, blocked, sapiTotalResultCount };
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
    return { listings: [], total: 0, discovered: uniqueUrls.length, blocked, sapiTotalResultCount };
  }

  const rawItems = await fetchDatasetItems<ApifyCLItem>(token, detailDatasetId);
  console.log(
    `[Craigslist] Phase 2: ${rawItems.length} detail items retrieved`,
  );

  // Guard against duplicate/junk dataset rows. Root cause (confirmed by
  // inspecting the raw dataset of run fjTCMgWEVXRGTXQG8: 154 items for 77
  // URLs, and every "extra" item was `{ "#error": false, "#debug": {...} }`
  // with no `url` field): apify/puppeteer-scraper auto-pushes one dataset
  // record per pageFunction invocation from its return value, merged with
  // request metadata — DETAIL_PAGE_FUNCTION used to call context.pushData(data)
  // explicitly AND return nothing, so the actor's own auto-push contributed a
  // second, url-less row per URL on top of our real one. DETAIL_PAGE_FUNCTION
  // now returns data instead of calling pushData, which should make this a
  // no-op going forward; this filter is a backstop, not the fix.
  const seenUrls = new Set<string>();
  const items: ApifyCLItem[] = [];
  for (const item of rawItems) {
    if (!item.url) continue;
    if (seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    items.push(item);
  }
  if (items.length !== rawItems.length) {
    console.warn(
      `[Craigslist] Phase 2: deduped ${rawItems.length - items.length} duplicate dataset item(s) by URL (${rawItems.length} raw → ${items.length} unique)`,
    );
  }

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
      // Normalize every pic to the 1200x900 variant (the [a-z]* catches
      // c-suffixed thumbnails like _50x50c.jpg that otherwise stay blurry),
      // THEN dedup — the same image is scraped as both a sharp and a thumbnail
      // URL, which collapse to one after normalization — THEN cap at 8.
      photo_urls: [
        ...new Set(
          (item.pics ?? []).map((url: string) =>
            url.replace(/_\d+x\d+[a-z]*\./i, '_1200x900.'),
          ),
        ),
      ].slice(0, 8),
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

  return { listings, total: listings.length, discovered: uniqueUrls.length, blocked, sapiTotalResultCount };
}
