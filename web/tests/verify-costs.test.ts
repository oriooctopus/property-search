/**
 * Tests for the verify-costs phase.
 *
 * Mocks globalThis.fetch to return fake Apify API responses.
 * Run with: npx vitest run tests/verify-costs.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrchestratorDeps, IntegrityReport } from "../lib/ingest/types";
import { runVerifyCostsPhase } from "../lib/ingest/phases/verify-costs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReport(overrides?: Partial<IntegrityReport>): IntegrityReport {
  return {
    runId: "test-run-1",
    fetchStrategy: "staleness-gated",
    sources: ["craigslist", "facebook-marketplace"],
    phases: [],
    totals: {
      rowsFetched: 10,
      rowsAfterNormalize: 8,
      rowsUpserted: 8,
      rowsFailed: 0,
      rowsDroppedNonNyc: 2,
      rowsDroppedSeUnitMismatch: 0,
      nullYearBuilt: 0,
      missingIsochrones: 0,
    },
    warnings: [],
    startedAt: "2026-04-08T10:00:00.000Z",
    finishedAt: "2026-04-08T10:05:00.000Z",
    exitCode: 0,
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<OrchestratorDeps>): OrchestratorDeps {
  const mockSupabase = {
    from: () => ({
      update: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
    }),
  } as unknown as SupabaseClient;

  return {
    supabase: mockSupabase,
    dryRun: false,
    sources: ["craigslist", "facebook-marketplace"],
    skipPhases: new Set(),
    onlyPhases: null,
    fetchStrategy: { name: "staleness-gated", fetchSource: vi.fn() },
    runId: "test-run-1",
    startedAt: "2026-04-08T10:00:00.000Z",
    budgetUsd: 1.0,
    ...overrides,
  };
}

// Apify actor-runs response factory
function makeApifyRunsResponse(
  items: Array<{
    id: string;
    actId: string;
    startedAt: string;
    usageTotalUsd: number;
    status?: string;
  }>,
) {
  return {
    data: {
      total: items.length,
      count: items.length,
      offset: 0,
      limit: 100,
      desc: true,
      items: items.map((i) => ({
        ...i,
        finishedAt: null,
        status: i.status ?? "SUCCEEDED",
      })),
    },
  };
}

function makeMonthlyResponse(totalUsd: number) {
  return {
    data: {
      totalUsageCreditsUsdAfterVolumeDiscount: totalUsd,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let originalFetch: typeof globalThis.fetch;
let originalApifyToken: string | undefined;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalApifyToken = process.env.APIFY_TOKEN;
  process.env.APIFY_TOKEN = "test-token";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApifyToken !== undefined) {
    process.env.APIFY_TOKEN = originalApifyToken;
  } else {
    delete process.env.APIFY_TOKEN;
  }
});

describe("verify-costs phase", () => {
  it("sums costs for runs found within the ingest window", async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/actor-runs")) {
        return Response.json(
          makeApifyRunsResponse([
            {
              id: "run1",
              actId: "owuUx043cdcXvJ6fa", // craigslist
              startedAt: "2026-04-08T10:01:00.000Z",
              usageTotalUsd: 0.08,
            },
            {
              id: "run2",
              actId: "U5DUNxhH3qKt5PnCf", // facebook-marketplace
              startedAt: "2026-04-08T10:02:00.000Z",
              usageTotalUsd: 0.12,
            },
          ]),
        );
      }
      if (url.includes("/usage/monthly")) {
        return Response.json(makeMonthlyResponse(4.5));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const report = makeReport();
    const result = await runVerifyCostsPhase({ report }, makeDeps());

    expect(result.ok).toBe(true);
    expect(result.output?.costReport.totalUsd).toBe(0.2);
    expect(result.output?.costReport.breakdown).toHaveLength(2);
    expect(result.output?.costReport.overBudget).toBe(false);
    expect(result.output?.costReport.monthToDateUsd).toBe(4.5);

    // Check report was mutated
    expect(report.costReport).toBeDefined();
    expect(report.costReport?.totalUsd).toBe(0.2);

    const cl = result.output?.costReport.breakdown.find(
      (b) => b.source === "craigslist",
    );
    expect(cl?.apifyUsd).toBe(0.08);
    expect(cl?.apifyActorRuns).toBe(1);

    const fb = result.output?.costReport.breakdown.find(
      (b) => b.source === "facebook-marketplace",
    );
    expect(fb?.apifyUsd).toBe(0.12);
  });

  it("reports $0 when no runs found in window", async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/actor-runs")) {
        // Return a run that's before the ingest window
        return Response.json(
          makeApifyRunsResponse([
            {
              id: "old-run",
              actId: "owuUx043cdcXvJ6fa",
              startedAt: "2026-04-07T01:00:00.000Z",
              usageTotalUsd: 5.0,
            },
          ]),
        );
      }
      if (url.includes("/usage/monthly")) {
        return Response.json(makeMonthlyResponse(10.0));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const report = makeReport();
    const result = await runVerifyCostsPhase({ report }, makeDeps());

    expect(result.ok).toBe(true);
    expect(result.output?.costReport.totalUsd).toBe(0);
    expect(result.output?.costReport.breakdown).toHaveLength(0);
  });

  it("warns when over budget", async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/actor-runs")) {
        return Response.json(
          makeApifyRunsResponse([
            {
              id: "run1",
              actId: "U5DUNxhH3qKt5PnCf",
              startedAt: "2026-04-08T10:01:00.000Z",
              usageTotalUsd: 1.5,
            },
          ]),
        );
      }
      if (url.includes("/usage/monthly")) {
        return Response.json(makeMonthlyResponse(20.0));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const report = makeReport();
    const deps = makeDeps({ budgetUsd: 1.0 });
    const result = await runVerifyCostsPhase({ report }, deps);

    expect(result.ok).toBe(true);
    expect(result.output?.costReport.overBudget).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/over budget/i);
    // Should also be pushed to the report warnings
    expect(report.warnings).toContainEqual(expect.stringMatching(/over budget/i));
  });

  it("handles Apify API errors gracefully", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response("Service Unavailable", { status: 503 });
    }) as typeof fetch;

    const report = makeReport();
    const result = await runVerifyCostsPhase({ report }, makeDeps());

    // Should not crash — errors captured
    expect(result.ok).toBe(true); // warnings, not errors
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.output?.costReport.totalUsd).toBe(0);
  });

  it("skips API queries under dry-run", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const report = makeReport();
    const deps = makeDeps({ dryRun: true });
    const result = await runVerifyCostsPhase({ report }, deps);

    expect(result.ok).toBe(true);
    expect(result.output?.costReport.totalUsd).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("handles missing APIFY_TOKEN gracefully", async () => {
    delete process.env.APIFY_TOKEN;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const report = makeReport();
    const result = await runVerifyCostsPhase({ report }, makeDeps());

    expect(result.ok).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.stringMatching(/APIFY_TOKEN not set/),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
