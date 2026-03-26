import { test, expect } from "@playwright/test";
import { fetchIsochrones, checkHealth } from "../../lib/isochrone/otp-client";
import sampleResponse from "./fixtures/sample-otp-response.json";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("otp-client", () => {
  let originalFetch: typeof globalThis.fetch;

  test.beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  test.afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("successfully fetches isochrone polygons from OTP", async () => {
    globalThis.fetch = async () => jsonResponse(sampleResponse);

    const result = await fetchIsochrones({
      lat: 40.7171,
      lon: -73.9567,
      mode: "WALK",
      cutoffMinutes: [5, 10, 15],
    });

    expect(result.origin).toEqual({ lat: 40.7171, lon: -73.9567 });
    expect(result.mode).toBe("WALK");
    expect(result.polygons).toHaveLength(3);
    expect(result.polygons[0].cutoffMinutes).toBe(5);
    expect(result.polygons[1].cutoffMinutes).toBe(10);
    expect(result.polygons[2].cutoffMinutes).toBe(15);
    expect(result.polygons[0].geometry.type).toBe("Polygon");
    expect(result.polygons[0].geometry.coordinates).toBeDefined();
    expect(result.polygons[0].geometry.coordinates[0].length).toBeGreaterThan(3);
  });

  test("handles multiple cutoff values in a single request URL", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return jsonResponse(sampleResponse);
    };

    await fetchIsochrones({
      lat: 40.75,
      lon: -73.98,
      mode: "WALK",
      cutoffMinutes: [5, 10, 15],
    });

    expect(capturedUrl).toContain("cutoffSec=300");
    expect(capturedUrl).toContain("cutoffSec=600");
    expect(capturedUrl).toContain("cutoffSec=900");
    expect(capturedUrl).toContain("fromPlace=40.75,-73.98");
    expect(capturedUrl).toContain("mode=WALK");
  });

  test("throws a clear error when OTP is not running (connection refused)", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed: ECONNREFUSED");
    };

    await expect(
      fetchIsochrones({
        lat: 40.75,
        lon: -73.98,
        mode: "WALK",
        cutoffMinutes: [5],
      }),
    ).rejects.toThrow(/Cannot connect to OTP/);
  });

  test("throws a clear error when OTP returns a 4xx status", async () => {
    globalThis.fetch = async () =>
      textResponse("Bad Request: invalid fromPlace", 400);

    await expect(
      fetchIsochrones({
        lat: 40.75,
        lon: -73.98,
        mode: "WALK",
        cutoffMinutes: [5],
      }),
    ).rejects.toThrow(/OTP returned 400/);
  });

  test("retries on transient 500 errors then succeeds", async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount < 3) {
        return textResponse("Internal Server Error", 500);
      }
      return jsonResponse(sampleResponse);
    };

    const result = await fetchIsochrones({
      lat: 40.75,
      lon: -73.98,
      mode: "WALK",
      cutoffMinutes: [5, 10, 15],
    });

    expect(callCount).toBe(3);
    expect(result.polygons).toHaveLength(3);
  });

  test("gives up after max retries on persistent 500 errors", async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return textResponse("Internal Server Error", 500);
    };

    await expect(
      fetchIsochrones({
        lat: 40.75,
        lon: -73.98,
        mode: "WALK",
        cutoffMinutes: [5],
      }),
    ).rejects.toThrow(/OTP returned 500/);

    expect(callCount).toBe(3); // MAX_RETRIES = 3
  });

  test("retries on fetch timeout (AbortError) then succeeds", async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount < 2) {
        const err = new DOMException("The operation was aborted", "AbortError");
        throw err;
      }
      return jsonResponse(sampleResponse);
    };

    const result = await fetchIsochrones({
      lat: 40.75,
      lon: -73.98,
      mode: "WALK",
      cutoffMinutes: [5, 10, 15],
    });

    expect(callCount).toBe(2);
    expect(result.polygons).toHaveLength(3);
  });

  test("does NOT retry on 4xx errors (non-retryable)", async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return textResponse("Not Found", 404);
    };

    await expect(
      fetchIsochrones({
        lat: 40.75,
        lon: -73.98,
        mode: "WALK",
        cutoffMinutes: [5],
      }),
    ).rejects.toThrow(/OTP returned 404/);

    expect(callCount).toBe(1);
  });

  test("throws when OTP returns invalid JSON (not a FeatureCollection)", async () => {
    globalThis.fetch = async () =>
      jsonResponse({ type: "Point", coordinates: [0, 0] });

    await expect(
      fetchIsochrones({
        lat: 40.75,
        lon: -73.98,
        mode: "WALK",
        cutoffMinutes: [5],
      }),
    ).rejects.toThrow(/not a valid GeoJSON FeatureCollection/);
  });

  test("checkHealth returns true when OTP is healthy", async () => {
    globalThis.fetch = async () => new Response("OK", { status: 200 });

    const result = await checkHealth();
    expect(result).toBe(true);
  });

  test("checkHealth returns false when OTP is down", async () => {
    globalThis.fetch = async () => {
      throw new Error("ECONNREFUSED");
    };

    const result = await checkHealth();
    expect(result).toBe(false);
  });

  test("checkHealth returns false when OTP returns non-ok status", async () => {
    globalThis.fetch = async () => new Response("Error", { status: 503 });

    const result = await checkHealth();
    expect(result).toBe(false);
  });

  test("includes date and time in OTP request URL", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return jsonResponse(sampleResponse);
    };

    await fetchIsochrones({
      lat: 40.75,
      lon: -73.98,
      mode: "WALK",
      cutoffMinutes: [5],
      date: "2025-03-15",
      time: "08:30",
    });

    expect(capturedUrl).toContain("date=2025-03-15");
    expect(capturedUrl).toContain("time=08%3A30");
  });

  test("uses default date (next weekday) and time (09:00) when not specified", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return jsonResponse(sampleResponse);
    };

    await fetchIsochrones({
      lat: 40.75,
      lon: -73.98,
      mode: "WALK",
      cutoffMinutes: [5],
    });

    expect(capturedUrl).toMatch(/date=\d{4}-\d{2}-\d{2}/);
    expect(capturedUrl).toContain("time=09%3A00");
  });

  test("correctly extracts cutoffMinutes from feature properties.time", async () => {
    const customResponse = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [[[-73.95, 40.71], [-73.96, 40.72], [-73.95, 40.71]]],
          },
          properties: { time: 420 }, // 7 minutes
        },
      ],
    };

    globalThis.fetch = async () => jsonResponse(customResponse);

    const result = await fetchIsochrones({
      lat: 40.71,
      lon: -73.95,
      mode: "WALK",
      cutoffMinutes: [7],
    });

    expect(result.polygons[0].cutoffMinutes).toBe(7);
  });

  test("falls back to request cutoffMinutes when properties.time is missing", async () => {
    const noTimeResponse = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [[[-73.95, 40.71], [-73.96, 40.72], [-73.95, 40.71]]],
          },
          properties: {},
        },
      ],
    };

    globalThis.fetch = async () => jsonResponse(noTimeResponse);

    const result = await fetchIsochrones({
      lat: 40.71,
      lon: -73.95,
      mode: "WALK",
      cutoffMinutes: [12],
    });

    expect(result.polygons[0].cutoffMinutes).toBe(12);
  });

  test("supports TRANSIT,WALK mode in request", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return jsonResponse(sampleResponse);
    };

    await fetchIsochrones({
      lat: 40.75,
      lon: -73.98,
      mode: "TRANSIT,WALK",
      cutoffMinutes: [15],
    });

    expect(capturedUrl).toContain("mode=TRANSIT,WALK");
  });

  test("uses /otp/routers/default/isochrone endpoint path", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return jsonResponse(sampleResponse);
    };

    await fetchIsochrones({
      lat: 40.75,
      lon: -73.98,
      mode: "WALK",
      cutoffMinutes: [5],
    });

    expect(capturedUrl).toContain("/otp/routers/default/isochrone");
  });

  test("returns correct origin coordinates in response", async () => {
    globalThis.fetch = async () => jsonResponse(sampleResponse);

    const result = await fetchIsochrones({
      lat: 40.12345,
      lon: -73.98765,
      mode: "WALK",
      cutoffMinutes: [5],
    });

    expect(result.origin.lat).toBe(40.12345);
    expect(result.origin.lon).toBe(-73.98765);
  });
});
