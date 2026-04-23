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
import type { VerifyResult } from "../../sources/verify/types";
import { sendIngestAlert } from "../alert";

const STALE_AGE_DAYS = 3;
// Per-source candidate cap. We fan out one query per source so that a
// stuck/blocked verifier on source A (e.g. FB-Marketplace returning 100%
// unknown) cannot starve sources B and C of their share of the daily budget.
// The previous behavior — one global ORDER BY last_seen_at LIMIT 2000 — let
// whichever source had the oldest backlog dominate the entire batch.
const PER_SOURCE_LIMIT = 1000;
// Sources we run verify-stale against. Adding a new source = add it here
// AND register a verifier in sources/verify/registry.ts.
const VERIFY_SOURCES: ListingSource[] = [
  "streeteasy",
  "craigslist",
  "facebook-marketplace",
];
// If a source's verify batch returns this fraction of `unknown` or higher AND
// at least MIN_BATCH_SIZE_FOR_ALERT candidates ran, fire an alert — that's the
// silent-failure pattern that kept delisted_at from being written for weeks
// (proxy blocked / captcha wall / wrong verifier).
const UNKNOWN_ALERT_RATIO = 0.8;
const MIN_BATCH_SIZE_FOR_ALERT = 50;

interface Candidate {
  id: number;
  url: string;
  source: string;
  external_id: string | null;
}

async function loadCandidatesForSource(
  supabase: SupabaseClient,
  source: ListingSource,
  limit: number,
  cutoff: string,
): Promise<Candidate[]> {
  const { data, error } = await supabase
    .from("listings")
    .select("id, url, source, external_id")
    .eq("source", source)
    .is("delisted_at", null)
    .lt("last_seen_at", cutoff)
    .order("last_seen_at", { ascending: true })
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
  // bounded by VERIFY_SOURCES.length * perSourceLimit (currently 3 * 1000 = 3000)
  // and no single source can crowd out another regardless of backlog size.
  const perSource = await Promise.all(
    VERIFY_SOURCES.map((source) =>
      loadCandidatesForSource(supabase, source, perSourceLimit, cutoff),
    ),
  );
  return perSource.flat();
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

  // delisted
  const { error } = await supabase
    .from("listings")
    .update({ delisted_at: new Date().toISOString() })
    .eq("id", candidate.id);
  return error ? "error" : "delisted";
}

export async function runVerifyStalePhase(
  deps: OrchestratorDeps,
): Promise<PhaseResult<VerifyStaleOutput>> {
  const log = phaseLogger("verify-stale");
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

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

  if (candidates.length === 0) {
    return {
      phase: "verify-stale",
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      ok: true,
      warnings: [],
      errors: [],
      metrics: { ...summary },
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
    const limit = VERIFY_CONCURRENCY[source] ?? 5;
    log.info(`${src}: ${rows.length} candidates (concurrency=${limit})`);

    // Apply per-row inside the parallelMap callback so partial progress
    // persists if the run is killed mid-flight (the previous batch-after-all
    // pattern lost ALL writes when the parent process was reaped).
    let progressCount = 0;
    const progressTotal = rows.length;
    let sourceUnknown = 0;
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
    warnings: [],
    errors: [],
    metrics: { ...summary },
    output: summary,
  };
}
