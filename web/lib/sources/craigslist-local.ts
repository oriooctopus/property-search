/**
 * Local headless-Playwright PageFunctionRunner for Craigslist.
 *
 * Runs the EXACT SAME SEARCH_ONLY_PAGE_FUNCTION / DETAIL_PAGE_FUNCTION
 * strings from lib/sources/craigslist.ts against a real local Chromium
 * instance instead of paying for an Apify puppeteer-scraper actor run. A
 * spike (see /home/esme/.claude/jobs/2ab1ae70/tmp/spike/probe.mjs and its
 * out-A.json) confirmed both pageFunction strings only call
 * page.waitForSelector / page.title / page.evaluate / page.reload — all
 * Playwright APIs with the same signature as Puppeteer's — so the strings
 * run unmodified. Only `context` (request/log/pushData, which come from the
 * Apify actor runtime, not from the browser driver) needs a shim; see
 * runPageFunction below.
 *
 * fetchCraigslistListings (craigslist.ts) treats this as a drop-in
 * replacement for the Apify runner via the PageFunctionRunner interface —
 * everything downstream of "dataset items" (URL dedup, DB incremental
 * check, sapi completeness fields, AdapterOutput mapping) is untouched.
 *
 * Behavior this file owns that the Apify actor never had to (QA scenarios,
 * job 2ab1ae70):
 *   - Detail fetches are strictly sequential with a randomized 2-5s delay
 *     between loads (E17) — a fixed cadence is a known bot signature.
 *   - Mid-detail bot-block detection (E6): DETAIL_PAGE_FUNCTION has no
 *     block-marker check of its own (only the search pageFunction does),
 *     so this file checks CL_BLOCK_MARKERS against each detail page's body
 *     text before invoking the pageFunction, and stops immediately on a
 *     match, returning whatever was already extracted.
 *   - 404 / navigation-timeout handling with one bounded retry (E12/E13).
 *   - A distinct network-error class (DNS/connection failures), fatal for
 *     the whole run, separate from a bot-block (E3).
 *   - A lock file so a manual run and a future timer can never overlap
 *     (E16), and a guarantee that the browser is always closed (B1/B2).
 */

import { chromium, type Browser, type Page } from "playwright";
import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import {
  CL_BLOCK_MARKERS,
  CraigslistBlockedError,
  CraigslistNetworkError,
  DETAIL_PAGE_FUNCTION,
  SEARCH_ONLY_PAGE_FUNCTION,
  type PageFunctionRunner,
} from "./craigslist";

// ---------------------------------------------------------------------------
// Lock file (QA E16: a manual CLI run and a future timer must never overlap)
// ---------------------------------------------------------------------------

const LOCK_DIR = join(homedir(), ".local", "state", "dwelligence");
const LOCK_PATH = join(LOCK_DIR, "craigslist-local.lock");
// A lock older than this is assumed abandoned (crashed process, killed
// container, etc.) rather than a genuinely running job — 2h is generously
// longer than a full 1000-URL detail scrape at the 2-5s/url pace above
// (worst case ~1.4h), so a live run should never trip this.
const LOCK_STALE_MS = 2 * 60 * 60 * 1000;

/** Thrown when another (non-stale) run already holds the lock file. */
export class CraigslistLockHeldError extends Error {}

// lockPath defaults to the real production path (LOCK_PATH) everywhere except
// tests, which MUST pass a temp path (e.g. under fs.mkdtempSync) — otherwise
// a test run collides with a real production run's lock (or vice versa) and
// throws CraigslistLockHeldError for a reason that has nothing to do with the
// test itself. See createLocalRunner's opts.lockPath.
function acquireLock(lockPath: string): () => void {
  mkdirSync(dirname(lockPath), { recursive: true });
  if (existsSync(lockPath)) {
    const ageMs = Date.now() - statSync(lockPath).mtimeMs;
    if (ageMs < LOCK_STALE_MS) {
      throw new CraigslistLockHeldError(
        `Another craigslist-local run appears to be in progress (lock held, age ${(ageMs / 1000).toFixed(0)}s): ${lockPath}. ` +
          `If you're certain no run is actually active, remove the lock file and retry.`,
      );
    }
    console.warn(
      `[craigslist-local] stale lock (age ${(ageMs / 3600000).toFixed(1)}h > ${LOCK_STALE_MS / 3600000}h) — ignoring and taking over: ${lockPath}`,
    );
  }
  writeFileSync(lockPath, String(process.pid));
  return () => {
    try {
      unlinkSync(lockPath);
    } catch {
      // Already gone (e.g. a stale lock we took over and something else
      // cleaned up first) — not an error, the invariant (lock absent when
      // no run is active) still holds.
    }
  };
}

// ---------------------------------------------------------------------------
// Network-error detection
// ---------------------------------------------------------------------------

// Chromium's net-error codes for DNS/connection-level failures, plus the
// bare Node equivalents in case a request never reaches Chromium's network
// stack at all. Deliberately narrow (not a catch-all) — a real page-level
// failure (timeout, bad selector) must NOT get misclassified as a network
// error, since the two map to different, mutually-exclusive CLI outcomes.
const NETWORK_ERROR_RE =
  /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_NETWORK_CHANGED|ERR_ADDRESS_UNREACHABLE|ERR_PROXY_CONNECTION_FAILED|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN/;

function isNetworkError(message: string): boolean {
  return NETWORK_ERROR_RE.test(message);
}

// ---------------------------------------------------------------------------
// pageFunction shim
// ---------------------------------------------------------------------------

/**
 * Executes one of the Apify pageFunction strings against a real local
 * Playwright page. `context.page` is the actual Playwright Page (both
 * pageFunction strings only call methods Playwright and Puppeteer share —
 * see the spike cited in the header comment), so only request/log/pushData
 * need faking.
 *
 * Mirrors the real Apify actor's dataset-row behavior exactly: every
 * context.pushData(row) call becomes one row, and the function's own return
 * value (if not undefined) is appended as ONE MORE row — see the comment on
 * DETAIL_PAGE_FUNCTION's final `return data` in craigslist.ts for why the
 * actor does this, and why getting it wrong caused a real double-counting
 * bug there. Getting this wrong here would silently break parity with the
 * Apify path (QA P1).
 */
export async function runPageFunction(src: string, page: Page, url: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  const context = {
    page,
    request: { url },
    log: {
      info: (...args: unknown[]) => console.log("[cl-local:info]", ...args),
      warning: (...args: unknown[]) => console.warn("[cl-local:warn]", ...args),
      error: (...args: unknown[]) => console.error("[cl-local:error]", ...args),
    },
    pushData: async (row: unknown) => {
      rows.push(row);
    },
  };
  // The pageFunction strings are literally `async function pageFunction(context)
  // {...}` source (see tests/craigslist-pagefunction.test.ts, which locks in
  // that they compile as a single expression the same way Apify's own
  // evalFunctionOrThrow does). Wrapping in parens turns the declaration into
  // an expression so it can be invoked immediately with our shimmed context.
  const fn = new Function("context", `return (${src})(context);`) as (
    ctx: unknown,
  ) => Promise<unknown>;
  const ret = await fn(context);
  if (ret !== undefined) rows.push(ret);
  return rows;
}

// ---------------------------------------------------------------------------
// Search phase
// ---------------------------------------------------------------------------

async function doSearch(page: Page, startUrl: string, navTimeoutMs: number): Promise<unknown[]> {
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: navTimeoutMs });
  } catch (e) {
    const msg = (e as Error).message || "";
    if (isNetworkError(msg)) {
      throw new CraigslistNetworkError(`Network-level failure loading search page ${startUrl}: ${msg}`);
    }
    throw e;
  }
  // No pre-wait here anymore — SEARCH_ONLY_PAGE_FUNCTION itself now owns the
  // timing (reads the static list immediately on entry, then waits for the
  // gallery to hydrate before reading that). A pre-wait here used to be
  // load-bearing for the gallery, but it ALSO meant the static server-
  // rendered list (present at domcontentloaded, replaced by client JS within
  // ~1-1.5s) was gone by the time the page function ever ran — see the dated
  // finding in SEARCH_ONLY_PAGE_FUNCTION's redesign comment (2026-08-28) for
  // the parity-run numbers that caught this: this runner was seeing only the
  // 200-item gallery, and the Apify runner only the ~300-item static list.
  return runPageFunction(SEARCH_ONLY_PAGE_FUNCTION, page, startUrl);
}

// ---------------------------------------------------------------------------
// Detail phase — strictly sequential (QA E17)
// ---------------------------------------------------------------------------

type DetailFetchResult =
  | { kind: "ok"; data: unknown }
  | { kind: "skipped"; data: unknown }
  | { kind: "blocked"; message: string }
  | { kind: "network-error"; message: string };

async function fetchOneDetail(page: Page, url: string, navTimeoutMs: number): Promise<DetailFetchResult> {
  let lastErr: Error | null = null;
  // One bounded retry, timeout only (QA E12/E13) — a 404 is handled inline
  // below without a retry (retrying a 404 can't succeed).
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: navTimeoutMs });
      if (resp && resp.status() === 404) {
        return { kind: "skipped", data: { url, __skipped: true, __skipReason: "http-404" } };
      }

      // Give a slow-rendering page a real chance to paint its body content
      // before the block-check heuristic and DETAIL_PAGE_FUNCTION's own wait
      // both run below. `waitUntil: "domcontentloaded"` above only means the
      // initial HTML parsed — it says nothing about whether CL's client JS
      // has finished writing span.price/#postingbody/etc. into the DOM yet.
      // Root-caused 2026-08-28: 108/258 detail pages in a real run came back
      // with null title/price on exactly this race (see the matching
      // comment on DETAIL_PAGE_FUNCTION's own waitForSelector in
      // craigslist.ts for the full incident). Swallow a timeout here — it
      // just means this extra wait didn't help, not that the page failed;
      // the block-check and DETAIL_PAGE_FUNCTION's own wait/timeout below
      // still run and are what actually decide skip/blocked/ok.
      await page
        .waitForSelector("span#titletextonly, .postingtitletext, span.price, #postingbody", {
          state: "attached",
          timeout: 15000,
        })
        .catch(() => {});

      // Block check BEFORE invoking DETAIL_PAGE_FUNCTION: that function's
      // own waitForSelector would just time out and throw a generic
      // "content did not load" error on a block page (it has no
      // block-marker check of its own — see this file's header comment),
      // masking the real cause. Scoped the same way as the search
      // pageFunction's check: only when the posting content is ABSENT. A
      // real listing whose body says "applications denied without proof of
      // income" or "blocked sink" must not halt the run (QA E4) —
      // CL_BLOCK_MARKERS includes bare words like "denied" and "blocked".
      const hasPostingContent = await page
        .evaluate(() => !!document.querySelector("#postingbody, .posting-title, span#titletextonly"))
        .catch(() => false);
      if (!hasPostingContent) {
        const title = await page.title().catch(() => "");
        const bodyText = await page
          .evaluate(() => (document.body ? document.body.innerText : ""))
          .catch(() => "");
        const combined = (title + " " + bodyText).slice(0, 3000).toLowerCase();
        const hitMarker = CL_BLOCK_MARKERS.find((m) => combined.includes(m));
        if (hitMarker) {
          return { kind: "blocked", message: `BOT BLOCK DETECTED mid-detail at ${url} (marker: "${hitMarker}")` };
        }
      }

      const pageRows = await runPageFunction(DETAIL_PAGE_FUNCTION, page, url);
      const blockedRow = pageRows.find(
        (r) => r && typeof r === "object" && (r as Record<string, unknown>).blocked === true,
      );
      if (blockedRow) {
        return {
          kind: "blocked",
          message: `BOT BLOCK DETECTED mid-detail at ${url} (pageFunction returned blocked:true)`,
        };
      }
      // DETAIL_PAGE_FUNCTION returns exactly one row (its own return value —
      // it never calls context.pushData). Guard anyway rather than assume.
      const data = pageRows[0] ?? { url, __skipped: true, __skipReason: "empty pageFunction result" };
      return { kind: "ok", data };
    } catch (e) {
      lastErr = e as Error;
      const msg = lastErr.message || "";
      if (isNetworkError(msg)) {
        return { kind: "network-error", message: `Network-level failure fetching ${url}: ${msg}` };
      }
      if (/timeout/i.test(msg) && attempt < 2) {
        console.warn(`[cl-local] detail fetch timeout (attempt ${attempt}/2) — retrying once: ${url}`);
        continue;
      }
      break;
    }
  }
  return {
    kind: "skipped",
    data: { url, __skipped: true, __skipReason: (lastErr?.message ?? "unknown error").slice(0, 200) },
  };
}

async function doDetailSequential(
  browser: Browser,
  urls: string[],
  navTimeoutMs: number,
  prepPage: ((page: Page) => Promise<void>) | undefined,
  onProgress?: (fetched: number, total: number) => void,
  // Delay-source seams (QA E17 vacuous-test fix): production never passes
  // these, so `random` defaults to Math.random and `sleep` defaults to the
  // real setTimeout wrapper below — byte-identical production behavior.
  // Tests inject a deterministic `random` sequence and a `sleep` spy that
  // records the requested ms WITHOUT actually waiting, so the suite can
  // assert the exact delay formula (2000 + random()*3000) instead of only
  // observing wall-clock time, which a `delayMs = 2000` constant mutant
  // would still satisfy (E17 was VACUOUS against exactly that mutation).
  random: () => number = Math.random,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<unknown[]> {
  const rows: unknown[] = [];
  // One page object reused across every URL (QA E17 permits either "one page
  // reused or one per URL" — reusing avoids the extra per-URL browser-context
  // churn and matches the search phase's approach).
  const page = await browser.newPage();
  if (prepPage) await prepPage(page);
  try {
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      if (i > 0) {
        // Randomized inter-load delay, uniform in [2000, 5000)ms. QA E17
        // requires this be non-constant — a fixed cadence is a known bot
        // signature Craigslist's rate-limiter keys on.
        const delayMs = 2000 + random() * 3000;
        await sleep(delayMs);
      }
      const result = await fetchOneDetail(page, url, navTimeoutMs);
      if (result.kind === "blocked") {
        // Stop immediately: no further navigations, return what's already
        // extracted (QA E6). The caller (craigslist.ts Phase 2) converts
        // this into `blocked: true` + the partial listings, not a run
        // failure.
        throw new CraigslistBlockedError(result.message, rows, url);
      }
      if (result.kind === "network-error") {
        // Fatal for the whole run — no partial-progress path.
        throw new CraigslistNetworkError(result.message);
      }
      if (result.kind === "skipped") {
        const reason = (result.data as { __skipReason?: string }).__skipReason ?? "unknown";
        console.warn(`[cl-local] skipped ${url}: ${reason}`);
      }
      rows.push(result.data);
      onProgress?.(i + 1, urls.length);
    }
  } finally {
    await page.close();
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface LocalCraigslistRunner extends PageFunctionRunner {
  /**
   * Closes the underlying browser and releases the lock file. Idempotent —
   * safe to call even if runSearch/runDetail never ran (e.g.
   * fetchCraigslistListings returned early with zero discovered URLs) or
   * threw. ALWAYS call this in a finally block (QA B1/B2: browser.close()
   * must run on every path, no zombie chromium after an error).
   */
  close(): Promise<void>;
}

export function createLocalRunner(opts?: {
  /** Max detail URLs to fetch — for dev loops, so an iteration doesn't burn a full production-sized run. */
  limit?: number;
  onProgress?: (fetched: number, total: number) => void;
  /**
   * Overrides the lock file path (default: LOCK_PATH, the real production
   * path under ~/.local/state/dwelligence). Tests MUST pass a temp path
   * (e.g. fs.mkdtempSync) so a test run can never collide with — or throw
   * CraigslistLockHeldError against — a real concurrent production run, and
   * vice versa.
   */
  lockPath?: string;
  /**
   * Called immediately after each `browser.newPage()`, before any
   * navigation. Tests use this to install `page.route(...)` handlers that
   * serve saved fixtures instead of hitting live Craigslist — the only way
   * to exercise the REAL pageFunction strings end-to-end without live
   * network traffic. Production callers never need this.
   */
  prepPage?: (page: Page) => Promise<void>;
  /**
   * Overrides the page.goto timeout for both search and detail navigations
   * (default 45s, matching the previous hardcoded value). Tests use a short
   * value to exercise the QA E13 (navigation-never-responds) retry-then-skip
   * path without waiting 45s twice per case.
   */
  navTimeoutMs?: number;
  /**
   * Overrides the inter-detail-load delay's random source (default
   * Math.random). Test-only seam — see doDetailSequential's header comment
   * for why this exists (QA E17 vacuous-test fix).
   */
  random?: () => number;
  /**
   * Overrides the inter-detail-load delay's sleep implementation (default: a
   * real setTimeout wrapper). Test-only seam — lets tests record the
   * requested delay in ms without actually waiting it out.
   */
  sleep?: (ms: number) => Promise<void>;
}): LocalCraigslistRunner {
  const lockPath = opts?.lockPath ?? LOCK_PATH;
  const navTimeoutMs = opts?.navTimeoutMs ?? 45_000;

  // Acquired eagerly (at construction, not on first use) so a second
  // concurrent invocation fails IMMEDIATELY and loudly, before it's done
  // any work at all — matches "second concurrent invocation exits non-zero
  // with a clear message" (QA E16).
  const releaseLock = acquireLock(lockPath);

  let browserPromise: Promise<Browser> | null = null;
  let closed = false;

  function ensureBrowser(): Promise<Browser> {
    if (!browserPromise) {
      browserPromise = chromium.launch({ headless: true });
    }
    return browserPromise;
  }

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    try {
      if (browserPromise) {
        const b = await browserPromise;
        await b.close();
      }
    } finally {
      releaseLock();
    }
  }

  return {
    name: "playwright-local",
    async runSearch(startUrl: string): Promise<unknown[]> {
      const browser = await ensureBrowser();
      const page = await browser.newPage();
      if (opts?.prepPage) await opts.prepPage(page);
      try {
        return await doSearch(page, startUrl, navTimeoutMs);
      } finally {
        await page.close();
      }
    },
    async runDetail(urls: string[]): Promise<unknown[]> {
      const browser = await ensureBrowser();
      const capped = opts?.limit != null ? urls.slice(0, opts.limit) : urls;
      return doDetailSequential(
        browser,
        capped,
        navTimeoutMs,
        opts?.prepPage,
        opts?.onProgress,
        opts?.random,
        opts?.sleep,
      );
    },
    close,
  };
}
