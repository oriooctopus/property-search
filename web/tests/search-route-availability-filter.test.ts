/**
 * Unit tests for the availability-date carve-out in applyBoundsAndFilters
 * (lib/search-filters.ts, used by app/api/listings/search/route.ts).
 *
 * Product rule: when an availability window is set and includeNaAvailableDate
 * is false, source='craigslist' rows with a NULL availability_date must
 * still pass the filter (CL's post-redesign pages often don't state
 * availability at all — the user decided date-less CL posts should always
 * fit the window). Every other source keeps the original strict
 * NOT NULL + range-only behavior, and CL rows that DO have a stated date are
 * still range-checked normally.
 *
 * Drives applyBoundsAndFilters against a stub query-builder that records
 * every chained call, then asserts on the exact filter string built — this
 * doesn't require a live Supabase connection.
 *
 * Run with: npx vitest run tests/search-route-availability-filter.test.ts
 */

import { describe, it, expect } from "vitest";
import { applyBoundsAndFilters, type SearchFilters } from "../lib/search-filters";

/** Chainable stub that records every call made on it, mimicking the subset
 * of the Supabase query-builder API applyBoundsAndFilters uses. */
function makeStubQuery() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const stub: Record<string, unknown> = {};
  for (const method of ["is", "neq", "gte", "lte", "in", "not", "or", "eq"]) {
    stub[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return stub;
    };
  }
  return { stub, calls };
}

function baseFilters(overrides: Partial<SearchFilters> = {}): SearchFilters {
  return { ...overrides };
}

describe("applyBoundsAndFilters — availability-date carve-out", () => {
  it("with a window set and includeNaAvailableDate false, the OR clause carves out NULL craigslist rows", () => {
    const { stub, calls } = makeStubQuery();
    applyBoundsAndFilters(stub, null, baseFilters({ minAvailableDate: "2026-08-01", maxAvailableDate: "2026-09-01" }));

    const orCalls = calls.filter((c) => c.method === "or");
    const availabilityOr = orCalls.find((c) => String(c.args[0]).includes("availability_date"));
    expect(availabilityOr).toBeDefined();
    const clause = String(availabilityOr!.args[0]);

    // The craigslist-null carve-out branch must be present verbatim.
    expect(clause).toContain("and(source.eq.craigslist,availability_date.is.null)");
    // The normal not-null + range branch must still be present for everyone else.
    expect(clause).toContain("availability_date.not.is.null");
    expect(clause).toContain("availability_date.gte.2026-08-01");
    expect(clause).toContain("availability_date.lte.2026-09-01");
  });

  it("with only a min bound, the range branch has just the min clause (no stray max)", () => {
    const { stub, calls } = makeStubQuery();
    applyBoundsAndFilters(stub, null, baseFilters({ minAvailableDate: "2026-08-01" }));

    const clause = String(
      calls.find((c) => c.method === "or" && String(c.args[0]).includes("availability_date"))!.args[0],
    );
    expect(clause).toContain("availability_date.gte.2026-08-01");
    expect(clause).not.toContain("availability_date.lte.");
  });

  it("with includeNaAvailableDate true, the ORIGINAL null-or-range behavior is unchanged (no source scoping)", () => {
    const { stub, calls } = makeStubQuery();
    applyBoundsAndFilters(
      stub,
      null,
      baseFilters({ minAvailableDate: "2026-08-01", maxAvailableDate: "2026-09-01", includeNaAvailableDate: true }),
    );

    const clause = String(
      calls.find((c) => c.method === "or" && String(c.args[0]).includes("availability_date"))!.args[0],
    );
    // This path is untouched by the CL carve-out — no source scoping at all.
    expect(clause).not.toContain("source.eq.craigslist");
    expect(clause).toContain("availability_date.is.null");
  });

  it("with no availability window set, no availability_date filter is applied at all", () => {
    const { stub, calls } = makeStubQuery();
    applyBoundsAndFilters(stub, null, baseFilters());

    const availabilityCalls = calls.filter((c) => JSON.stringify(c.args).includes("availability_date"));
    expect(availabilityCalls).toHaveLength(0);
  });
});

describe("applyBoundsAndFilters — craigslist 7-day staleness rule", () => {
  // Product rule: CL posts go stale fast (56-day median active lifetime vs
  // 19 for StreetEasy) — hide craigslist listings older than 7 days.
  // Always-on (not a user toggle), same treatment as the facebook-marketplace
  // exclusion. Verified live 2026-07-17: list_date is 100% populated for
  // craigslist rows (0 nulls / 5,150 rows), so created_at is a fallback for
  // a theoretical future gap, not something exercised by current data.

  function findClStaleOrClause(calls: Array<{ method: string; args: unknown[] }>): string {
    const call = calls.find(
      (c) => c.method === "or" && String(c.args[0]).includes("source.neq.craigslist"),
    );
    expect(call).toBeDefined();
    return String(call!.args[0]);
  }

  it("is applied unconditionally, even with no filters set at all", () => {
    const { stub, calls } = makeStubQuery();
    applyBoundsAndFilters(stub, null, baseFilters());

    const clause = findClStaleOrClause(calls);
    expect(clause).toContain("source.neq.craigslist");
    expect(clause).toMatch(/list_date\.gte\.\d{4}-\d{2}-\d{2}T/);
    expect(clause).toContain("and(list_date.is.null,created_at.gte.");
  });

  it("non-craigslist rows pass via the source.neq.craigslist branch regardless of list_date", () => {
    const { stub, calls } = makeStubQuery();
    applyBoundsAndFilters(stub, null, baseFilters());

    // The clause's first branch is exactly "source.neq.craigslist" — any
    // non-craigslist row satisfies the OR without touching list_date at all.
    const clause = findClStaleOrClause(calls);
    expect(clause.startsWith("source.neq.craigslist,")).toBe(true);
  });

  it("the cutoff is ~7 days (CL_MAX_AGE_DAYS) before now, not some other window", () => {
    const { stub, calls } = makeStubQuery();
    const before = Date.now();
    applyBoundsAndFilters(stub, null, baseFilters());
    const after = Date.now();

    const clause = findClStaleOrClause(calls);
    const match = clause.match(/list_date\.gte\.([^,]+)/);
    expect(match).toBeTruthy();
    const cutoffMs = new Date(match![1]).getTime();

    const expectedMin = before - 7 * 86_400_000;
    const expectedMax = after - 7 * 86_400_000;
    expect(cutoffMs).toBeGreaterThanOrEqual(expectedMin - 1000);
    expect(cutoffMs).toBeLessThanOrEqual(expectedMax + 1000);
  });

  it("composes as an independent top-level filter alongside other active filters (e.g. an availability window)", () => {
    const { stub, calls } = makeStubQuery();
    applyBoundsAndFilters(stub, null, baseFilters({ minAvailableDate: "2026-08-01" }));

    // Both .or() clauses must be present as SEPARATE top-level calls (which
    // Supabase/PostgREST ANDs together) — the CL-staleness rule must not be
    // folded into, or replaced by, the availability-date clause.
    const orClauses = calls.filter((c) => c.method === "or").map((c) => String(c.args[0]));
    expect(orClauses.some((c) => c.includes("source.neq.craigslist"))).toBe(true);
    expect(orClauses.some((c) => c.includes("availability_date"))).toBe(true);
    expect(orClauses.length).toBeGreaterThanOrEqual(2);
  });

  it("is applied even when selectedSources explicitly includes craigslist", () => {
    const { stub, calls } = makeStubQuery();
    applyBoundsAndFilters(stub, null, baseFilters({ selectedSources: ["craigslist", "streeteasy"] }));

    // Not a user-facing toggle — selecting craigslist as a source doesn't
    // exempt it from the staleness rule.
    const clause = findClStaleOrClause(calls);
    expect(clause).toContain("source.neq.craigslist");
  });
});
