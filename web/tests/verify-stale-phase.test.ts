/**
 * Phase-level test for verify-stale.
 *
 * Mocks supabase + the per-source verifiers and asserts the phase groups
 * candidates by source, dispatches to the right verifier, and writes the
 * right UPDATE (last_seen_at for active, delisted_at for delisted).
 *
 * Run with: npx vitest run tests/verify-stale-phase.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
import { verifiers, VERIFY_CONCURRENCY } from "../lib/sources/verify/registry";

interface UpdateCall {
  set: Record<string, unknown>;
  eqColumn: string;
  eqValue: unknown;
}

function makeSupabaseMock(
  candidates: Array<{
    id: number;
    url: string;
    source: string;
    external_id: string | null;
    // Optional: only the craigslist-local oldest-first path reads this via
    // .order(). Existing tests don't care about ordering, so it defaults
    // below rather than requiring every call site to supply one.
    last_seen_at?: string;
  }>,
) {
  const updates: UpdateCall[] = [];

  const fromFn = vi.fn((table: string) => {
    if (table !== "listings") throw new Error(`unexpected table ${table}`);

    // Candidate query filters by source via .eq("source", …); the mock honors
    // that so only the queried source's rows come back (matches real behavior
    // and lets us assert that excluded sources are never loaded/verified).
    let sourceFilter: string | null = null;
    // Set by .order("last_seen_at", { ascending: true }) — only the
    // craigslist-local path calls this (see loadCandidatesForSource in
    // verify-stale.ts). Mirrors the real query: ordering + limit together
    // determine which `limit` rows come back, oldest first.
    let orderAscendingCol: string | null = null;
    const selectBuilder = {
      select: vi.fn(() => selectBuilder),
      eq: vi.fn((col: string, val: unknown) => {
        if (col === "source") sourceFilter = val as string;
        return selectBuilder;
      }),
      is: vi.fn(() => selectBuilder),
      lt: vi.fn(() => selectBuilder),
      order: vi.fn((col: string, opts?: { ascending?: boolean }) => {
        if (opts?.ascending) orderAscendingCol = col;
        return selectBuilder;
      }),
      limit: vi.fn(async (n: number) => {
        let rows = candidates.filter((c) => sourceFilter == null || c.source === sourceFilter);
        if (orderAscendingCol === "last_seen_at") {
          rows = [...rows].sort((a, b) =>
            (a.last_seen_at ?? "").localeCompare(b.last_seen_at ?? ""),
          );
        }
        return { data: rows.slice(0, n), error: null };
      }),
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

// ===========================================================================
// Craigslist-local gentle pass.
//
// Incident (2026-08-28): the first local ingest ran verify-stale for
// craigslist at concurrency 10 (VERIFY_CONCURRENCY.craigslist), 500 direct
// fetches in 5.8s from the home residential IP — a textbook bot signature.
// ~30min later Craigslist started serving its "blocked" page. When
// CRAIGSLIST_FETCHER=local, the craigslist pass MUST instead be: sequential
// (concurrency 1), a randomized 2-5s delay between requests, capped at 60
// candidates (oldest last_seen_at first), and abort-on-first-block leaving
// the rest of the batch untouched. These tests pin all four properties with
// mutation-provable assertions (structural concurrency check, exact delay
// sequence, exact call/apply counts on abort) rather than just call counts,
// since call-count-only assertions would survive e.g. a `delayMs = 0` or
// "cap removed" mutation.
// ===========================================================================
describe("craigslist-local gentle pass", () => {
  const ORIGINAL_FETCHER = process.env.CRAIGSLIST_FETCHER;

  beforeEach(() => {
    // This describe is a sibling of "verify-stale phase" above, not nested
    // inside it, so that describe's own beforeEach(vi.clearAllMocks) does
    // NOT run for these tests — without this, call counts accumulate across
    // tests in this block (caught: H2 saw 64 calls instead of 60, carrying
    // over H1's 4).
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (ORIGINAL_FETCHER === undefined) delete process.env.CRAIGSLIST_FETCHER;
    else process.env.CRAIGSLIST_FETCHER = ORIGINAL_FETCHER;
  });

  function makeCandidates(n: number) {
    // Strictly increasing last_seen_at: id 1 is oldest, id n is newest.
    return Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      url: `https://cl/${i}`,
      source: "craigslist",
      external_id: null,
      last_seen_at: new Date(2026, 0, i + 1).toISOString(),
    }));
  }

  it("H1: verifies sequentially with randomized delays recorded as [2000, 3500, 5000] for 4 candidates", async () => {
    process.env.CRAIGSLIST_FETCHER = "local";
    const craigslistMock = verifiers.craigslist as ReturnType<typeof vi.fn>;
    // Structural sequentiality proof: if the phase ever ran two verifier
    // calls concurrently (e.g. a mutation reintroducing parallelMap or
    // concurrency>1), maxConcurrent would exceed 1 — a call-count-only
    // assertion could not catch that.
    let concurrent = 0;
    let maxConcurrent = 0;
    craigslistMock.mockImplementation(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await Promise.resolve();
      concurrent--;
      return { status: "active" };
    });

    const { client } = makeSupabaseMock(makeCandidates(4));
    const sleepCalls: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      sleepCalls.push(ms);
    });
    // 2000 + random()*3000 => 2000, 3500, 5000 for random() = 0, 0.5, 1.
    const randomSeq = [0, 0.5, 1];
    let ri = 0;
    const random = vi.fn(() => randomSeq[ri++]);

    const res = await runVerifyStalePhase(makeDeps(client), { random, sleep });

    expect(craigslistMock).toHaveBeenCalledTimes(4);
    expect(maxConcurrent).toBe(1);
    // 3 delays for 4 candidates (none before the first request).
    expect(sleepCalls).toEqual([2000, 3500, 5000]);
    expect(res.output?.activeConfirmed).toBe(4);
  });

  it("H2: caps craigslist candidates at 60 of 80 loaded, oldest last_seen_at first", async () => {
    process.env.CRAIGSLIST_FETCHER = "local";
    const craigslistMock = verifiers.craigslist as ReturnType<typeof vi.fn>;
    craigslistMock.mockResolvedValue({ status: "active" });

    const candidates = makeCandidates(80); // ids 1..80, id 1 oldest
    const { client } = makeSupabaseMock(candidates);
    const sleep = vi.fn(async () => {});
    const random = vi.fn(() => 0.5);

    const res = await runVerifyStalePhase(makeDeps(client), { random, sleep });

    expect(craigslistMock).toHaveBeenCalledTimes(60);
    const calledUrls = new Set(craigslistMock.mock.calls.map((c) => c[0]));
    // The oldest 60 (ids 1..60), never the 20 newest (ids 61..80).
    expect(calledUrls).toEqual(new Set(candidates.slice(0, 60).map((c) => c.url)));
    expect(res.output?.candidates).toBe(60);
  });

  it("H3: aborts on the first bot-block signal — exactly 3 calls, 2 applied, rest left untouched, blocked surfaced", async () => {
    process.env.CRAIGSLIST_FETCHER = "local";
    const craigslistMock = verifiers.craigslist as ReturnType<typeof vi.fn>;
    craigslistMock
      .mockResolvedValueOnce({ status: "active" })
      .mockResolvedValueOnce({ status: "active" })
      .mockResolvedValueOnce({ status: "unknown", reason: "unexpected http 403", blocked: true });

    const candidates = makeCandidates(4);
    const { client, updates } = makeSupabaseMock(candidates);
    const sleep = vi.fn(async () => {});
    const random = vi.fn(() => 0.5);

    const res = await runVerifyStalePhase(makeDeps(client), { random, sleep });

    expect(craigslistMock).toHaveBeenCalledTimes(3);
    // Rows 1 and 2 (active) applied to the DB; row 3 (blocked/unknown) never
    // writes (existing unknown-never-writes behavior); row 4 never even
    // reaches the verifier — left completely untouched.
    expect(updates).toHaveLength(2);
    expect(updates.every((u) => Object.keys(u.set).includes("last_seen_at"))).toBe(true);
    expect(res.output?.activeConfirmed).toBe(2);
    expect(res.output?.blocked).toBe(true);
    expect(res.warnings.some((w) => w.includes("BOT BLOCK"))).toBe(true);
  });

  it("H4: non-local mode leaves concurrency and the cap unchanged from today (VERIFY_CONCURRENCY.craigslist=10, no 60-cap)", async () => {
    delete process.env.CRAIGSLIST_FETCHER;
    // Sanity on the registry constant this phase actually reads.
    expect(VERIFY_CONCURRENCY.craigslist).toBe(10);

    const craigslistMock = verifiers.craigslist as ReturnType<typeof vi.fn>;
    let concurrent = 0;
    let maxConcurrent = 0;
    craigslistMock.mockImplementation(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 5));
      concurrent--;
      return { status: "active" };
    });

    // 80 candidates: past a would-be 60-cap (proves the local-only cap
    // doesn't leak into this path) but well under PER_SOURCE_LIMIT=500.
    const { client } = makeSupabaseMock(makeCandidates(80));

    const res = await runVerifyStalePhase(makeDeps(client));

    expect(craigslistMock).toHaveBeenCalledTimes(80);
    expect(res.output?.candidates).toBe(80);
    // Real parallelism reached — not forced down to the local mode's
    // concurrency=1.
    expect(maxConcurrent).toBeGreaterThan(1);
    expect(res.output?.blocked).toBeUndefined();
  });
});
