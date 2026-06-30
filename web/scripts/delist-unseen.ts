/**
 * Set-difference delisting (stale detection for the complete-refetch model).
 *
 * Because the daily ingest fetches the ENTIRE active in-region 2–4BR set from
 * StreetEasy's free API, "active" listings get last_seen_at refreshed every
 * run. So any in-region listing NOT refreshed within the cadence window is no
 * longer on StreetEasy → delisted. This is the cheap inverse of verify-stale,
 * which re-checks each listing individually via the SE detail page (PerimeterX
 * → paid Apify proxy). We trust the complete fetch instead.
 *
 * SAFETY: refuses to delist if the fraction to delist exceeds --max-delist-frac
 * (default 0.35). A healthy day churns a few percent; a large fraction means the
 * preceding fetch was incomplete/failed and we must NOT mass-delist. That case
 * alerts and exits non-zero instead.
 *
 * Run AFTER a successful full fetch:
 *   npx tsx scripts/delist-unseen.ts [--max-age-hours=26] [--max-delist-frac=0.35] [--dry-run]
 */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import {
  REGION_LAT_MIN,
  REGION_LAT_MAX,
  REGION_LON_MIN,
  REGION_LON_MAX,
} from "../lib/sources/pipeline";
import { sendIngestAlert } from "../lib/ingest/alert";

// .env.local is optional: present locally, absent in CI (env comes from GH
// Actions secrets there). Mirror scripts/ingest.ts — load it if present, else
// fall through to the real environment.
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim();
  }
} catch {
  // env file optional — CI injects vars directly
}

const num = (name: string, def: number) => {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? Number(m.split("=")[1]) : def;
};
const maxAgeHours = num("max-age-hours", 26);
const maxDelistFrac = num("max-delist-frac", 0.35);
const dryRun = process.argv.includes("--dry-run");

// Common region/source/bed filter applied to every query below. Structural
// generic so it works on both select() and update() builders.
interface RegionQuery<Q> {
  eq(col: string, v: unknown): Q;
  in(col: string, v: unknown[]): Q;
  is(col: string, v: unknown): Q;
  gte(col: string, v: unknown): Q;
  lte(col: string, v: unknown): Q;
}
function regionFilter<Q extends RegionQuery<Q>>(q: Q): Q {
  return q
    .eq("source", "streeteasy")
    .in("beds", [2, 3, 4])
    .is("delisted_at", null)
    .gte("lat", REGION_LAT_MIN)
    .lte("lat", REGION_LAT_MAX)
    .gte("lon", REGION_LON_MIN)
    .lte("lon", REGION_LON_MAX);
}

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const cutoff = new Date(Date.now() - maxAgeHours * 3600_000).toISOString();

  const { count: total, error: e1 } = await regionFilter(
    sb.from("listings").select("*", { count: "exact", head: true }),
  );
  if (e1) throw new Error(`count active: ${e1.message}`);

  const { count: stale, error: e2 } = await regionFilter(
    sb.from("listings").select("*", { count: "exact", head: true }),
  ).lt("last_seen_at", cutoff);
  if (e2) throw new Error(`count stale: ${e2.message}`);

  const totalN = total ?? 0;
  const staleN = stale ?? 0;
  const frac = totalN > 0 ? staleN / totalN : 0;
  console.log(
    `active in-region 2-4BR=${totalN}  not-seen-in-${maxAgeHours}h=${staleN}  frac=${(frac * 100).toFixed(1)}%  cutoff=${cutoff}`,
  );

  if (staleN === 0) {
    console.log("nothing to delist.");
    return;
  }
  if (frac > maxDelistFrac) {
    const msg = `delist-unseen ABORT: would delist ${staleN}/${totalN} (${(frac * 100).toFixed(1)}%) > ${(maxDelistFrac * 100).toFixed(0)}% cap — the preceding fetch was almost certainly incomplete. NOT delisting.`;
    console.error(msg);
    await sendIngestAlert("[Dwelligence] delist-unseen aborted", msg).catch(() => {});
    process.exit(3);
  }

  if (dryRun) {
    console.log(`[dry-run] would delist ${staleN} listings.`);
    return;
  }

  const { error: e3, count: updated } = await regionFilter(
    sb.from("listings").update({ delisted_at: new Date().toISOString() }, { count: "exact" }),
  ).lt("last_seen_at", cutoff);
  if (e3) throw new Error(`delist update: ${e3.message}`);
  console.log(`delisted ${updated ?? staleN} listings.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
