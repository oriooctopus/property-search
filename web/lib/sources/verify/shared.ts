/**
 * Shared HTTP + URL primitives for source verifiers.
 *
 * Every per-source verifier uses fetchHtml + normalizeUrl from here so the
 * plumbing lives in exactly one place. Verifier files stay ~30 lines because
 * retries, timeouts, and Apify proxy fall-through live in this module.
 */

import { makeProxyFetch, resolveApifyProxyUrl, withRotatingSession } from "../proxy";

const DEFAULT_TIMEOUT = 15_000;

const NOISE_PARAMS = new Set(["lstt", "utm_source", "utm_medium", "utm_campaign", "ref"]);

/** Strip known tracking/noise params from a URL. Returns the input unchanged on parse failure. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (NOISE_PARAMS.has(key)) u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return url;
  }
}

export interface FetchHtmlOptions {
  /** Route via Apify residential proxy. Required for SE and FB. */
  useProxy?: boolean;
  /** Apify token (only used when useProxy is true). */
  apifyToken?: string;
  /** Request timeout in ms. Defaults to DEFAULT_TIMEOUT. */
  timeout?: number;
}

export interface FetchHtmlResult {
  status: number;
  body: string;
  finalUrl: string;
}

/**
 * Fetch an HTML document, retrying up to twice on transient errors. Handles
 * redirects via fetch's native `redirect: "follow"` mode. When useProxy is
 * true, requests are routed through Apify's residential proxy via the public
 * `proxy.apify.com:8000` endpoint, which is the same backing network the SE
 * bisection fetch uses.
 */
const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

async function directFetch(url: string, timeout: number): Promise<FetchHtmlResult> {
  const res = await fetch(url, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(timeout),
    headers: DEFAULT_HEADERS,
  });
  const body = await res.text();
  return { status: res.status, body, finalUrl: res.url || url };
}

async function proxyFetch(
  url: string,
  proxyUrl: string,
  timeout: number,
): Promise<FetchHtmlResult> {
  // Rotate to a fresh US residential session each call. The default `auto`
  // username pins to one IP that gets flagged by PerimeterX within a few
  // requests; `session-<random>` burns a new IP per attempt.
  const rotated = withRotatingSession(proxyUrl);
  const pf = makeProxyFetch(rotated);
  const res = await pf(url, {
    method: "GET",
    headers: {
      ...DEFAULT_HEADERS,
      "Accept-Encoding": "identity",
      "Upgrade-Insecure-Requests": "1",
    },
    signal: AbortSignal.timeout(timeout),
  });
  const body = await res.text();
  const finalUrl =
    (res as unknown as { __finalUrl?: string }).__finalUrl ?? url;
  return { status: res.status, body, finalUrl };
}

/** PerimeterX captcha served on 403 — retry with a fresh session can unblock. */
function isCaptchaBlock(r: FetchHtmlResult): boolean {
  return r.status === 403 && r.body.includes("px-captcha");
}

export async function fetchHtml(
  url: string,
  opts: FetchHtmlOptions = {},
): Promise<FetchHtmlResult> {
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  const proxyUrl = opts.useProxy ? resolveApifyProxyUrl(opts.apifyToken) : null;

  // Try proxy first (with retries + session rotation) when requested and
  // available. Rotate on both network errors and PerimeterX captcha blocks.
  if (opts.useProxy && proxyUrl) {
    const MAX_ATTEMPTS = 15;
    let lastResult: FetchHtmlResult | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const r = await proxyFetch(url, proxyUrl, timeout);
        if (!isCaptchaBlock(r)) return r;
        lastResult = r;
      } catch {
        // fall through to next attempt / direct fallback
      }
    }
    if (lastResult) return lastResult;
    // Proxy fully unavailable — fall back to a direct fetch so transient
    // proxy outages don't kill verification entirely.
    try {
      return await directFetch(url, timeout);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: 0, body: "", finalUrl: `fetch-failed: ${msg}` };
    }
  }

  // useProxy requested but no token/URL configured: fall through to direct
  // fetch. In production this will usually get a 403 from SE and the verifier
  // will emit `{ status: 'unknown' }` naturally; in tests this is the path
  // that hits the mocked globalThis.fetch.

  // Direct fetch path (Craigslist, tests, or missing-proxy fallback).
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await directFetch(url, timeout);
    } catch (err) {
      lastErr = err;
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  return { status: 0, body: "", finalUrl: `fetch-failed: ${msg}` };
}

/** Tiny p-limit-style helper. Runs up to `limit` tasks in parallel. */
export async function parallelMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}
