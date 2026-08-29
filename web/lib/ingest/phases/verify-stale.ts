/**
 * verify-stale phase: check every listing whose last_seen_at is older than
 * STALE_AGE_DAYS against its source's verifier, and mark delisted rows.
 *
 * The phase itself knows nothing about individual sources — it groups
 * candidates by source, looks up the verifier in the registry, and runs each
 * group with the source's configured concurrency limit. Adding a source =
 * one entry in verify/registry.ts, no changes here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { phaseLogger } from "../logger";
import type {
  OrchestratorDeps,
  PhaseResult,
  VerifyStaleOutput,
} from "../types";
import type { ListingSource } from "../../sources/types";
import { verifiers, VERIFY_CONCURRENCY } from "../../sources/verify/registry";
import { parallelMap } from "../../sources/verify/shared";
import type { Verifier, VerifyDeps, VerifyResult } from "../../sources/verify/types";
import { sendIngestAlert } from "../alert";
import { isCraigslistLocalMode } from "../strategies";

const STALE_AGE_DAYS = 3;
// Per-source candidate cap. We fan out one query per source so that a
// stuck/blocked verifier on source A (e.g. FB-Marketplace returning 100%
// unknown) cannot starve sources B and C of their share of the daily budget.
// The previous behavior — one global ORDER BY last_seen_at LIMIT 2000 — let
// whichever source had the oldest backlog dominate the entire batch.
//
// Temporarily reduced 1000 → 500 as a circuit breaker while we validate the
// new split-workflow + concurrency=6 wall time. Can bump back to 1000 once
// tomorrow's 16:00 UTC run confirms the verify-stale job fits under 60min.
const PER_SOURCE_LIMIT = 500;
// Sources we run verify-stale against. Adding a new source = add it here
// AND register a verifier in sources/verify/registry.ts.
// NOTE: facebook-marketplace excluded — verifier is blocked (returns 100% unknown)
// and the source is disabled in the scraper registry.
// StreetEasy is intentionally NOT here: its per-listing verifier hits SE detail
// pages (PerimeterX → paid Apify proxy). SE stale detection now uses the free
// set-difference delist-unseen step after each complete fetch. Craigslist stays
// (no canonical URLs / reposts, so the per-listing verifier is the right tool).
const VERIFY_SOURCES: ListingSource[] = [
  "craigslist",
];
// If a source's verify batch returns this fraction of `unknown` or higher AND
// at least MIN_BATCH_SIZE_FOR_ALERT candidates ran, fire an alert — that's the
// silent-failure pattern that kept delisted_at from being written for weeks
// (proxy blocked / captcha wall / wrong verifier).
const UNKNOWN_ALERT_RATIO = 0.8;
const MIN_BATCH_SIZE_FOR_ALERT = 50;

// ---------------------------------------------------------------------------
// Craigslist-local gentle pass — see the 2026-08-28 incident note at the top
// of this file's header. When CRAIGSLIST_FETCHER=local, verify-stale must
// never again fire a burst of direct fetches from this box's residential
// IP: one request at a time, a randomized human-ish gap between them, a
// small per-run cap so even the throttled path can't approach the burst
// that got the IP blocked, and an immediate stop on the first sign
// Craigslist noticed us.
// ---------------------------------------------------------------------------
const CRAIGSLIST_LOCAL_CAP = 60;
// Delay is uniform in [2000, 5000)ms, i.e. MIN + random()*RANGE. Same
// formula/rationale as lib/sources/craigslist-local.ts's inter-detail-load
// delay: a fixed cadence is a known bot signature Craigslist's rate-limiter
// keys on.
const CRAIGSLIST_LOCAL_DELAY_MIN_MS = 2000;
const CRAIGSLIST_LOCAL_DELAY_RANGE_MS = 3000;

interface Candidate {
  id: number;
  url: string;
  source: string;
  external_id: string | null;
  last_seen_at: string;
}

async function loadCandidatesForSource(
  supabase: SupabaseClient,
  source: ListingSource,
  limit: number,
  cutoff: string,
  orderOldestFirst: boolean,
): Promise<Candidate[]> {
  let query = supabase
    .from("listings")
    .select("id, url, source, external_id, last_seen_at")
    .eq("source", source)
    .is("delisted_at", null)
    .lt("last_seen_at", cutoff);
  if (orderOldestFirst) {
    // Only used for the craigslist-local gentle pass, whose cap (60) is far
    // below the size that blew the Postgres statement-timeout for the
    // unordered full-batch query below — ordering a 60-row LIMIT is cheap.
    // "Oldest first" also matters more here: this pass runs sequentially at
    // ~3.5s/request, so which 60 rows it spends its budget on should be the
    // ones that have gone longest without a fresh last_seen_at, not an
    // arbitrary Postgres-chosen sample.
    query = query.order("last_seen_at", { ascending: true });
  }
  const { data, error } = await query
    // No ORDER BY on the unordered path: sorting the full stale candidate
    // set blew the Postgres statement-timeout on craigslist. We just need a
    // sample of `limit` rows per pass — Postgres can return them in
    // whatever order it likes, and rotating which rows get verified each
    // pass is slightly better than always picking the same oldest ones
    // anyway.
    .limit(limit);
  if (error) {
    throw new Error(
      `verify-stale candidate query failed for source=${source}: ${error.message}`,
    );
  }
  return (data ?? []) as Candidate[];
}

async function loadCandidates(
  supabase: SupabaseClient,
  perSourceLimit: number,
): Promise<Candidate[]> {
  const cutoff = new Date(
    Date.now() - STALE_AGE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  // Fan out one query per source with its own limit. The total processed is
  // bounded by VERIFY_SOURCES.length * perSourceLimit (currently 2 * 1000 = 2000)
  // and no single source can crowd out another regardless of backlog size.
  // Use allSettled so a transient timeout on one source's query doesn't kill
  // the entire phase — the working source(s) still get verified, and the
  // failed source will try again on the next run.
  //
  // craigslist-local is the one exception to perSourceLimit/no-ordering:
  // its cap and ordering come from the incident note above, not the general
  // per-source budget.
  const settled = await Promise.allSettled(
    VERIFY_SOURCES.map((source) => {
      const craigslistLocal = source === "craigslist" && isCraigslistLocalMode(process.env);
      const limit = craigslistLocal ? CRAIGSLIST_LOCAL_CAP : perSourceLimit;
      return loadCandidatesForSource(supabase, source, limit, cutoff, craigslistLocal);
    }),
  );
  const out: Candidate[] = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === "fulfilled") {
      out.push(...r.value);
    } else {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      console.warn(
        `[verify-stale] candidate query failed for source=${VERIFY_SOURCES[i]} — skipping this source for this run: ${reason}`,
      );
    }
  }
  return out;
}

function groupBySource(rows: Candidate[]): Map<string, Candidate[]> {
  const out = new Map<string, Candidate[]>();
  for (const r of rows) {
    const arr = out.get(r.source) ?? [];
    arr.push(r);
    out.set(r.source, arr);
  }
  return out;
}

interface AppliedResult {
  result: VerifyResult;
  candidate: Candidate;
}

async function applyResult(
  supabase: SupabaseClient,
  applied: AppliedResult,
  dryRun: boolean,
  phaseCutoff: string,
): Promise<"active" | "delisted" | "unknown" | "error"> {
  const { result, candidate } = applied;
  if (result.status === "unknown") return "unknown";
  if (dryRun) return result.status;

  if (result.status === "active") {
    const { error } = await supabase
      .from("listings")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", candidate.id);
    return error ? "error" : "active";
  }

  // delisted — gate on `last_seen_at < phaseCutoff` so a parallel fetch job
  // that just bumped this row to "fresh" wins the race. Without this gate,
  // verify-stale and fetch can produce the contradictory state
  // `delisted_at IS NOT NULL AND last_seen_at > delisted_at`. The phase
  // cutoff is the timestamp we used to load candidates — fetch's bump
  // would set last_seen_at >= now > phaseCutoff, failing the predicate
  // and leaving the listing untouched (correctly).
  const { error } = await supabase
    .from("listings")
    .update({ delisted_at: new Date().toISOString() })
    .eq("id", candidate.id)
    .lt("last_seen_at", phaseCutoff);
  return error ? "error" : "delisted";
}

/** True when a verify result signals the source bot-blocked us (see the
 *  `blocked` field on VerifyResult, set by verify/craigslist.ts on HTTP 403
 *  and on a 200 body with a block marker). Never true for "delisted" — a
 *  block is not evidence a posting is gone. */
function isBlockSignal(result: VerifyResult): boolean {
  return result.status === "unknown" && result.blocked === true;
}

/**
 * Craigslist-local gentle pass (see the CRAIGSLIST_LOCAL_* constants and the
 * 2026-08-28 incident note above): strictly sequential, a randomized 2-5s
 * delay between requests, and an immediate stop — remaining candidates left
 * completely untouched, no last_seen_at bump, no delisted_at — on the first
 * bot-block signal.
 *
 * `random`/`sleep` are injectable seams (default Math.random / a real
 * setTimeout wrapper) so tests can assert the exact delay sequence and drive
 * the abort path without waiting real time — same seam pattern as
 * lib/sources/craigslist-local.ts's doDetailSequential, which exists for the
 * identical reason: a `delayMs = 0` mutant must fail a dedicated test, not
 * just go unnoticed.
 */
async function runCraigslistLocalPass(
  rows: Candidate[],
  verifier: Verifier,
  verifyDeps: VerifyDeps,
  supabase: SupabaseClient,
  dryRun: boolean,
  phaseCutoff: string,
  summary: VerifyStaleOutput,
  log: ReturnType<typeof phaseLogger>,
  random: () => number,
  sleep: (ms: number) => Promise<void>,
): Promise<{ processed: number; unknown: number; blocked: boolean }> {
  let processed = 0;
  let sourceUnknown = 0;
  for (let i = 0; i < rows.length; i++) {
    if (i > 0) {
      const delayMs = CRAIGSLIST_LOCAL_DELAY_MIN_MS + random() * CRAIGSLIST_LOCAL_DELAY_RANGE_MS;
      await sleep(delayMs);
    }
    const row = rows[i];
    let result: VerifyResult;
    try {
      result = await verifier(row.url, verifyDeps);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result = { status: "unknown", reason: `exception: ${msg}` };
    }
    processed++;
    if (isBlockSignal(result)) {
      summary.unknown++;
      sourceUnknown++;
      const remaining = rows.length - processed;
      // The one loud line the run report / logs must carry — see brief:
      // "[verify-stale] craigslist: BOT BLOCK at <url> — aborting remaining
      // N candidates". phaseLogger already prefixes "[verify-stale]".
      log.warn(
        `craigslist: BOT BLOCK at ${row.url} — aborting remaining ${remaining} candidates (marked unknown, not delisted)`,
      );
      return { processed, unknown: sourceUnknown, blocked: true };
    }
    const outcome = await applyResult(supabase, { result, candidate: row }, dryRun, phaseCutoff);
    if (outcome === "active") summary.activeConfirmed++;
    else if (outcome === "delisted") summary.delistedConfirmed++;
    else if (outcome === "unknown") { summary.unknown++; sourceUnknown++; }
    else summary.errors++;
  }
  return { processed, unknown: sourceUnknown, blocked: false };
}

export async function runVerifyStalePhase(
  deps: OrchestratorDeps,
  // Test-only seams for the craigslist-local gentle pass's delay. Production
  // never passes these — defaults below are Math.random and a real
  // setTimeout wrapper, byte-identical to omitting the parameter entirely.
  testSeams?: { random?: () => number; sleep?: (ms: number) => Promise<void> },
): Promise<PhaseResult<VerifyStaleOutput>> {
  const log = phaseLogger("verify-stale");
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const random = testSeams?.random ?? Math.random;
  const sleep = testSeams?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const candidates = await loadCandidates(deps.supabase, PER_SOURCE_LIMIT);
  log.info(
    `found ${candidates.length} candidates with last_seen_at older than ${STALE_AGE_DAYS}d (per-source cap=${PER_SOURCE_LIMIT}, sources=${VERIFY_SOURCES.length})`,
  );

  const summary: VerifyStaleOutput = {
    candidates: candidates.length,
    activeConfirmed: 0,
    delistedConfirmed: 0,
    unknown: 0,
    errors: 0,
  };
  // Populated only by the craigslist-local abort path — kept out of
  // `summary`'s numeric fields (metrics below must stay Record<string,
  // number>) and surfaced separately in the returned `warnings`.
  const phaseWarnings: string[] = [];

  if (candidates.length === 0) {
    return {
      phase: "verify-stale",
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      ok: true,
      warnings: [],
      errors: [],
      metrics: {
        candidates: summary.candidates,
        activeConfirmed: summary.activeConfirmed,
        delistedConfirmed: summary.delistedConfirmed,
        unknown: summary.unknown,
        errors: summary.errors,
      },
      output: summary,
    };
  }

  const verifyDeps = {
    apifyToken: process.env.APIFY_TOKEN ?? process.env.APIFY_PROXY_URL ?? "",
  };

  const groups = groupBySource(candidates);
  for (const [src, rows] of groups) {
    const source = src as ListingSource;
    const verifier = verifiers[source];
    if (!verifier) {
      log.warn(`no verifier registered for source=${src}; ${rows.length} candidates skipped`);
      summary.unknown += rows.length;
      continue;
    }
    const craigslistLocal = source === "craigslist" && isCraigslistLocalMode(process.env);
    const limit = craigslistLocal ? 1 : (VERIFY_CONCURRENCY[source] ?? 5);
    log.info(
      `${src}: ${rows.length} candidates (concurrency=${limit}${craigslistLocal ? ", local gentle pass" : ""})`,
    );

    // Apply per-row as soon as each result comes back so partial progress
    // persists if the run is killed mid-flight (the previous batch-after-all
    // pattern lost ALL writes when the parent process was reaped).
    let progressCount = 0;
    const progressTotal = rows.length;
    let sourceUnknown = 0;
    const sourceStartedAt = Date.now();

    if (craigslistLocal) {
      log.info(
        `starting craigslist-local gentle pass for ${src} (${rows.length} rows, sequential, 2-5s delay)`,
      );
      const pass = await runCraigslistLocalPass(
        rows,
        verifier,
        verifyDeps,
        deps.supabase,
        deps.dryRun,
        startedAt,
        summary,
        log,
        random,
        sleep,
      );
      progressCount = pass.processed;
      sourceUnknown = pass.unknown;
      if (pass.blocked) {
        summary.blocked = true;
        phaseWarnings.push(
          `craigslist: BOT BLOCK detected — aborted local gentle pass after ${pass.processed}/${rows.length} candidates`,
        );
      }
    } else {
      log.info(`starting parallelMap for ${src} (${rows.length} rows, concurrency=${limit})`);
      await parallelMap(rows, limit, async (row) => {
        let result: VerifyResult;
        try {
          result = await verifier(row.url, verifyDeps);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result = { status: "unknown", reason: `exception: ${msg}` };
        }
        const outcome = await applyResult(
          deps.supabase,
          { result, candidate: row },
          deps.dryRun,
          startedAt,
        );
        if (outcome === "active") summary.activeConfirmed++;
        else if (outcome === "delisted") summary.delistedConfirmed++;
        else if (outcome === "unknown") { summary.unknown++; sourceUnknown++; }
        else summary.errors++;
        progressCount++;
        if (progressCount % 25 === 0 || progressCount === progressTotal) {
          log.info(
            `progress ${progressCount}/${progressTotal} a=${summary.activeConfirmed} d=${summary.delistedConfirmed} u=${summary.unknown} (last: ${result.status})`,
          );
        }
      });
    }
    const sourceMs = Date.now() - sourceStartedAt;
    log.info(
      `${src} pass finished: processed=${progressCount}/${progressTotal} unknown=${sourceUnknown} active=${summary.activeConfirmed} delisted=${summary.delistedConfirmed} errors=${summary.errors} elapsed=${sourceMs}ms`,
    );

    const unknownRatio = rows.length > 0 ? sourceUnknown / rows.length : 0;
    if (
      rows.length >= MIN_BATCH_SIZE_FOR_ALERT &&
      unknownRatio >= UNKNOWN_ALERT_RATIO
    ) {
      const pct = Math.round(unknownRatio * 100);
      log.warn(
        `WARNING: ${sourceUnknown}/${rows.length} (${pct}%) ${src} candidates returned unknown — verifier likely blocked`,
      );
      // Fire-and-forget alert so stale detection can't silently degrade again.
      sendIngestAlert(
        `[Dwelligence] verify-stale degraded: ${pct}% unknown for ${src}`,
        `verify-stale phase returned ${sourceUnknown}/${rows.length} (${pct}%) unknown for source=${src}. Zero progress is being made against the stale backlog. Common causes: Apify proxy budget exceeded, PerimeterX tightening, or verifier regex drift. Check https://console.apify.com usage and the ingest_runs table for the latest run id.`,
      ).catch(() => {});

      // Defense-in-depth: if a verifier is fully blocked (100% unknown) AND
      // RESEND_API_KEY isn't set, the alert email never goes out and the
      // failure stays invisible. Refuse to silently succeed in that case —
      // fail the workflow loudly so the missing key gets fixed.
      if (unknownRatio >= 1.0 && !process.env.RESEND_API_KEY) {
        const msg = `verify-stale returned 100% unknown for source=${src} AND RESEND_API_KEY is not set — refusing to silently degrade. Set RESEND_API_KEY in GH Actions secrets.`;
        log.warn(msg);
        throw new Error(msg);
      }
    }
  }

  if (deps.dryRun) {
    log.info(
      `dry-run summary: active=${summary.activeConfirmed} delisted=${summary.delistedConfirmed} unknown=${summary.unknown}`,
    );
  } else {
    log.info(
      `applied: active=${summary.activeConfirmed} delisted=${summary.delistedConfirmed} unknown=${summary.unknown} errors=${summary.errors}`,
    );
  }

  return {
    phase: "verify-stale",
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    ok: summary.errors === 0,
    warnings: phaseWarnings,
    errors: [],
    metrics: {
      candidates: summary.candidates,
      activeConfirmed: summary.activeConfirmed,
      delistedConfirmed: summary.delistedConfirmed,
      unknown: summary.unknown,
      errors: summary.errors,
    },
    output: summary,
  };
}
