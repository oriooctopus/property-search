/**
 * Orchestrator: composes phases in order and threads typed outputs forward.
 *
 * Each phase runs inside a try/catch that wraps exceptions into a failed
 * PhaseResult. Subsequent phases still run — enrichment and cleanup operate
 * on DB state, not on this run's output.
 */

import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { runFetchPhase } from "./phases/fetch";
import { runNormalizePhase } from "./phases/normalize";
import { runUpsertPhase } from "./phases/upsert";
import { runEnrichYearBuiltPhase } from "./phases/enrich-year-built";
import { runEnrichIsochronesPhase } from "./phases/enrich-isochrones";
import { runCleanupStalePhase } from "./phases/cleanup-stale";
import { runVerifyStalePhase } from "./phases/verify-stale";
import { runReportPhase } from "./phases/report";
import { runVerifyCostsPhase } from "./phases/verify-costs";
import type {
  FetchPhaseOutput,
  FetchStrategy,
  IntegrityReport,
  NormalizePhaseOutput,
  OrchestratorDeps,
  PerSourceFetchResult,
  PhaseResult,
  UpsertPhaseOutput,
} from "./types";

export interface RunOrchestratorOpts {
  supabase: SupabaseClient;
  fetchStrategy: FetchStrategy;
  sources: string[];
  dryRun: boolean;
  skipPhases: Set<string>;
  onlyPhases: Set<string> | null;
  since?: string;
  budgetUsd?: number;
}

const ALL_PHASES = [
  "fetch",
  "normalize",
  "upsert",
  "enrich-year-built",
  "enrich-isochrones",
  "verify-stale",
  "cleanup-stale",
  "report",
  "verify-costs",
] as const;

function shouldRun(
  phase: string,
  skipPhases: Set<string>,
  onlyPhases: Set<string> | null,
): boolean {
  if (onlyPhases && onlyPhases.size > 0) return onlyPhases.has(phase);
  return !skipPhases.has(phase);
}

async function safeRun<TOutput>(
  phase: string,
  fn: () => Promise<PhaseResult<TOutput>>,
): Promise<PhaseResult<TOutput>> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${phase}] unhandled exception: ${msg}`);
    return {
      phase,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      ok: false,
      warnings: [],
      errors: [msg],
      metrics: {},
    };
  }
}

export async function runOrchestrator(
  opts: RunOrchestratorOpts,
): Promise<IntegrityReport> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();

  const deps: OrchestratorDeps = {
    supabase: opts.supabase,
    dryRun: opts.dryRun,
    sources: opts.sources,
    since: opts.since,
    skipPhases: opts.skipPhases,
    onlyPhases: opts.onlyPhases,
    fetchStrategy: opts.fetchStrategy,
    runId,
    startedAt,
    budgetUsd: opts.budgetUsd ?? 1.0,
  };

  const phases: PhaseResult[] = [];
  let fetchOut: FetchPhaseOutput | undefined;
  let normalizeOut: NormalizePhaseOutput | undefined;
  let upsertOut: UpsertPhaseOutput | undefined;
  let perSourceResults: PerSourceFetchResult[] = [];

  // fetch
  if (shouldRun("fetch", opts.skipPhases, opts.onlyPhases)) {
    const res = await safeRun("fetch", () => runFetchPhase(deps));
    phases.push(res);
    fetchOut = res.output as FetchPhaseOutput | undefined;
    if (fetchOut) perSourceResults = fetchOut.perSourceResults;
  }

  // normalize
  if (shouldRun("normalize", opts.skipPhases, opts.onlyPhases)) {
    const input: FetchPhaseOutput =
      fetchOut ?? { rowsBySource: new Map(), perSourceResults: [] };
    const res = await safeRun("normalize", () => runNormalizePhase(input, deps));
    phases.push(res);
    normalizeOut = res.output as NormalizePhaseOutput | undefined;
  }

  // upsert
  if (shouldRun("upsert", opts.skipPhases, opts.onlyPhases)) {
    const input: NormalizePhaseOutput =
      normalizeOut ?? {
        validated: [],
        droppedCounts: { nonNyc: 0, seUnitMismatch: 0, other: 0 },
      };
    const res = await safeRun("upsert", () => runUpsertPhase(input, deps));
    phases.push(res);
    upsertOut = res.output as UpsertPhaseOutput | undefined;
  }

  // enrich-year-built (operates on DB state, not this run's output)
  if (shouldRun("enrich-year-built", opts.skipPhases, opts.onlyPhases)) {
    const res = await safeRun("enrich-year-built", () =>
      runEnrichYearBuiltPhase(deps),
    );
    phases.push(res);
  }

  // enrich-isochrones
  if (shouldRun("enrich-isochrones", opts.skipPhases, opts.onlyPhases)) {
    const res = await safeRun("enrich-isochrones", () =>
      runEnrichIsochronesPhase(deps),
    );
    phases.push(res);
  }

  // verify-stale (must run before cleanup-stale so delisted rows get a
  // chance to be marked before the 90-day archive sweep)
  if (shouldRun("verify-stale", opts.skipPhases, opts.onlyPhases)) {
    const res = await safeRun("verify-stale", () => runVerifyStalePhase(deps));
    phases.push(res);
  }

  // cleanup-stale
  if (shouldRun("cleanup-stale", opts.skipPhases, opts.onlyPhases)) {
    const res = await safeRun("cleanup-stale", () => runCleanupStalePhase(deps));
    phases.push(res);
  }

  // Totals
  let totalListingsInDb = 0;
  let nullYearBuilt = 0;
  let missingIsochrones = 0;
  try {
    const { count: lc } = await deps.supabase
      .from("listings")
      .select("*", { count: "exact", head: true });
    totalListingsInDb = lc ?? 0;

    const { count: nybc } = await deps.supabase
      .from("listings")
      .select("*", { count: "exact", head: true })
      .is("year_built", null);
    nullYearBuilt = nybc ?? 0;

    // missingIsochrones: listings count minus listing_isochrones count (rough)
    const { count: lic } = await deps.supabase
      .from("listing_isochrones")
      .select("*", { count: "exact", head: true });
    missingIsochrones = Math.max(0, totalListingsInDb - (lic ?? 0));
  } catch {
    // best-effort totals
  }

  const finishedAt = new Date().toISOString();
  const report: IntegrityReport = {
    runId,
    fetchStrategy: opts.fetchStrategy.name,
    sources: opts.sources,
    phases,
    totals: {
      rowsFetched: fetchOut
        ? Array.from(fetchOut.rowsBySource.values()).reduce(
            (s, arr) => s + arr.length,
            0,
          )
        : 0,
      rowsAfterNormalize: normalizeOut?.validated.length ?? 0,
      rowsUpserted: upsertOut?.upsertResult.succeeded ?? 0,
      rowsFailed: upsertOut?.upsertResult.failed ?? 0,
      rowsDroppedNonNyc: normalizeOut?.droppedCounts.nonNyc ?? 0,
      rowsDroppedSeUnitMismatch: normalizeOut?.droppedCounts.seUnitMismatch ?? 0,
      nullYearBuilt,
      missingIsochrones,
    },
    warnings: [],
    startedAt,
    finishedAt,
    exitCode: 0,
  };

  // report
  if (shouldRun("report", opts.skipPhases, opts.onlyPhases)) {
    const res = await safeRun("report", () =>
      runReportPhase(
        { report, perSourceResults, totalListingsInDb },
        deps,
      ),
    );
    phases.push(res);
  }

  // verify-costs — always runs (even if earlier phases failed)
  if (shouldRun("verify-costs", opts.skipPhases, opts.onlyPhases)) {
    const res = await safeRun("verify-costs", () =>
      runVerifyCostsPhase({ report }, deps),
    );
    phases.push(res);
  }

  report.finishedAt = new Date().toISOString();
  return report;
}

export { ALL_PHASES };
