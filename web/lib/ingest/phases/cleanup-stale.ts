/**
 * cleanup-stale phase: reports how many delisted listings exist in the DB.
 *
 * Previously this phase hard-deleted listings that had been delisted for 90+
 * days, which broke user references (wishlists, hidden lists) and destroyed
 * data. Delisted listings are now retained indefinitely — the partial index
 * on `delisted_at IS NULL` keeps active-listing queries fast regardless of
 * how many delisted rows accumulate.
 */

import { phaseLogger } from "../logger";
import type {
  CleanupStaleOutput,
  OrchestratorDeps,
  PhaseResult,
} from "../types";

export async function runCleanupStalePhase(
  deps: OrchestratorDeps,
): Promise<PhaseResult<CleanupStaleOutput>> {
  const log = phaseLogger("cleanup-stale");
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const { count, error: countErr } = await deps.supabase
    .from("listings")
    .select("*", { count: "exact", head: true })
    .not("delisted_at", "is", null);

  if (countErr) throw new Error(`count failed: ${countErr.message}`);
  const delistedCount = count ?? 0;
  log.info(
    `${delistedCount} delisted listings retained in DB (no longer purged)`,
  );

  return {
    phase: "cleanup-stale",
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    ok: true,
    warnings: [],
    errors: [],
    metrics: { staleDeleted: 0, staleFound: delistedCount },
    output: { staleDeleted: 0 },
  };
}
