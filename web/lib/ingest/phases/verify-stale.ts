/**
 * verify-stale phase: check every listing whose last_seen_at is older than
 * STALE_AGE_DAYS against its source's verifier, and mark delisted rows.
 *
 * The phase itself knows nothing about individual sources — it groups
 * candidates by source, looks up the verifier in the registry, and runs each
 * group with the source's configured concurrency limit. Adding a source =
 * one entry in verify/registry.ts, no changes here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { phaseLogger } from "../logger";
import type {
  OrchestratorDeps,
  PhaseResult,
  VerifyStaleOutput,
} from "../types";
import type { ListingSource } from "../../sources/types";
import { verifiers, VERIFY_CONCURRENCY } from "../../sources/verify/registry";
import { parallelMap } from "../../sources/verify/shared";
import type { VerifyResult } from "../../sources/verify/types";

const STALE_AGE_DAYS = 3;
const BATCH_LIMIT = 500;

interface Candidate {
  id: number;
  url: string;
  source: string;
  external_id: string | null;
}

async function loadCandidates(
  supabase: SupabaseClient,
  limit: number,
): Promise<Candidate[]> {
  const cutoff = new Date(
    Date.now() - STALE_AGE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data, error } = await supabase
    .from("listings")
    .select("id, url, source, external_id")
    .is("delisted_at", null)
    .lt("last_seen_at", cutoff)
    .limit(limit);
  if (error) throw new Error(`verify-stale candidate query failed: ${error.message}`);
  return (data ?? []) as Candidate[];
}

function groupBySource(rows: Candidate[]): Map<string, Candidate[]> {
  const out = new Map<string, Candidate[]>();
  for (const r of rows) {
    const arr = out.get(r.source) ?? [];
    arr.push(r);
    out.set(r.source, arr);
  }
  return out;
}

interface AppliedResult {
  result: VerifyResult;
  candidate: Candidate;
}

async function applyResult(
  supabase: SupabaseClient,
  applied: AppliedResult,
  dryRun: boolean,
): Promise<"active" | "delisted" | "unknown" | "error"> {
  const { result, candidate } = applied;
  if (result.status === "unknown") return "unknown";
  if (dryRun) return result.status;

  if (result.status === "active") {
    const { error } = await supabase
      .from("listings")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", candidate.id);
    return error ? "error" : "active";
  }

  // delisted
  const { error } = await supabase
    .from("listings")
    .update({ delisted_at: new Date().toISOString() })
    .eq("id", candidate.id);
  return error ? "error" : "delisted";
}

export async function runVerifyStalePhase(
  deps: OrchestratorDeps,
): Promise<PhaseResult<VerifyStaleOutput>> {
  const log = phaseLogger("verify-stale");
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const candidates = await loadCandidates(deps.supabase, BATCH_LIMIT);
  log.info(
    `found ${candidates.length} candidates with last_seen_at older than ${STALE_AGE_DAYS}d`,
  );

  const summary: VerifyStaleOutput = {
    candidates: candidates.length,
    activeConfirmed: 0,
    delistedConfirmed: 0,
    unknown: 0,
    errors: 0,
  };

  if (candidates.length === 0) {
    return {
      phase: "verify-stale",
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      ok: true,
      warnings: [],
      errors: [],
      metrics: { ...summary },
      output: summary,
    };
  }

  const verifyDeps = {
    apifyToken: process.env.APIFY_TOKEN ?? process.env.APIFY_PROXY_URL ?? "",
  };

  const groups = groupBySource(candidates);
  for (const [src, rows] of groups) {
    const source = src as ListingSource;
    const verifier = verifiers[source];
    if (!verifier) {
      log.warn(`no verifier registered for source=${src}; ${rows.length} candidates skipped`);
      summary.unknown += rows.length;
      continue;
    }
    const limit = VERIFY_CONCURRENCY[source] ?? 5;
    log.info(`${src}: ${rows.length} candidates (concurrency=${limit})`);

    const results = await parallelMap(rows, limit, async (row) => {
      try {
        const result = await verifier(row.url, verifyDeps);
        return { result, candidate: row };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          result: { status: "unknown", reason: `exception: ${msg}` } as VerifyResult,
          candidate: row,
        };
      }
    });

    for (const applied of results) {
      const outcome = await applyResult(deps.supabase, applied, deps.dryRun);
      if (outcome === "active") summary.activeConfirmed++;
      else if (outcome === "delisted") summary.delistedConfirmed++;
      else if (outcome === "unknown") summary.unknown++;
      else summary.errors++;
    }
  }

  if (deps.dryRun) {
    log.info(
      `dry-run summary: active=${summary.activeConfirmed} delisted=${summary.delistedConfirmed} unknown=${summary.unknown}`,
    );
  } else {
    log.info(
      `applied: active=${summary.activeConfirmed} delisted=${summary.delistedConfirmed} unknown=${summary.unknown} errors=${summary.errors}`,
    );
  }

  return {
    phase: "verify-stale",
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    ok: summary.errors === 0,
    warnings: [],
    errors: [],
    metrics: { ...summary },
    output: summary,
  };
}
