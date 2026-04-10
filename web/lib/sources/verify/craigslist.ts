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

export const verifyCraigslist: Verifier = async (url, deps): Promise<VerifyResult> => {
  const { status, body } = await fetchHtml(normalizeUrl(url), {
    useProxy: false,
    timeout: deps.fetchTimeout,
  });
  if (status === 0) return { status: "unknown", reason: "fetch failed" };
  if (status === 410) return { status: "delisted", delistedAt: null, reason: "HTTP 410 flagged" };
  if (status === 404) return { status: "delisted", delistedAt: null, reason: "HTTP 404" };
  if (status >= 500) return { status: "unknown", reason: `http ${status}` };
  if (status === 200) {
    for (const marker of FLAGGED_MARKERS) {
      if (body.includes(marker)) {
        return { status: "delisted", delistedAt: null, reason: marker };
      }
    }
    return { status: "active" };
  }
  return { status: "unknown", reason: `unexpected http ${status}` };
};
