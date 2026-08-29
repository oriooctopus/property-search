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
 *
 * Execution backend is pluggable via the PageFunctionRunner interface
 * (opts.runner, default = the Apify actor runner defined below): everything
 * from "dataset items" onward — URL dedup, the DB incremental check,
 * last_seen_at bumping, AdapterOutput mapping, sapi completeness fields —
 * is byte-for-byte identical regardless of which runner actually executed
 * SEARCH_ONLY_PAGE_FUNCTION / DETAIL_PAGE_FUNCTION. See
 * lib/sources/craigslist-local.ts for a local-headless-Playwright runner
 * that runs the exact same pageFunction strings without paying for Apify.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdapterOutput, SearchParams } from "./types";
import { extractBaths, extractBeds, parsePrice } from "./parse-utils";
import { parseAvailabilityDate, extractAvailabilityFromDescription } from "./availability";

const APIFY_START_URL =
  "https://api.apify.com/v2/acts/apify~puppeteer-scraper/runs";

const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 3_600_000; // 60 min max (detail scrape for ~1000 URLs needs ~50 min)

// ---------------------------------------------------------------------------
// Bot-block detection markers
// ---------------------------------------------------------------------------

/**
 * Markers that distinguish a Craigslist bot-block/CAPTCHA interstitial from
 * a normal (possibly zero-result) page. "automatically blocked" is CL's
 * documented rate-limit message, reported verbatim by multiple scraping
 * guides (e.g. https://marsproxies.com/blog/craigslist-ip-block-guide/ and
 * https://proxywing.com/blog/craigslist-ip-blocked-causes-fixes-and-ban-prevention-guide).
 * "captcha"/"recaptcha" cover CL's documented reCAPTCHA challenge
 * (https://www.craigslist.org/about/help/captcha). "robot"/"denied" cover
 * the generic anti-bot interstitial copy scrapers commonly report.
 *
 * Kept as one exported TS-level array (rather than duplicated inline inside
 * SEARCH_ONLY_PAGE_FUNCTION's string) so there is exactly one source of
 * truth: SEARCH_ONLY_PAGE_FUNCTION interpolates it via JSON.stringify below,
 * and lib/sources/craigslist-local.ts's local Playwright runner imports it
 * directly to run the equivalent check during the DETAIL-page phase — which,
 * unlike the search phase, has no block-detection logic baked into
 * DETAIL_PAGE_FUNCTION itself (see that function's header comment below).
 */
export const CL_BLOCK_MARKERS = [
  "automatically blocked",
  "access denied",
  "blocked",
  "denied",
  "are you a robot",
  "verify you are human",
  "captcha",
  "recaptcha",
];

// ---------------------------------------------------------------------------
// SEARCH_ONLY_PAGE_FUNCTION — only scrapes search result pages, extracts URLs
// ---------------------------------------------------------------------------

export const SEARCH_ONLY_PAGE_FUNCTION = `
async function pageFunction(context) {
  const { page, request, log } = context;
  const url = request.url;

  // See the CL_BLOCK_MARKERS export at the top of craigslist.ts for what
  // these markers are and why. Interpolated here (rather than duplicated)
  // so this stays the single source of truth shared with the local
  // Playwright runner's detail-page block check.
  const CL_BLOCK_MARKERS = ${JSON.stringify(CL_BLOCK_MARKERS)};

  // Only handle search result pages
  if (!url.includes('/search/') && !url.includes('search=')) {
    log.warning('Unexpected non-search URL: ' + url);
    return;
  }

  // Capture the static, server-rendered result list (li.cl-static-search-result,
  // plain a[href] children) IMMEDIATELY — before any wait, any network call,
  // anything. See the dated finding in the redesign comment below: this list
  // is present at domcontentloaded but gets REPLACED by client JS within
  // ~1-1.5s, and there is a ~1s gap before the hydrated gallery variant
  // appears — so this is the only point in the function where the static
  // list is reliably still there to read.
  const extractStaticNow = () =>
    Array.from(document.querySelectorAll('li.cl-static-search-result > a[href]'))
      .map(a => a.getAttribute('href'));
  const extractGalleryNow = () =>
    Array.from(document.querySelectorAll('[data-pid] a[href]'))
      .map(a => a.getAttribute('href'));

  let staticHrefs = await page.evaluate(extractStaticNow).catch(() => []);

  // Wait for SOME result content to exist (either variant) before deciding
  // this is a genuine zero-results/blocked page. The JS-gallery selectors
  // are included here only so bot-block/zero-result detection below still
  // fires on either DOM variant.
  try {
    // state: 'attached' is explicit and load-bearing, not decoration. On
    // Apify (Puppeteer) this key is simply ignored — Puppeteer's
    // waitForSelector has no 'state' concept and its default already means
    // "exists in the DOM" (visible:false). On the local Playwright runner
    // (lib/sources/craigslist-local.ts), Playwright's page.waitForSelector
    // defaults to state:'visible' instead — and since document.querySelector
    // resolves this OR-list to whichever matching element is FIRST in
    // document order, if that first match happens to be an invisible one
    // (confirmed live for DETAIL_PAGE_FUNCTION's script[type=ld+json], which
    // is always display:none and appears before the visible fields), the
    // wait hangs the full timeout even though visible cards/fields ARE on
    // the page. Discovered while wiring the local runner (every single
    // detail fetch failed with "did not load" until this was added) — see
    // the same explicit state on DETAIL_PAGE_FUNCTION's waitForSelector
    // below, which is where this actually bit.
    await page.waitForSelector(
      'li.cl-static-search-result, .cl-static-search-result, [data-pid], .gallery-card, .cl-search-result',
      { timeout: 15000, state: 'attached' },
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
  //     reached via a #search=<id>~gallery~<n> hash route.
  //   - UPDATE (2026-08-28, root-caused via a local-vs-Apify parity run —
  //     raw captures in /home/esme/.claude/jobs/2ab1ae70/tmp/parity/{local-search,apify-search}.json
  //     — followed by a 1s-resolution timeline probe of the live DOM,
  //     /home/esme/.claude/jobs/2ab1ae70/tmp/discovery/probe.mjs): the two
  //     "DOM variants" are NOT randomly served one-or-the-other per request
  //     — every request gets BOTH, in sequence. CL first
  //     serves the static, server-rendered list (li.cl-static-search-result
  //     > a[href], ~300 items) present already at domcontentloaded; client
  //     JS then REPLACES it with a hydrated gallery ([data-pid] a[href],
  //     ~200 items, freshest-first). Measured timeline for one search:
  //     static count 258 at t=0.5s -> 0 at t=1.5s; gallery count 0 through
  //     t=1.5s -> 400 (raw anchor count, ~200 cards) at t=2.5s onward. The
  //     parity run confirmed this end to end: a local runner that waits 8s
  //     before reading the DOM (craigslist-local.ts's old pre-wait) saw only
  //     the 200-item gallery; the Apify runner (no pre-wait, networkidle)
  //     saw only the ~300-item static list; only 100 URLs were common
  //     between them, and the local runner's items 100-199 matched the
  //     Apify runner's items 0-99 in the same order — i.e. each run was
  //     missing what the OTHER captured, not extra/duplicate data. The fix:
  //     read the static list IMMEDIATELY on entry (before any wait — see
  //     extractStaticNow above), THEN wait for the gallery to hydrate and
  //     read that too, and UNION the two (deduped by href) — see the
  //     extraction block below. The "variant missing entirely" case (NEITHER
  //     ever yields anything, after the hydration wait) still triggers the
  //     reload-and-retry loop and the loud zero-results return below,
  //     unchanged.
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
  const GALLERY_HYDRATE_TIMEOUT_MS = 10000;

  // Wait for the client-JS gallery to hydrate (see the dated finding above —
  // it lands ~2.5s post-nav, well within this budget), then read it. Tolerate
  // a timeout: some pages may only ever serve the static variant, and
  // staticHrefs (captured before this function ran) still covers that case.
  async function waitAndExtractGallery() {
    try {
      await page.waitForSelector('[data-pid] a[href]', { timeout: GALLERY_HYDRATE_TIMEOUT_MS, state: 'attached' });
    } catch (e) {
      log.warning('Gallery hydration wait timed out (' + GALLERY_HYDRATE_TIMEOUT_MS + 'ms) — proceeding with whatever was captured: ' + url);
    }
    return page.evaluate(extractGalleryNow).catch(() => []);
  }

  // NOTE: page.evaluate can only return JSON-serializable values across the
  // browser/Node boundary — DOM elements do NOT survive the trip (they
  // serialize to empty objects with no .getAttribute etc). Extract the
  // hrefs as plain strings inside the evaluate callback, not the elements.
  let galleryHrefs = await waitAndExtractGallery();

  // Union of BOTH DOM phases (see the dated finding above), deduped by href
  // string. staticHrefs was captured at function entry, before any wait —
  // by the time we reach here it is usually already stale in the live DOM,
  // but the string array we captured is unaffected by that.
  let hrefs = [...new Set([...staticHrefs, ...galleryHrefs])].filter(Boolean);
  let cardCount = hrefs.length;
  let firstHref = hrefs[0] || null;

  // The reload-and-retry loop now triggers only when the UNION is empty
  // after the hydration wait above — i.e. neither phase ever produced a
  // single card for this request (a genuinely different failure than one
  // phase being merely absent, which the union already tolerates).
  for (let attempt = 2; cardCount === 0 && attempt <= MAX_VARIANT_RETRIES; attempt++) {
    log.warning('Both DOM variants empty (attempt ' + (attempt - 1) + '/' + MAX_VARIANT_RETRIES + ') — reloading to retry: ' + url);
    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      log.warning('Reload failed: ' + e.message);
    }
    staticHrefs = await page.evaluate(extractStaticNow).catch(() => []);
    galleryHrefs = await waitAndExtractGallery();
    hrefs = [...new Set([...staticHrefs, ...galleryHrefs])].filter(Boolean);
    cardCount = hrefs.length;
    if (cardCount > 0) {
      firstHref = hrefs[0] || null;
      log.info('Result cards found on reload attempt ' + attempt + ' (' + cardCount + ' cards).');
    }
  }

  if (cardCount === 0) {
    log.error('Both DOM variants missing after ' + MAX_VARIANT_RETRIES + ' attempts — reporting zero results rather than guessing at stale selectors: ' + url);
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

  log.info('Page 1: ' + cardCount + ' cards (static=' + staticHrefs.length + ' gallery=' + galleryHrefs.length + '), ' + links.length + ' links, first href ' + firstHref);

  for (const link of links) {
    await context.pushData({ url: link });
  }

  log.info('Done: ' + links.length + ' total URLs found (single-page scrape — no working pagination mechanism found, see comment above). SAPI total=' + sapiTotalResultCount + ' inRegion=' + sapiInRegionCount);

  // This summary row is the function's return value, auto-pushed by the
  // actor as ONE additional dataset record alongside the per-link pushData
  // rows above (see the DETAIL_PAGE_FUNCTION comment on this actor behavior).
  // It has no \`url\` field so it's naturally excluded when
  // fetchCraigslistListings collects discovered URLs, and is instead read
  // separately for the sapi completeness/discovery-floor signal. staticCount
  // / galleryCount are the raw (pre-union) href counts from each DOM phase —
  // see the dated finding above — kept for diagnosing coverage drift.
  return {
    sapiSummary: true,
    linksCount: links.length,
    staticCount: staticHrefs.length,
    galleryCount: galleryHrefs.length,
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

  // Wait for content to load. Selector list is deliberately REAL BODY
  // CONTENT only (span.price/#postingbody/.posting-title/span#titletextonly/
  // .postingtitletext) — script[type="application/ld+json"] used to be
  // included too, but that tag lives in <head> and is attached to the DOM
  // before the page BODY renders. On the local Playwright runner (page.goto
  // with waitUntil:'domcontentloaded', then this function invoked
  // immediately — see craigslist-local.ts) that meant this wait could
  // resolve on the ld+json match alone, before span.price/#postingbody etc.
  // actually existed, and extraction below ran against a half-rendered page.
  // Root-caused 2026-08-28 from a real ingest run: 108 of 258 detail pages
  // came back with null title/price even though a live probe confirmed the
  // pages had a visible price — Apify's networkidle2 pre-wait masked this
  // same race on that path, which is why it only ever showed up locally.
  try {
    // state: 'attached' — see the matching comment on SEARCH_ONLY_PAGE_FUNCTION's
    // waitForSelector above for why this is required, not optional: without
    // it, Playwright's default state:'visible' can wait on whichever of
    // these matches first in DOM order even if it never becomes visible.
    // Puppeteer (Apify) ignores this key and already behaves this way by
    // default, so this has no effect there — pure parity fix.
    await page.waitForSelector(
      'span.price, #postingbody, .posting-title, span#titletextonly, .postingtitletext',
      { timeout: 10000, state: 'attached' },
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

    // Availability date. CL's redesign moved this into .attrgroup — a set of
    // <span class="attr important"> tags, one per attribute (beds/baths,
    // availability, pets, laundry, etc). The "available now" case gets an
    // EXTRA "available-now" class, but month-day text ("available aug 1")
    // does NOT get any distinguishing class — so match by TEXT CONTENT
    // ("avail"), not by class, to catch both. Confirmed via a diagnostic
    // dump against 3 live /view/d/ URLs. Old selectors kept as a fallback
    // for any classic-DOM stragglers.
    //
    // Pass the FULL raw text through unparsed — normalization into ISO
    // happens Node-side (lib/sources/availability.ts), not here. The
    // PREVIOUS code parsed with /available\s+(\S+)/, which truncated
    // "available may 1" down to just "may" (dropping the day number) — the
    // pageFunction has no business doing partial date parsing at all.
    const attrSpans = Array.from(document.querySelectorAll('.attrgroup .attr'));
    const availSpan = attrSpans.find(el => /avail/i.test(el.textContent || ''));
    const legacyAvailEl = document.querySelector('span.housing_movein_now, span.availabilitytext');
    const availableFrom = (availSpan ? availSpan.textContent.trim().replace(/\\s+/g, ' ') : '')
      || (legacyAvailEl ? legacyAvailEl.textContent.trim() : '')
      || '';

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
   * Set when neither DOM variant's selector yielded any cards after
   * MAX_VARIANT_RETRIES reloads — distinct from a genuine zeroResults page
   * (which has a normal search shell and just no listings): this means the
   * page's markup didn't match anything we know how to read at all, and
   * fetchCraigslistListings.staticVariantMissing surfaces it so callers can
   * report a distinguishable "variant-miss" outcome instead of a silent
   * empty-listings result (QA scenario E3).
   */
  staticVariantMissing?: boolean;
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
  /** Raw (pre-union, pre-dedup) href count from li.cl-static-search-result — see the dated finding in SEARCH_ONLY_PAGE_FUNCTION. */
  staticCount?: number;
  /** Raw (pre-union, pre-dedup) href count from [data-pid] a[href] — see the dated finding in SEARCH_ONLY_PAGE_FUNCTION. */
  galleryCount?: number;
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
// PageFunctionRunner — executes the pageFunction strings above against real
// listing pages. Two implementations exist: createApifyRunner below (the
// original Apify puppeteer-scraper actor calls, unchanged) and
// lib/sources/craigslist-local.ts's local headless-Playwright runner, which
// runs the EXACT SAME pageFunction strings in a real local browser instead
// of paying for Apify's proxy/compute. Factoring this out is what lets
// fetchCraigslistListings' post-processing (URL dedup, DB incremental check,
// sapi completeness fields, AdapterOutput mapping) stay byte-for-byte
// identical between the two paths.
// ---------------------------------------------------------------------------

export interface PageFunctionRunner {
  /**
   * Runs SEARCH_ONLY_PAGE_FUNCTION against one search-results start URL.
   * Returns the resulting dataset rows: one per context.pushData call the
   * function made, PLUS the function's own return value as one extra row —
   * this mirrors the real Apify actor's auto-push-return-value behavior
   * (see the comment on DETAIL_PAGE_FUNCTION's final `return data` below).
   */
  runSearch(startUrl: string): Promise<unknown[]>;
  /**
   * Runs DETAIL_PAGE_FUNCTION against each listing URL. Returns the same
   * dataset-row shape as runSearch. May throw CraigslistBlockedError (with
   * whatever rows were already extracted attached) or CraigslistNetworkError
   * — see those classes below.
   */
  runDetail(urls: string[]): Promise<unknown[]>;
  /** Short name for logging, e.g. "apify" or "playwright-local". */
  name: string;
}

/**
 * Thrown by a PageFunctionRunner when a bot-block/CAPTCHA interstitial is
 * detected mid-detail-scrape. Carries whatever rows were already extracted
 * before the block so the caller can still upsert partial progress (QA
 * scenario E6: never mark the un-fetched remainder as delisted, never throw
 * away real data just because the run had to stop).
 */
export class CraigslistBlockedError extends Error {
  constructor(
    message: string,
    public readonly partialItems: unknown[],
    public readonly blockedAtUrl: string | null = null,
  ) {
    super(message);
    this.name = "CraigslistBlockedError";
  }
}

/**
 * Thrown by a PageFunctionRunner on a network-level failure (DNS resolution,
 * connection refused, etc.) — distinct from a bot-block (QA scenario
 * requirement): a block means "the site is responding but doesn't want us",
 * a network error means "we can't reach the site at all". Fatal for the
 * whole run — unlike CraigslistBlockedError there is no partial-progress
 * path, since the failure isn't localized to one page.
 */
export class CraigslistNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CraigslistNetworkError";
  }
}

/** The default runner: the original Apify puppeteer-scraper actor calls, unchanged. */
export function createApifyRunner(token: string): PageFunctionRunner {
  return {
    name: "apify",
    async runSearch(startUrl: string): Promise<unknown[]> {
      const input = {
        startUrls: [{ url: startUrl }],
        pageFunction: SEARCH_ONLY_PAGE_FUNCTION,
        proxyConfiguration: { useApifyProxy: true },
        maxRequestsPerCrawl: 50,
        maxConcurrency: 3,
        waitUntil: ["networkidle2"],
      };
      const { runId, datasetId } = await launchApifyRun(token, input);
      console.log(`[Craigslist] Apify search run started (${runId}) for ${startUrl}`);
      const status = await pollApifyRun(token, runId, MAX_WAIT_MS);
      console.log(`[Craigslist] Apify search run ${runId}: ${status}`);
      if (status !== "SUCCEEDED") {
        throw new Error(`Apify search run ${status}: ${runId}`);
      }
      return fetchDatasetItems<unknown>(token, datasetId);
    },
    async runDetail(urls: string[]): Promise<unknown[]> {
      const input = {
        startUrls: urls.map((url) => ({ url })),
        pageFunction: DETAIL_PAGE_FUNCTION,
        proxyConfiguration: { useApifyProxy: true },
        maxRequestsPerCrawl: urls.length + 100,
        maxConcurrency: 10,
        waitUntil: ["networkidle2"],
      };
      const { runId, datasetId } = await launchApifyRun(token, input);
      console.log(`[Craigslist] Apify detail run started (${runId}) for ${urls.length} URLs`);
      const status = await pollApifyRun(token, runId, MAX_WAIT_MS);
      console.log(`[Craigslist] Apify detail run ${status}`);
      if (status !== "SUCCEEDED") {
        throw new Error(`Apify detail run ${status}: ${runId}`);
      }
      return fetchDatasetItems<unknown>(token, datasetId);
    },
  };
}

// ---------------------------------------------------------------------------
// Main fetch function
// ---------------------------------------------------------------------------

export async function fetchCraigslistListings(
  params: SearchParams,
  opts?: { supabase?: SupabaseClient; runner?: PageFunctionRunner },
): Promise<{
  listings: AdapterOutput[];
  total: number;
  /** Unique URLs discovered in Phase 1, before the DB new/existing filter. */
  discovered: number;
  /**
   * True if any borough's Phase 1 search page hit a bot-block/CAPTCHA
   * interstitial, OR the detail phase hit one mid-scrape (local runner
   * only — see CraigslistBlockedError). When true, `blockedAtUrl` names
   * where.
   */
  blocked: boolean;
  /**
   * True if, after MAX_VARIANT_RETRIES reloads, neither DOM-variant
   * selector yielded any search-result cards at all — distinct from a
   * genuine zero-results page (QA scenario E3: these must be
   * distinguishable outcomes, not both collapsed into "0 listings").
   */
  staticVariantMissing: boolean;
  /**
   * Sum across boroughs of sapi.craigslist.org's totalResultCount (the FULL
   * live result count for the query, independent of what the static-page
   * scrape managed to extract) — null if every borough's sapi call failed.
   * Ground truth for discovery-floor alerting; see lib/ingest/strategies.ts.
   */
  sapiTotalResultCount: number | null;
  /** Sum across boroughs of sapi's in-target-region-bbox item count. Null under the same conditions as sapiTotalResultCount. */
  sapiInRegionCount: number | null;
  /** Count of detail URLs that were successfully page-fetched (excludes 404/timeout skips and un-attempted URLs after a mid-detail block). */
  fetched: number;
  /** Count of detail URLs that 404'd or timed out (after one retry) — counted skips, not silent drops (QA E12/E13). */
  skipped: number;
  /** The URL where a block was detected, if `blocked` is true and it happened on a specific page (search-phase blocks may leave this null). */
  blockedAtUrl: string | null;
}> {
  const { bedsMin, bedsMax, priceMax, priceMin } = params;

  // The runner owns HOW SEARCH_ONLY_PAGE_FUNCTION / DETAIL_PAGE_FUNCTION
  // actually get executed (a paid Apify actor run vs. a local headless
  // Playwright browser) — see the PageFunctionRunner doc comment above.
  // Default to Apify, matching every call site before this abstraction
  // existed; only resolve/require APIFY_TOKEN when no runner was supplied,
  // so the local runner path never needs it.
  const runner: PageFunctionRunner =
    opts?.runner ??
    (() => {
      const token = process.env.APIFY_TOKEN;
      if (!token) {
        throw new Error("APIFY_TOKEN not set — cannot query Craigslist via Apify");
      }
      return createApifyRunner(token);
    })();

  // Brooklyn only — the target region is entirely in Brooklyn, so we don't scan
  // Manhattan (saves a paid Apify search run; it returned 0 in-region anyway).
  // Full list: ["brk", "mnh", "que", "brx", "stn"]
  const CL_BOROUGHS = ["brk"];
  // Scope the SEARCH server-side so we detail-scrape far fewer out-of-scope
  // listings (the detail scrape is the Apify cost). min/max_bedrooms filter to
  // the 1–2BR band before Phase 2; the pipeline's region gate then trims the
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
    `[Craigslist] Phase 1: search-page scan across ${CL_BOROUGHS.length} boroughs (runner=${runner.name})`,
  );

  interface SearchRunResult {
    borough: string;
    items: ApifySearchItem[];
    ok: boolean;
    error?: string;
  }

  // One runner.runSearch call per borough, in parallel — the runner owns
  // however it actually executes SEARCH_ONLY_PAGE_FUNCTION (an Apify actor
  // run vs. a local Playwright page); everything below only cares about the
  // resulting dataset rows, so this is identical for both runners.
  const searchResults: SearchRunResult[] = await Promise.all(
    CL_BOROUGHS.map(async (borough): Promise<SearchRunResult> => {
      // Canonical URL scheme (see the redesign comment inside
      // SEARCH_ONLY_PAGE_FUNCTION above): CL redirects the old
      // newyork.craigslist.org/search/<borough>/apa form to this one, so we
      // construct it directly rather than relying on the redirect hop.
      const startUrl = `https://www.craigslist.org/search/subarea/${borough}?cat=apa&${qs}`;
      try {
        const items = (await runner.runSearch(startUrl)) as ApifySearchItem[];
        console.log(
          `[Craigslist] Phase 1 — borough ${borough}: search run completed (${items.length} raw dataset row(s))`,
        );
        return { borough, items, ok: true };
      } catch (e) {
        if (e instanceof CraigslistNetworkError) {
          // Network-level failure is fatal for the whole run, not just this
          // borough — rethrow so it propagates all the way to the caller
          // (scripts/craigslist-local-run.ts) as a distinct "network-error"
          // outcome, per QA scenario requiring it be distinguishable from a
          // bot-block or a genuine empty result.
          throw e;
        }
        console.warn(
          `[Craigslist] Phase 1 — borough ${borough}: search run failed: ${(e as Error).message}`,
        );
        return { borough, items: [], ok: false, error: (e as Error).message };
      }
    }),
  );

  // Collect discovered URLs, bot-block, and sapi-completeness signals from
  // every borough that completed. staticVariantMissing mirrors `blocked`:
  // both are per-item flags the pageFunction already computes (see the
  // redesign comment inside SEARCH_ONLY_PAGE_FUNCTION) — surfaced here so
  // scripts/craigslist-local-run.ts can report the correct outcome class
  // (QA E3: zero-results / variant-miss / blocked must be distinguishable,
  // not all collapsed into "0 listings").
  const allDiscoveredUrls: string[] = [];
  const blockedBoroughs: string[] = [];
  const staticVariantMissingBoroughs: string[] = [];
  let sapiTotalResultCount: number | null = null;
  let sapiInRegionCount: number | null = null;
  let sapiSawAnyValue = false;
  let blockedAtUrl: string | null = null;

  // Only keep urls that look like an actual listing (same /view/d/ or legacy
  // <id>.html regex DETAIL_PAGE_FUNCTION's callers rely on elsewhere). A
  // blocked / zeroResults / staticVariantMissing summary row ALSO carries a
  // `url` field — it's request.url, i.e. the SEARCH page's own url, not a
  // listing — which would otherwise get treated as a "discovered" listing
  // URL and sent to Phase 2 for a detail fetch. Found while wiring the local
  // runner (QA E5: a block on the search page must produce ZERO detail
  // fetches); without this filter a blocked run still fired exactly one
  // bogus detail request, at the search page's own URL. Also fixes the
  // identical latent issue for genuine-zero-results and variant-miss rows.
  const LISTING_URL_RE = /\/view\/d\//;
  const LISTING_URL_LEGACY_RE = /\d+\.html$/;

  for (const run of searchResults.filter((r) => r.ok)) {
    const items = run.items;
    const blockedItems = items.filter((item) => item.blocked || item.sapiBlocked);
    if (blockedItems.length > 0) {
      blockedBoroughs.push(run.borough);
      if (!blockedAtUrl) blockedAtUrl = blockedItems[0].url ?? null;
      console.error(
        `[Craigslist] BOT BLOCK DETECTED — borough ${run.borough}: ${blockedItems.length} blocked page(s). ` +
          `Sample: title="${blockedItems[0].blockTitle ?? ""}" snippet="${(blockedItems[0].blockSnippet ?? "").slice(0, 150)}"`,
      );
    }
    if (items.some((item) => item.staticVariantMissing)) {
      staticVariantMissingBoroughs.push(run.borough);
    }
    const urls = items
      .map((item) => item.url)
      .filter((u): u is string => !!u && (LISTING_URL_RE.test(u) || LISTING_URL_LEGACY_RE.test(u)));
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
      if (sapiItem.sapiInRegionCount != null) {
        sapiInRegionCount = (sapiInRegionCount ?? 0) + sapiItem.sapiInRegionCount;
      }
      sapiSawAnyValue = true;
      console.log(
        `[Craigslist] Phase 1 — borough ${run.borough}: sapi totalResultCount=${sapiItem.sapiTotalResultCount} inRegion(bbox)=${sapiItem.sapiInRegionCount ?? "?"} vs ${urls.length} scraped URLs`,
      );
    } else {
      console.warn(
        `[Craigslist] Phase 1 — borough ${run.borough}: sapi summary missing or failed — no completeness signal for this borough.`,
      );
    }
  }

  const blocked = blockedBoroughs.length > 0;
  const staticVariantMissing = staticVariantMissingBoroughs.length > 0;
  if (!sapiSawAnyValue) {
    sapiTotalResultCount = null;
    sapiInRegionCount = null;
  }

  // Deduplicate URLs across boroughs
  const uniqueUrls = [...new Set(allDiscoveredUrls)];
  console.log(
    `[Craigslist] Phase 1 complete: ${uniqueUrls.length} unique URLs discovered (${allDiscoveredUrls.length} total before dedup)${blocked ? ` — BOT-BLOCKED boroughs: ${blockedBoroughs.join(", ")}` : ""}`,
  );

  // Warn about boroughs that failed
  const failedBoroughs = searchResults.filter((r) => !r.ok);
  if (failedBoroughs.length > 0) {
    console.warn(
      `[Craigslist] Phase 1: ${failedBoroughs.length} borough(s) failed: ${failedBoroughs.map((r) => `${r.borough} (${r.error ?? "unknown error"})`).join(", ")}`,
    );
  }

  if (uniqueUrls.length === 0) {
    console.log("[Craigslist] No URLs discovered — nothing to do");
    return {
      listings: [],
      total: 0,
      discovered: 0,
      blocked,
      staticVariantMissing,
      sapiTotalResultCount,
      sapiInRegionCount,
      fetched: 0,
      skipped: 0,
      blockedAtUrl,
    };
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
        // BUG FIX (QA scenario E11): this used to `console.warn` and
        // `continue`, which silently treated every URL in the failed batch
        // as "not in DB" — i.e. degraded straight into fetch-everything
        // behavior for exactly the URLs the DB couldn't confirm. That's the
        // failure mode that gets a home IP rate-limited/banned: a real DB
        // outage would make an incremental run silently detail-scrape the
        // ENTIRE discovered set (minus whatever batches happened to
        // succeed) instead of just the new rows, with no operator
        // visibility. A supabase client was explicitly supplied by the
        // caller, so an unreachable/erroring DB here is a hard error, not a
        // fallback path — contrast the `else` branch below, which is the
        // ONLY sanctioned "fetch everything" path (no DB client at all).
        throw new Error(
          `[Craigslist] DB query failed while checking existing URLs (batch ${Math.floor(i / BATCH_SIZE) + 1}, ${chunk.length} urls): ${error.message}`,
        );
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
    return {
      listings: [], total: 0, discovered: uniqueUrls.length, blocked, staticVariantMissing,
      sapiTotalResultCount, sapiInRegionCount, fetched: 0, skipped: 0, blockedAtUrl,
    };
  }

  console.log(
    `[Craigslist] Phase 2: fetching ${urlsToFetch.length} new listing details via runner=${runner.name}`,
  );

  let rawItems: ApifyCLItem[];
  let detailBlocked = false;
  try {
    rawItems = (await runner.runDetail(urlsToFetch)) as ApifyCLItem[];
  } catch (e) {
    if (e instanceof CraigslistNetworkError) {
      // Fatal for the whole run — propagate to the caller
      // (scripts/craigslist-local-run.ts maps this to a distinct
      // "network-error" outcome/exit code, per QA scenario requiring it be
      // distinguishable from a bot-block).
      throw e;
    }
    if (e instanceof CraigslistBlockedError) {
      // Mid-detail bot-block (QA E6): stop cold, keep whatever the runner
      // already extracted before the block, and surface it as blocked
      // rather than silently returning a partial success or throwing away
      // real data. Falls through to the SAME dedup/mapping code used for a
      // normal run below, so a partial blocked run still upserts what it
      // got — never marks the un-fetched remainder as delisted.
      console.error(`[Craigslist] Phase 2: ${e.message}`);
      rawItems = e.partialItems as ApifyCLItem[];
      detailBlocked = true;
      blockedAtUrl = blockedAtUrl ?? e.blockedAtUrl;
    } else {
      console.error(
        `[Craigslist] Phase 2: detail run failed: ${(e as Error).message} — returning empty`,
      );
      return {
        listings: [], total: 0, discovered: uniqueUrls.length, blocked, staticVariantMissing,
        sapiTotalResultCount, sapiInRegionCount, fetched: 0, skipped: 0, blockedAtUrl,
      };
    }
  }
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

  // Local-runner skip rows (lib/sources/craigslist-local.ts) carry
  // `__skipped: true` for a detail URL that 404'd or timed out (after one
  // retry) — counted here so the caller can report a genuine skip count,
  // distinct from "fetched but rejected by the pipeline gate" (e.g. null
  // price, below). Apify rows never carry this marker, so `skipped` is
  // always 0 on that path — parity preserved.
  const skippedCount = items.filter(
    (item) => (item as { __skipped?: boolean }).__skipped === true,
  ).length;
  const fetchedCount = items.length - skippedCount;

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

    // Normalize into ISO YYYY-MM-DD (or null) here, Node-side — the
    // pageFunction only scrapes the raw text (see the comment on
    // availableFrom in DETAIL_PAGE_FUNCTION). Never write '' — the
    // saved-search availability-date range filter (route.ts) treats ''
    // and null identically when dropping unknown-availability rows, but
    // null is the honest "we don't know" signal; '' looked like a
    // successful-but-empty parse.
    //
    // Fall back to mining the free-form description when the structured
    // .attrgroup field didn't have it — many CL posts only state
    // availability in the prose (e.g. "*Available 8/1", "August 1st
    // MOVE-IN"), confirmed via a live diagnostic dump of 10 real listings
    // with null availability_date. Structured field wins when present —
    // it's unambiguous; description mining is regex-over-prose and used
    // only as a fallback.
    const availabilityDate =
      parseAvailabilityDate(item.availableFrom, item.datetime ?? null) ??
      extractAvailabilityFromDescription(item.post, item.datetime ?? null);

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
      // BUG FIX: item.post (the scraped post body) was extracted by
      // DETAIL_PAGE_FUNCTION and used for beds/baths text extraction above,
      // but was never actually written to the `description` field — the
      // column and AdapterOutput field both exist (see row.ts / types.ts),
      // it was just silently dropped here. Confirmed live: 100% of
      // source='craigslist' rows had description = null in the DB, for
      // every row ever scraped. This also means extractAvailabilityFromDescription
      // above only mines a live scrape's in-memory item.post — going
      // forward, description is finally persisted too.
      description: item.post || null,
      list_date: item.datetime ?? null,
      last_update_date: null,
      availability_date: availabilityDate,
      source: "craigslist" as const,
      external_id: item.id ?? null,
    });
  }

  console.log(
    `[Craigslist] Done: ${listings.length} new listings ready for pipeline`,
  );

  return {
    listings,
    total: listings.length,
    discovered: uniqueUrls.length,
    blocked: blocked || detailBlocked,
    staticVariantMissing,
    sapiTotalResultCount,
    sapiInRegionCount,
    fetched: fetchedCount,
    skipped: skippedCount,
    blockedAtUrl,
  };
}
