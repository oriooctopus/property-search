/**
 * StreetEasy stale detector.
 *
 * Parses the SSR payload in the listing HTML for `offMarketAt`:
 *   - null      → active
 *   - ISO date  → delisted at that date
 *   - missing   → unknown (SE served a page we don't understand)
 *
 * Direct requests to streeteasy.com get 403'd, so we require the Apify
 * residential proxy (set APIFY_PROXY_URL).
 */

import { fetchHtml, normalizeUrl } from "./shared";
import type { Verifier, VerifyResult } from "./types";

// The SSR payload is a JSON blob embedded in a JS string literal, so keys
// appear both as unescaped (`"offMarketAt":...`) and escaped (`\"offMarketAt\":...`).
// Match either form.
const OFF_MARKET_DATE_RE = /\\?"offMarketAt\\?"\s*:\s*\\?"([^"\\]+)\\?"/;
const OFF_MARKET_NULL_RE = /\\?"offMarketAt\\?"\s*:\s*null/;

export const verifyStreetEasy: Verifier = async (url, deps): Promise<VerifyResult> => {
  const clean = normalizeUrl(url);
  const { status, body } = await fetchHtml(clean, {
    useProxy: true,
    apifyToken: deps.apifyToken,
    timeout: deps.fetchTimeout,
  });
  if (status === 0) return { status: "unknown", reason: "fetch failed" };
  if (status === 403 || status >= 500) return { status: "unknown", reason: `http ${status}` };
  if (status === 404) return { status: "delisted", delistedAt: null, reason: "HTTP 404" };

  if (OFF_MARKET_NULL_RE.test(body)) return { status: "active" };

  const m = body.match(OFF_MARKET_DATE_RE);
  if (m) {
    const d = new Date(m[1]);
    return {
      status: "delisted",
      delistedAt: isNaN(d.getTime()) ? null : d,
      reason: "offMarketAt set",
    };
  }

  return { status: "unknown", reason: "offMarketAt marker not found" };
};
