/**
 * cleanup-stale phase: archive rows that have been delisted for longer than
 * ARCHIVE_DAYS.
 *
 * Earlier versions of this phase deleted rows based on `created_at < now -
 * 45d`, which incorrectly wiped active, re-verified listings whose first
 * scrape was old. The correct semantics — now that verify-stale handles true
 * staleness — is: only delete rows that verify-stale has confirmed delisted
 * AND that have been delisted long enough that keeping them around no longer
 * serves users (historic favorites still see them until this sweep runs).
 */

import { phaseLogger } from "../logger";
import type {
  CleanupStaleOutput,
  OrchestratorDeps,
  PhaseResult,
} from "../types";

const ARCHIVE_DAYS = 90;

export async function runCleanupStalePhase(
  deps: OrchestratorDeps,
): Promise<PhaseResult<CleanupStaleOutput>> {
  const log = phaseLogger("cleanup-stale");
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const cutoff = new Date(
    Date.now() - ARCHIVE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { count, error: countErr } = await deps.supabase
    .from("listings")
    .select("*", { count: "exact", head: true })
    .not("delisted_at", "is", null)
    .lt("delisted_at", cutoff);

  if (countErr) throw new Error(`count failed: ${countErr.message}`);
  const staleCount = count ?? 0;
  log.info(
    `found ${staleCount} listings delisted more than ${ARCHIVE_DAYS} days ago`,
  );

  if (deps.dryRun) {
    log.info(`dry-run: skipping archive delete`);
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
      .not("delisted_at", "is", null)
      .lt("delisted_at", cutoff);
    if (delErr) throw new Error(`delete failed: ${delErr.message}`);
    staleDeleted = staleCount;
    log.info(`archived ${staleDeleted} long-delisted listings`);
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
