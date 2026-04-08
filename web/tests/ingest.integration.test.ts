/**
 * Phase D: integration test for the ingest orchestrator.
 *
 * Two tests:
 *   1. Fast sanity test (always runs): empty sources, only-phase=normalize.
 *      Exercises the orchestrator wiring without hitting any external API.
 *   2. Full StreetEasy soak test (gated by RUN_INTEGRATION_TESTS=1): real
 *      Supabase client, real StreetEasy fetch, dry-run — asserts no writes.
 *
 * Run:
 *   npx vitest run tests/ingest.integration.test.ts
 *   RUN_INTEGRATION_TESTS=1 npx vitest run tests/ingest.integration.test.ts
 */

import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

import { runOrchestrator } from "../lib/ingest/orchestrator";
import { StalenessGatedFetch } from "../lib/ingest/strategies";
import type { FetchStrategy } from "../lib/ingest/types";

// ---------------------------------------------------------------------------
// Load .env.local (same pattern as scripts/ingest.ts)
// ---------------------------------------------------------------------------

function loadDotEnvLocal() {
  const envPath = resolve(__dirname, "..", ".env.local");
  try {
    const envContent = readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx);
      const val = trimmed.slice(eqIdx + 1);
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // optional
  }
}
loadDotEnvLocal();

const EXPECTED_PHASES = [
  "fetch",
  "normalize",
  "upsert",
  "enrich-year-built",
  "enrich-isochrones",
  "cleanup-stale",
  "report",
];

// A no-op fetch strategy used by the fast test so we never hit the network.
class NoopFetch implements FetchStrategy {
  name = "noop";
  async fetchSource() {
    return [];
  }
}

function buildSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key);
}

// ---------------------------------------------------------------------------
// Fast sanity test — always runs
// ---------------------------------------------------------------------------

describe("ingest orchestrator (fast sanity)", () => {
  it("runs only the normalize phase cleanly with empty sources", async () => {
    // This test must not hit Supabase or any external API. We give it a
    // minimal fake supabase client because the orchestrator queries a few
    // counts after phases run; head/select calls return a resolved "no rows".
    // Thenable chain: from().select() and from().select().is() both resolve
    // to { count: 0 }. Chainable so any intermediate .is()/.eq() works too.
    const makeChain = (): any => {
      const chain: any = {
        select: () => chain,
        is: () => chain,
        eq: () => chain,
        then: (r: (v: { count: number; data: unknown[] }) => void) =>
          r({ count: 0, data: [] }),
      };
      return chain;
    };
    const fakeSupabase = {
      from: () => makeChain(),
    } as unknown as SupabaseClient;

    const report = await runOrchestrator({
      supabase: fakeSupabase,
      fetchStrategy: new NoopFetch(),
      sources: [],
      dryRun: true,
      skipPhases: new Set<string>(),
      onlyPhases: new Set<string>(["normalize"]),
    });

    expect(report.exitCode).toBe(0);
    // Only normalize ran
    const phaseNames = report.phases.map((p) => p.phase);
    expect(phaseNames).toContain("normalize");
    expect(phaseNames).not.toContain("fetch");
    expect(phaseNames).not.toContain("upsert");
    // Normalize on empty input should succeed
    const normalize = report.phases.find((p) => p.phase === "normalize");
    expect(normalize?.ok).toBe(true);
    expect(report.totals.rowsFetched).toBe(0);
    expect(report.totals.rowsAfterNormalize).toBe(0);
    expect(report.totals.rowsUpserted).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Full StreetEasy soak — gated by RUN_INTEGRATION_TESTS
// ---------------------------------------------------------------------------

const runFull = process.env.RUN_INTEGRATION_TESTS
  ? describe
  : describe.skip;

runFull("ingest orchestrator (full StreetEasy dry-run)", () => {
  it(
    "runs all 7 phases and writes nothing to the database",
    async () => {
      const supabase = buildSupabase();

      // Baseline counts
      const { count: listingsBefore } = await supabase
        .from("listings")
        .select("*", { count: "exact", head: true });
      const { count: runsBefore } = await supabase
        .from("ingest_runs")
        .select("*", { count: "exact", head: true });

      const report = await runOrchestrator({
        supabase,
        fetchStrategy: new StalenessGatedFetch(),
        sources: ["streeteasy"],
        dryRun: true,
        skipPhases: new Set<string>(),
        onlyPhases: null,
      });

      expect(report.exitCode).toBe(0);

      // All 7 phases present
      const phaseNames = report.phases.map((p) => p.phase);
      for (const expected of EXPECTED_PHASES) {
        expect(phaseNames).toContain(expected);
      }

      // Every phase ok
      for (const phase of report.phases) {
        expect(phase.ok, `phase ${phase.phase} failed: ${phase.errors.join(";")}`).toBe(
          true,
        );
      }

      // Totals shape
      expect(report.totals).toEqual(
        expect.objectContaining({
          rowsFetched: expect.any(Number),
          rowsAfterNormalize: expect.any(Number),
          rowsUpserted: expect.any(Number),
          rowsFailed: expect.any(Number),
          rowsDroppedNonNyc: expect.any(Number),
          rowsDroppedSeUnitMismatch: expect.any(Number),
          nullYearBuilt: expect.any(Number),
          missingIsochrones: expect.any(Number),
        }),
      );

      // Dry-run must write zero rows
      expect(report.totals.rowsUpserted).toBe(0);

      // DB state unchanged
      const { count: listingsAfter } = await supabase
        .from("listings")
        .select("*", { count: "exact", head: true });
      const { count: runsAfter } = await supabase
        .from("ingest_runs")
        .select("*", { count: "exact", head: true });

      expect(listingsAfter).toBe(listingsBefore);
      expect(runsAfter).toBe(runsBefore);
    },
    300_000,
  );
});
