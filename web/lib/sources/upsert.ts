/**
 * Centralized batch upsert for the `listings` table.
 *
 * Phase B of INGEST-PROPOSAL.md. Single source of truth for:
 *   - batch size
 *   - retry policy (exponential backoff)
 *   - 413 payload-too-large auto-splitting
 *   - honest success counting (derived from response, not "no error")
 *
 * Used by refresh-sources.ts, refresh-se-daily.ts, and (Phase C) ingest.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ListingRow } from "./row";
import { apartmentIdentityKey } from "./identity";

export interface UpsertOpts {
  batchSize?: number;
  maxRetries?: number;
  backoffMs?: number;
  onConflict?: string;
  dryRun?: boolean;
  /**
   * Opt-in INGEST-LEVEL identity de-duplication. When true, before upserting we
   * (1) collapse within-batch duplicates that share an apartment-identity key
   * (see lib/sources/identity.ts), and (2) redirect any row whose identity
   * matches an EXISTING active row (same source, DIFFERENT url) onto that row's
   * `id`, so the upsert UPDATES it in place instead of INSERTing a churned-url
   * duplicate. Without this, a Craigslist repost / StreetEasy re-list (which
   * gets a fresh url) inserts a brand-new duplicate row every scrape.
   */
  dedupIdentity?: boolean;
}

export interface UpsertResult {
  attempted: number;
  succeeded: number;
  failed: number;
  errors: Array<{ batchIndex: number; message: string; rowUrls: string[] }>;
  splitOn413: number;
  retries: number;
  dedupedInBatch: number;
  /** Rows dropped because another row in the same batch shared their identity key. */
  identityDedupedInBatch: number;
  /** Rows redirected onto an existing active row's id (url churn caught). */
  identityRedirected: number;
}

const DEFAULTS: Required<Omit<UpsertOpts, "dryRun">> & { dryRun: boolean } = {
  batchSize: 50,
  maxRetries: 2,
  backoffMs: 500,
  onConflict: "url",
  dryRun: false,
  dedupIdentity: false,
};

// NOTE: toListingRow (lib/sources/row.ts) intentionally OMITS `delisted_at`
// and `created_at` from the row payload. supabase-js strips undefined keys
// before hitting PostgREST, so the ON CONFLICT UPDATE never touches those
// columns — meaning a row that verify-stale marked delisted cannot be
// resurrected by a subsequent upsert, and `created_at` keeps its original
// value. `last_seen_at` IS set (to now) so upserts bump it naturally.

function isPayloadTooLarge(err: unknown): boolean {
  if (!err) return false;
  const msg =
    typeof err === "string"
      ? err
      : err instanceof Error
        ? err.message
        : (err as { message?: string })?.message ?? "";
  const code = (err as { code?: string | number; status?: number })?.code;
  const status = (err as { status?: number; statusCode?: number })?.status ??
    (err as { statusCode?: number })?.statusCode;
  if (status === 413 || code === 413 || code === "413") return true;
  return /payload\s*too\s*large|413|request entity too large/i.test(msg);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface BatchOutcome {
  succeeded: number;
  failed: number;
  errorMessage?: string;
  splitOn413: number;
  retries: number;
}

async function upsertOneBatch(
  supabase: SupabaseClient,
  batch: ListingRow[],
  opts: Required<Omit<UpsertOpts, "dryRun">>,
  depth: number,
): Promise<BatchOutcome> {
  let retries = 0;
  const splitOn413 = 0;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    const t0 = Date.now();
    const { data, error } = await supabase
      .from("listings")
      .upsert(batch, { onConflict: opts.onConflict, ignoreDuplicates: false })
      .select("url");

    if (!error) {
      const succeeded = Array.isArray(data) ? data.length : 0;
      const failed = Math.max(0, batch.length - succeeded);
      const dt = Date.now() - t0;
      console.log(
        `[upsert] batch ok: ${succeeded}/${batch.length} (${dt}ms${attempt > 0 ? `, attempt ${attempt + 1}` : ""})`,
      );
      return { succeeded, failed, splitOn413, retries };
    }

    // 413 → split in half and recurse, regardless of remaining retries
    if (isPayloadTooLarge(error) && batch.length > 1 && depth < 3) {
      const mid = Math.floor(batch.length / 2);
      console.warn(
        `[upsert] 413 payload too large at size ${batch.length} — splitting (depth ${depth + 1})`,
      );
      const left = await upsertOneBatch(supabase, batch.slice(0, mid), opts, depth + 1);
      const right = await upsertOneBatch(supabase, batch.slice(mid), opts, depth + 1);
      return {
        succeeded: left.succeeded + right.succeeded,
        failed: left.failed + right.failed,
        errorMessage: left.errorMessage ?? right.errorMessage,
        splitOn413: 1 + left.splitOn413 + right.splitOn413,
        retries: retries + left.retries + right.retries,
      };
    }

    // Generic error → retry with backoff
    if (attempt < opts.maxRetries) {
      retries++;
      const wait = opts.backoffMs * Math.pow(2, attempt);
      console.warn(
        `[upsert] batch error (attempt ${attempt + 1}/${opts.maxRetries + 1}): ${error.message} — retrying in ${wait}ms`,
      );
      await sleep(wait);
      continue;
    }

    // Out of retries
    console.warn(
      `[upsert] batch failed after ${opts.maxRetries + 1} attempts: ${error.message}`,
    );
    return {
      succeeded: 0,
      failed: batch.length,
      errorMessage: error.message,
      splitOn413,
      retries,
    };
  }

  // Unreachable, but keeps TS happy
  return { succeeded: 0, failed: batch.length, splitOn413, retries };
}

/** Minimal shape needed to compute an identity key from an existing DB row. */
interface ActiveRow {
  id: number;
  url: string;
  address: string;
  beds: number;
  price: number;
  source: string;
  last_seen_at: string | null;
  lat: number | null;
  lon: number | null;
}

function rowToIdentity(r: {
  address?: string | null;
  beds?: number;
  price?: number;
  url: string;
  source?: string;
  lat?: number | null;
  lon?: number | null;
}) {
  return {
    address: r.address ?? null,
    beds: r.beds ?? 0,
    price: r.price ?? 0,
    url: r.url,
    // `source` is NOT NULL on the listings table and is always set by
    // toListingRow — an undefined here would be an upstream bug, so we don't
    // paper over it with a fallback string.
    source: r.source as string,
    // Needed for the craigslist title+coords identity fallback (rule 3 in
    // identity.ts) — undefined/null on either just falls through to the
    // url-only rule 4, same as before this field existed.
    lat: r.lat ?? null,
    lon: r.lon ?? null,
  };
}

/** Prefer the most-recently-seen row (max last_seen_at, tiebreak max id). */
function moreRecent(a: ActiveRow, b: ActiveRow): boolean {
  const at = a.last_seen_at ?? "";
  const bt = b.last_seen_at ?? "";
  if (at !== bt) return at > bt;
  return a.id > b.id;
}

/**
 * Fetch active rows (delisted_at IS NULL) for the sources present in `rows`,
 * and index them by apartment-identity key. When several active rows share a
 * key (an existing duplicate), the most-recently-seen one wins — matching the
 * "keep newest" rule used by the one-time cleanup script.
 */
async function buildIdentityIndex(
  supabase: SupabaseClient,
  rows: ListingRow[],
): Promise<Map<string, { id: number; url: string }>> {
  const sources = Array.from(new Set(rows.map((r) => r.source as string)));
  const active: ActiveRow[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("listings")
      .select("id, url, address, beds, price, source, last_seen_at, lat, lon")
      .is("delisted_at", null)
      .in("source", sources)
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`identity index fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    active.push(...(data as ActiveRow[]));
    if (data.length < PAGE) break;
  }

  const winners = new Map<string, ActiveRow>();
  for (const r of active) {
    const k = apartmentIdentityKey(rowToIdentity(r));
    const prev = winners.get(k);
    if (!prev || moreRecent(r, prev)) winners.set(k, r);
  }
  return new Map(
    Array.from(winners, ([k, r]) => [k, { id: r.id, url: r.url }]),
  );
}

interface GroupOutcome {
  attempted: number;
  succeeded: number;
  failed: number;
  splitOn413: number;
  retries: number;
  deduped: number;
  errors: UpsertResult["errors"];
}

/**
 * De-duplicate `rows` by their conflict key (last-write-wins, prevents
 * "cannot affect row a second time"), then batch-upsert them with that key as
 * the ON CONFLICT target.
 */
async function upsertConflictGroup(
  supabase: SupabaseClient,
  rows: ListingRow[],
  merged: Required<Omit<UpsertOpts, "dryRun">> & { dryRun: boolean },
  onConflict: string,
): Promise<GroupOutcome> {
  const conflictKey = onConflict as keyof ListingRow;
  const seen = new Map<string, ListingRow>();
  for (const row of rows) {
    const key = row[conflictKey] as unknown as string | number | undefined;
    if (key != null) seen.set(String(key), row); // last-write wins
  }
  const dedupedRows = Array.from(seen.values());
  const deduped = rows.length - dedupedRows.length;
  if (deduped > 0) {
    console.log(
      `[upsert] deduplicated ${deduped} rows by "${onConflict}" (${rows.length} → ${dedupedRows.length})`,
    );
  }

  const outcome: GroupOutcome = {
    attempted: dedupedRows.length,
    succeeded: 0,
    failed: 0,
    splitOn413: 0,
    retries: 0,
    deduped,
    errors: [],
  };

  if (merged.dryRun) {
    console.log(
      `[upsert] dry-run: would upsert ${dedupedRows.length} rows by "${onConflict}" (no writes)`,
    );
    return outcome;
  }
  if (dedupedRows.length === 0) return outcome;

  const groupOpts = { ...merged, onConflict };
  const totalBatches = Math.ceil(dedupedRows.length / merged.batchSize);
  for (let i = 0, batchIndex = 0; i < dedupedRows.length; i += merged.batchSize, batchIndex++) {
    const batch = dedupedRows.slice(i, i + merged.batchSize);
    console.log(
      `[upsert] batch ${batchIndex + 1}/${totalBatches} (on ${onConflict}): ${batch.length} rows`,
    );

    const b = await upsertOneBatch(supabase, batch, groupOpts, 0);
    outcome.succeeded += b.succeeded;
    outcome.failed += b.failed;
    outcome.splitOn413 += b.splitOn413;
    outcome.retries += b.retries;

    if (b.failed > 0) {
      outcome.errors.push({
        batchIndex,
        message: b.errorMessage ?? "partial landing (response shorter than input)",
        rowUrls: batch.slice(-b.failed).map((r) => r.url),
      });
    }
  }
  return outcome;
}

export async function upsertListings(
  supabase: SupabaseClient,
  rows: ListingRow[],
  opts: UpsertOpts = {},
): Promise<UpsertResult> {
  const merged: Required<Omit<UpsertOpts, "dryRun">> & { dryRun: boolean } = {
    ...DEFAULTS,
    ...opts,
    dryRun: opts.dryRun ?? false,
  };

  const result: UpsertResult = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
    splitOn413: 0,
    retries: 0,
    dedupedInBatch: 0,
    identityDedupedInBatch: 0,
    identityRedirected: 0,
  };

  let working = rows;

  // ── INGEST-LEVEL identity de-duplication (prevents url-churn duplicates) ──
  if (merged.dedupIdentity) {
    // 1. Collapse within-batch duplicates that share an identity key (keep the
    //    first occurrence). A single scrape can contain two reposts of the same
    //    apartment under different urls — without this they'd both survive the
    //    url-dedup below and one would INSERT a fresh duplicate.
    const seenKeys = new Map<string, ListingRow>();
    for (const row of rows) {
      const k = apartmentIdentityKey(rowToIdentity(row));
      if (!seenKeys.has(k)) seenKeys.set(k, row);
    }
    result.identityDedupedInBatch = rows.length - seenKeys.size;
    working = Array.from(seenKeys.values());
    if (result.identityDedupedInBatch > 0) {
      console.log(
        `[upsert] identity: collapsed ${result.identityDedupedInBatch} within-batch duplicate(s)`,
      );
    }

    // 2. Redirect rows whose identity matches an EXISTING active row (different
    //    url) onto that row's id, so the upsert UPDATES it in place. Read-only
    //    DB lookup — skipped in dry-run (no writes happen there anyway).
    if (!merged.dryRun) {
      const index = await buildIdentityIndex(supabase, working);
      for (const row of working) {
        const hit = index.get(apartmentIdentityKey(rowToIdentity(row)));
        if (hit && hit.url !== row.url) {
          row.id = hit.id;
          result.identityRedirected++;
        }
      }
      if (result.identityRedirected > 0) {
        console.log(
          `[upsert] identity: redirected ${result.identityRedirected} row(s) onto existing ids (url churn caught)`,
        );
      }
    }
  }

  // Rows carrying an `id` (identity-redirected) update in place via ON CONFLICT
  // "id"; everything else keeps the normal url-based upsert.
  const idGroup = working.filter((r) => r.id != null);
  const urlGroup = working.filter((r) => r.id == null);

  const groups: Array<GroupOutcome> = [];
  if (idGroup.length > 0) {
    groups.push(await upsertConflictGroup(supabase, idGroup, merged, "id"));
  }
  if (urlGroup.length > 0) {
    groups.push(await upsertConflictGroup(supabase, urlGroup, merged, merged.onConflict));
  }

  for (const g of groups) {
    result.attempted += g.attempted;
    result.succeeded += g.succeeded;
    result.failed += g.failed;
    result.splitOn413 += g.splitOn413;
    result.retries += g.retries;
    result.dedupedInBatch += g.deduped;
    result.errors.push(...g.errors);
  }

  return result;
}

export function formatUpsertResult(r: UpsertResult): string {
  const lines = [
    `  attempted:   ${r.attempted}`,
    `  succeeded:   ${r.succeeded}`,
    `  failed:      ${r.failed}`,
    `  retries:     ${r.retries}`,
    `  split-on-413: ${r.splitOn413}`,
    `  deduped:     ${r.dedupedInBatch}`,
    `  identity-deduped: ${r.identityDedupedInBatch}`,
    `  identity-redirected: ${r.identityRedirected}`,
  ];
  if (r.errors.length > 0) {
    lines.push(`  errors:`);
    for (const e of r.errors.slice(0, 5)) {
      lines.push(`    [batch ${e.batchIndex}] ${e.message} (${e.rowUrls.length} rows)`);
    }
    if (r.errors.length > 5) {
      lines.push(`    ...and ${r.errors.length - 5} more`);
    }
  }
  return lines.join("\n");
}
