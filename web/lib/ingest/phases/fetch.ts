/**
 * Fetch phase: run FetchStrategy for each source in parallel with retries.
 *
 * Per-source circuit breaker: if all 3 fetch retries fail, that source is
 * marked failed in perSourceResults and excluded from the output map. Other
 * sources continue.
 */

import type { AdapterOutput } from "../../sources/types";
import type {
  FetchPhaseOutput,
  OrchestratorDeps,
  PerSourceFetchResult,
  PhaseResult,
} from "../types";
import { phaseLogger } from "../logger";
import { withRetries } from "../retry";

export async function runFetchPhase(
  deps: OrchestratorDeps,
): Promise<PhaseResult<FetchPhaseOutput>> {
  const log = phaseLogger("fetch");
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const rowsBySource = new Map<string, AdapterOutput[]>();
  const perSourceResults: PerSourceFetchResult[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  log.info(`strategy=${deps.fetchStrategy.name} sources=${deps.sources.join(",")}`);

  const results = await Promise.all(
    deps.sources.map(async (source): Promise<PerSourceFetchResult> => {
      try {
        const rows = await withRetries(
          () =>
            deps.fetchStrategy.fetchSource(source, {
              supabase: deps.supabase,
              since: deps.since,
              dryRun: deps.dryRun,
            }),
          {
            tries: 3,
            backoffMs: 500,
            onAttempt: (attempt, err) => {
              const msg = err instanceof Error ? err.message : String(err);
              log.warn(`${source} attempt ${attempt} failed: ${msg}`);
            },
          },
        );
        rowsBySource.set(source, rows);
        log.info(`${source}: ${rows.length} rows fetched`);
        return { source, ok: true, rowCount: rows.length };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`${source}: circuit breaker — all retries failed: ${msg}`);
        warnings.push(`${source} fetch failed after 3 retries: ${msg}`);
        return { source, ok: false, rowCount: 0, error: msg };
      }
    }),
  );

  perSourceResults.push(...results);

  const finishedAt = new Date().toISOString();
  const totalRows = Array.from(rowsBySource.values()).reduce(
    (s, arr) => s + arr.length,
    0,
  );

  return {
    phase: "fetch",
    startedAt,
    finishedAt,
    durationMs: Date.now() - t0,
    ok: errors.length === 0,
    warnings,
    errors,
    metrics: {
      totalRows,
      sourcesOk: perSourceResults.filter((r) => r.ok).length,
      sourcesFailed: perSourceResults.filter((r) => !r.ok).length,
    },
    output: { rowsBySource, perSourceResults },
  };
}
