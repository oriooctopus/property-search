/**
 * Tests for the centralized upsertListings helper (Phase B).
 *
 * Run with: npx vitest run tests/upsert.test.ts
 */

import { describe, it, expect, vi } from "vitest";
import { upsertListings } from "../lib/sources/upsert";
import type { ListingRow } from "../lib/sources/row";
import type { SupabaseClient } from "@supabase/supabase-js";

function makeRow(i: number): ListingRow {
  return {
    address: `${i} Test St`,
    area: "Test, NY",
    price: 1000 + i,
    beds: 1,
    baths: 1,
    sqft: null,
    lat: 40.7,
    lon: -74,
    photos: 0,
    photo_urls: [],
    url: `https://example.com/${i}`,
    list_date: null,
    last_update_date: null,
    availability_date: null,
    source: "streeteasy",
    year_built: null,
  };
}

function makeRows(n: number): ListingRow[] {
  return Array.from({ length: n }, (_, i) => makeRow(i));
}

/**
 * Build a fake Supabase client whose `from().upsert().select()` chain
 * returns whatever the test queues up. The chain is: from -> upsert -> select.
 */
function makeFakeSupabase(
  responses: Array<{ data: { url: string }[] | null; error: { message: string; status?: number; code?: number } | null }>,
) {
  let call = 0;
  const upsertSpy = vi.fn();
  const fromSpy = vi.fn(() => ({
    upsert: (rows: ListingRow[], opts: unknown) => {
      upsertSpy(rows, opts);
      return {
        select: () => {
          const r = responses[call++] ?? { data: [], error: null };
          return Promise.resolve(r);
        },
      };
    },
  }));
  return {
    client: { from: fromSpy } as unknown as SupabaseClient,
    fromSpy,
    upsertSpy,
    callCount: () => call,
  };
}

describe("upsertListings", () => {
  it("happy path: all rows land", async () => {
    const rows = makeRows(10);
    const fake = makeFakeSupabase([
      { data: rows.map((r) => ({ url: r.url })), error: null },
    ]);
    const result = await upsertListings(fake.client, rows, { batchSize: 50 });
    expect(result.attempted).toBe(10);
    expect(result.succeeded).toBe(10);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("partial landing: response shorter than input → failed reflects diff", async () => {
    const rows = makeRows(10);
    const fake = makeFakeSupabase([
      // Only 7 of 10 came back
      { data: rows.slice(0, 7).map((r) => ({ url: r.url })), error: null },
    ]);
    const result = await upsertListings(fake.client, rows, { batchSize: 50 });
    expect(result.succeeded).toBe(7);
    expect(result.failed).toBe(3);
    expect(result.errors).toHaveLength(1);
  });

  it("413 split: payload-too-large → split in half and retry", async () => {
    const rows = makeRows(4);
    const fake = makeFakeSupabase([
      { data: null, error: { message: "Payload Too Large", status: 413 } },
      // After split: first half (2 rows)
      { data: [{ url: rows[0].url }, { url: rows[1].url }], error: null },
      // Second half (2 rows)
      { data: [{ url: rows[2].url }, { url: rows[3].url }], error: null },
    ]);
    const result = await upsertListings(fake.client, rows, { batchSize: 50, maxRetries: 0 });
    expect(result.succeeded).toBe(4);
    expect(result.failed).toBe(0);
    expect(result.splitOn413).toBeGreaterThanOrEqual(1);
  });

  it("retry path: first call generic error, second call succeeds", async () => {
    const rows = makeRows(3);
    const fake = makeFakeSupabase([
      { data: null, error: { message: "transient network blip" } },
      { data: rows.map((r) => ({ url: r.url })), error: null },
    ]);
    const result = await upsertListings(fake.client, rows, {
      batchSize: 50,
      maxRetries: 2,
      backoffMs: 1,
    });
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.retries).toBeGreaterThanOrEqual(1);
  });

  it("dedup: rows with same URL are deduplicated before upsert (last-write wins)", async () => {
    // 10 rows, but 3 share URLs with earlier rows → only 7 unique
    const rows = makeRows(10);
    rows[7] = { ...makeRow(99), url: rows[0].url }; // dup of row 0
    rows[8] = { ...makeRow(98), url: rows[1].url }; // dup of row 1
    rows[9] = { ...makeRow(97), url: rows[2].url }; // dup of row 2

    const uniqueUrls = new Set(rows.map((r) => r.url));
    expect(uniqueUrls.size).toBe(7); // sanity check

    const fake = makeFakeSupabase([
      // The upsert should receive 7 rows, respond with all 7
      { data: Array.from(uniqueUrls).map((url) => ({ url })), error: null },
    ]);
    const result = await upsertListings(fake.client, rows, { batchSize: 50 });
    expect(result.attempted).toBe(7);
    expect(result.succeeded).toBe(7);
    expect(result.failed).toBe(0);
    expect(result.dedupedInBatch).toBe(3);
    expect(result.errors).toHaveLength(0);

    // Verify only 7 rows were sent to Supabase
    const upsertedRows = fake.upsertSpy.mock.calls[0][0] as ListingRow[];
    expect(upsertedRows).toHaveLength(7);

    // Verify last-write wins: the dup rows (indices 7,8,9) should replace 0,1,2
    const row0 = upsertedRows.find((r) => r.url === rows[0].url)!;
    expect(row0.address).toBe("99 Test St"); // from makeRow(99), not makeRow(0)
  });

  it("dry-run: no calls to supabase.from()", async () => {
    const rows = makeRows(5);
    const fake = makeFakeSupabase([]);
    const result = await upsertListings(fake.client, rows, { dryRun: true });
    expect(fake.fromSpy).not.toHaveBeenCalled();
    expect(result.attempted).toBe(5);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
  });
});
