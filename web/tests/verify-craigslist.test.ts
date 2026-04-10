/**
 * Unit tests for the Craigslist stale-detection verifier.
 *
 * Run with: npx vitest run tests/verify-craigslist.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifyCraigslist } from "../lib/sources/verify/craigslist";

const URL = "https://newyork.craigslist.org/brk/apa/d/example/7000000000.html";

function mockFetch(status: number, body: string) {
  return vi.fn(async () =>
    new Response(body, { status, headers: { "content-type": "text/html" } }),
  );
}

describe("verifyCraigslist", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("returns delisted on HTTP 410", async () => {
    globalThis.fetch = mockFetch(410, "") as unknown as typeof fetch;
    const res = await verifyCraigslist(URL, {});
    expect(res.status).toBe("delisted");
    if (res.status === "delisted") expect(res.reason).toMatch(/410/);
  });

  it("returns delisted on HTTP 404", async () => {
    globalThis.fetch = mockFetch(404, "") as unknown as typeof fetch;
    const res = await verifyCraigslist(URL, {});
    expect(res.status).toBe("delisted");
  });

  it("returns delisted when 200 body contains a flag marker", async () => {
    globalThis.fetch = mockFetch(
      200,
      "<html>This posting has been flagged for removal.</html>",
    ) as unknown as typeof fetch;
    const res = await verifyCraigslist(URL, {});
    expect(res.status).toBe("delisted");
  });

  it("returns active when 200 body has no flag markers", async () => {
    globalThis.fetch = mockFetch(
      200,
      "<html>Nice apartment for rent $2000</html>",
    ) as unknown as typeof fetch;
    const res = await verifyCraigslist(URL, {});
    expect(res.status).toBe("active");
  });
});
