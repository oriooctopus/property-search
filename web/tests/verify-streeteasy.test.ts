/**
 * Unit tests for the StreetEasy stale-detection verifier.
 *
 * Run with: npx vitest run tests/verify-streeteasy.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifyStreetEasy } from "../lib/sources/verify/streeteasy";

const URL = "https://streeteasy.com/building/example/1a";

function mockFetch(status: number, body: string) {
  return vi.fn(async () =>
    new Response(body, { status, headers: { "content-type": "text/html" } }),
  );
}

describe("verifyStreetEasy", () => {
  const realFetch = globalThis.fetch;
  const savedEnv = {
    APIFY_TOKEN: process.env.APIFY_TOKEN,
    APIFY_PROXY_URL: process.env.APIFY_PROXY_URL,
  };
  beforeEach(() => {
    vi.restoreAllMocks();
    // Force the direct-fetch path so globalThis.fetch mocks apply. Proxy
    // wiring is covered by the live smoke test, not these unit tests.
    delete process.env.APIFY_TOKEN;
    delete process.env.APIFY_PROXY_URL;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (savedEnv.APIFY_TOKEN) process.env.APIFY_TOKEN = savedEnv.APIFY_TOKEN;
    if (savedEnv.APIFY_PROXY_URL) process.env.APIFY_PROXY_URL = savedEnv.APIFY_PROXY_URL;
  });

  it("returns active when SSR body has offMarketAt: null", async () => {
    globalThis.fetch = mockFetch(200, `<html>..."offMarketAt":null,...</html>`) as unknown as typeof fetch;
    const res = await verifyStreetEasy(URL, {});
    expect(res.status).toBe("active");
  });

  it("returns delisted with date when offMarketAt is set", async () => {
    globalThis.fetch = mockFetch(
      200,
      `<html>..."offMarketAt":"2024-01-25T00:00:00.000Z",...</html>`,
    ) as unknown as typeof fetch;
    const res = await verifyStreetEasy(URL, {});
    expect(res.status).toBe("delisted");
    if (res.status === "delisted") {
      expect(res.delistedAt?.toISOString().startsWith("2024-01-25")).toBe(true);
      expect(res.reason).toMatch(/offMarketAt/);
    }
  });

  it("returns unknown on 403", async () => {
    globalThis.fetch = mockFetch(403, "blocked") as unknown as typeof fetch;
    const res = await verifyStreetEasy(URL, {});
    expect(res.status).toBe("unknown");
  });

  it("returns unknown when marker is missing", async () => {
    globalThis.fetch = mockFetch(200, "<html>no marker</html>") as unknown as typeof fetch;
    const res = await verifyStreetEasy(URL, {});
    expect(res.status).toBe("unknown");
  });
});
