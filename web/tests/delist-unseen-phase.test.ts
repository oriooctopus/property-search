/**
 * Phase-level test for delist-unseen (promoted from the old standalone
 * scripts/delist-unseen.ts — see lib/ingest/phases/delist-unseen.ts's file
 * header for why the promotion happened and how the safety gate/cap work).
 *
 * REGRESSION TARGET: the old script hard-coded `.in("beds",[2,3,4])`, a
 * stale band from before the search moved to 1-2BR (pipeline.ts's
 * BEDS_MIN=1) — under that band, 1BR StreetEasy rows could never be
 * delisted by this path. The "predicate uses BEDS_MIN/MAX, not a literal
 * list" test below is the one that catches a regression back to that; it
 * was proven live by temporarily restoring `.in("beds",[2,3,4])` in the
 * phase and confirming that exact test fails (see the mutation-check note
 * at the bottom of this file).
 *
 * Run with: npx vitest run tests/delist-unseen-phase.test.ts
 */

import { describe, it, expect, vi } from "vitest";
import type { DelistUnseenOutput, OrchestratorDeps, PerSourceFetchResult } from "../lib/ingest/types";
import {
  BEDS_MAX,
  BEDS_MIN,
  PRICE_MAX,
  PRICE_MIN,
  REGION_LAT_MAX,
  REGION_LAT_MIN,
  REGION_LON_MAX,
  REGION_LON_MIN,
} from "../lib/sources/pipeline";
import { runDelistUnseenPhase, DEFAULT_MAX_DELIST_FRAC } from "../lib/ingest/phases/delist-unseen";
import { parseArgs } from "../lib/ingest/cli-args";
import { runOrchestrator } from "../lib/ingest/orchestrator";
import type { FetchStrategy } from "../lib/ingest/types";

// ---------------------------------------------------------------------------
// Fake Supabase query builder / client
// ---------------------------------------------------------------------------

interface ListingSeed {
  id: number;
  source: string;
  beds: number;
  price: number;
  lat: number;
  lon: number;
  delisted_at: string | null;
  last_seen_at: string;
}

interface FilterCall {
  method: "eq" | "is" | "gte" | "lte" | "lt" | "in";
  col: string;
  val: unknown;
}

/**
 * Minimal stand-in for supabase-js's PostgrestFilterBuilder covering only the
 * methods this phase calls (eq/is/gte/lte/lt for the predicate + cutoff,
 * select/update for the two query shapes). Every filter call is recorded via
 * `onFilter` so tests can assert on the EXACT predicate sent, not just on the
 * row counts it produces — that's what makes the "predicate uses BEDS_MIN/MAX"
 * test below a real regression test rather than an output-only check that a
 * differently-wrong predicate could still pass by accident.
 */
class FakeQuery implements PromiseLike<{ count: number; error: null; data: unknown[] }> {
  private filters: ((r: ListingSeed) => boolean)[] = [];
  private isUpdate = false;
  private updatePayload: Record<string, unknown> | null = null;

  constructor(
    private rows: ListingSeed[],
    private onFilter: (c: FilterCall) => void,
    private onUpdate: (matched: ListingSeed[], payload: Record<string, unknown>) => void,
  ) {}

  select(_sel: string, _opts?: unknown): this {
    return this;
  }
  update(payload: Record<string, unknown>, _opts?: unknown): this {
    this.isUpdate = true;
    this.updatePayload = payload;
    return this;
  }
  eq(col: string, val: unknown): this {
    this.onFilter({ method: "eq", col, val });
    this.filters.push((r) => (r as unknown as Record<string, unknown>)[col] === val);
    return this;
  }
  is(col: string, val: unknown): this {
    this.onFilter({ method: "is", col, val });
    this.filters.push((r) => (r as unknown as Record<string, unknown>)[col] === val);
    return this;
  }
  gte(col: string, val: unknown): this {
    this.onFilter({ method: "gte", col, val });
    this.filters.push(
      (r) => (r as unknown as Record<string, unknown>)[col] as number >= (val as number),
    );
    return this;
  }
  lte(col: string, val: unknown): this {
    this.onFilter({ method: "lte", col, val });
    this.filters.push(
      (r) => (r as unknown as Record<string, unknown>)[col] as number <= (val as number),
    );
    return this;
  }
  lt(col: string, val: unknown): this {
    this.onFilter({ method: "lt", col, val });
    this.filters.push(
      (r) => (r as unknown as Record<string, unknown>)[col] as string < (val as string),
    );
    return this;
  }
  in(col: string, vals: unknown[]): this {
    this.onFilter({ method: "in", col, val: vals });
    const set = new Set(vals);
    this.filters.push((r) => set.has((r as unknown as Record<string, unknown>)[col]));
    return this;
  }

  then<TResult1 = { count: number; error: null; data: unknown[] }, TResult2 = never>(
    onfulfilled?:
      | ((value: { count: number; error: null; data: unknown[] }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const matched = this.rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.isUpdate && this.updatePayload) {
      this.onUpdate(matched, this.updatePayload);
      for (const r of matched) Object.assign(r, this.updatePayload);
    }
    return Promise.resolve({ count: matched.length, error: null, data: [] }).then(
      onfulfilled,
      onrejected,
    );
  }
}

function makeSupabase(listings: ListingSeed[]) {
  const fromCalls: string[] = [];
  const filterCallsByQuery: FilterCall[][] = [];
  const updateCalls: { matched: ListingSeed[]; payload: Record<string, unknown> }[] = [];

  const client = {
    from(table: string) {
      fromCalls.push(table);
      // The orchestrator's post-phase "Totals" section (unrelated to this
      // phase) also queries listing_isochrones — support it trivially so
      // the orchestrator-ordering test below doesn't need a second mock.
      if (table === "listing_isochrones") {
        return new FakeQuery([] as unknown as ListingSeed[], () => {}, () => {});
      }
      if (table !== "listings") throw new Error(`unexpected table ${table}`);
      const calls: FilterCall[] = [];
      filterCallsByQuery.push(calls);
      return new FakeQuery(
        listings,
        (c) => calls.push(c),
        (matched, payload) => updateCalls.push({ matched: [...matched], payload }),
      );
    },
  };

  return { client, fromCalls, filterCallsByQuery, updateCalls };
}

function makeDeps(
  supabase: ReturnType<typeof makeSupabase>["client"],
  dryRun = false,
): OrchestratorDeps {
  return {
    supabase: supabase as unknown as OrchestratorDeps["supabase"],
    dryRun,
    sources: ["streeteasy"],
    skipPhases: new Set(),
    onlyPhases: null,
    fetchStrategy: { name: "test", fetchSource: async () => [] },
    runId: "test",
    startedAt: new Date().toISOString(),
    budgetUsd: 1.0,
  };
}

const REGION_LAT_MID = (REGION_LAT_MIN + REGION_LAT_MAX) / 2;
const REGION_LON_MID = (REGION_LON_MIN + REGION_LON_MAX) / 2;

/** A listing that matches the delist-unseen predicate exactly. */
function matchingListing(id: number, overrides: Partial<ListingSeed> = {}): ListingSeed {
  return {
    id,
    source: "streeteasy",
    beds: BEDS_MIN,
    price: PRICE_MIN,
    lat: REGION_LAT_MID,
    lon: REGION_LON_MID,
    delisted_at: null,
    last_seen_at: new Date().toISOString(), // "fresh" by default
    ...overrides,
  };
}

const FRESH = new Date().toISOString();
const STALE_26H = new Date(Date.now() - 30 * 3600_000).toISOString(); // older than the 26h default cutoff

const OK_STREETEASY: PerSourceFetchResult[] = [
  { source: "streeteasy", ok: true, rowCount: 500 },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("delist-unseen phase", () => {
  it("delists exactly the stale rows: 3 stale of 30 -> one update call, delisted=3, ok", async () => {
    const listings = Array.from({ length: 30 }, (_, i) =>
      matchingListing(i + 1, { last_seen_at: i < 3 ? STALE_26H : FRESH }),
    );
    const { client, updateCalls } = makeSupabase(listings);

    const res = await runDelistUnseenPhase(makeDeps(client), OK_STREETEASY, {
      maxAgeHours: 26,
      maxDelistFrac: 0.35,
    });

    expect(res.ok).toBe(true);
    expect(res.output).toEqual({
      scanned: 30,
      stale: 3,
      delisted: 3,
      skippedReason: null,
      capOverridden: false,
    });
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].matched.map((r) => r.id).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(typeof updateCalls[0].payload.delisted_at).toBe("string");
  });

  it("nothing stale -> ok, no update call, stale=0, not skipped", async () => {
    const listings = Array.from({ length: 30 }, (_, i) => matchingListing(i + 1, { last_seen_at: FRESH }));
    const { client, updateCalls } = makeSupabase(listings);

    const res = await runDelistUnseenPhase(makeDeps(client), OK_STREETEASY, {
      maxAgeHours: 26,
      maxDelistFrac: 0.35,
    });

    expect(res.ok).toBe(true);
    expect(res.output?.scanned).toBe(30);
    expect(res.output?.stale).toBe(0);
    expect(res.output?.delisted).toBe(0);
    expect(res.output?.skippedReason).toBeNull();
    expect(updateCalls.length).toBe(0);
  });

  it("no rows match the predicate at all -> ok, scanned=0, not skipped", async () => {
    const { client, updateCalls } = makeSupabase([]);
    const res = await runDelistUnseenPhase(makeDeps(client), OK_STREETEASY, {
      maxAgeHours: 26,
      maxDelistFrac: 0.35,
    });
    expect(res.ok).toBe(true);
    expect(res.output).toEqual({
      scanned: 0,
      stale: 0,
      delisted: 0,
      skippedReason: null,
      capOverridden: false,
    });
    expect(updateCalls.length).toBe(0);
  });

  describe("gate", () => {
    const listings = [matchingListing(1)];

    it("streeteasy absent from fetchResults -> skipped, zero client calls", async () => {
      const { client, fromCalls } = makeSupabase(listings);
      const fetchResults: PerSourceFetchResult[] = [{ source: "craigslist", ok: true, rowCount: 50 }];

      const res = await runDelistUnseenPhase(makeDeps(client), fetchResults, {
        maxAgeHours: 26,
        maxDelistFrac: 0.35,
      });

      expect(res.ok).toBe(true);
      expect(res.output?.skippedReason).toBe("streeteasy not in sources");
      expect(fromCalls.length).toBe(0);
    });

    it("streeteasy ok:false -> skipped with the error in skippedReason", async () => {
      const { client, fromCalls } = makeSupabase(listings);
      const fetchResults: PerSourceFetchResult[] = [
        { source: "streeteasy", ok: false, rowCount: 0, error: "403 PerimeterX block" },
      ];

      const res = await runDelistUnseenPhase(makeDeps(client), fetchResults, {
        maxAgeHours: 26,
        maxDelistFrac: 0.35,
      });

      expect(res.ok).toBe(true);
      expect(res.output?.skippedReason).toBe("streeteasy fetch failed: 403 PerimeterX block");
      expect(fromCalls.length).toBe(0);
    });

    it("streeteasy ok but rowCount:0 -> skipped", async () => {
      const { client, fromCalls } = makeSupabase(listings);
      const fetchResults: PerSourceFetchResult[] = [{ source: "streeteasy", ok: true, rowCount: 0 }];

      const res = await runDelistUnseenPhase(makeDeps(client), fetchResults, {
        maxAgeHours: 26,
        maxDelistFrac: 0.35,
      });

      expect(res.ok).toBe(true);
      expect(res.output?.skippedReason).toBe("streeteasy fetch returned 0 rows");
      expect(fromCalls.length).toBe(0);
    });

    it("fetchResults === null (explicit --only-phase=delist-unseen invocation) -> runs", async () => {
      const { client, fromCalls } = makeSupabase(listings);

      const res = await runDelistUnseenPhase(makeDeps(client), null, {
        maxAgeHours: 26,
        maxDelistFrac: 0.35,
      });

      expect(res.output?.skippedReason).toBeNull();
      expect(fromCalls.length).toBeGreaterThan(0);
    });
  });

  it("dry run: computes counts, issues no update call", async () => {
    const listings = Array.from({ length: 30 }, (_, i) =>
      matchingListing(i + 1, { last_seen_at: i < 3 ? STALE_26H : FRESH }),
    );
    const { client, updateCalls } = makeSupabase(listings);

    const res = await runDelistUnseenPhase(makeDeps(client, /* dryRun */ true), OK_STREETEASY, {
      maxAgeHours: 26,
      maxDelistFrac: 0.35,
    });

    expect(res.ok).toBe(true);
    expect(res.output?.scanned).toBe(30);
    expect(res.output?.stale).toBe(3);
    expect(res.output?.delisted).toBe(0);
    expect(updateCalls.length).toBe(0);
  });

  describe("cap boundary (strict >)", () => {
    it("stale/total exactly at the cap (35/100 = 0.35) still runs", async () => {
      const listings = Array.from({ length: 100 }, (_, i) =>
        matchingListing(i + 1, { last_seen_at: i < 35 ? STALE_26H : FRESH }),
      );
      const { client, updateCalls } = makeSupabase(listings);

      const res = await runDelistUnseenPhase(makeDeps(client), OK_STREETEASY, {
        maxAgeHours: 26,
        maxDelistFrac: 0.35,
      });

      expect(res.ok).toBe(true);
      expect(res.output?.delisted).toBe(35);
      expect(updateCalls.length).toBe(1);
    });

    it("stale/total one row over the cap (36/100 = 0.36) is refused, zero writes", async () => {
      const listings = Array.from({ length: 100 }, (_, i) =>
        matchingListing(i + 1, { last_seen_at: i < 36 ? STALE_26H : FRESH }),
      );
      const { client, updateCalls } = makeSupabase(listings);

      const res = await runDelistUnseenPhase(makeDeps(client), OK_STREETEASY, {
        maxAgeHours: 26,
        maxDelistFrac: 0.35,
      });

      expect(res.ok).toBe(false);
      expect(res.output?.delisted).toBe(0);
      expect(res.output?.stale).toBe(36);
      expect(res.output?.scanned).toBe(100);
      expect(updateCalls.length).toBe(0);
      expect(res.warnings.some((w) => w.includes("refused") && w.includes("36/100"))).toBe(true);
    });
  });

  it("predicate uses BEDS_MIN/MAX and PRICE_MIN/MAX (.gte/.lte), never a hard-coded .in(\"beds\", ...) list", async () => {
    const listings = Array.from({ length: 10 }, (_, i) => matchingListing(i + 1));
    const { client, filterCallsByQuery } = makeSupabase(listings);

    await runDelistUnseenPhase(makeDeps(client), OK_STREETEASY, {
      maxAgeHours: 26,
      maxDelistFrac: 0.35,
    });

    const allCalls = filterCallsByQuery.flat();
    const has = (method: FilterCall["method"], col: string, val: unknown) =>
      allCalls.some((c) => c.method === method && c.col === col && c.val === val);

    expect(has("eq", "source", "streeteasy")).toBe(true);
    expect(has("is", "delisted_at", null)).toBe(true);
    expect(has("gte", "beds", BEDS_MIN)).toBe(true);
    expect(has("lte", "beds", BEDS_MAX)).toBe(true);
    expect(BEDS_MIN).toBe(1);
    expect(BEDS_MAX).toBe(2);
    expect(has("gte", "price", PRICE_MIN)).toBe(true);
    expect(has("lte", "price", PRICE_MAX)).toBe(true);
    expect(PRICE_MIN).toBe(3000);
    expect(PRICE_MAX).toBe(5000);
    expect(has("gte", "lat", REGION_LAT_MIN)).toBe(true);
    expect(has("lte", "lat", REGION_LAT_MAX)).toBe(true);
    expect(has("gte", "lon", REGION_LON_MIN)).toBe(true);
    expect(has("lte", "lon", REGION_LON_MAX)).toBe(true);

    // The regression this test exists to catch: the old script's
    // `.in("beds",[2,3,4])` predicate. Proven by temporarily restoring it in
    // lib/ingest/phases/delist-unseen.ts and confirming this exact assertion
    // fails — see the file header note.
    expect(allCalls.some((c) => c.method === "in" && c.col === "beds")).toBe(false);
  });

  it("age cutoff: the last_seen_at cutoff is within a few seconds of now - maxAgeHours, and moves with maxAgeHours", async () => {
    const listings = Array.from({ length: 5 }, (_, i) => matchingListing(i + 1));

    const { client: client26, filterCallsByQuery: calls26 } = makeSupabase(listings);
    const before26 = Date.now();
    await runDelistUnseenPhase(makeDeps(client26), OK_STREETEASY, {
      maxAgeHours: 26,
      maxDelistFrac: 0.35,
    });
    const cutoff26 = calls26.flat().find((c) => c.method === "lt" && c.col === "last_seen_at")
      ?.val as string;
    expect(cutoff26).toBeDefined();
    const expected26 = before26 - 26 * 3600_000;
    expect(Math.abs(new Date(cutoff26).getTime() - expected26)).toBeLessThan(5000);

    const { client: client1, filterCallsByQuery: calls1 } = makeSupabase(listings);
    const before1 = Date.now();
    await runDelistUnseenPhase(makeDeps(client1), OK_STREETEASY, {
      maxAgeHours: 1,
      maxDelistFrac: 0.35,
    });
    const cutoff1 = calls1.flat().find((c) => c.method === "lt" && c.col === "last_seen_at")
      ?.val as string;
    expect(cutoff1).toBeDefined();
    const expected1 = before1 - 1 * 3600_000;
    expect(Math.abs(new Date(cutoff1).getTime() - expected1)).toBeLessThan(5000);

    // The two cutoffs must differ by roughly 25 hours, proving maxAgeHours
    // actually drives the value rather than a hard-coded constant. cutoff1
    // (now-1h) is later than cutoff26 (now-26h), so the difference is
    // computed in that order.
    const diffHours = (new Date(cutoff1).getTime() - new Date(cutoff26).getTime()) / 3600_000;
    expect(diffHours).toBeGreaterThan(24.9);
    expect(diffHours).toBeLessThan(25.1);
  });

  it("capOverridden reflects whether a non-default --max-delist-frac was passed", async () => {
    const { client: c1 } = makeSupabase([matchingListing(1)]);
    const resDefault = await runDelistUnseenPhase(makeDeps(c1), OK_STREETEASY, {
      maxAgeHours: 26,
      maxDelistFrac: DEFAULT_MAX_DELIST_FRAC,
    });
    expect(resDefault.output?.capOverridden).toBe(false);

    const { client: c2 } = makeSupabase([matchingListing(1)]);
    const resOverridden = await runDelistUnseenPhase(makeDeps(c2), OK_STREETEASY, {
      maxAgeHours: 26,
      maxDelistFrac: 0.5,
    });
    expect(resOverridden.output?.capOverridden).toBe(true);
  });

  // Every prior test in this file checks COUNTS (scanned/stale/delisted) or
  // the raw filter calls sent for the COUNT queries. Neither proves the
  // update actually applied the same predicate to the same rows — the
  // FakeQuery's `then()` re-evaluates `this.filters` (built from whichever
  // chain the phase called) against the full seeded row set for every query,
  // count or update alike, so a predicate that's subtly wrong on the UPDATE
  // call specifically (e.g. missing a clause, or a boundary off-by-one) can
  // still produce a correct-looking `delisted` count while touching the
  // wrong rows. This test seeds one row that fails each individual predicate
  // clause plus one exactly-at-the-cutoff boundary row, and asserts on the
  // update's actual matched id set rather than a count.
  it("contamination: the update touches exactly the 3 legit stale in-band streeteasy rows, nothing else", async () => {
    // Frozen clock so the cutoff computed inside the phase
    // (`Date.now() - maxAgeHours*3600_000`) is byte-for-byte reproducible
    // here, letting the boundary row be seeded at EXACTLY that cutoff rather
    // than "close enough" — real wall-clock drift between seeding and the
    // phase's own `Date.now()` call would make an exact-boundary assertion
    // flaky.
    const FIXED_NOW = new Date("2026-01-15T12:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    try {
      const maxAgeHours = 26;
      const cutoffExact = new Date(FIXED_NOW - maxAgeHours * 3600_000).toISOString();
      const staleTs = new Date(FIXED_NOW - 30 * 3600_000).toISOString(); // older than cutoff
      const freshTs = new Date(FIXED_NOW).toISOString();

      const listings: ListingSeed[] = [
        // The only 3 rows the update should touch.
        matchingListing(1, { last_seen_at: staleTs }),
        matchingListing(2, { last_seen_at: staleTs }),
        matchingListing(3, { last_seen_at: staleTs }),
        // In-band and otherwise identical, but last_seen_at == cutoff exactly.
        // The phase's cutoff comparison is `.lt("last_seen_at", cutoff)`
        // (strict), so this row is NOT stale — it must be excluded. A
        // mutation to `.lte` (mutation (i) below) pulls it in.
        matchingListing(4, { last_seen_at: cutoffExact }),
        // Padding: fresh in-band rows so 3-stale-of-total stays well under
        // the 35% maxDelistFrac cap regardless of how many contamination
        // rows below end up (wrongly) counted as "total" by a broken predicate.
        ...Array.from({ length: 7 }, (_, i) =>
          matchingListing(100 + i, { last_seen_at: freshTs }),
        ),
        // Contamination: each row fails exactly ONE regionFilter clause,
        // otherwise matches. Any one of these appearing in the update's
        // matched set means that clause got dropped or weakened.
        matchingListing(12, { source: "craigslist", last_seen_at: staleTs }), // wrong source
        matchingListing(13, { last_seen_at: staleTs, delisted_at: freshTs }), // already delisted
        matchingListing(14, { last_seen_at: staleTs, beds: BEDS_MAX + 1 }), // outside beds band
        matchingListing(15, { last_seen_at: staleTs, price: PRICE_MIN - 100 }), // outside price band
        matchingListing(16, { last_seen_at: staleTs, lat: REGION_LAT_MAX + 1 }), // outside region
      ];

      const { client, updateCalls } = makeSupabase(listings);

      const res = await runDelistUnseenPhase(makeDeps(client), OK_STREETEASY, {
        maxAgeHours,
        maxDelistFrac: 0.35,
      });

      expect(res.ok).toBe(true);
      expect(updateCalls.length).toBe(1);
      expect(updateCalls[0].matched.map((r) => r.id).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// CLI arg parsing (lib/ingest/cli-args.ts)
// ---------------------------------------------------------------------------

describe("parseArgs: --max-age-hours / --max-delist-frac", () => {
  const argv = (...flags: string[]) => ["node", "ingest.ts", ...flags];

  it("rejects --max-delist-frac=1.5 (out of (0,1])", () => {
    expect(() => parseArgs(argv("--max-delist-frac=1.5"))).toThrow(/Invalid --max-delist-frac/);
  });
  it("rejects --max-delist-frac=0 (not > 0)", () => {
    expect(() => parseArgs(argv("--max-delist-frac=0"))).toThrow(/Invalid --max-delist-frac/);
  });
  it("rejects --max-delist-frac=abc (not a number)", () => {
    expect(() => parseArgs(argv("--max-delist-frac=abc"))).toThrow(/Invalid --max-delist-frac/);
  });
  it("rejects --max-age-hours=0 (not > 0)", () => {
    expect(() => parseArgs(argv("--max-age-hours=0"))).toThrow(/Invalid --max-age-hours/);
  });
  it("rejects --max-age-hours=abc (not a number, Number(\"abc\") is NaN)", () => {
    // Regression target: cli-args.ts guards this with `!Number.isFinite(...)`
    // (see its comment on why a silent NaN/negative cutoff is dangerous —
    // it'd make every active row look stale and risk a mass-delist). A prior
    // audit mutation removed that Number.isFinite check and no test failed —
    // Number("abc") is NaN, `NaN <= 0` is false, so the surviving `<= 0`
    // check alone lets a garbage value through silently. This test exists to
    // catch that regression; see the mutation-check note below.
    expect(() => parseArgs(argv("--max-age-hours=abc"))).toThrow(/Invalid --max-age-hours/);
  });
  it("accepts --max-delist-frac=1 (upper bound inclusive)", () => {
    const args = parseArgs(argv("--max-delist-frac=1"));
    expect(args.maxDelistFrac).toBe(1);
  });
  it("accepts --max-delist-frac=0.2", () => {
    const args = parseArgs(argv("--max-delist-frac=0.2"));
    expect(args.maxDelistFrac).toBe(0.2);
  });
  it("accepts --max-age-hours=5", () => {
    const args = parseArgs(argv("--max-age-hours=5"));
    expect(args.maxAgeHours).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Orchestrator ordering
// ---------------------------------------------------------------------------

class NoopFetch implements FetchStrategy {
  name = "noop";
  async fetchSource() {
    return [];
  }
}

// report.phases is typed as bare PhaseResult[] (TOutput defaults to
// `unknown`), so `.output` needs an explicit cast to the phase's real output
// shape at each orchestrator-level call site — same pattern orchestrator.ts
// itself uses internally (`res.output as FetchPhaseOutput | undefined`).
function findDelistOutput(
  phases: { phase: string; output?: unknown }[],
): DelistUnseenOutput | undefined {
  return phases.find((p) => p.phase === "delist-unseen")?.output as
    | DelistUnseenOutput
    | undefined;
}

describe("orchestrator wiring", () => {
  it("runs delist-unseen immediately after upsert", async () => {
    // Empty predicate match (scanned=0) so the phase returns after its first
    // count query without needing the stale-count/update queries stubbed.
    const { client } = makeSupabase([]);

    const report = await runOrchestrator({
      supabase: client as unknown as import("@supabase/supabase-js").SupabaseClient,
      fetchStrategy: new NoopFetch(),
      sources: ["streeteasy"],
      dryRun: true,
      skipPhases: new Set<string>(),
      onlyPhases: new Set<string>(["upsert", "delist-unseen"]),
    });

    expect(report.phases.map((p) => p.phase)).toEqual(["upsert", "delist-unseen"]);
    const delistPhase = report.phases.find((p) => p.phase === "delist-unseen");
    expect(delistPhase?.ok).toBe(true);
  });

  // REGRESSION TARGET: the orchestrator used to wire delist-unseen with
  // `fetchOut?.perSourceResults ?? null` (see delist-unseen.ts's GATE section
  // for what null vs [] means to the gate). safeRun() catches a thrown fetch
  // phase into an errorless PhaseResult with `output: undefined`, so a
  // *scheduled* fetch that threw collapsed to the exact same `null` as a
  // fetch that was never scheduled — the gate then reads "operator
  // invocation, trust the caller" and proceeds to delist off an unverified
  // (in this case failed) fetch. That's the one case the gate exists to
  // block. Fixed by gating on whether fetch was scheduled
  // (`shouldRun("fetch", ...)`), not on whether fetchOut ended up populated.
  describe("fetch-outcome wiring into delist-unseen's gate", () => {
    it("(a) fetch scheduled and throws -> delist-unseen skips, zero listing updates", async () => {
      const listings = [matchingListing(1, { last_seen_at: STALE_26H })];
      const { client, updateCalls } = makeSupabase(listings);

      const report = await runOrchestrator({
        supabase: client as unknown as import("@supabase/supabase-js").SupabaseClient,
        fetchStrategy: new NoopFetch(),
        // sources:null forces runFetchPhase to throw synchronously — its
        // very first line does `deps.sources.join(",")` before entering the
        // per-source try/catch, so this reproduces "fetch phase ran, threw,
        // safeRun caught it, res.output is undefined" deterministically and
        // without real network failures or the withRetries backoff delay.
        sources: null as unknown as string[],
        dryRun: false,
        skipPhases: new Set<string>(),
        onlyPhases: new Set<string>(["fetch", "delist-unseen"]),
      });

      const fetchPhase = report.phases.find((p) => p.phase === "fetch");
      expect(fetchPhase?.ok).toBe(false);
      expect(fetchPhase?.output).toBeUndefined();

      const delistOutput = findDelistOutput(report.phases);
      expect(delistOutput?.skippedReason).not.toBeNull();
      expect(updateCalls.length).toBe(0);
    });

    it("(b) fetch scheduled, streeteasy ok:false -> delist-unseen skips with that error", async () => {
      class FailingStreeteasyFetch implements FetchStrategy {
        name = "failing-streeteasy";
        async fetchSource(source: string) {
          if (source === "streeteasy") throw new Error("403 PerimeterX block");
          return [];
        }
      }
      const listings = [matchingListing(1, { last_seen_at: STALE_26H })];
      const { client, updateCalls } = makeSupabase(listings);

      const report = await runOrchestrator({
        supabase: client as unknown as import("@supabase/supabase-js").SupabaseClient,
        fetchStrategy: new FailingStreeteasyFetch(),
        sources: ["streeteasy"],
        dryRun: false,
        skipPhases: new Set<string>(),
        onlyPhases: new Set<string>(["fetch", "delist-unseen"]),
      });

      const delistOutput = findDelistOutput(report.phases);
      expect(delistOutput?.skippedReason).toBe(
        "streeteasy fetch failed: 403 PerimeterX block",
      );
      expect(updateCalls.length).toBe(0);
    }, 10_000); // real withRetries backoff (500ms+1000ms) runs inside runFetchPhase

    it("(c) fetch scheduled, streeteasy ok rowCount 5 -> delist-unseen runs (skippedReason null)", async () => {
      class OkStreeteasyFetch implements FetchStrategy {
        name = "ok-streeteasy";
        async fetchSource(source: string) {
          return source === "streeteasy" ? (Array(5).fill({}) as never[]) : [];
        }
      }
      // 30 rows, 3 stale: matches the maxDelistFrac boundary used by the
      // top-level "delists exactly the stale rows" test above (10%, safely
      // under the 35% cap) — a single stale-of-1 row would hit 100% and be
      // REFUSED by the cap (ok:false, delisted:0, skippedReason still null),
      // which would make this test pass for the wrong reason.
      const listings = Array.from({ length: 30 }, (_, i) =>
        matchingListing(i + 1, { last_seen_at: i < 3 ? STALE_26H : FRESH }),
      );
      const { client, updateCalls } = makeSupabase(listings);

      const report = await runOrchestrator({
        supabase: client as unknown as import("@supabase/supabase-js").SupabaseClient,
        fetchStrategy: new OkStreeteasyFetch(),
        sources: ["streeteasy"],
        dryRun: false,
        skipPhases: new Set<string>(),
        onlyPhases: new Set<string>(["fetch", "delist-unseen"]),
      });

      const delistOutput = findDelistOutput(report.phases);
      expect(delistOutput?.skippedReason).toBeNull();
      expect(updateCalls.length).toBe(1);
      expect(updateCalls[0].matched.map((r) => r.id).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    });

    it("(d) --only-phase=delist-unseen (fetch not scheduled) -> delist-unseen runs (skippedReason null)", async () => {
      const listings = Array.from({ length: 30 }, (_, i) =>
        matchingListing(i + 1, { last_seen_at: i < 3 ? STALE_26H : FRESH }),
      );
      const { client, updateCalls } = makeSupabase(listings);

      const report = await runOrchestrator({
        supabase: client as unknown as import("@supabase/supabase-js").SupabaseClient,
        fetchStrategy: new NoopFetch(),
        sources: ["streeteasy"],
        dryRun: false,
        skipPhases: new Set<string>(),
        onlyPhases: new Set<string>(["delist-unseen"]),
      });

      expect(report.phases.map((p) => p.phase)).toEqual(["delist-unseen"]);
      const delistOutput = findDelistOutput(report.phases);
      expect(delistOutput?.skippedReason).toBeNull();
      expect(updateCalls.length).toBe(1);
    });
  });
});
