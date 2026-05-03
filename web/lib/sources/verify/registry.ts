import type { ListingSource } from "../types";
import { verifyStreetEasy } from "./streeteasy";
import { verifyCraigslist } from "./craigslist";
import { verifyFacebookMarketplace } from "./facebook-marketplace";
import type { Verifier } from "./types";

/** Per-source verifier dispatch. Adding a source = one entry here. */
export const verifiers: Record<ListingSource, Verifier> = {
  streeteasy: verifyStreetEasy,
  craigslist: verifyCraigslist,
  "facebook-marketplace": verifyFacebookMarketplace,
};

/** Max concurrent per-source verify calls. SE is rate-sensitive, CL is fine.
 *  StreetEasy concurrency progression:
 *  - 2: original — ~135min for 809 rows, blew the 60min cap.
 *  - 4: split workflow gave verify-stale its own 60min job, but at ~67min
 *    it still cancelled on the verify job alone.
 *  - 6 (current): ~45min, fits comfortably under 60min on the dedicated
 *    verify-stale job. Each call rotates its own Apify session so
 *    6-way parallel comes from 6 different residential exit IPs —
 *    PerimeterX should treat each as a distinct visitor. If 403 rates
 *    spike on the next run, drop back to 5. */
export const VERIFY_CONCURRENCY: Record<ListingSource, number> = {
  streeteasy: 6,
  craigslist: 10,
  "facebook-marketplace": 1,
};
