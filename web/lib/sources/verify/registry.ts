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
 *  StreetEasy bumped 2→4 to halve verify-stale wall time (was ~10s/row × 809
 *  rows = ~135min at concurrency 2 → ~67min at concurrency 4) and let the
 *  daily ingest fit under the 60min job cap. Each verify call goes through
 *  the rotating Apify proxy session, so 4 parallel requests come from
 *  different residential exit IPs — should not trigger SE PerimeterX more
 *  than the existing concurrency=2 path. If 403 rates spike on the next
 *  run, lower back to 2-3. */
export const VERIFY_CONCURRENCY: Record<ListingSource, number> = {
  streeteasy: 4,
  craigslist: 10,
  "facebook-marketplace": 1,
};
