/**
 * cleanup-stale phase: delete listings older than STALE_LISTING_DAYS.
 *
 * Ported from refresh-sources.ts (deleteStaleListings). Same cutoff semantics:
 * rows with created_at < now - 45d.
 */

import { phaseLogger } from "../logger";
import type {
  CleanupStaleOutput,
  OrchestratorDeps,
  PhaseResult,
} from "../types";

const STALE_LISTING_DAYS = 45;

export async function runCleanupStalePhase(
  deps: OrchestratorDeps,
): Promise<PhaseResult<CleanupStaleOutput>> {
  const log = phaseLogger("cleanup-stale");
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const cutoff = new Date(
    Date.now() - STALE_LISTING_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { count, error: countErr } = await deps.supabase
    .from("listings")
    .select("*", { count: "exact", head: true })
    .lt("created_at", cutoff);

  if (countErr) throw new Error(`count failed: ${countErr.message}`);
  const staleCount = count ?? 0;
  log.info(`found ${staleCount} listings older than ${STALE_LISTING_DAYS} days`);

  if (deps.dryRun) {
    log.info(`dry-run: skipping delete`);
    return {
      phase: "cleanup-stale",
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      ok: true,
      warnings: [],
      errors: [],
      metrics: { staleDeleted: 0, staleFound: staleCount },
      output: { staleDeleted: 0 },
    };
  }

  let staleDeleted = 0;
  if (staleCount > 0) {
    const { error: delErr } = await deps.supabase
      .from("listings")
      .delete()
      .lt("created_at", cutoff);
    if (delErr) throw new Error(`delete failed: ${delErr.message}`);
    staleDeleted = staleCount;
    log.info(`deleted ${staleDeleted} stale listings`);
  }

  return {
    phase: "cleanup-stale",
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    ok: true,
    warnings: [],
    errors: [],
    metrics: { staleDeleted, staleFound: staleCount },
    output: { staleDeleted },
  };
}
