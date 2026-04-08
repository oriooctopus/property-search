/**
 * enrich-isochrones phase: find listings without listing_isochrones rows,
 * call the batch_enrich_listing_isochrones RPC in batches.
 */

import { phaseLogger } from "../logger";
import { withRetries } from "../retry";
import type {
  EnrichIsochronesOutput,
  OrchestratorDeps,
  PhaseResult,
} from "../types";

const SELECT_LIMIT = 10_000;
const RPC_BATCH = 200;

interface Row {
  id: number;
  lat: number;
  lon: number;
}

export async function runEnrichIsochronesPhase(
  deps: OrchestratorDeps,
): Promise<PhaseResult<EnrichIsochronesOutput>> {
  const log = phaseLogger("enrich-isochrones");
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  // Listings missing isochrones. Use a NOT EXISTS-ish pattern via
  // .not('id', 'in', subquery) — Supabase JS client can't express a left
  // join directly, so fetch listing_ids that DO have isochrones and exclude.
  // For reasonable dataset sizes (~50k listings) this is fine.
  const { data: hasData, error: hasErr } = await deps.supabase
    .from("listing_isochrones")
    .select("listing_id");
  if (hasErr) throw new Error(`select listing_isochrones failed: ${hasErr.message}`);

  const existing = new Set<number>(
    ((hasData ?? []) as { listing_id: number }[]).map((r) => r.listing_id),
  );

  const { data, error } = await deps.supabase
    .from("listings")
    .select("id, lat, lon")
    .not("lat", "is", null)
    .not("lon", "is", null)
    .limit(SELECT_LIMIT);
  if (error) throw new Error(`select listings failed: ${error.message}`);

  const missing = ((data ?? []) as Row[]).filter((r) => !existing.has(r.id));
  log.info(`found ${missing.length} listings missing isochrones`);

  if (deps.dryRun) {
    log.info(`dry-run: skipping RPC calls`);
    return {
      phase: "enrich-isochrones",
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      ok: true,
      warnings: [],
      errors: [],
      metrics: { queried: missing.length, enriched: 0, errors: 0 },
      output: { queried: missing.length, enriched: 0, errors: 0 },
    };
  }

  let enriched = 0;
  let errors = 0;

  for (let i = 0; i < missing.length; i += RPC_BATCH) {
    const batch = missing.slice(i, i + RPC_BATCH).map((r) => ({
      listing_id: r.id,
      lat: Number(r.lat),
      lon: Number(r.lon),
    }));
    try {
      await withRetries(
        async () => {
          const { error: rpcErr } = await deps.supabase.rpc(
            "batch_enrich_listing_isochrones",
            { p_listings: JSON.stringify(batch) },
          );
          if (rpcErr) throw new Error(rpcErr.message);
        },
        { tries: 2, backoffMs: 500 },
      );
      enriched += batch.length;
    } catch (err) {
      errors += batch.length;
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`batch ${i / RPC_BATCH + 1} failed: ${msg}`);
    }
  }

  log.info(`enriched=${enriched} errors=${errors}`);

  return {
    phase: "enrich-isochrones",
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    ok: errors === 0,
    warnings: errors > 0 ? [`${errors} rows failed isochrone enrichment`] : [],
    errors: [],
    metrics: { queried: missing.length, enriched, errors },
    output: { queried: missing.length, enriched, errors },
  };
}
