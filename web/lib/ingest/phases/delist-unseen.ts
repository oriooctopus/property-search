/**
 * delist-unseen phase: set-difference stale detection for the complete-refetch
 * model. Promoted from the old standalone `scripts/delist-unseen.ts` (see git
 * history) into the phase pipeline so it runs automatically whenever
 * StreetEasy is part of the sources list — the whole reason for this move is
 * that `ingest.ts --sources=craigslist,streeteasy` should delist StreetEasy
 * rows on its own, rather than needing a second script invocation the way the
 * old two-script CI setup did (see ../../.github/workflows/ingest.yml).
 *
 * WHY set-difference works for StreetEasy and nowhere else: the daily fetch
 * pulls the ENTIRE active in-region in-band set from StreetEasy's free API
 * (see BEDS_MIN/MAX, PRICE_MIN/MAX, REGION_LAT/LON bounds in
 * ../../sources/pipeline.ts), so every still-active listing gets its
 * last_seen_at bumped every run (see ../../sources/row.ts). Any in-region
 * in-band StreetEasy row NOT refreshed within the cadence window can only mean
 * StreetEasy stopped returning it — i.e. it's gone. This is the cheap inverse
 * of verify-stale, which re-checks each listing individually via the SE detail
 * page (PerimeterX-gated, paid Apify proxy) — we trust the complete fetch
 * instead and skip the per-listing check entirely for this source.
 *
 * SAFETY: refuses to delist (ok:false, zero writes) if the stale fraction
 * exceeds maxDelistFrac (default 0.35). A healthy day churns a few percent;
 * a large stale fraction means the preceding fetch was incomplete/failed, and
 * mass-delisting on that basis would be wrong — see the gate below, which
 * exists for the exact same reason at the source-count level rather than the
 * fraction level.
 *
 * GATE: this phase only touches the DB when there's good reason to trust this
 * run's StreetEasy fetch was actually complete:
 *   - fetchResults === null means the fetch phase was NOT SCHEDULED this
 *     invocation at all (e.g. `npx tsx scripts/ingest.ts
 *     --only-phase=delist-unseen`, an explicit operator invocation with no
 *     fetch step to check against) — we trust the caller in that case and run
 *     normally. This is NOT the same thing as "the fetch phase ran but its
 *     output was empty/missing" (e.g. it threw) — the orchestrator is
 *     responsible for only passing null when fetch was truly unscheduled, and
 *     passing `[]` (routing to the "streeteasy not in sources" branch below)
 *     whenever fetch was scheduled, ran, and produced nothing.
 *   - Otherwise we require a streeteasy entry in fetchResults with ok:true
 *     and rowCount>0. Any other case — streeteasy absent from --sources, its
 *     fetch threw (403/etc — see ../../sources/streeteasy.ts), or it somehow
 *     returned zero rows — means we do NOT have a trustworthy complete set
 *     this run, so we skip with a named reason and make zero DB calls rather
 *     than risk delisting on stale/absent fetch data.
 */

import { phaseLogger } from "../logger";
import {
  BEDS_MAX,
  BEDS_MIN,
  PRICE_MAX,
  PRICE_MIN,
  REGION_LAT_MAX,
  REGION_LAT_MIN,
  REGION_LON_MAX,
  REGION_LON_MIN,
} from "../../sources/pipeline";
import type {
  DelistUnseenOutput,
  OrchestratorDeps,
  PerSourceFetchResult,
  PhaseResult,
} from "../types";

export const DEFAULT_MAX_AGE_HOURS = 26;
export const DEFAULT_MAX_DELIST_FRAC = 0.35;

export interface DelistUnseenOpts {
  maxAgeHours: number;
  maxDelistFrac: number;
}

/**
 * The single predicate every query in this phase runs through: streeteasy,
 * active, in the ingested beds/price band, inside the region bounds.
 *
 * BEDS_MIN/MAX and PRICE_MIN/MAX come from ../../sources/pipeline.ts (the
 * same constants the normalize pipeline enforces on every ingested row) —
 * NOT a hard-coded `.in("beds", [...])` list. The old script hard-coded
 * `.in("beds",[2,3,4])`, a stale band from before the search moved to 1-2BR
 * (see git history / pipeline.ts's BEDS_MIN=1), which meant 1BR StreetEasy
 * rows could never be delisted by this path at all. Using .gte/.lte against
 * the shared constants means this predicate can't drift from the band the
 * rest of the pipeline ingests against.
 *
 * Typed loosely (`any` in, `any` out) rather than as a generic over
 * supabase-js's real PostgrestFilterBuilder<...>: the old script's version of
 * this helper used a generic `<Q extends RegionQuery<Q>>` structural type,
 * which was never actually typechecked (scripts/ is excluded from
 * tsconfig.json) and blows up here with "Type instantiation is excessively
 * deep and possibly infinite" (TS2589) against the real builder's generics —
 * PostgrestFilterBuilder's own type parameters recurse through the schema
 * type in a way the checker can't bound once wrapped in another generic. The
 * select/update builders returned by deps.supabase are correctly typed at
 * every call site below regardless — this function is pure chaining glue, so
 * losing static checking inside it costs nothing real.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see TS2589 note above
function regionFilter(q: any): any {
  return q
    .eq("source", "streeteasy")
    .is("delisted_at", null)
    .gte("beds", BEDS_MIN)
    .lte("beds", BEDS_MAX)
    .gte("price", PRICE_MIN)
    .lte("price", PRICE_MAX)
    .gte("lat", REGION_LAT_MIN)
    .lte("lat", REGION_LAT_MAX)
    .gte("lon", REGION_LON_MIN)
    .lte("lon", REGION_LON_MAX);
}

/** See the GATE section of the file header. Returns null when the phase should run. */
function gateReason(fetchResults: PerSourceFetchResult[] | null): string | null {
  if (fetchResults === null) return null;
  const se = fetchResults.find((r) => r.source === "streeteasy");
  if (!se) return "streeteasy not in sources";
  if (!se.ok) return `streeteasy fetch failed: ${se.error ?? "unknown error"}`;
  if (se.rowCount === 0) return "streeteasy fetch returned 0 rows";
  return null;
}

function result(
  startedAt: string,
  t0: number,
  ok: boolean,
  warnings: string[],
  output: DelistUnseenOutput,
): PhaseResult<DelistUnseenOutput> {
  return {
    phase: "delist-unseen",
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    ok,
    warnings,
    errors: [],
    metrics: { scanned: output.scanned, stale: output.stale, delisted: output.delisted },
    output,
  };
}

export async function runDelistUnseenPhase(
  deps: OrchestratorDeps,
  fetchResults: PerSourceFetchResult[] | null,
  opts: DelistUnseenOpts,
): Promise<PhaseResult<DelistUnseenOutput>> {
  const log = phaseLogger("delist-unseen");
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const capOverridden = opts.maxDelistFrac !== DEFAULT_MAX_DELIST_FRAC;

  const skipReason = gateReason(fetchResults);
  if (skipReason) {
    log.info(`skipped: ${skipReason}`);
    return result(startedAt, t0, true, [], {
      scanned: 0,
      stale: 0,
      delisted: 0,
      skippedReason: skipReason,
      capOverridden,
    });
  }

  const cutoff = new Date(Date.now() - opts.maxAgeHours * 3600_000).toISOString();

  const { count: total, error: e1 } = await regionFilter(
    deps.supabase.from("listings").select("*", { count: "exact", head: true }),
  );
  if (e1) throw new Error(`delist-unseen count active: ${e1.message}`);
  const totalN = total ?? 0;

  if (totalN === 0) {
    log.info(`ok: 0 rows match the streeteasy predicate, nothing to scan`);
    return result(startedAt, t0, true, [], {
      scanned: 0,
      stale: 0,
      delisted: 0,
      skippedReason: null,
      capOverridden,
    });
  }

  const { count: stale, error: e2 } = await regionFilter(
    deps.supabase.from("listings").select("*", { count: "exact", head: true }),
  ).lt("last_seen_at", cutoff);
  if (e2) throw new Error(`delist-unseen count stale: ${e2.message}`);
  const staleN = stale ?? 0;
  const frac = staleN / totalN;
  log.info(
    `scanned=${totalN} stale=${staleN} frac=${(frac * 100).toFixed(1)}% cutoff=${cutoff}`,
  );

  if (frac > opts.maxDelistFrac) {
    const msg = `delist-unseen refused: would delist ${staleN}/${totalN} (${(frac * 100).toFixed(1)}%) > ${(opts.maxDelistFrac * 100).toFixed(0)}% cap`;
    log.warn(msg);
    return result(startedAt, t0, false, [msg], {
      scanned: totalN,
      stale: staleN,
      delisted: 0,
      skippedReason: null,
      capOverridden,
    });
  }

  if (staleN === 0) {
    log.info(`ok: nothing stale`);
    return result(startedAt, t0, true, [], {
      scanned: totalN,
      stale: 0,
      delisted: 0,
      skippedReason: null,
      capOverridden,
    });
  }

  if (deps.dryRun) {
    log.info(`dry-run: would delist ${staleN} listings`);
    return result(startedAt, t0, true, [], {
      scanned: totalN,
      stale: staleN,
      delisted: 0,
      skippedReason: null,
      capOverridden,
    });
  }

  const { error: e3, count: updated } = await regionFilter(
    deps.supabase
      .from("listings")
      .update({ delisted_at: new Date().toISOString() }, { count: "exact" }),
  ).lt("last_seen_at", cutoff);
  if (e3) throw new Error(`delist-unseen update: ${e3.message}`);
  const delisted = updated ?? staleN;
  log.info(`delisted-${delisted} of ${totalN} scanned`);
  return result(startedAt, t0, true, [], {
    scanned: totalN,
    stale: staleN,
    delisted,
    skippedReason: null,
    capOverridden,
  });
}
