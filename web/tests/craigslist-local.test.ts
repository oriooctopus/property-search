/**
 * End-to-end tests for lib/sources/craigslist-local.ts: the REAL
 * SEARCH_ONLY_PAGE_FUNCTION / DETAIL_PAGE_FUNCTION strings (imported from
 * lib/sources/craigslist.ts, never redefined here) run against a REAL local
 * headless Chromium, with every network request served from saved fixtures
 * in tests/fixtures/craigslist/ via Playwright's page.route — no live
 * Craigslist traffic.
 *
 * QA ids in each test's comment refer to
 * /home/esme/.claude/jobs/2ab1ae70/tmp/qa-scenarios.md.
 *
 * Every createLocalRunner() call in this file passes a TEMP lockPath
 * (tmpLockPath() below) — the real production path is
 * ~/.local/state/dwelligence/craigslist-local.lock, which a concurrent real
 * run may be holding while this suite executes. Using the default path here
 * would either collide with that real run (CraigslistLockHeldError, nothing
 * to do with this test) or steal the lock out from under it.
 *
 * Run with: npx vitest run tests/craigslist-local.test.ts
 */

import { describe, it, expect, vi, afterAll } from "vitest";
import { readFileSync, mkdtempSync, utimesSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Page, Browser } from "playwright";
import { createLocalRunner, CraigslistLockHeldError } from "../lib/sources/craigslist-local";
import {
  fetchCraigslistListings,
  CraigslistBlockedError,
  CraigslistNetworkError,
  type PageFunctionRunner,
} from "../lib/sources/craigslist";
import type { SearchParams } from "../lib/sources/types";
import { selectCraigslistRunner } from "../lib/ingest/strategies";
import { validateAndNormalize } from "../lib/sources/pipeline";

const FIXTURES_DIR = join(__dirname, "fixtures/craigslist");
const SEARCH_HTML = readFileSync(join(FIXTURES_DIR, "search-brk-2026-08-28.html"), "utf8");
const SAPI_JSON = readFileSync(join(FIXTURES_DIR, "sapi-brk-2026-08-28.json"), "utf8");
const DETAIL_1_HTML = readFileSync(join(FIXTURES_DIR, "detail-1-2026-08-28.html"), "utf8");
const DETAIL_2_HTML = readFileSync(join(FIXTURES_DIR, "detail-2-2026-08-28.html"), "utf8");
const DETAIL_3_HTML = readFileSync(join(FIXTURES_DIR, "detail-3-2026-08-28.html"), "utf8");

// The canonical urls the detail fixtures were captured from (og:url /
// canonical <link>, confirmed identical in each file). DETAIL_PAGE_FUNCTION
// reads window.location.href for its `url`/`id` fields, so navigating to
// this EXACT string and serving the fixture body at that exact request URL
// (no redirect) makes the returned row's `url` equal this constant.
const DETAIL_1_URL =
  "https://www.craigslist.org/view/d/long-island-city-spacious-bedroom-in/o6LNrAKdqnGQPS7hxeuGs1";
const DETAIL_2_URL =
  "https://www.craigslist.org/view/d/brooklyn-no-fee-bed-next-to-prospect/xq957WHuRi1Xj8cAMDSXzz";
const DETAIL_3_URL =
  "https://www.craigslist.org/view/d/brooklyn-top-line-2br-2ba-prospect/9r424pQfNA24fdPHxAtEX4";

// Matches exactly what lib/sources/craigslist.ts's fetchCraigslistListings
// builds for the brk borough with the pipeline's 1-2BR/$3000-5000 band — see
// SEARCH_ONLY_PAGE_FUNCTION's redesign comment for why this exact form
// (rather than the old newyork.craigslist.org/search/<brc>/apa form).
const SEARCH_URL =
  "https://www.craigslist.org/search/subarea/brk?cat=apa&min_price=3000&max_price=5000&min_bedrooms=1&max_bedrooms=2&availabilityMode=0";

const NYC_PARAMS: SearchParams = { city: "New York", stateCode: "NY", priceMin: 3000, priceMax: 5000, bedsMin: 1, bedsMax: 2 };

function tmpLockPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "cl-lock-test-"));
  return join(dir, "craigslist-local.lock");
}

/** Every /view/d/ href actually present in a search-page fixture, deduped by href string the same way extractStaticHrefs does. Computed from the file, never hard-coded. */
function distinctViewDHrefs(html: string): string[] {
  const hrefs = new Set<string>();
  const re = /href="([^"]*\/view\/d\/[^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) hrefs.add(m[1]);
  return [...hrefs];
}

type DetailRouteSpec = string | { status: 404 } | { neverResponds: true };

interface RouteRecorder {
  searchHits: number[];
  /** Every hit to a URL registered in opts.details, in request order (across all distinct URLs) — used to measure QA E17's inter-load timing. */
  detailSequence: { url: string; ts: number }[];
  /** Per-URL hit counts for registered detail URLs — used to assert retries and "never requested after a block". */
  detailHitCounts: Record<string, number>;
}

/**
 * Installs a single page.route("**\/*") handler that serves fixtures for the
 * search URL / sapi.craigslist.org / a map of exact detail URLs, and 204s
 * everything else (images, css, js the fixture HTML references — none of
 * which the extraction logic needs, since CL's static markup is already in
 * the saved HTML with no client-side rendering required).
 */
function installRoutes(
  page: Page,
  opts: {
    searchHtml?: string | null;
    sapiJson?: string | null;
    details?: Record<string, DetailRouteSpec>;
  },
): RouteRecorder {
  const rec: RouteRecorder = { searchHits: [], detailSequence: [], detailHitCounts: {} };
  page.route("**/*", async (route) => {
    const req = route.request();
    const url = req.url();
    const now = Date.now();
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    if (u.hostname === "www.craigslist.org" && u.pathname.startsWith("/search/")) {
      rec.searchHits.push(now);
      if (opts.searchHtml != null) {
        await route.fulfill({ status: 200, contentType: "text/html", body: opts.searchHtml });
      } else {
        await route.fulfill({ status: 204, body: "" });
      }
      return;
    }

    if (u.hostname === "sapi.craigslist.org") {
      if (opts.sapiJson != null) {
        // access-control-allow-origin is load-bearing: the pageFunction's
        // sapi call is a real cross-origin fetch (sapi.craigslist.org from a
        // www.craigslist.org page) — without this header the browser's CORS
        // check rejects the response before the page ever sees it, even
        // though we're the one fulfilling it.
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
          body: opts.sapiJson,
        });
      } else {
        await route.fulfill({ status: 204, body: "" });
      }
      return;
    }

    const detail = opts.details?.[url];
    if (detail !== undefined) {
      rec.detailSequence.push({ url, ts: now });
      rec.detailHitCounts[url] = (rec.detailHitCounts[url] ?? 0) + 1;
      if (typeof detail === "string") {
        await route.fulfill({ status: 200, contentType: "text/html", body: detail });
      } else if ("status" in detail) {
        await route.fulfill({ status: 404, contentType: "text/html", body: "Not Found" });
      } else {
        // neverResponds: deliberately never call route.fulfill/continue/abort
        // — the request stays pending until page.goto's own timeout fires.
        // This is how QA E13 (a detail page that never responds) is
        // exercised.
        return;
      }
      return;
    }

    await route.fulfill({ status: 204, body: "" });
  });
  return rec;
}

/** A minimal Craigslist bot-block interstitial page — no posting content, just the documented block copy. */
function blockPageHtml(marker = "This IP has been automatically blocked"): string {
  return `<html><head><title>Blocked</title></head><body><h1>${marker}</h1><p>Please try again later.</p></body></html>`;
}

// Track every Browser this file launches so afterAll asserts none leaked,
// belt-and-suspenders on top of each test's own runner.close() (QA B1/B2).
const launchedBrowsers: Browser[] = [];
afterAll(async () => {
  for (const b of launchedBrowsers) {
    if (b.isConnected()) await b.close().catch(() => {});
  }
});

// ===========================================================================
// 1. Search happy path
// ===========================================================================
describe("search happy path", () => {
  it("QA search-happy-path: discovers every /view/d/ href in the fixture, plus one sapi summary row, no blocked", async () => {
    let rec!: RouteRecorder;
    const runner = createLocalRunner({
      lockPath: tmpLockPath(),
      prepPage: async (page) => {
        const b = page.context().browser();
        if (b) launchedBrowsers.push(b);
        rec = installRoutes(page, { searchHtml: SEARCH_HTML, sapiJson: SAPI_JSON });
      },
    });
    try {
      const rows = (await runner.runSearch(SEARCH_URL)) as Array<Record<string, unknown>>;

      const expectedHrefs = distinctViewDHrefs(SEARCH_HTML);
      expect(expectedHrefs.length).toBeGreaterThan(0);

      const listingRows = rows.filter(
        (r) => typeof r.url === "string" && /\/view\/d\//.test(r.url as string),
      );
      expect(listingRows).toHaveLength(expectedHrefs.length);
      expect(new Set(listingRows.map((r) => r.url))).toEqual(new Set(expectedHrefs));

      const summaryRows = rows.filter((r) => r.sapiSummary === true);
      expect(summaryRows).toHaveLength(1);
      expect(summaryRows[0].sapiTotalResultCount).toBe(JSON.parse(SAPI_JSON).data.totalResultCount);
      expect(summaryRows[0].blocked).not.toBe(true);

      expect(rows.some((r) => r.blocked === true)).toBe(false);
      expect(rec.searchHits.length).toBeGreaterThan(0);
    } finally {
      await runner.close();
    }
  }, 60_000);
});

// ===========================================================================
// 1b. Static-list phase, relative hrefs — the real "search happy path" test
//     above only exercises SEARCH_HTML, which (per the redesign comment in
//     SEARCH_ONLY_PAGE_FUNCTION) carries BOTH DOM variants with absolute
//     hrefs already. That leaves the STATIC-ONLY branch of the union (the
//     `[...staticHrefs, ...galleryHrefs]` line) and href absolutization
//     (`href.startsWith('http') ? href : 'https://www.craigslist.org' + href`)
//     un-exercised on their own: a mutation dropping either one still passed
//     the happy-path test, because SEARCH_HTML's gallery variant covers for
//     a broken static path and its hrefs are already absolute. This fixture
//     has ONLY li.cl-static-search-result cards with RELATIVE hrefs and NO
//     [data-pid] cards at all, isolating both code paths.
// ===========================================================================
describe("static-list phase — relative hrefs, no gallery cards", () => {
  const STATIC_ONLY_HTML = `<!DOCTYPE html>
<html><head><title>brooklyn apts for rent</title></head>
<body>
<form id="searchform"></form>
<ul class="rows">
<li class="cl-static-search-result"><a href="/view/d/foo-bar/AbC123def456GhI789jkL"><span class="title">Foo Bar Apt</span></a></li>
<li class="cl-static-search-result"><a href="/view/d/baz-qux/DeF456ghI789jKl012mNo"><span class="title">Baz Qux Apt</span></a></li>
</ul>
</body></html>`;

  it("li.cl-static-search-result relative hrefs are discovered and absolutized to https://www.craigslist.org/...", async () => {
    const runner = createLocalRunner({
      lockPath: tmpLockPath(),
      prepPage: async (page) => {
        const b = page.context().browser();
        if (b) launchedBrowsers.push(b);
        // No sapiJson => sapi call gets CORS-blocked/204'd, which is fine —
        // this test only asserts on discovered listing URLs, not the sapi
        // summary row (covered separately by "search happy path" and E8).
        installRoutes(page, { searchHtml: STATIC_ONLY_HTML, sapiJson: null });
      },
    });
    try {
      const rows = (await runner.runSearch(SEARCH_URL)) as Array<Record<string, unknown>>;
      const listingRows = rows.filter(
        (r) => typeof r.url === "string" && /\/view\/d\//.test(r.url as string),
      );
      expect(listingRows).toHaveLength(2);
      expect(new Set(listingRows.map((r) => r.url))).toEqual(
        new Set([
          "https://www.craigslist.org/view/d/foo-bar/AbC123def456GhI789jkL",
          "https://www.craigslist.org/view/d/baz-qux/DeF456ghI789jKl012mNo",
        ]),
      );
    } finally {
      await runner.close();
    }
  }, 60_000);
});

// ===========================================================================
// 2. E18 — the search page's own URL must never be treated as a discovered
//    listing. Pure fetchCraigslistListings post-processing logic (the
//    LISTING_URL_RE filter in craigslist.ts) — no real browser needed.
// ===========================================================================
describe("E18 — a blocked/summary row's own url is not a discovered listing", () => {
  it("blocked:true row with url = search page url produces zero detail fetches", async () => {
    const runDetail = vi.fn(async (_urls: string[]) => [] as unknown[]);
    const stubRunner: PageFunctionRunner = {
      name: "stub",
      runSearch: async (startUrl) => [
        { blocked: true, url: startUrl, blockTitle: "Blocked", blockSnippet: "automatically blocked" },
      ],
      runDetail,
    };
    const res = await fetchCraigslistListings(NYC_PARAMS, { runner: stubRunner });
    expect(runDetail).not.toHaveBeenCalled();
    expect(res.blocked).toBe(true);
    expect(res.discovered).toBe(0);
  });
});

// ===========================================================================
// 2b. Phase 2 CraigslistBlockedError propagation — the audit found no test
//     exercising fetchCraigslistListings' own catch(e instanceof
//     CraigslistBlockedError) branch in craigslist.ts (~1246-1256): a stub
//     runner whose runDetail throws mid-scrape, asserting the partial items
//     still flow through the SAME post-processing (dedup, price/beds/baths
//     mapping) as a normal run, not a special-cased shortcut.
// ===========================================================================
describe("Phase 2 — CraigslistBlockedError propagation", () => {
  it("runDetail throws CraigslistBlockedError with 1 partial item => blocked:true, blockedAtUrl set, partial item mapped through real post-processing", async () => {
    const urls = [
      "https://www.craigslist.org/view/d/a/AAAAAAAAAAAAAAAAAAAAAA",
      "https://www.craigslist.org/view/d/b/BBBBBBBBBBBBBBBBBBBBBB",
      "https://www.craigslist.org/view/d/c/CCCCCCCCCCCCCCCCCCCCCC",
    ];
    // A realistic single ApifyCLItem-shaped row for urls[1] (the URL the
    // block happened at) — exercises the SAME item->AdapterOutput mapping
    // (parsePrice, ldBeds/ldBaths parseFloat, lat/lon parseFloat) a normal
    // successful detail fetch goes through, not a shortcut.
    const partialRow = {
      url: urls[1],
      title: "Sunny 2BR near the park",
      price: "$4,200",
      location: "123 Test St, Brooklyn, NY",
      latitude: "40.70",
      longitude: "-73.95",
      pics: ["https://images.craigslist.org/abc_600x450.jpg"],
      post: "Great apartment, come see it.",
      datetime: "2026-08-28T12:00:00-0400",
      ldBeds: "2",
      ldBaths: "1",
      id: "BBBBBBBBBBBBBBBBBBBBBB",
    };
    const runDetail = vi.fn(async (_urls: string[]) => {
      throw new CraigslistBlockedError("BOT BLOCK DETECTED mid-detail", [partialRow], urls[1]);
    });
    const stubRunner: PageFunctionRunner = {
      name: "stub",
      runSearch: async () => [
        ...urls.map((url) => ({ url })),
        { sapiSummary: true, sapiTotalResultCount: urls.length },
      ],
      runDetail,
    };
    const res = await fetchCraigslistListings(NYC_PARAMS, { runner: stubRunner });
    expect(runDetail).toHaveBeenCalledTimes(1);
    expect(res.blocked).toBe(true);
    expect(res.blockedAtUrl).toBe(urls[1]);
    expect(res.fetched).toBe(1);
    expect(res.listings).toHaveLength(1);
    const listing = res.listings[0];
    expect(listing.url).toBe(urls[1]);
    expect(listing.price).toBe(4200);
    expect(listing.beds).toBe(2);
    expect(listing.baths).toBe(1);
  });
});

// ===========================================================================
// 3. E1 — static-variant miss: reload loop then a loud zero
// ===========================================================================
describe("E1 — static variant miss", () => {
  it("neither [data-pid] nor li.cl-static-search-result present => reload(s) then staticVariantMissing, no blocked", async () => {
    // Strip every [data-pid] attribute and neutralize the
    // cl-static-search-result class token — extractStaticHrefs only reads
    // `li.cl-static-search-result > a[href]` and `[data-pid] a[href]`, so
    // this makes it find zero cards on every attempt regardless of the
    // page's other wrapper elements (.gallery-card, .cl-search-result)
    // still being present and satisfying the broader waitForSelector call
    // (so this does NOT hit the 15s "results never appeared" timeout path
    // — it hits the separate "cards found but zero hrefs extracted" path).
    const stripped = SEARCH_HTML
      .replace(/\sdata-pid="[^"]*"/g, "")
      .replace(/cl-static-search-result/g, "cl-static-search-result-x");
    // (No sanity pre-check here: distinctViewDHrefs is a flat href regex
    // that ignores DOM ancestry, so it can't tell whether the transform
    // actually broke extraction — extractStaticHrefs requires the anchor to
    // be a DESCENDANT of `[data-pid]` or `li.cl-static-search-result`, which
    // a flat regex has no way to check. The real evidence is the assertions
    // below, which run the actual production code against the transformed
    // HTML in a real browser.)

    let rec!: RouteRecorder;
    const runner = createLocalRunner({
      lockPath: tmpLockPath(),
      prepPage: async (page) => {
        const b = page.context().browser();
        if (b) launchedBrowsers.push(b);
        rec = installRoutes(page, { searchHtml: stripped, sapiJson: SAPI_JSON });
      },
    });
    try {
      const rows = (await runner.runSearch(SEARCH_URL)) as Array<Record<string, unknown>>;

      // SEARCH_ONLY_PAGE_FUNCTION's retry loop is
      //   for (attempt = 1; attempt <= MAX_VARIANT_RETRIES=3; attempt++) {
      //     extract; if (found) break;
      //     if (attempt < MAX_VARIANT_RETRIES) reload();
      //   }
      // — reload only fires on attempts 1 and 2 (attempt 3's guard is
      // false), so there are exactly 2 reloads, not 3. Total requests to
      // the search URL = 1 initial page.goto + 2 reloads = 3. Asserting the
      // actual count the code produces, not the naive "3 reloads" reading.
      expect(rec.searchHits).toHaveLength(3);

      const missingRow = rows.find((r) => r.staticVariantMissing === true);
      expect(missingRow).toBeTruthy();
      expect(missingRow?.zeroResults).toBe(true);
      expect(rows.some((r) => r.blocked === true)).toBe(false);
    } finally {
      await runner.close();
    }
  }, 60_000);
});

// ===========================================================================
// 4. E5/E3 — block on the search page => zero detail fetches
// ===========================================================================
describe("E5/E3 — block on search page", () => {
  it("search page body is a bot-block interstitial => blocked:true, zero detail fetches", async () => {
    const runner = createLocalRunner({
      lockPath: tmpLockPath(),
      prepPage: async (page) => {
        const b = page.context().browser();
        if (b) launchedBrowsers.push(b);
        // No results shell at all — this fixture has none of
        // li.cl-static-search-result / [data-pid] / .gallery-card /
        // .cl-search-result / #searchform / .filter-column / .cl-app-anchor,
        // so SEARCH_ONLY_PAGE_FUNCTION's initial waitForSelector times out
        // (15s, hardcoded in the pageFunction string — not overridable),
        // falls into its catch block, and matches "automatically blocked"
        // against CL_BLOCK_MARKERS.
        installRoutes(page, { searchHtml: blockPageHtml(), sapiJson: null });
      },
    });
    const runDetail = vi.fn(async (_urls: string[]) => [] as unknown[]);
    const wrapped: PageFunctionRunner = {
      name: "wrapped-local",
      runSearch: (u) => runner.runSearch(u),
      runDetail,
    };
    try {
      const res = await fetchCraigslistListings(NYC_PARAMS, { runner: wrapped });
      expect(res.blocked).toBe(true);
      expect(runDetail).not.toHaveBeenCalled();
    } finally {
      await runner.close();
    }
  }, 60_000);
});

// ===========================================================================
// 4b. E3 — network-level failure (DNS/connection), distinct from a bot-block.
//     A block means "the site responded but doesn't want us"; a network
//     error means "we can't reach the site at all" (see CraigslistNetworkError's
//     doc comment in craigslist.ts) — these must produce different, callers-
//     distinguishable outcomes, not both collapse into a generic failure.
// ===========================================================================
describe("E3 — network-level failure", () => {
  it("search page navigation aborted (namenotresolved) => runSearch rejects with CraigslistNetworkError", async () => {
    const runner = createLocalRunner({
      lockPath: tmpLockPath(),
      prepPage: async (page) => {
        const b = page.context().browser();
        if (b) launchedBrowsers.push(b);
        await page.route("**/*", async (route) => {
          const url = route.request().url();
          if (url === SEARCH_URL) {
            await route.abort("namenotresolved");
            return;
          }
          await route.fulfill({ status: 204, body: "" });
        });
      },
    });
    try {
      await expect(runner.runSearch(SEARCH_URL)).rejects.toBeInstanceOf(CraigslistNetworkError);
    } finally {
      await runner.close();
    }
  }, 60_000);

  it("2nd of 3 detail URLs aborted (namenotresolved) => runDetail rejects with CraigslistNetworkError, 3rd URL never requested", async () => {
    const urls = [
      DETAIL_1_URL,
      "https://www.craigslist.org/view/d/network-fail/NETFAILTOKEN000000001",
      DETAIL_3_URL,
    ];
    const hitUrls: string[] = [];
    const runner = createLocalRunner({
      lockPath: tmpLockPath(),
      prepPage: async (page) => {
        const b = page.context().browser();
        if (b) launchedBrowsers.push(b);
        await page.route("**/*", async (route) => {
          const url = route.request().url();
          if (url === urls[1]) {
            hitUrls.push(url);
            await route.abort("namenotresolved");
            return;
          }
          if (url === urls[0]) {
            hitUrls.push(url);
            await route.fulfill({ status: 200, contentType: "text/html", body: DETAIL_1_HTML });
            return;
          }
          if (url === urls[2]) {
            hitUrls.push(url);
            await route.fulfill({ status: 200, contentType: "text/html", body: DETAIL_3_HTML });
            return;
          }
          await route.fulfill({ status: 204, body: "" });
        });
      },
    });
    try {
      let caught: unknown = null;
      try {
        await runner.runDetail(urls);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CraigslistNetworkError);
      // Exactly [urls[0], urls[1]] were hit, in that order — urls[2] is
      // never requested because a network error is fatal for the whole run
      // (no partial-progress path, unlike a bot-block — see
      // CraigslistNetworkError's doc comment).
      expect(hitUrls).toEqual([urls[0], urls[1]]);
    } finally {
      await runner.close();
    }
  }, 60_000);
});

// ===========================================================================
// 5. Detail happy path
// ===========================================================================
describe("detail happy path", () => {
  it("QA detail-happy-path: three fixtures => three rows with real price/beds/baths/lat/lon/location", async () => {
    let rec!: RouteRecorder;
    const runner = createLocalRunner({
      lockPath: tmpLockPath(),
      prepPage: async (page) => {
        const b = page.context().browser();
        if (b) launchedBrowsers.push(b);
        rec = installRoutes(page, {
          details: {
            [DETAIL_1_URL]: DETAIL_1_HTML,
            [DETAIL_2_URL]: DETAIL_2_HTML,
            [DETAIL_3_URL]: DETAIL_3_HTML,
          },
        });
      },
    });
    try {
      const rows = (await runner.runDetail([DETAIL_1_URL, DETAIL_2_URL, DETAIL_3_URL])) as Array<
        Record<string, unknown>
      >;
      expect(rows).toHaveLength(3);
      const byUrl = Object.fromEntries(rows.map((r) => [r.url, r]));

      // Values below were read directly from the fixture files (grep on
      // class="price", the ld_posting_data JSON-LD block's
      // numberOfBedrooms/numberOfBathroomsTotal/latitude/longitude/address),
      // not invented — see the report for the exact commands used.
      const d1 = byUrl[DETAIL_1_URL];
      expect(d1.price).toBe("$4,500");
      expect(d1.ldBeds).toBe("3");
      expect(d1.ldBaths).toBe("1");
      expect(d1.latitude).toBe("40.735918");
      expect(d1.longitude).toBe("-73.954275");
      expect(d1.location).toBe("Dupont st, Long Island City, NY");
      expect(Array.isArray(d1.pics)).toBe(true);
      expect((d1.pics as unknown[]).length).toBeGreaterThan(0);

      const d3 = byUrl[DETAIL_3_URL];
      expect(d3.price).toBe("$4,525");
      expect(d3.ldBeds).toBe("2");
      expect(d3.ldBaths).toBe("2");
      expect(d3.latitude).toBe("40.679373");
      expect(d3.longitude).toBe("-73.961799");
      expect(d3.location).toBe("527 Grand Ave, Brooklyn, NY");

      const d2 = byUrl[DETAIL_2_URL];
      expect(d2.price).toBe("$4,395");
      expect(d2.ldBeds).toBe("3");
      expect(d2.ldBaths).toBe("3");
      expect(d2.latitude).toBe("40.662800");
      expect(d2.longitude).toBe("-73.954600");

      expect(rec.detailHitCounts[DETAIL_1_URL]).toBe(1);
      expect(rec.detailHitCounts[DETAIL_2_URL]).toBe(1);
      expect(rec.detailHitCounts[DETAIL_3_URL]).toBe(1);
    } finally {
      await runner.close();
    }
  }, 60_000);
});

// ===========================================================================
// 5b. Delayed body-content race (incident 2026-08-28): a real ingest run
//     found 108/258 detail pages came back with null title/price despite the
//     pages being live with a visible price. Root cause: DETAIL_PAGE_FUNCTION's
//     readiness wait used to include script[type="application/ld+json"] —
//     which sits in <head> and is attached at parse time, BEFORE the body
//     actually renders — so the wait could resolve on that match alone and
//     extraction ran against a still-empty body. This fixture reproduces the
//     race directly: ld+json is present in <head> immediately, but the real
//     body content (span#titletextonly/span.price/#postingbody) is injected
//     1500ms later via an inline <script>/setTimeout — nothing about this
//     fixture depends on live Craigslist, it's a synthetic repro of the
//     load-order gap itself.
// ===========================================================================
describe("delayed body-content race — extraction must wait for real content, not just ld+json", () => {
  const DELAYED_URL = "https://www.craigslist.org/view/d/delayed/DELAYEDTOKEN000000001";
  // ld+json intentionally omits price — DETAIL_PAGE_FUNCTION's price field
  // ONLY ever comes from span.price's DOM text (see `const priceEl =
  // document.querySelector('span.price')` in craigslist.ts), never from ld —
  // so price is the field this test uses to prove extraction actually waited
  // for the injected content rather than resolving early off ld.name alone.
  const DELAYED_HTML = `<!DOCTYPE html>
<html><head><title>Delayed Listing | brooklyn apts</title>
<script type="application/ld+json">{"@type":"Apartment","name":"Delayed Listing","numberOfBedrooms":2,"numberOfBathroomsTotal":1,"latitude":40.70,"longitude":-73.95,"address":{"streetAddress":"123 Delay St","addressLocality":"Brooklyn","addressRegion":"NY"}}</script>
</head>
<body>
<div id="late-content-placeholder"></div>
<script>
setTimeout(function () {
  document.getElementById("late-content-placeholder").innerHTML =
    '<span id="titletextonly">Delayed Listing</span>' +
    '<span class="price">$4,000</span>' +
    '<section id="postingbody">Great place, come see it, arrives late on purpose.</section>';
}, 1500);
</script>
</body></html>`;

  it("body content injected 1500ms after navigation is still extracted (title/price/post non-empty)", async () => {
    const runner = createLocalRunner({
      lockPath: tmpLockPath(),
      prepPage: async (page) => {
        const b = page.context().browser();
        if (b) launchedBrowsers.push(b);
        installRoutes(page, { details: { [DELAYED_URL]: DELAYED_HTML } });
      },
    });
    try {
      const rows = (await runner.runDetail([DELAYED_URL])) as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.__skipped).not.toBe(true);
      expect(row.title).toBe("Delayed Listing");
      // The discriminating assertion: price/post only ever come from the
      // delayed DOM elements, never from ld+json — under the pre-fix
      // selector list + no local-runner wait, these read "" because
      // extraction ran before the setTimeout fired.
      expect(row.price).toBe("$4,000");
      expect(String(row.post)).toContain("arrives late on purpose");
    } finally {
      await runner.close();
    }
  }, 60_000);
});

// ===========================================================================
// 6. E4 — false-positive block markers inside a real posting body must NOT
//    halt the run
// ===========================================================================
describe("E4 — block markers inside real posting content are not a block", () => {
  it('postingbody containing "denied"/"blocked" text extracts normally, not blocked', async () => {
    const injected =
      "Applications denied without proof of income; sink was blocked last year.";
    expect(DETAIL_1_HTML).toContain('<section id="postingbody">');
    const html = DETAIL_1_HTML.replace(
      '<section id="postingbody">',
      `<section id="postingbody">${injected} `,
    );
    expect(html).not.toBe(DETAIL_1_HTML); // sanity: injection actually happened

    let rec!: RouteRecorder;
    const runner = createLocalRunner({
      lockPath: tmpLockPath(),
      prepPage: async (page) => {
        const b = page.context().browser();
        if (b) launchedBrowsers.push(b);
        rec = installRoutes(page, { details: { [DETAIL_1_URL]: html } });
      },
    });
    try {
      const rows = (await runner.runDetail([DETAIL_1_URL])) as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.blocked).not.toBe(true);
      expect(row.__skipped).not.toBe(true);
      expect(row.price).toBe("$4,500"); // normal extraction still ran
      expect(typeof row.post).toBe("string");
      expect(row.post as string).toContain(injected);
      expect(rec.detailHitCounts[DETAIL_1_URL]).toBe(1); // no retry triggered
    } finally {
      await runner.close();
    }
  }, 60_000);
});

// ===========================================================================
// 7. E6 — block mid-detail: stop immediately, keep partial progress, never
//    request the URL after the block
// ===========================================================================
describe("E6 — block mid-detail scrape", () => {
  it("[good, blockpage, good] => CraigslistBlockedError with 1 partial item, blockedAtUrl = 2nd url, 3rd never requested", async () => {
    const BLOCK_URL = "https://www.craigslist.org/view/d/blockpage/BLOCKTOKEN000000000001";
    let rec!: RouteRecorder;
    const runner = createLocalRunner({
      lockPath: tmpLockPath(),
      prepPage: async (page) => {
        const b = page.context().browser();
        if (b) launchedBrowsers.push(b);
        rec = installRoutes(page, {
          details: {
            [DETAIL_1_URL]: DETAIL_1_HTML,
            [BLOCK_URL]: blockPageHtml(),
            [DETAIL_3_URL]: DETAIL_3_HTML,
          },
        });
      },
    });
    try {
      let caught: unknown = null;
      try {
        await runner.runDetail([DETAIL_1_URL, BLOCK_URL, DETAIL_3_URL]);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CraigslistBlockedError);
      const err = caught as CraigslistBlockedError;
      expect(err.partialItems).toHaveLength(1);
      expect((err.partialItems[0] as Record<string, unknown>).url).toBe(DETAIL_1_URL);
      expect(err.blockedAtUrl).toBe(BLOCK_URL);
      expect(rec.detailHitCounts[DETAIL_3_URL]).toBeUndefined();
    } finally {
      await runner.close();
    }
  }, 60_000);
});

// ===========================================================================
// 8. E12 — 404 on a detail page => counted skip, run continues
// ===========================================================================
describe("E12 — 404 detail page", () => {
  it("404 => __skipped with http-404 reason, next URL still fetched", async () => {
    const NOT_FOUND_URL = "https://www.craigslist.org/view/d/gone/GONETOKEN0000000000001";
    const runner = createLocalRunner({
      lockPath: tmpLockPath(),
      prepPage: async (page) => {
        const b = page.context().browser();
        if (b) launchedBrowsers.push(b);
        installRoutes(page, {
          details: { [NOT_FOUND_URL]: { status: 404 }, [DETAIL_1_URL]: DETAIL_1_HTML },
        });
      },
    });
    try {
      const rows = (await runner.runDetail([NOT_FOUND_URL, DETAIL_1_URL])) as Array<
        Record<string, unknown>
      >;
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ url: NOT_FOUND_URL, __skipped: true, __skipReason: "http-404" });
      expect(rows[1].url).toBe(DETAIL_1_URL);
      expect(rows[1].__skipped).not.toBe(true);
      expect(rows[1].price).toBe("$4,500");
    } finally {
      await runner.close();
    }
  }, 60_000);
});

// ===========================================================================
// 9. E13 — a detail page that never responds: one retry, then skip, run
//    continues
// ===========================================================================
describe("E13 — detail page never responds", () => {
  it("navigation never resolves => bounded retry then skip, next URL still fetched", async () => {
    const HANG_URL = "https://www.craigslist.org/view/d/hangs/HANGTOKEN00000000000001";
    let rec!: RouteRecorder;
    const runner = createLocalRunner({
      lockPath: tmpLockPath(),
      navTimeoutMs: 800, // short so this test doesn't wait 2x45s
      prepPage: async (page) => {
        const b = page.context().browser();
        if (b) launchedBrowsers.push(b);
        rec = installRoutes(page, {
          details: { [HANG_URL]: { neverResponds: true }, [DETAIL_1_URL]: DETAIL_1_HTML },
        });
      },
    });
    try {
      const rows = (await runner.runDetail([HANG_URL, DETAIL_1_URL])) as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(2);
      expect(rows[0].url).toBe(HANG_URL);
      expect(rows[0].__skipped).toBe(true);
      expect(String(rows[0].__skipReason)).toMatch(/timeout/i);
      expect(rec.detailHitCounts[HANG_URL]).toBe(2); // 1 initial attempt + 1 bounded retry
      expect(rows[1].url).toBe(DETAIL_1_URL);
      expect(rows[1].__skipped).not.toBe(true);
    } finally {
      await runner.close();
    }
  }, 60_000);
});

// ===========================================================================
// 9b. End-to-end on fixtures: the real local runner (fixtures via
//     prepPage/route) through the real fetchCraigslistListings (no supabase)
//     and then the real validateAndNormalize from lib/sources/pipeline.ts.
//     Exercises the full production path in one pass — the seam-level tests
//     above (detail happy path, E4, E6, etc.) each verify one piece; this
//     verifies they compose correctly end to end, including the pipeline's
//     own bedroom/price gate deciding which of the 3 fixtures survive.
// ===========================================================================
describe("end-to-end: fixtures -> real local runner -> real fetchCraigslistListings -> real validateAndNormalize", () => {
  it("3 detail fixtures (two 3BR, one 2BR $4,525) => exactly 1 accepted listing, 2 rejected for bedrooms", async () => {
    let rec!: RouteRecorder;
    const localRunner = createLocalRunner({
      lockPath: tmpLockPath(),
      prepPage: async (page) => {
        const b = page.context().browser();
        if (b) launchedBrowsers.push(b);
        rec = installRoutes(page, {
          details: {
            [DETAIL_1_URL]: DETAIL_1_HTML,
            [DETAIL_2_URL]: DETAIL_2_HTML,
            [DETAIL_3_URL]: DETAIL_3_HTML,
          },
        });
      },
    });
    try {
      // Wrap the real local runner's runDetail behind a stub runSearch that
      // "discovers" exactly these 3 URLs — isolates this test to Phase
      // 2/pipeline behavior without also depending on the search-page
      // extraction logic already covered by "search happy path" above.
      const wrapped: PageFunctionRunner = {
        name: "wrapped-local-e2e",
        runSearch: async () => [DETAIL_1_URL, DETAIL_2_URL, DETAIL_3_URL].map((url) => ({ url })),
        runDetail: (urls) => localRunner.runDetail(urls),
      };

      const res = await fetchCraigslistListings(NYC_PARAMS, { runner: wrapped });
      expect(res.blocked).toBe(false);
      expect(res.listings).toHaveLength(3); // all 3 pass fetchCraigslistListings' own price>0/title gate

      const { listings, rejected } = validateAndNormalize(res.listings, "craigslist");

      expect(listings).toHaveLength(1);
      expect(rejected).toHaveLength(2);
      // DETAIL_1_HTML/DETAIL_2_HTML are ldBeds="3" (confirmed in "detail
      // happy path" above via a direct grep of the fixtures) — both outside
      // the pipeline's 1-2BR band; DETAIL_3_HTML is the ldBeds="2" one.
      expect(new Set(rejected.map((r) => r.url))).toEqual(new Set([DETAIL_1_URL, DETAIL_2_URL]));
      for (const r of rejected) expect(r.reason).toBe("bedrooms outside 1-2");

      const accepted = listings[0];
      expect(accepted.url).toBe(DETAIL_3_URL);
      expect(accepted.price).toBe(4525);
      expect(typeof accepted.price).toBe("number");
      expect(accepted.beds).toBe(2);
      expect(typeof accepted.baths).toBe("number");
      expect(accepted.baths).toBe(2); // DETAIL_3's ldBaths="2", confirmed in "detail happy path" above
      expect(typeof accepted.lat).toBe("number");
      expect(typeof accepted.lon).toBe("number");
      expect(accepted.lat).toBeCloseTo(40.679373, 5);
      expect(accepted.lon).toBeCloseTo(-73.961799, 5);
      expect(accepted.source).toBe("craigslist");
      expect(accepted.description).toBeTruthy();
      expect(typeof accepted.description).toBe("string");

      // external_id is set by fetchCraigslistListings' item->AdapterOutput
      // mapping (item.id ?? null, craigslist.ts) but toValidatedListing()
      // (pipeline.ts) does NOT currently carry it forward onto
      // ValidatedListing — so it's asserted here on the pre-pipeline
      // AdapterOutput (res.listings), which is where the mapping this
      // item's mutation target actually lives, not on the post-pipeline
      // `accepted` object above (where it would read `undefined`).
      const rawAccepted = res.listings.find((l) => l.url === DETAIL_3_URL);
      expect(rawAccepted).toBeTruthy();
      expect(typeof rawAccepted?.external_id).toBe("string");
      expect(rawAccepted?.external_id).not.toBeNull();
      expect((rawAccepted?.external_id as string).length).toBeGreaterThan(0);
    } finally {
      await localRunner.close();
    }
  }, 60_000);
});

// ===========================================================================
// 10. E17 — detail loads strictly sequential, randomized non-constant delay
//
// VACUOUS-test fix: the old version measured only wall-clock GAPS between
// requests, never the actual delay FORMULA. That could not distinguish
// `2000 + Math.random()*3000` from a constant `delayMs = 2000` mutant,
// because the mutant's fixed 2000ms gap still satisfies ">= 1950" and (with
// enough luck across 3 gaps) could even satisfy the old non-constant check
// on timer jitter alone. createLocalRunner now accepts opts.random/opts.sleep
// test-only seams (default Math.random / a real setTimeout wrapper — see
// craigslist-local.ts's doDetailSequential) so this test can assert the
// EXACT requested delay values, not just infer them from timing noise.
// ===========================================================================
describe("E17 — sequential, randomized inter-load delay", () => {
  it("4 URLs => 3 sleeps requested, values = 2000 + random()*3000 in exact order, and the sleep is genuinely honored in wall-clock time", async () => {
    const urls = [0, 1, 2, 3].map(
      (i) => `https://www.craigslist.org/view/d/timing-${i}/TIMINGTOKEN0000000000${i}`,
    );
    let rec!: RouteRecorder;
    // Deterministic sequence => exact expected delays [2000, 3500, 5000].
    const randomSeq = [0, 0.5, 1];
    let randomCallIdx = 0;
    const requestedDelaysMs: number[] = [];
    const runner = createLocalRunner({
      lockPath: tmpLockPath(),
      random: () => randomSeq[randomCallIdx++],
      // Records the requested ms AND still actually waits it out (via a real
      // setTimeout) — this is what lets the test assert BOTH the exact
      // formula (requestedDelaysMs) AND that production really awaits the
      // full delay before the next navigation (the wall-clock gaps below),
      // in one pass.
      sleep: (ms: number) => {
        requestedDelaysMs.push(ms);
        return new Promise((r) => setTimeout(r, ms));
      },
      prepPage: async (page) => {
        const b = page.context().browser();
        if (b) launchedBrowsers.push(b);
        // Content doesn't matter for a timing test — reuse detail-1's HTML
        // for all 4 synthetic URLs so each load succeeds quickly.
        rec = installRoutes(page, {
          details: Object.fromEntries(urls.map((u) => [u, DETAIL_1_HTML])),
        });
      },
    });
    try {
      const rows = await runner.runDetail(urls);
      expect(rows).toHaveLength(4);

      // The seam-level proof: the exact ms values requested from `sleep`,
      // in call order. A `delayMs = 2000` constant mutant produces
      // [2000, 2000, 2000] here and fails this assertion directly — no
      // reliance on wall-clock jitter to catch it.
      expect(requestedDelaysMs).toEqual([2000, 3500, 5000]);

      expect(rec.detailSequence).toHaveLength(4);
      // detailSequence is appended in request order — with a single reused
      // Page and no concurrency possible, this is inherently
      // non-overlapping; the wall-clock gaps confirm the sleep seam above
      // was actually awaited by production code, not just computed and
      // discarded.
      const ts = rec.detailSequence.map((h) => h.ts);
      for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1]);
      const gaps = [ts[1] - ts[0], ts[2] - ts[1], ts[3] - ts[2]];
      // Small margin (1950) absorbs OS timer jitter, not code behavior.
      for (const g of gaps) expect(g).toBeGreaterThanOrEqual(1950);
      // Non-constant cadence (QA E17), now backed by the exact requested
      // values above rather than inferred from timing alone.
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(50);
    } finally {
      await runner.close();
    }
  }, 60_000);
});

// ===========================================================================
// 10b. E8 — sapi call failure produces a null totalResultCount (an honest
//      "we don't know", distinct from 0 real results) and sapiBlocked=true.
//
//      CORRECTION to this item's brief: the brief text said to also assert
//      "sapiBlocked falsy" on a sapi failure. Reading SEARCH_ONLY_PAGE_FUNCTION
//      (lib/sources/craigslist.ts) directly: `if (sapiRaw.error ||
//      sapiRaw.status !== 200 || !sapiRaw.json) { sapiBlocked = true; ... }`
//      — a non-200 status sets sapiBlocked TRUE, not falsy. Asserting the
//      brief's literal wording would test for behavior the code doesn't
//      have; asserting the actual semantics below instead.
// ===========================================================================
describe("E8 — sapi call failure", () => {
  it("sapi route returns 403 => summary row sapiTotalResultCount is null (not 0) and sapiBlocked is true", async () => {
    const runner = createLocalRunner({
      lockPath: tmpLockPath(),
      prepPage: async (page) => {
        const b = page.context().browser();
        if (b) launchedBrowsers.push(b);
        await page.route("**/*", async (route) => {
          const req = route.request();
          const url = req.url();
          let u: URL;
          try {
            u = new URL(url);
          } catch {
            await route.fulfill({ status: 204, body: "" });
            return;
          }
          if (u.hostname === "www.craigslist.org" && u.pathname.startsWith("/search/")) {
            await route.fulfill({ status: 200, contentType: "text/html", body: SEARCH_HTML });
            return;
          }
          if (u.hostname === "sapi.craigslist.org") {
            // access-control-allow-origin present so this is a genuine
            // status:403 the pageFunction observes (sapiRaw.status), not a
            // CORS-blocked fetch (sapiRaw.error) — isolates the `status !==
            // 200` branch specifically, matching "sapi route returns 403".
            await route.fulfill({
              status: 403,
              headers: { "content-type": "text/plain", "access-control-allow-origin": "*" },
              body: "Forbidden",
            });
            return;
          }
          await route.fulfill({ status: 204, body: "" });
        });
      },
    });
    try {
      const rows = (await runner.runSearch(SEARCH_URL)) as Array<Record<string, unknown>>;
      const summaryRows = rows.filter((r) => r.sapiSummary === true);
      expect(summaryRows).toHaveLength(1);
      expect(summaryRows[0].sapiTotalResultCount).toBeNull();
      expect(summaryRows[0].sapiBlocked).toBe(true);
    } finally {
      await runner.close();
    }
  }, 60_000);
});

// ===========================================================================
// 10c. opts.limit caps the number of detail URLs actually requested — a dev
//      seam (createLocalRunner's opts.limit doc comment) so a local iteration
//      doesn't burn a full production-sized run.
// ===========================================================================
describe("opts.limit — caps detail URLs actually fetched", () => {
  it("limit:2 with 3 URLs requests exactly the first 2, never the 3rd", async () => {
    const urls = [DETAIL_1_URL, DETAIL_2_URL, DETAIL_3_URL];
    let rec!: RouteRecorder;
    const runner = createLocalRunner({
      lockPath: tmpLockPath(),
      limit: 2,
      prepPage: async (page) => {
        const b = page.context().browser();
        if (b) launchedBrowsers.push(b);
        rec = installRoutes(page, {
          details: {
            [DETAIL_1_URL]: DETAIL_1_HTML,
            [DETAIL_2_URL]: DETAIL_2_HTML,
            [DETAIL_3_URL]: DETAIL_3_HTML,
          },
        });
      },
    });
    try {
      const rows = await runner.runDetail(urls);
      expect(rows).toHaveLength(2);
      expect(rec.detailHitCounts[DETAIL_1_URL]).toBe(1);
      expect(rec.detailHitCounts[DETAIL_2_URL]).toBe(1);
      expect(rec.detailHitCounts[DETAIL_3_URL]).toBeUndefined();
    } finally {
      await runner.close();
    }
  }, 60_000);
});

// ===========================================================================
// 11. E16 — lock file
// ===========================================================================
describe("E16 — lock file", () => {
  it("fresh lock => throws CraigslistLockHeldError; stale (>2h) lock => proceeds; close() removes the lock", async () => {
    const lockPath = tmpLockPath();

    // Fresh lock (just written, mtime = now)
    writeFileSync(lockPath, "12345");
    expect(() => createLocalRunner({ lockPath })).toThrow(CraigslistLockHeldError);

    // Age it past LOCK_STALE_MS (2h) — createLocalRunner should now treat it
    // as abandoned and take over rather than refuse.
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    utimesSync(lockPath, threeHoursAgo, threeHoursAgo);
    const runner = createLocalRunner({ lockPath });
    expect(existsSync(lockPath)).toBe(true);
    await runner.close();
    expect(existsSync(lockPath)).toBe(false);
  });
});

// ===========================================================================
// 12. E11 — DB unreachable is a hard error, never a silent fetch-everything
//     fallback; no DB at all IS the sanctioned fetch-everything path
// ===========================================================================
describe("E11 — DB reachability gates the fetch-everything fallback", () => {
  /**
   * Mirrors what the REAL @supabase/postgrest-js client does on a network/DNS
   * failure: PostgrestBuilder's exec() awaits fetch() inside a try/catch and,
   * when shouldThrowOnError is false (the default — no `.throwOnError()` call
   * anywhere in craigslist.ts), the caught fetch rejection is turned into a
   * RESOLVED `{ data: null, error: {...} }`, never a rejected promise (see
   * node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts ~231-246, the
   * `res.catch((fetchError) => ...)` branch). The PREVIOUS version of this
   * stub had `.in()` REJECT instead — which made this describe's first test
   * VACUOUS against the mutation "revert the DB-check throw to
   * `console.warn(); continue;`": a rejecting `.in()` already throws at the
   * `await supabase.from(...).in(...)` call site regardless of whether that
   * production code still re-throws afterward, so the test passed whether or
   * not the fix was even present. Resolving (never rejecting) makes the
   * assertion depend on the actual `if (error) throw` line in
   * fetchCraigslistListings' DB-check.
   */
  function makeUnreachableSupabase() {
    const resolved = Promise.resolve({
      data: null,
      error: { message: "TypeError: fetch failed" },
    });
    const chain = {
      select: () => chain,
      eq: () => chain,
      update: () => chain,
      in: () => resolved,
    };
    return { from: () => chain } as unknown as import("@supabase/supabase-js").SupabaseClient;
  }

  const discoveredUrls = [
    "https://www.craigslist.org/view/d/a/AAAAAAAAAAAAAAAAAAAAAA",
    "https://www.craigslist.org/view/d/b/BBBBBBBBBBBBBBBBBBBBBB",
  ];
  function makeStubRunner(
    runDetail = vi.fn(async (_urls: string[]) => [] as unknown[]),
  ): PageFunctionRunner {
    return {
      name: "stub",
      runSearch: async () => discoveredUrls.map((url) => ({ url })),
      runDetail,
    };
  }

  it("supabase supplied but its query resolves { data: null, error } (real-client DNS-failure shape) => fetchCraigslistListings throws, runDetail never called", async () => {
    const runDetail = vi.fn(async (_urls: string[]) => [] as unknown[]);
    const badSupabase = makeUnreachableSupabase();
    await expect(
      fetchCraigslistListings(NYC_PARAMS, { supabase: badSupabase, runner: makeStubRunner(runDetail) }),
    ).rejects.toThrow();
    expect(runDetail).not.toHaveBeenCalled();
  });

  it("no supabase client at all => runDetail called with every discovered URL (the only sanctioned fetch-everything path)", async () => {
    const runDetail = vi.fn(async (_urls: string[]) => [] as unknown[]);
    const res = await fetchCraigslistListings(NYC_PARAMS, { runner: makeStubRunner(runDetail) });
    expect(runDetail).toHaveBeenCalledTimes(1);
    expect(new Set(runDetail.mock.calls[0][0] as string[])).toEqual(new Set(discoveredUrls));
    expect(res.discovered).toBe(discoveredUrls.length);
  });
});

// ===========================================================================
// 13. H6 — only the exact string "local" selects the local runner
//
// VACUOUS-test fix: the previous version was a source-text grep, which
// SURVIVED the mutation `=== "local" || "LOCAL"` (that string still contains
// the literal substring `CRAIGSLIST_FETCHER === "local"`, so the grep passed
// even though the actual runtime gate now also matched "LOCAL"). The real
// fix factors the gate out into an exported, injectable function
// (lib/ingest/strategies.ts's selectCraigslistRunner: env + a `create`
// factory in, PageFunctionRunner | undefined out) so this test can call the
// REAL comparison with a fake factory and a real env-var value, instead of
// grepping the source for what the comparison is SUPPOSED to look like.
// runAdapter itself still isn't safe to call directly from a test (it would
// call createLocalRunner() with the real production lock path — see this
// file's header comment on why every createLocalRunner() call here uses a
// temp lock) but selectCraigslistRunner has no such side effect, so it's
// exercised directly.
// ===========================================================================
describe("H6 — CRAIGSLIST_FETCHER exact-match gate", () => {
  it('env.CRAIGSLIST_FETCHER === "local" (exact, case-sensitive) calls create(); every other value does not', () => {
    const create = vi.fn(() => ({ name: "fake-local" }) as unknown as PageFunctionRunner);

    const local = selectCraigslistRunner({ ...process.env, CRAIGSLIST_FETCHER: "local" }, create);
    expect(create).toHaveBeenCalledTimes(1);
    expect(local).toBe(create.mock.results[0]?.value);

    create.mockClear();
    for (const value of ["LOCAL", "true", "1", "", undefined, "cloud"]) {
      const env = { ...process.env, CRAIGSLIST_FETCHER: value };
      const result = selectCraigslistRunner(env, create);
      expect(result).toBeUndefined();
    }
    expect(create).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 14. B4 — browser is always closed, no lingering Chromium process
// ===========================================================================
describe("B4 — browser always closed after close()", () => {
  it("the exact Browser instance this runner launched reports disconnected after close()", async () => {
    // Playwright's `Browser` (the object chromium.launch() returns) does NOT
    // expose the underlying process/pid in its public API — .process() only
    // exists on BrowserServer, returned by launchServer(), which this seam
    // doesn't use. A pgrep-by-name check was considered and rejected per the
    // brief's own caveat: it can't be scoped to "this test's browser" without
    // a pid, so it risks matching another user's or another test's Chromium.
    // isConnected() is Playwright's own supported signal for exactly this
    // ("has this Browser object's underlying connection been torn down") and
    // is captured on the EXACT instance our prepPage hook observed, so there
    // is no ambiguity about which process it refers to.
    let browser: Browser | undefined;
    const runner = createLocalRunner({
      lockPath: tmpLockPath(),
      prepPage: async (page) => {
        const b = page.context().browser();
        expect(b).not.toBeNull();
        if (b) {
          browser = b;
          launchedBrowsers.push(b);
        }
        installRoutes(page, { details: { [DETAIL_1_URL]: DETAIL_1_HTML } });
      },
    });
    await runner.runDetail([DETAIL_1_URL]);
    expect(browser?.isConnected()).toBe(true);

    await runner.close();

    expect(browser?.isConnected()).toBe(false);
  }, 60_000);
});
