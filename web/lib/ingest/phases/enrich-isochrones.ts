/**
 * enrich-isochrones phase: find listings without listing_isochrones rows,
 * call the batch_enrich_listing_isochrones RPC in batches.
 *
 * BUG FIXED 2026-08-29: the old version fetched ALL listing_isochrones.listing_id
 * (one unranged .select()) into a Set, and all "missing" candidates via a single
 * .limit(10_000) on listings. PostgREST caps every response at 1000 rows
 * regardless of .limit(), so in production — ~8.6M listing_isochrones rows
 * over ~43k listings — this silently degenerated to: "existing" Set held
 * <=1000 of those 8.6M rows, and the candidate list was the first 1000
 * listings in arbitrary (effectively oldest-inserted) order. Journal evidence:
 * two live runs both logged "found 1000 listings missing isochrones" /
 * "enriched=975", while a probe showed 259 of 265 active craigslist listings
 * (the ones actually shown in the app) had zero isochrone rows — the phase
 * kept re-enriching the same ~1000 old rows (RPC's ON CONFLICT DO NOTHING
 * made that look like success) and never advanced. See web/lib/l-strip.ts,
 * which joins on listing_isochrones and was silently hiding almost every
 * active craigslist listing as a result.
 *
 * BUG FIXED 2026-08-29 (same day, found immediately after the first fix
 * shipped): the "already enriched?" existence check still hit the same
 * 1000-row cap from a different angle. listing_isochrones is a many-to-many
 * join (one row per listing x intersecting isochrone polygon — ~200 rows per
 * listing on average), so `.from("listing_isochrones").select("listing_id")
 * .in("listing_id", chunkIds)` for a 200-id chunk could return thousands of
 * matching rows, truncated by PostgREST to 1000 — covering as few as 2-3
 * distinct listing_ids out of the 200 (measured live). The other ~197 in the
 * chunk were then wrongly treated as "missing" and endlessly re-enriched:
 * "found N missing" could approach but never reach 0. Fixed by querying from
 * `listings` with an inner join instead, capped to 1 child row per parent
 * via `.limit(1, { referencedTable: "listing_isochrones" })` — bounds the
 * response to at most chunkIds.length rows regardless of how many isochrones
 * any one listing has.
 */

import { phaseLogger } from "../logger";
import { withRetries } from "../retry";
import type {
  EnrichIsochronesOutput,
  OrchestratorDeps,
  PhaseResult,
} from "../types";

// Max active listings scanned per run. Paged in POSTGREST_PAGE-sized chunks
// (see below) rather than one .limit() call, since PostgREST silently caps
// any single response at 1000 rows regardless of what .limit()/.range() asks
// for — that cap is what caused the bug this phase was rewritten to fix.
const SELECT_LIMIT = 10_000;
// PostgREST's hard per-response row cap (project-wide default). A .range()
// spanning more than this returns only the first POSTGREST_PAGE rows with no
// error — silently truncating, which is exactly the bug being fixed here. Any
// query over more rows MUST be paged in chunks of this size or smaller.
const POSTGREST_PAGE = 1000;
// Chunk size for the "already enriched?" existence check against
// listing_isochrones.listing_id. Small enough to stay well under URL/query
// size limits for an .in() filter, large enough to keep the number of
// round-trips reasonable (10_000 candidates / 200 = 50 queries worst case).
const EXISTENCE_CHUNK = 200;
const RPC_BATCH = 25;

interface Row {
  id: number;
  lat: number;
  lon: number;
}

/**
 * Page through active (delisted_at IS NULL) listings with coordinates,
 * newest-first, up to SELECT_LIMIT rows total. Newest-first (rather than the
 * old code's arbitrary/oldest order) matters because when the candidate pool
 * exceeds SELECT_LIMIT, we want to make progress on the listings the app
 * actually surfaces (recently seen/active) before working backward through
 * history — delisted listings are skipped entirely below since l-strip.ts
 * never shows them, so isochrones for them are pure waste.
 */
async function fetchActiveCandidates(deps: OrchestratorDeps): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; offset < SELECT_LIMIT; offset += POSTGREST_PAGE) {
    const pageEnd = Math.min(offset + POSTGREST_PAGE, SELECT_LIMIT) - 1;
    const { data, error } = await deps.supabase
      .from("listings")
      .select("id, lat, lon")
      .is("delisted_at", null)
      .not("lat", "is", null)
      .not("lon", "is", null)
      // Newest first; id desc as a tiebreak for listings sharing a
      // created_at timestamp (bulk-inserted in the same ingest run).
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, pageEnd);
    if (error) throw new Error(`select listings failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < POSTGREST_PAGE) break; // last page was partial: no more rows
  }
  return rows;
}

/**
 * Which of these candidate ids already have a listing_isochrones row.
 * Chunked (rather than one unranged .select() of the whole table, which was
 * the original bug this phase was rewritten to fix) so the query cost scales
 * with the candidate pool, not with total table size.
 *
 * Querying listing_isochrones directly (`.select("listing_id").in(...)`)
 * does NOT work here even chunked: a listing can have hundreds of isochrone
 * rows (one per intersecting polygon), so a 200-id chunk's matching rows can
 * exceed PostgREST's 1000-row cap after only a handful of listing_ids,
 * silently dropping the rest of the chunk (see the file-header bug note).
 * Querying from `listings` with an inner join instead, and capping the
 * embedded child rows to 1 per parent via
 * `.limit(1, { referencedTable: "listing_isochrones" })`, bounds the
 * response to at most chunkIds.length top-level rows no matter how many
 * isochrones any single listing has.
 */
async function findExistingIsochroneIds(
  deps: OrchestratorDeps,
  candidateIds: number[],
): Promise<Set<number>> {
  const existing = new Set<number>();
  for (let i = 0; i < candidateIds.length; i += EXISTENCE_CHUNK) {
    const chunkIds = candidateIds.slice(i, i + EXISTENCE_CHUNK);
    const { data, error } = await deps.supabase
      .from("listings")
      .select("id, listing_isochrones!inner(listing_id)")
      .in("id", chunkIds)
      .limit(1, { referencedTable: "listing_isochrones" });
    if (error) throw new Error(`select listing_isochrones failed: ${error.message}`);
    for (const r of (data ?? []) as { id: number }[]) {
      existing.add(r.id);
    }
  }
  return existing;
}

export async function runEnrichIsochronesPhase(
  deps: OrchestratorDeps,
): Promise<PhaseResult<EnrichIsochronesOutput>> {
  const log = phaseLogger("enrich-isochrones");
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const candidates = await fetchActiveCandidates(deps);
  const existing = await findExistingIsochroneIds(
    deps,
    candidates.map((r) => r.id),
  );
  const missing = candidates.filter((r) => !existing.has(r.id));
  log.info(
    `found ${missing.length} active listings missing isochrones (scanned ${candidates.length})`,
  );

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
            { p_listings: batch },
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
