/**
 * Phase-level test for verify-stale.
 *
 * Mocks supabase + the per-source verifiers and asserts the phase groups
 * candidates by source, dispatches to the right verifier, and writes the
 * right UPDATE (last_seen_at for active, delisted_at for delisted).
 *
 * Run with: npx vitest run tests/verify-stale-phase.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrchestratorDeps } from "../lib/ingest/types";
import type { VerifyResult } from "../lib/sources/verify/types";

vi.mock("../lib/sources/verify/registry", () => {
  const streeteasy = vi.fn(async (): Promise<VerifyResult> => ({ status: "active" }));
  const craigslist = vi.fn(async (): Promise<VerifyResult> => ({
    status: "delisted",
    delistedAt: new Date("2026-04-01T00:00:00Z"),
    reason: "HTTP 410 flagged",
  }));
  const facebook = vi.fn(async (): Promise<VerifyResult> => ({
    status: "unknown",
    reason: "not implemented",
  }));
  return {
    verifiers: {
      streeteasy,
      craigslist,
      "facebook-marketplace": facebook,
    },
    VERIFY_CONCURRENCY: {
      streeteasy: 5,
      craigslist: 10,
      "facebook-marketplace": 1,
    },
  };
});

import { runVerifyStalePhase } from "../lib/ingest/phases/verify-stale";
import { verifiers } from "../lib/sources/verify/registry";

interface UpdateCall {
  set: Record<string, unknown>;
  eqColumn: string;
  eqValue: unknown;
}

function makeSupabaseMock(candidates: Array<{ id: number; url: string; source: string; external_id: string | null }>) {
  const updates: UpdateCall[] = [];

  const fromFn = vi.fn((table: string) => {
    if (table !== "listings") throw new Error(`unexpected table ${table}`);

    // Candidate query filters by source via .eq("source", …); the mock honors
    // that so only the queried source's rows come back (matches real behavior
    // and lets us assert that excluded sources are never loaded/verified).
    let sourceFilter: string | null = null;
    const selectBuilder = {
      select: vi.fn(() => selectBuilder),
      eq: vi.fn((col: string, val: unknown) => {
        if (col === "source") sourceFilter = val as string;
        return selectBuilder;
      }),
      is: vi.fn(() => selectBuilder),
      lt: vi.fn(() => selectBuilder),
      limit: vi.fn(async () => ({
        data: candidates.filter((c) => sourceFilter == null || c.source === sourceFilter),
        error: null,
      })),
    };

    // Active path awaits `.update(set).eq("id", …)`; delisted path awaits
    // `.update(set).eq("id", …).lt("last_seen_at", …)`. So eq() must be BOTH
    // awaitable and expose a chainable .lt().
    const updateBuilder = (set: Record<string, unknown>) => ({
      eq: vi.fn((col: string, val: unknown) => {
        const record = () => {
          updates.push({ set, eqColumn: col, eqValue: val });
          return { error: null };
        };
        return {
          lt: vi.fn(async () => record()),
          then: (resolve: (v: { error: null }) => void) => resolve(record()),
        };
      }),
    });

    return {
      ...selectBuilder,
      update: (set: Record<string, unknown>) => updateBuilder(set),
    };
  });

  const client = { from: fromFn } as unknown as SupabaseClient;
  return { client, updates };
}

function makeDeps(supabase: SupabaseClient, dryRun = false): OrchestratorDeps {
  return {
    supabase,
    dryRun,
    sources: ["streeteasy", "craigslist", "facebook-marketplace"],
    skipPhases: new Set(),
    onlyPhases: null,
    fetchStrategy: { name: "test", fetchSource: async () => [] },
    runId: "test",
    startedAt: new Date().toISOString(),
    budgetUsd: 1.0,
  };
}

describe("verify-stale phase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches by source and writes last_seen_at for active", async () => {
    // craigslist is the only verify-stale source now (StreetEasy uses the free
    // set-difference delist-unseen step). Override its result to active here.
    (verifiers.craigslist as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ status: "active" });
    const { client, updates } = makeSupabaseMock([
      { id: 1, url: "https://cl/a", source: "craigslist", external_id: "cl1" },
    ]);
    const res = await runVerifyStalePhase(makeDeps(client));
    expect(res.output?.activeConfirmed).toBe(1);
    expect(res.output?.delistedConfirmed).toBe(0);
    expect(verifiers.craigslist).toHaveBeenCalledOnce();
    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0].set)).toEqual(["last_seen_at"]);
    expect(updates[0].eqValue).toBe(1);
  });

  it("writes delisted_at for delisted results", async () => {
    const { client, updates } = makeSupabaseMock([
      { id: 42, url: "https://cl/x", source: "craigslist", external_id: "cl1" },
    ]);
    const res = await runVerifyStalePhase(makeDeps(client));
    expect(res.output?.delistedConfirmed).toBe(1);
    expect(Object.keys(updates[0].set)).toEqual(["delisted_at"]);
    expect(updates[0].eqValue).toBe(42);
  });

  it("is a no-op for unknown results", async () => {
    (verifiers.craigslist as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: "unknown",
      reason: "not implemented",
    });
    const { client, updates } = makeSupabaseMock([
      { id: 7, url: "https://cl/y", source: "craigslist", external_id: null },
    ]);
    const res = await runVerifyStalePhase(makeDeps(client));
    expect(res.output?.unknown).toBe(1);
    expect(updates).toHaveLength(0);
  });

  it("does NOT verify StreetEasy (handled by set-difference delist-unseen)", async () => {
    const { client, updates } = makeSupabaseMock([
      { id: 99, url: "https://streeteasy.com/a", source: "streeteasy", external_id: "se1" },
    ]);
    const res = await runVerifyStalePhase(makeDeps(client));
    expect(verifiers.streeteasy).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    expect(res.output?.activeConfirmed).toBe(0);
    expect(res.output?.delistedConfirmed).toBe(0);
  });
});
