/**
 * enrich-year-built phase: idempotent PLUTO lookup for listings where
 * year_built IS NULL. No watermarks — just find NULLs, fill them.
 */

import { lookupYearBuiltForCoords } from "../../enrich/year-built";
import { phaseLogger } from "../logger";
import type {
  EnrichYearBuiltOutput,
  OrchestratorDeps,
  PhaseResult,
} from "../types";

const SELECT_LIMIT = 10_000;
const BATCH_SIZE = 500;
const REQUEST_DELAY_MS = 200;

interface Row {
  id: number;
  lat: number;
  lon: number;
}

export async function runEnrichYearBuiltPhase(
  deps: OrchestratorDeps,
): Promise<PhaseResult<EnrichYearBuiltOutput>> {
  const log = phaseLogger("enrich-year-built");
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const { data, error } = await deps.supabase
    .from("listings")
    .select("id, lat, lon")
    .is("year_built", null)
    .not("lat", "is", null)
    .not("lon", "is", null)
    .limit(SELECT_LIMIT);

  if (error) {
    throw new Error(`select failed: ${error.message}`);
  }

  const rows = (data ?? []) as Row[];
  log.info(`found ${rows.length} listings with null year_built`);

  if (deps.dryRun) {
    log.info(`dry-run: skipping PLUTO lookups`);
    return {
      phase: "enrich-year-built",
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      ok: true,
      warnings: [],
      errors: [],
      metrics: { queried: rows.length, updated: 0, noMatch: 0, errors: 0 },
      output: { queried: rows.length, updated: 0, noMatch: 0, errors: 0 },
    };
  }

  let updated = 0;
  let noMatch = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    log.info(`batch ${i / BATCH_SIZE + 1}/${Math.ceil(rows.length / BATCH_SIZE)} (${batch.length} rows)`);
    for (const row of batch) {
      try {
        const year = await lookupYearBuiltForCoords(Number(row.lat), Number(row.lon));
        if (year == null) {
          noMatch++;
        } else {
          const { error: upErr } = await deps.supabase
            .from("listings")
            .update({ year_built: year })
            .eq("id", row.id);
          if (upErr) {
            errors++;
            log.warn(`update id=${row.id} failed: ${upErr.message}`);
          } else {
            updated++;
          }
        }
        await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
      } catch (err) {
        errors++;
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`lookup id=${row.id} failed: ${msg}`);
      }
    }
  }

  log.info(`updated=${updated} noMatch=${noMatch} errors=${errors}`);

  return {
    phase: "enrich-year-built",
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    ok: true,
    warnings: errors > 0 ? [`${errors} PLUTO lookup errors`] : [],
    errors: [],
    metrics: { queried: rows.length, updated, noMatch, errors },
    output: { queried: rows.length, updated, noMatch, errors },
  };
}
