/**
 * Facebook Marketplace stale detector — stub.
 *
 * FB Marketplace actively blocks headless requests and requires a logged-in
 * session, so direct fetch-based verification is unreliable. Until we wire up
 * a dedicated Apify actor for per-listing checks, this returns `unknown` for
 * every URL — the verify-stale phase treats unknown as a no-op so FB rows
 * never get incorrectly marked delisted.
 *
 * TODO: implement via apify~facebook-marketplace-listing-check-actor once
 * that work lands. See the future-work note in the verify-stale proposal.
 */

import type { Verifier, VerifyResult } from "./types";

export const verifyFacebookMarketplace: Verifier = async (): Promise<VerifyResult> => {
  return { status: "unknown", reason: "FB verify not implemented yet" };
};
