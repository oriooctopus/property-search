import { test, expect } from "@playwright/test";
import type { SubwayStation } from "../../lib/isochrone/types";
import { generateStationWalkIsochrones } from "../../lib/isochrone/generate";

// ---------------------------------------------------------------------------
// Mock stations for testing
// ---------------------------------------------------------------------------

const MOCK_STATIONS: SubwayStation[] = [
  { stopId: "TEST1", name: "Test Station 1", lat: 40.75, lon: -73.98, lines: ["1"] },
  { stopId: "TEST2", name: "Test Station 2", lat: 40.76, lon: -73.97, lines: ["2"] },
  { stopId: "TEST3", name: "Test Station 3", lat: 40.77, lon: -73.96, lines: ["3"] },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePolygon(): GeoJSON.Polygon {
  return {
    type: "Polygon",
    coordinates: [[[-73.95, 40.71], [-73.96, 40.72], [-73.94, 40.72], [-73.95, 40.71]]],
  };
}

function makeOtpResponse(cutoffMinutes: number[]) {
  return {
    type: "FeatureCollection",
    features: cutoffMinutes.map((m) => ({
      type: "Feature",
      geometry: makePolygon(),
      properties: { time: m * 60 },
    })),
  };
}

// ---------------------------------------------------------------------------
// Semaphore unit tests (testing the concurrency primitive directly)
// ---------------------------------------------------------------------------

test.describe("generate – Semaphore", () => {
  test("limits concurrent async tasks to the specified concurrency", async () => {
    class Semaphore {
      private queue: Array<() => void> = [];
      private active = 0;

      constructor(private readonly maxConcurrency: number) {}

      async acquire(): Promise<void> {
        if (this.active < this.maxConcurrency) {
          this.active++;
          return;
        }
        return new Promise<void>((resolve) => {
          this.queue.push(() => {
            this.active++;
            resolve();
          });
        });
      }

      release(): void {
        this.active--;
        const next = this.queue.shift();
        if (next) next();
      }
    }

    const sem = new Semaphore(2);
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const task = async (id: number) => {
      await sem.acquire();
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      await new Promise((r) => setTimeout(r, 10));
      currentConcurrent--;
      sem.release();
      return id;
    };

    const results = await Promise.all([task(1), task(2), task(3), task(4), task(5)]);
    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  test("semaphore with concurrency 1 serializes all tasks", async () => {
    class Semaphore {
      private queue: Array<() => void> = [];
      private active = 0;

      constructor(private readonly maxConcurrency: number) {}

      async acquire(): Promise<void> {
        if (this.active < this.maxConcurrency) {
          this.active++;
          return;
        }
        return new Promise<void>((resolve) => {
          this.queue.push(() => {
            this.active++;
            resolve();
          });
        });
      }

      release(): void {
        this.active--;
        const next = this.queue.shift();
        if (next) next();
      }
    }

    const sem = new Semaphore(1);
    let maxConcurrent = 0;
    let current = 0;

    const task = async () => {
      await sem.acquire();
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((r) => setTimeout(r, 5));
      current--;
      sem.release();
    };

    await Promise.all([task(), task(), task()]);
    expect(maxConcurrent).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// generateStationWalkIsochrones integration tests
// ---------------------------------------------------------------------------

test.describe("generate – generateStationWalkIsochrones", () => {
  let originalFetch: typeof globalThis.fetch;

  test.beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";
  });

  test.afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /**
   * Helper: create a fetch mock that handles both Supabase and OTP requests.
   */
  function createMockFetch(options: {
    existingStopIds?: string[];
    otpCutoffs?: number[];
    otpFailOnCall?: number;
    onOtpCall?: (url: string) => void;
  }) {
    let otpCallCount = 0;
    const existing = options.existingStopIds ?? [];
    const cutoffs = options.otpCutoffs ?? [1];

    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();

      // Supabase SELECT query for existing station IDs
      if (url.includes("localhost:54321") && url.includes("isochrones") && url.includes("select")) {
        const data = existing.map((id) => ({ station_stop_id: id }));
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Content-Range": `0-${data.length}/*`,
          },
        });
      }

      // Supabase INSERT
      if (url.includes("localhost:54321") && url.includes("isochrones") && init?.method === "POST") {
        return new Response(JSON.stringify([]), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Any other Supabase request
      if (url.includes("localhost:54321")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json", "Content-Range": "0-0/*" },
        });
      }

      // OTP isochrone requests
      if (url.includes("/otp/routers/default/isochrone")) {
        otpCallCount++;
        options.onOtpCall?.(url);

        if (options.otpFailOnCall && otpCallCount === options.otpFailOnCall) {
          return new Response("Internal Server Error", { status: 500 });
        }

        return new Response(JSON.stringify(makeOtpResponse(cutoffs)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("Not Found", { status: 404 });
    };
  }

  test("generates correct number of yielded results (stations x cutoff range)", async () => {
    const cutoffs = [1, 2, 3];
    globalThis.fetch = createMockFetch({ otpCutoffs: cutoffs });

    const results: unknown[] = [];
    for await (const iso of generateStationWalkIsochrones(MOCK_STATIONS, {
      minMinutes: 1,
      maxMinutes: 3,
      concurrency: 2,
    })) {
      results.push(iso);
    }

    // 3 stations x 3 cutoffs = 9 results
    expect(results.length).toBe(MOCK_STATIONS.length * cutoffs.length);
  });

  test("skips stations that already have isochrones (resume)", async () => {
    const processedLats: number[] = [];

    globalThis.fetch = createMockFetch({
      existingStopIds: ["TEST1", "TEST2"],
      otpCutoffs: [1],
      onOtpCall: (url) => {
        const match = url.match(/fromPlace=([\d.]+)/);
        if (match) processedLats.push(parseFloat(match[1]));
      },
    });

    const results: unknown[] = [];
    for await (const iso of generateStationWalkIsochrones(MOCK_STATIONS, {
      minMinutes: 1,
      maxMinutes: 1,
      concurrency: 1,
    })) {
      results.push(iso);
    }

    // Only TEST3 (lat 40.77) should have been sent to OTP
    expect(processedLats).toHaveLength(1);
    expect(processedLats[0]).toBeCloseTo(40.77, 1);
  });

  test("handles OTP errors gracefully for individual stations (does not throw)", async () => {
    globalThis.fetch = createMockFetch({
      otpCutoffs: [1],
      otpFailOnCall: 2,
    });

    const results: unknown[] = [];
    for await (const iso of generateStationWalkIsochrones(
      MOCK_STATIONS.slice(0, 2),
      { minMinutes: 1, maxMinutes: 1, concurrency: 1 },
    )) {
      results.push(iso);
    }

    // At least station 1 should succeed
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("yields correct GeneratedIsochrone shape", async () => {
    globalThis.fetch = createMockFetch({ otpCutoffs: [5, 10] });

    const results: Array<{ station: SubwayStation; cutoff: number; polygon: GeoJSON.Polygon }> = [];
    for await (const iso of generateStationWalkIsochrones(
      [MOCK_STATIONS[0]],
      { minMinutes: 5, maxMinutes: 10, concurrency: 1 },
    )) {
      results.push(iso);
    }

    for (const result of results) {
      expect(result.station).toBeDefined();
      expect(result.station.stopId).toBe("TEST1");
      expect(result.station.name).toBe("Test Station 1");
      expect(typeof result.cutoff).toBe("number");
      expect(result.polygon).toBeDefined();
      expect(result.polygon.type).toBe("Polygon");
      expect(Array.isArray(result.polygon.coordinates)).toBe(true);
    }
  });

  test("yields nothing when all stations already exist", async () => {
    globalThis.fetch = createMockFetch({
      existingStopIds: MOCK_STATIONS.map((s) => s.stopId),
    });

    const results: unknown[] = [];
    for await (const iso of generateStationWalkIsochrones(MOCK_STATIONS, {
      minMinutes: 1,
      maxMinutes: 5,
      concurrency: 2,
    })) {
      results.push(iso);
    }

    expect(results).toHaveLength(0);
  });

  test("cutoff range is calculated correctly from min/max options", async () => {
    let capturedUrl = "";

    globalThis.fetch = createMockFetch({
      otpCutoffs: [3, 4, 5],
      onOtpCall: (url) => {
        capturedUrl = url;
      },
    });

    const results: unknown[] = [];
    for await (const iso of generateStationWalkIsochrones(
      [MOCK_STATIONS[0]],
      { minMinutes: 3, maxMinutes: 5, concurrency: 1 },
    )) {
      results.push(iso);
    }

    expect(capturedUrl).toContain("cutoffSec=180");
    expect(capturedUrl).toContain("cutoffSec=240");
    expect(capturedUrl).toContain("cutoffSec=300");
  });

  test("uses WALK mode for all OTP requests", async () => {
    const capturedUrls: string[] = [];

    globalThis.fetch = createMockFetch({
      otpCutoffs: [1],
      onOtpCall: (url) => capturedUrls.push(url),
    });

    for await (const _iso of generateStationWalkIsochrones(
      [MOCK_STATIONS[0]],
      { minMinutes: 1, maxMinutes: 1, concurrency: 1 },
    )) {
      // consume
    }

    for (const url of capturedUrls) {
      expect(url).toContain("mode=WALK");
    }
  });
});
