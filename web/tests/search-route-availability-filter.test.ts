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
