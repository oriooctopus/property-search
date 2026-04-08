/**
 * Upsert phase: build rows via toListingRow, batch-upsert via upsertListings.
 */

import { toListingRow } from "../../sources/row";
import { formatUpsertResult, upsertListings } from "../../sources/upsert";
import { phaseLogger } from "../logger";
import type {
  NormalizePhaseOutput,
  OrchestratorDeps,
  PhaseResult,
  UpsertPhaseOutput,
} from "../types";

export async function runUpsertPhase(
  input: NormalizePhaseOutput,
  deps: OrchestratorDeps,
): Promise<PhaseResult<UpsertPhaseOutput>> {
  const log = phaseLogger("upsert");
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const rows = input.validated.map(toListingRow);
  const upsertResult = await upsertListings(deps.supabase, rows, {
    batchSize: 50,
    onConflict: "url",
    dryRun: deps.dryRun,
  });

  log.info(`\n${formatUpsertResult(upsertResult)}`);

  const finishedAt = new Date().toISOString();
  return {
    phase: "upsert",
    startedAt,
    finishedAt,
    durationMs: Date.now() - t0,
    ok: upsertResult.failed === 0,
    warnings: upsertResult.failed > 0 ? [`${upsertResult.failed} rows failed to upsert`] : [],
    errors: [],
    metrics: {
      attempted: upsertResult.attempted,
      succeeded: upsertResult.succeeded,
      failed: upsertResult.failed,
      retries: upsertResult.retries,
      splitOn413: upsertResult.splitOn413,
    },
    output: {
      upsertResult,
      upsertedUrls: input.validated.map((l) => l.url),
    },
  };
}
