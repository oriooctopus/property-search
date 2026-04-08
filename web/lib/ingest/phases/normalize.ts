/**
 * Normalize phase: validate (per source) + dedup (combined).
 *
 * Per staff review: validate + dedup live together inside one "normalize"
 * phase, not split across two.
 */

import { deduplicateAndComposite } from "../../sources/dedup";
import { validateAndNormalize } from "../../sources/pipeline";
import type { ValidatedListing } from "../../sources/types";
import { phaseLogger } from "../logger";
import type {
  FetchPhaseOutput,
  NormalizePhaseOutput,
  OrchestratorDeps,
  PhaseResult,
} from "../types";

export async function runNormalizePhase(
  input: FetchPhaseOutput,
  _deps: OrchestratorDeps,
): Promise<PhaseResult<NormalizePhaseOutput>> {
  const log = phaseLogger("normalize");
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const warnings: string[] = [];
  const combinedValidated: ValidatedListing[] = [];
  let nonNyc = 0;
  let seUnitMismatch = 0;
  let other = 0;

  for (const [source, rows] of input.rowsBySource) {
    const result = validateAndNormalize(rows, source);
    combinedValidated.push(...result.listings);
    warnings.push(...result.qualitySummary.warnings);

    for (const r of result.rejected) {
      if (r.reason === "outside NYC bbox") nonNyc++;
      else if (r.reason.includes("unit")) seUnitMismatch++;
      else other++;
    }
  }

  const preDedup = combinedValidated.length;
  const deduped = deduplicateAndComposite(combinedValidated);
  log.info(
    `validated=${preDedup} deduped=${deduped.length} dropped=${preDedup - deduped.length} nonNyc=${nonNyc} seUnitMismatch=${seUnitMismatch} other=${other}`,
  );

  const finishedAt = new Date().toISOString();
  return {
    phase: "normalize",
    startedAt,
    finishedAt,
    durationMs: Date.now() - t0,
    ok: true,
    warnings,
    errors: [],
    metrics: {
      preDedup,
      postDedup: deduped.length,
      droppedNonNyc: nonNyc,
      droppedSeUnitMismatch: seUnitMismatch,
      droppedOther: other,
    },
    output: {
      validated: deduped,
      droppedCounts: { nonNyc, seUnitMismatch, other },
    },
  };
}
