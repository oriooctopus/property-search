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

/** Max concurrent per-source verify calls. SE is rate-sensitive, CL is fine. */
export const VERIFY_CONCURRENCY: Record<ListingSource, number> = {
  streeteasy: 2,
  craigslist: 10,
  "facebook-marketplace": 1,
};
