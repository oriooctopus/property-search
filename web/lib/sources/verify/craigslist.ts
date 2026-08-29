/**
 * Craigslist stale detector.
 *
 * CL is polite to ordinary GETs — no proxy required. Status 410 means
 * "flagged for removal", 404 means "gone", and an OK body with a removal
 * banner means the posting was deleted/expired.
 */

import { fetchHtml, normalizeUrl } from "./shared";
import type { Verifier, VerifyResult } from "./types";

const FLAGGED_MARKERS = [
  "This posting has been flagged",
  "This posting has been deleted",
  "This posting has expired",
];

// Distinct from FLAGGED_MARKERS: these mean "Craigslist bot-blocked this
// request", not "the posting is gone". A 200 with one of these strings must
// never be read as delisted or active — see the `blocked` field on
// VerifyResult, which callers (verify-stale's craigslist-local gentle pass)
// key on to abort a batch rather than misreport blocked pages as confirmed
// listings.
const BOT_BLOCK_MARKERS = ["Your request has been blocked", "automatically blocked"];

export const verifyCraigslist: Verifier = async (url, deps): Promise<VerifyResult> => {
  const { status, body } = await fetchHtml(normalizeUrl(url), {
    useProxy: false,
    timeout: deps.fetchTimeout,
  });
  if (status === 0) return { status: "unknown", reason: "fetch failed" };
  if (status === 410) return { status: "delisted", delistedAt: null, reason: "HTTP 410 flagged" };
  if (status === 404) return { status: "delisted", delistedAt: null, reason: "HTTP 404" };
  // 403 stays "unknown", never "delisted" — a block is not evidence the
  // posting is gone. `blocked: true` lets a caller that needs to react to a
  // block specifically (as opposed to any other unknown outcome) do so.
  if (status === 403) return { status: "unknown", reason: "unexpected http 403", blocked: true };
  if (status >= 500) return { status: "unknown", reason: `http ${status}` };
  if (status === 200) {
    for (const marker of BOT_BLOCK_MARKERS) {
      if (body.includes(marker)) {
        return { status: "unknown", reason: `bot block detected: "${marker}"`, blocked: true };
      }
    }
    for (const marker of FLAGGED_MARKERS) {
      if (body.includes(marker)) {
        return { status: "delisted", delistedAt: null, reason: marker };
      }
    }
    return { status: "active" };
  }
  return { status: "unknown", reason: `unexpected http ${status}` };
};
