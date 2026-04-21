/**
 * Facebook Marketplace stale detector.
 *
 * Strategy (two-tier, zero Apify cost):
 *
 * 1. **Direct HTTP fetch** — hit the listing URL and inspect the response.
 *    Facebook returns distinguishable signals for removed listings:
 *    - Final URL redirects to `/marketplace/` (no item ID) → delisted
 *    - Body contains "This listing is no longer available" or similar → delisted
 *    - HTTP 404 → delisted
 *    - Normal item page returned → active
 *
 * 2. **Age-based fallback** — if the fetch is ambiguous (FB blocks us, returns
 *    a login wall, etc.) AND the listing URL contains a `last_seen_at` that we
 *    can't check here, the verify-stale phase already filters by STALE_AGE_DAYS.
 *    So we simply return "unknown" and let the caller handle it. However, we do
 *    NOT want to be a silent stub — if the fetch succeeds but gives no signal,
 *    we still try to classify rather than punting to unknown.
 */

import { fetchHtml, normalizeUrl } from "./shared";
import type { Verifier, VerifyResult } from "./types";

/** Strings that indicate the listing has been removed, sold, or is unavailable. */
const DELISTED_MARKERS = [
  "This listing is no longer available",
  "this listing may have been removed",
  "This content isn&#039;t available",
  "This content isn't available",
  "The link you followed may be broken",
  "this page isn't available",
  "This page isn&#039;t available",
];

/**
 * If Facebook redirects to a generic /marketplace/ page (no item slug),
 * the listing was removed.
 */
function isMarketplaceRootRedirect(finalUrl: string): boolean {
  try {
    const u = new URL(finalUrl);
    // e.g. /marketplace/ or /marketplace
    const path = u.pathname.replace(/\/+$/, "");
    return path === "/marketplace" || path === "/login" || path === "/login.php";
  } catch {
    return false;
  }
}

/** FB login walls / captcha pages — we can't determine status. */
function isLoginWall(body: string): boolean {
  return (
    body.includes("login_form") ||
    body.includes("/login/?next=") ||
    (body.includes("Log in") && body.includes("Create new account") && !body.includes("marketplace"))
  );
}

export const verifyFacebookMarketplace: Verifier = async (
  url,
  deps,
): Promise<VerifyResult> => {
  const clean = normalizeUrl(url);

  // Try direct fetch first (no proxy — free). FB often serves partial HTML
  // even to unauthenticated requests, which is enough to detect removal signals.
  const { status, body, finalUrl } = await fetchHtml(clean, {
    useProxy: false,
    timeout: deps.fetchTimeout ?? 15_000,
  });

  // Network failure
  if (status === 0) return { status: "unknown", reason: "fetch failed" };

  // Clear HTTP-level signals
  if (status === 404) {
    return { status: "delisted", delistedAt: null, reason: "HTTP 404" };
  }
  if (status >= 500) {
    return { status: "unknown", reason: `http ${status}` };
  }

  // Redirect to marketplace root or login → listing gone
  if (isMarketplaceRootRedirect(finalUrl)) {
    return {
      status: "delisted",
      delistedAt: null,
      reason: `redirected to ${new URL(finalUrl).pathname}`,
    };
  }

  // Check body for removal markers
  const bodyLower = body.toLowerCase();
  for (const marker of DELISTED_MARKERS) {
    if (bodyLower.includes(marker.toLowerCase())) {
      return { status: "delisted", delistedAt: null, reason: marker };
    }
  }

  // If we got a login wall, we can't determine anything
  if (isLoginWall(body)) {
    return { status: "unknown", reason: "login wall" };
  }

  // If the response looks like a real marketplace listing page, call it active
  if (
    status === 200 &&
    (body.includes("/marketplace/item/") || body.includes("marketplace_listing"))
  ) {
    return { status: "active" };
  }

  // 302/303 that didn't redirect to /marketplace/ root — could be anything
  if (status >= 300 && status < 400) {
    return { status: "unknown", reason: `redirect ${status} to ${finalUrl}` };
  }

  // Got a 200 but no clear signal either way
  if (status === 200) {
    return { status: "unknown", reason: "200 but no marketplace markers found" };
  }

  return { status: "unknown", reason: `unexpected http ${status}` };
};
