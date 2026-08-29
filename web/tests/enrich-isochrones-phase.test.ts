/**
 * Phase-level test for enrich-isochrones.
 *
 * BUG #1 (2026-08-29): the old phase fetched ALL listing_isochrones.listing_id in
 * one unranged .select(), and all "missing" candidates via one
 * .from("listings")...limit(10_000). PostgREST caps every single response at
 * 1000 rows regardless of what .limit()/.range() asks for, so in production
 * (~8.6M listing_isochrones rows over ~43k listings) both queries silently
 * truncated: the "existing" Set held <=1000 of those 8.6M rows, and the
 * candidate list was the first 1000 listings in arbitrary (effectively
 * oldest-inserted) order. The RPC's ON CONFLICT DO NOTHING made re-enriching
 * those same ~1000 rows look like a successful run forever, while new/active
 * listings were never reached.
 *
 * BUG #2 (2026-08-29, found live immediately after #1 shipped): the fix for
 * #1 paged the candidate listings correctly, but its "already enriched?"
 * check still hit the SAME 1000-row cap from a different angle:
 * listing_isochrones is a many-to-many join (one row per listing x
 * intersecting isochrone polygon, ~200 rows/listing on average), so
 * `.select("listing_id").in("listing_id", chunkIds)` for a 200-id chunk can
 * return thousands of matching rows — truncated by PostgREST to 1000,
 * covering as few as 2-3 distinct listing_ids out of the 200 (measured
 * live). The other ~197 were then wrongly treated as "missing" forever:
 * "found N missing" approached but never reached 0. The fix queries FROM
 * `listings` with an inner join instead, capped to 1 embedded child row per
 * parent via `.limit(1, { referencedTable: "listing_isochrones" })` — this
 * bounds the response to at most chunkIds.length top-level rows no matter
 * how many isochrones any one listing has.
 *
 * The fake Supabase client below reproduces PostgREST's 1000-row cap for
 * every query (not just this phase's current usage), and models
 * listing_isochrones as a genuine many-to-many join (multiple rows per
 * "existing" listing) so a regression back to either buggy form silently
 * truncates here exactly like it does in prod, and the affected test fails
 * loudly instead of a mock quietly "supporting" whatever the code happens to
 * do.
 *
 * Run with: npx vitest run tests/enrich-isochrones-phase.test.ts
 */

import { describe, it, expect } from "vitest";
import type { OrchestratorDeps } from "../lib/ingest/types";

// ---------------------------------------------------------------------------
// Fake Supabase query builder / client
// ---------------------------------------------------------------------------

const POSTGREST_CAP = 1000;

interface ListingSeed {
  id: number;
  lat: number | null;
  lon: number | null;
  delisted_at: string | null;
  created_at: string;
}

interface IsochroneSeed {
  listing_id: number;
}

type FilterFn<T> = (row: T) => boolean;

/**
 * Minimal stand-in for supabase-js's PostgrestFilterBuilder: chain methods
 * mutate internal state and return `this`; the object is thenable at every
 * point in the chain (matching the real library, where `await` can land
 * after any chain method) and resolves by applying filters/order/embed,
 * THEN a .range()/.limit() slice, THEN the hard 1000-row PostgREST cap — in
 * that order, so a .range() request spanning >1000 rows (misuse) or an
 * unranged .select() both truncate the same way a real PostgREST response
 * would.
 *
 * Embedded-relation support (`.select("id, listing_isochrones!inner(...)")`
 * + `.limit(1, { referencedTable })`) is special-cased narrowly for the one
 * shape this phase actually uses — a `listings` query inner-joined against
 * `listing_isochrones` by id — rather than a general join engine.
 */
class FakeQuery<T> implements PromiseLike<{ data: unknown[]; error: null }> {
  private filters: FilterFn<T>[] = [];
  private orders: { col: keyof T; ascending: boolean }[] = [];
  private rangeVal: [number, number] | null = null;
  private limitVal: number | null = null;
  private innerJoinRequested = false;

  constructor(
    private rows: T[],
    // Only set on the "listings" table's query, and only consulted when an
    // embedded `listing_isochrones!inner(...)` relation was requested via
    // .select(). Maps listing id -> count of its listing_isochrones rows,
    // so the embed can apply real inner-join semantics (exclude ids with 0
    // related rows) without needing a full join engine.
    private isochroneCounts?: Map<number, number>,
  ) {}

  select(sel: string): this {
    if (sel.includes("listing_isochrones!inner")) this.innerJoinRequested = true;
    return this;
  }
  is(col: keyof T, val: unknown): this {
    this.filters.push((r) => (r[col] as unknown) === val);
    return this;
  }
  not(col: keyof T, _op: string, val: unknown): this {
    this.filters.push((r) => (r[col] as unknown) !== val);
    return this;
  }
  in(col: keyof T, vals: unknown[]): this {
    const set = new Set(vals);
    this.filters.push((r) => set.has(r[col] as unknown));
    return this;
  }
  order(col: keyof T, opts?: { ascending?: boolean }): this {
    this.orders.push({ col, ascending: opts?.ascending ?? true });
    return this;
  }
  range(start: number, end: number): this {
    this.rangeVal = [start, end];
    return this;
  }
  // Real supabase-js overloads .limit(n) for a top-level limit and
  // .limit(n, { referencedTable }) to cap an EMBEDDED relation's row count
  // per parent — the two are unrelated, which is exactly why bug #2 needed
  // the second form rather than reusing plain .limit().
  limit(n: number, opts?: { referencedTable?: string }): this {
    if (opts?.referencedTable) {
      // Nothing to do structurally here: resolve() below only ever needs
      // to know a listing HAS >=1 related row (existence, not the count),
      // so capping to "1" doesn't change what findExistingIsochroneIds
      // reads off the result. Real PostgREST would trim the embedded array
      // to n rows; we model that by never expanding it in the first place.
    } else {
      this.limitVal = n;
    }
    return this;
  }

  private resolve(): { data: unknown[]; error: null } {
    let result = this.rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.orders.length > 0) {
      result = [...result].sort((a, b) => {
        for (const o of this.orders) {
          const av = a[o.col] as unknown as string | number;
          const bv = b[o.col] as unknown as string | number;
          if (av < bv) return o.ascending ? -1 : 1;
          if (av > bv) return o.ascending ? 1 : -1;
        }
        return 0;
      });
    }
    // No .order() call => real Postgrest gives no ordering guarantee; we
    // return rows in seed/insertion order, which is how the original bug's
    // "arbitrary (effectively oldest) order" manifested.
    if (this.rangeVal) {
      const [start, end] = this.rangeVal;
      result = result.slice(start, end + 1);
    } else if (this.limitVal != null) {
      result = result.slice(0, this.limitVal);
    }
    // The invariant that makes both bugs reproduce here: PostgREST always
    // caps a response at 1000 rows, no matter what was asked for.
    if (result.length > POSTGREST_CAP) result = result.slice(0, POSTGREST_CAP);

    if (this.innerJoinRequested) {
      // Inner-join semantics: drop any row with zero related isochrone
      // rows, and shape the surviving rows the way findExistingIsochroneIds
      // reads them (only `id` is read, so the embedded array's content is
      // irrelevant beyond "non-empty").
      const counts = this.isochroneCounts ?? new Map();
      const joined = (result as { id: number }[])
        .filter((r) => (counts.get(r.id) ?? 0) > 0)
        .map((r) => ({ id: r.id, listing_isochrones: [{ listing_id: r.id }] }));
      return { data: joined, error: null };
    }
    return { data: result, error: null };
  }

  then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
  }
}

function makeSupabase(
  listings: ListingSeed[],
  isochrones: IsochroneSeed[],
  rpcHandler: (args: { p_listings: unknown[] }) => Promise<{ error: { message: string } | null }>,
) {
  const rpcCalls: { p_listings: { listing_id: number }[] }[] = [];
  // Every .in() call across every table, tagged with which table it hit —
  // lets tests assert chunk sizes stay <=EXISTENCE_CHUNK regardless of
  // which table/query shape the phase currently sends them to (this changed
  // between bug #1's fix and bug #2's fix: first listing_isochrones.in(),
  // now listings.in()).
  const inCalls: { table: string; size: number }[] = [];

  const isochroneCounts = new Map<number, number>();
  for (const row of isochrones) {
    isochroneCounts.set(row.listing_id, (isochroneCounts.get(row.listing_id) ?? 0) + 1);
  }

  const client = {
    from(table: string) {
      if (table === "listings") {
        const q = new FakeQuery(listings, isochroneCounts);
        const origIn = q.in.bind(q);
        q.in = (col, vals) => {
          inCalls.push({ table: "listings", size: vals.length });
          return origIn(col, vals);
        };
        return q;
      }
      if (table === "listing_isochrones") {
        const q = new FakeQuery(isochrones);
        const origIn = q.in.bind(q);
        q.in = (col, vals) => {
          inCalls.push({ table: "listing_isochrones", size: vals.length });
          return origIn(col, vals);
        };
        return q;
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc(name: string, args: { p_listings: unknown[] }) {
      if (name !== "batch_enrich_listing_isochrones") {
        throw new Error(`unexpected rpc ${name}`);
      }
      rpcCalls.push(args as { p_listings: { listing_id: number }[] });
      return rpcHandler(args);
    },
  };

  return { client, rpcCalls, inCalls };
}

function makeDeps(supabase: ReturnType<typeof makeSupabase>["client"]): OrchestratorDeps {
  return {
    supabase: supabase as unknown as OrchestratorDeps["supabase"],
    dryRun: false,
    sources: ["craigslist"],
    skipPhases: new Set(),
    onlyPhases: null,
    fetchStrategy: { name: "test", fetchSource: async () => [] },
    runId: "test",
    startedAt: new Date().toISOString(),
    budgetUsd: 1.0,
  };
}

// ---------------------------------------------------------------------------
// Fixture: 2,500 listings, 100 delisted (ids 2401-2500), 2,400 active.
// Among the 2,400 active listings, every id with `id % 4 === 1` (600 ids,
// spread across the whole range, not clustered at the low end) has NO
// isochrone rows yet; the other 1,800 each have ISOCHRONES_PER_LISTING=6
// rows (real listing_isochrones is a many-to-many join — a listing can
// intersect several isochrone polygons — this is what makes bug #2's flat
// `.in("listing_id", chunkIds)` query blow past the 1000-row cap on a
// 200-id chunk: 200 * 6 = 1200 > 1000). NEWEST_MISSING_ID is one of the 600
// missing ids, but its created_at is overridden far into the future so it
// is unambiguously the single newest listing in the whole set — this
// decouples "newest" from "highest id" so an ordering test can't pass by
// accident on an id-based sort.
// ---------------------------------------------------------------------------

const TOTAL = 2500;
const DELISTED_START = 2401; // ids 2401..2500 delisted
const NEWEST_MISSING_ID = 1201; // 1201 % 4 === 1 => in the "missing" set
const ISOCHRONES_PER_LISTING = 8; // per 200-id chunk, ~75% are "existing" (150) x 8 = 1200 rows > POSTGREST_CAP=1000; 6 was too low once accounting for the missing 25% mixed into each chunk

function buildFixture() {
  const listings: ListingSeed[] = [];
  const isochrones: IsochroneSeed[] = [];

  for (let id = 1; id <= TOTAL; id++) {
    const delisted = id >= DELISTED_START;
    const createdAt =
      id === NEWEST_MISSING_ID
        ? new Date("2099-01-01T00:00:00Z").toISOString()
        : new Date(2020, 0, 1, 0, 0, id).toISOString(); // strictly increasing with id

    listings.push({
      id,
      lat: 40.7 + id * 0.0001,
      lon: -73.9 + id * 0.0001,
      delisted_at: delisted ? "2026-08-01T00:00:00Z" : null,
      created_at: createdAt,
    });

    const active = !delisted;
    const missing = active && id % 4 === 1;
    if (active && !missing) {
      for (let k = 0; k < ISOCHRONES_PER_LISTING; k++) {
        isochrones.push({ listing_id: id });
      }
    }
  }

  const activeMissingIds = listings
    .filter((l) => l.delisted_at === null && l.id % 4 === 1)
    .map((l) => l.id);
  const activeExistingIds = listings
    .filter((l) => l.delisted_at === null && l.id % 4 !== 1)
    .map((l) => l.id);
  const delistedIds = listings.filter((l) => l.delisted_at !== null).map((l) => l.id);

  return { listings, isochrones, activeMissingIds, activeExistingIds, delistedIds };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("enrich-isochrones phase", () => {
  it("sends every active listing missing an isochrone to the RPC, and no already-enriched or delisted one", async () => {
    const { listings, isochrones, activeMissingIds, activeExistingIds, delistedIds } =
      buildFixture();
    const { client, rpcCalls } = makeSupabase(listings, isochrones, async () => ({ error: null }));

    const { runEnrichIsochronesPhase } = await import("../lib/ingest/phases/enrich-isochrones");
    const res = await runEnrichIsochronesPhase(makeDeps(client));

    const sentIds = new Set(rpcCalls.flatMap((c) => c.p_listings.map((p) => p.listing_id)));

    // Every missing active listing was sent...
    for (const id of activeMissingIds) {
      expect(sentIds.has(id)).toBe(true);
    }
    // ...and nothing else was: no already-enriched id (even though each has
    // 6 isochrone rows, not 1 — this is what catches bug #2), no delisted id.
    for (const id of activeExistingIds) {
      expect(sentIds.has(id)).toBe(false);
    }
    for (const id of delistedIds) {
      expect(sentIds.has(id)).toBe(false);
    }
    expect(sentIds.size).toBe(activeMissingIds.length);
    expect(res.output?.queried).toBe(activeMissingIds.length);
    expect(res.output?.enriched).toBe(activeMissingIds.length);
    expect(res.ok).toBe(true);
  });

  it("chunks the existence check (no single .in() call over EXISTENCE_CHUNK=200 ids)", async () => {
    const { listings, isochrones } = buildFixture();
    const { client, inCalls } = makeSupabase(listings, isochrones, async () => ({ error: null }));

    const { runEnrichIsochronesPhase } = await import("../lib/ingest/phases/enrich-isochrones");
    await runEnrichIsochronesPhase(makeDeps(client));

    expect(inCalls.length).toBeGreaterThan(1); // 2,400 active ids / 200 = 12 chunks
    for (const call of inCalls) {
      expect(call.size).toBeLessThanOrEqual(200);
    }
  });

  it("never sends a delisted listing even if it has no isochrone row", async () => {
    const { listings, isochrones, delistedIds } = buildFixture();
    const { client, rpcCalls } = makeSupabase(listings, isochrones, async () => ({ error: null }));

    const { runEnrichIsochronesPhase } = await import("../lib/ingest/phases/enrich-isochrones");
    await runEnrichIsochronesPhase(makeDeps(client));

    const sentIds = new Set(rpcCalls.flatMap((c) => c.p_listings.map((p) => p.listing_id)));
    for (const id of delistedIds) {
      expect(sentIds.has(id)).toBe(false);
    }
  });

  it("scans newest-first: the single newest listing appears in the first RPC batch", async () => {
    const { listings, isochrones } = buildFixture();
    const { client, rpcCalls } = makeSupabase(listings, isochrones, async () => ({ error: null }));

    const { runEnrichIsochronesPhase } = await import("../lib/ingest/phases/enrich-isochrones");
    await runEnrichIsochronesPhase(makeDeps(client));

    expect(rpcCalls.length).toBeGreaterThan(0);
    const firstBatchIds = rpcCalls[0].p_listings.map((p) => p.listing_id);
    expect(firstBatchIds).toContain(NEWEST_MISSING_ID);
  });

  it("counts a failed RPC batch as errors, reports ok:false, while other batches still enrich", async () => {
    // Small fixture: 50 active listings, ids 1-50, all missing isochrones,
    // no delisted rows. RPC_BATCH=25 => exactly 2 batches. Fail the 2nd.
    const listings: ListingSeed[] = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      lat: 40.7,
      lon: -73.9,
      delisted_at: null,
      created_at: new Date(2020, 0, 1, 0, 0, i + 1).toISOString(),
    }));
    // Fail deterministically by batch CONTENT (first listing_id >= 26 => the
    // 2nd batch), not by a global call counter — the phase retries a failed
    // batch (withRetries tries:2), so a call-counter-based fake would let
    // the retry attempt "succeed" on a different counter value and silently
    // hide the failure this test exists to catch.
    const { client, rpcCalls } = makeSupabase(listings, [], async (args) => {
      const firstId = (args.p_listings[0] as { listing_id: number }).listing_id;
      if (firstId >= 26) return { error: { message: "simulated RPC failure" } };
      return { error: null };
    });

    const { runEnrichIsochronesPhase } = await import("../lib/ingest/phases/enrich-isochrones");
    const res = await runEnrichIsochronesPhase(makeDeps(client));

    const batch1Calls = rpcCalls.filter((c) => c.p_listings[0].listing_id < 26);
    const batch2Calls = rpcCalls.filter((c) => c.p_listings[0].listing_id >= 26);
    expect(batch1Calls.length).toBe(1); // succeeded first try, no retry
    expect(batch2Calls.length).toBe(2); // both retry attempts (tries:2) hit the failure
    expect(res.output?.enriched).toBe(25);
    expect(res.output?.errors).toBe(25);
    expect(res.ok).toBe(false);
    expect(res.warnings.length).toBeGreaterThan(0);
  });
});
