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

export interface UpsertOpts {
  batchSize?: number;
  maxRetries?: number;
  backoffMs?: number;
  onConflict?: string;
  dryRun?: boolean;
}

export interface UpsertResult {
  attempted: number;
  succeeded: number;
  failed: number;
  errors: Array<{ batchIndex: number; message: string; rowUrls: string[] }>;
  splitOn413: number;
  retries: number;
}

const DEFAULTS: Required<Omit<UpsertOpts, "dryRun">> & { dryRun: boolean } = {
  batchSize: 50,
  maxRetries: 2,
  backoffMs: 500,
  onConflict: "url",
  dryRun: false,
};

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
    attempted: rows.length,
    succeeded: 0,
    failed: 0,
    errors: [],
    splitOn413: 0,
    retries: 0,
  };

  if (merged.dryRun) {
    console.log(`[upsert] dry-run: would upsert ${rows.length} rows (no writes)`);
    return result;
  }

  if (rows.length === 0) return result;

  const totalBatches = Math.ceil(rows.length / merged.batchSize);
  for (let i = 0, batchIndex = 0; i < rows.length; i += merged.batchSize, batchIndex++) {
    const batch = rows.slice(i, i + merged.batchSize);
    console.log(`[upsert] batch ${batchIndex + 1}/${totalBatches}: ${batch.length} rows`);

    const outcome = await upsertOneBatch(supabase, batch, merged, 0);
    result.succeeded += outcome.succeeded;
    result.failed += outcome.failed;
    result.splitOn413 += outcome.splitOn413;
    result.retries += outcome.retries;

    if (outcome.failed > 0) {
      result.errors.push({
        batchIndex,
        message: outcome.errorMessage ?? "partial landing (response shorter than input)",
        rowUrls: batch.slice(-outcome.failed).map((r) => r.url),
      });
    }
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
