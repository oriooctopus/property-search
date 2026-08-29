/**
 * Dev/ops CLI for the local (non-Apify) Craigslist fetcher.
 *
 * Runs fetchCraigslistListings with a local headless-Playwright runner
 * (lib/sources/craigslist-local.ts) instead of the Apify actor, dumps the
 * result to --out as JSON, and exits with a distinguishable code per
 * outcome class (QA scenario O1/H9). Intentionally does NOT pass a supabase
 * client — the DB is currently unreachable, and fetchCraigslistListings'
 * undefined-supabase path is exactly "standalone: fetch every discovered
 * URL", which is what a dump/dev run wants. Passing a defined-but-broken
 * client here would THROW (see the E11 fix in lib/sources/craigslist.ts),
 * not silently degrade — never work around that by passing one anyway.
 *
 * Usage:
 *   npx tsx scripts/craigslist-local-run.ts --out /path/to/dump.json [--limit N] [--no-fixtures]
 *
 * Exit codes: 0 ok, 2 zero-results, 3 variant-miss, 4 blocked,
 * 5 network-error, 6 lock-held, 1 other/unexpected error.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

// ---------------------------------------------------------------------------
// Load .env.local — copied verbatim from scripts/ingest.ts's loader so both
// entry points behave identically re: which env vars win (existing
// process.env values are never overwritten).
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, "..", ".env.local");
try {
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
} catch {
  // env file optional — this script doesn't strictly need any secrets
  // (no Apify token, no supabase creds), but pick up APIFY_TOKEN etc. if
  // present in case a future flag wants to A/B against the Apify runner.
}

import {
  CraigslistBlockedError,
  CraigslistNetworkError,
  fetchCraigslistListings,
} from "../lib/sources/craigslist";
import {
  CraigslistLockHeldError,
  createLocalRunner,
  type LocalCraigslistRunner,
} from "../lib/sources/craigslist-local";
import { PRICE_MAX, PRICE_MIN } from "../lib/sources/pipeline";
import type { AdapterOutput, SearchParams } from "../lib/sources/types";

// ---------------------------------------------------------------------------
// Arg parsing (no deps — matches scripts/ingest.ts's style)
// ---------------------------------------------------------------------------

interface ParsedArgs {
  out: string;
  limit?: number;
  captureFixtures: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const rest = argv.slice(2);
  let out: string | undefined;
  let limit: number | undefined;
  let captureFixtures = true;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--out") {
      out = rest[++i];
    } else if (arg.startsWith("--out=")) {
      out = arg.slice("--out=".length);
    } else if (arg === "--limit") {
      limit = parseInt(rest[++i], 10);
    } else if (arg.startsWith("--limit=")) {
      limit = parseInt(arg.slice("--limit=".length), 10);
    } else if (arg === "--no-fixtures") {
      captureFixtures = false;
    } else {
      throw new Error(`Unknown arg: ${arg}`);
    }
  }

  if (!out) throw new Error("--out <path> is required");
  // limit === 0 is valid and means "discover only, fetch zero detail
  // pages" (createLocalRunner's runDetail does urls.slice(0, limit), so 0
  // yields an empty slice) — used by discovery-only dev/verification runs
  // that must not burn a detail-page load budget. Only negative/NaN reject.
  if (limit != null && (isNaN(limit) || limit < 0)) {
    throw new Error(`Invalid --limit value`);
  }

  return { out, limit, captureFixtures };
}

// ---------------------------------------------------------------------------
// Outcome classification (QA scenario E3/O1: these must be distinguishable,
// not all collapsed into "0 listings")
// ---------------------------------------------------------------------------

type Outcome = "ok" | "zero-results" | "variant-miss" | "blocked" | "network-error" | "other";

const EXIT_CODES: Record<Outcome, number> = {
  ok: 0,
  "zero-results": 2,
  "variant-miss": 3,
  blocked: 4,
  "network-error": 5,
  other: 1,
};

// ---------------------------------------------------------------------------
// Fixture capture (for the test-writing phase — QA/regression fixtures)
// ---------------------------------------------------------------------------

const FIXTURE_DIR = resolve(__dirname, "..", "tests", "fixtures", "craigslist");
const FIXTURE_DATE_TAG = "2026-08-28";
const FIXTURE_MAX_BYTES = 2 * 1024 * 1024; // ~2MB cap per brief — warn, don't strip content

function assertFixtureSize(path: string) {
  const size = statSync(path).size;
  if (size > FIXTURE_MAX_BYTES) {
    console.error(
      `[craigslist-local-run] FIXTURE TOO LARGE: ${path} is ${(size / 1024 / 1024).toFixed(2)}MB (cap ~2MB) — ` +
        `left in place as-is (brief says strip nothing else); trim manually before committing.`,
    );
  }
}

/**
 * Saves the hydrated search page HTML, the raw sapi JSON, and 3 detail
 * pages (most photos / fewest photos / longest description, picked from
 * listings the MAIN run already fetched) as regression fixtures. Runs at
 * most 1 extra search-page load + 3 extra detail-page loads — it does NOT
 * re-crawl the whole discovery set, and skips entirely (0 extra loads) if
 * the fixtures already exist, so repeated dev iterations don't blow the
 * page-load budget.
 */
async function captureFixtures(params: SearchParams, listings: AdapterOutput[]): Promise<void> {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  const searchPath = join(FIXTURE_DIR, `search-brk-${FIXTURE_DATE_TAG}.html`);
  const sapiPath = join(FIXTURE_DIR, `sapi-brk-${FIXTURE_DATE_TAG}.json`);

  if (!existsSync(searchPath) || !existsSync(sapiPath)) {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const startUrl = `https://www.craigslist.org/search/subarea/brk?cat=apa&min_price=${params.priceMin}&max_price=${params.priceMax}`;
      await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
      // Same hydration wait as the real runner — see SEARCH_ONLY_PAGE_FUNCTION's
      // redesign comment for why this matters.
      await page.waitForTimeout(8_000);

      if (!existsSync(searchPath)) {
        const html = await page.evaluate(() => document.documentElement.outerHTML);
        writeFileSync(searchPath, html);
        assertFixtureSize(searchPath);
      }

      if (!existsSync(sapiPath)) {
        // Fetched from inside the page (same as SEARCH_ONLY_PAGE_FUNCTION
        // does) — sapi.craigslist.org 403s a direct out-of-browser request.
        const sapiText = await page.evaluate(async () => {
          const u =
            "https://sapi.craigslist.org/web/v8/postings/search/full?cat=apa&searchPath=subarea%2Fbrk&lang=en&cc=us&min_price=3000&max_price=5000&batch=0-" +
            Date.now() +
            "-0-1-0";
          const r = await fetch(u, { headers: { Accept: "application/json" } });
          return r.text();
        });
        writeFileSync(sapiPath, sapiText);
        assertFixtureSize(sapiPath);
      }
      await page.close();
    } finally {
      await browser.close();
    }
  } else {
    console.log("[craigslist-local-run] search/sapi fixtures already exist — skipping (idempotent)");
  }

  // Pick 3 distinct listings from what the main run already fetched: most
  // photos, fewest photos, longest description — chosen to exercise
  // different detail-page shapes in the fixture-based unit tests.
  const byPhotosDesc = [...listings].sort((a, b) => b.photo_urls.length - a.photo_urls.length);
  const byPhotosAsc = [...listings].sort((a, b) => a.photo_urls.length - b.photo_urls.length);
  const byBodyDesc = [...listings].sort(
    (a, b) => (b.description?.length ?? 0) - (a.description?.length ?? 0),
  );

  const candidates: Array<[string, AdapterOutput | undefined]> = [
    ["many-photos", byPhotosDesc[0]],
    ["few-photos", byPhotosAsc[0]],
    ["long-body", byBodyDesc[0]],
  ];
  const seenUrls = new Set<string>();
  const picks: Array<{ label: string; listing: AdapterOutput }> = [];
  for (const [label, listing] of candidates) {
    if (!listing || seenUrls.has(listing.url)) continue;
    seenUrls.add(listing.url);
    picks.push({ label, listing });
  }

  const detailBrowser = await chromium.launch({ headless: true });
  try {
    const page = await detailBrowser.newPage();
    for (let i = 0; i < picks.length; i++) {
      const detailPath = join(FIXTURE_DIR, `detail-${i + 1}-${FIXTURE_DATE_TAG}.html`);
      if (existsSync(detailPath)) continue;
      const { label, listing } = picks[i];
      await page.goto(listing.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(2_000);
      const html = await page.evaluate(() => document.documentElement.outerHTML);
      writeFileSync(detailPath, html);
      assertFixtureSize(detailPath);
      console.log(`[craigslist-local-run] fixture: detail-${i + 1} = ${label} (${listing.url})`);
      if (i < picks.length - 1) {
        await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));
      }
    }
    await page.close();
  } finally {
    await detailBrowser.close();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  const params: SearchParams = {
    city: "New York",
    stateCode: "NY",
    priceMin: PRICE_MIN,
    priceMax: PRICE_MAX,
  };

  let runner: LocalCraigslistRunner | undefined;
  try {
    runner = createLocalRunner({
      limit: args.limit,
      onProgress: (fetched, total) => {
        console.log(`[craigslist-local-run] detail progress: ${fetched}/${total}`);
      },
    });
  } catch (e) {
    if (e instanceof CraigslistLockHeldError) {
      console.error(`[craigslist-local-run] LOCK HELD: ${e.message}`);
      process.exit(6);
    }
    throw e;
  }
  if (!runner) throw new Error("unreachable: runner not created");
  const activeRunner = runner;

  let outcome: Outcome = "other";
  let result: Awaited<ReturnType<typeof fetchCraigslistListings>> | null = null;
  let errorMessage: string | null = null;

  try {
    result = await fetchCraigslistListings(params, { runner: activeRunner });
    if (result.blocked) outcome = "blocked";
    else if (result.staticVariantMissing) outcome = "variant-miss";
    else if (result.discovered === 0) outcome = "zero-results";
    else outcome = "ok";
  } catch (e) {
    if (e instanceof CraigslistNetworkError) {
      outcome = "network-error";
      errorMessage = e.message;
      console.error(`[craigslist-local-run] NETWORK ERROR: ${e.message}`);
    } else if (e instanceof CraigslistBlockedError) {
      // fetchCraigslistListings converts detail-phase blocks into a normal
      // return with blocked:true internally — a CraigslistBlockedError
      // reaching here would mean it escaped that handling, which is a bug
      // in craigslist.ts, not an expected outcome. Report it as such.
      outcome = "other";
      errorMessage = `CraigslistBlockedError escaped fetchCraigslistListings' own handling: ${e.message}`;
      console.error(`[craigslist-local-run] UNEXPECTED: ${errorMessage}`);
    } else {
      outcome = "other";
      errorMessage = (e as Error).message;
      console.error("[craigslist-local-run] FATAL:", e);
    }
  } finally {
    await activeRunner.close();
  }

  if (args.captureFixtures && result && result.listings.length > 0) {
    try {
      await captureFixtures(params, result.listings);
    } catch (e) {
      // Fixture capture is dev-tooling, not part of the run's correctness —
      // never let it turn a real ok/blocked/etc. outcome into a failure.
      console.warn(`[craigslist-local-run] fixture capture failed (non-fatal): ${(e as Error).message}`);
    }
  }

  const dump = {
    outcome,
    discovered: result?.discovered ?? 0,
    fetched: result?.fetched ?? 0,
    skipped: result?.skipped ?? 0,
    blockedAt: result?.blockedAtUrl ?? null,
    sapiTotalResultCount: result?.sapiTotalResultCount ?? null,
    sapiInRegionCount: result?.sapiInRegionCount ?? null,
    listings: result?.listings ?? [],
    ranAt: new Date().toISOString(),
    ...(errorMessage ? { errorMessage } : {}),
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(dump, null, 2));

  console.log(
    `[craigslist-local-run] DONE outcome=${outcome} discovered=${dump.discovered} fetched=${dump.fetched} ` +
      `skipped=${dump.skipped} listings=${dump.listings.length} sapiTotalResultCount=${dump.sapiTotalResultCount} ` +
      `sapiInRegionCount=${dump.sapiInRegionCount} out=${args.out}`,
  );

  process.exit(EXIT_CODES[outcome]);
}

main().catch((e) => {
  console.error("[craigslist-local-run] FATAL (unhandled):", e);
  process.exit(1);
});
