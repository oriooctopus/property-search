/**
 * Shared types for the ingest orchestrator.
 *
 * Each phase takes a typed input + deps, returns a typed PhaseResult.
 * No shared god-object mutable state — orchestrator threads outputs forward.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdapterOutput, ValidatedListing } from "../sources/types";
import type { UpsertResult } from "../sources/upsert";

// ---------------------------------------------------------------------------
// Core phase contracts
// ---------------------------------------------------------------------------

export interface PhaseResult<TOutput = unknown> {
  phase: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  ok: boolean;
  warnings: string[];
  errors: string[];
  metrics: Record<string, number>;
  output?: TOutput;
}

export interface IntegrityReport {
  runId: string;
  fetchStrategy: string;
  sources: string[];
  phases: PhaseResult[];
  totals: {
    rowsFetched: number;
    rowsAfterNormalize: number;
    rowsUpserted: number;
    rowsFailed: number;
    rowsDroppedNonNyc: number;
    rowsDroppedSeUnitMismatch: number;
    nullYearBuilt: number;
    missingIsochrones: number;
  };
  warnings: string[];
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  costReport?: CostReport;
}

// ---------------------------------------------------------------------------
// Shared deps
// ---------------------------------------------------------------------------

export interface OrchestratorDeps {
  supabase: SupabaseClient;
  dryRun: boolean;
  sources: string[];
  since?: string;
  skipPhases: Set<string>;
  onlyPhases: Set<string> | null;
  fetchStrategy: FetchStrategy;
  runId: string;
  startedAt: string;
  budgetUsd: number;
}

// ---------------------------------------------------------------------------
// Per-phase input/output shapes
// ---------------------------------------------------------------------------

export interface PerSourceFetchResult {
  source: string;
  ok: boolean;
  rowCount: number;
  error?: string;
}

export interface FetchPhaseOutput {
  rowsBySource: Map<string, AdapterOutput[]>;
  perSourceResults: PerSourceFetchResult[];
}

export interface NormalizePhaseOutput {
  validated: ValidatedListing[];
  droppedCounts: {
    nonNyc: number;
    seUnitMismatch: number;
    other: number;
  };
}

export interface UpsertPhaseOutput {
  upsertResult: UpsertResult;
  upsertedUrls: string[];
}

export interface EnrichYearBuiltOutput {
  queried: number;
  updated: number;
  noMatch: number;
  errors: number;
}

export interface EnrichIsochronesOutput {
  queried: number;
  enriched: number;
  errors: number;
}

export interface CleanupStaleOutput {
  staleDeleted: number;
}

export interface VerifyStaleOutput {
  candidates: number;
  activeConfirmed: number;
  delistedConfirmed: number;
  unknown: number;
  errors: number;
}

// ---------------------------------------------------------------------------
// Cost tracking
// ---------------------------------------------------------------------------

export interface CostBreakdown {
  source: string;
  apifyActorRuns: number;
  apifyUsd: number;
}

export interface CostReport {
  breakdown: CostBreakdown[];
  totalUsd: number;
  budgetUsd: number;
  overBudget: boolean;
  monthToDateUsd: number | null;
}

export interface VerifyCostsOutput {
  costReport: CostReport;
}

// ---------------------------------------------------------------------------
// FetchStrategy
// ---------------------------------------------------------------------------

export interface FetchDeps {
  supabase: SupabaseClient;
  since?: string;
  dryRun?: boolean;
}

export interface FetchStrategy {
  name: string;
  fetchSource(source: string, deps: FetchDeps): Promise<AdapterOutput[]>;
}
