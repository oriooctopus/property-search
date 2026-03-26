/**
 * HTTP client for OpenTripPlanner (OTP) isochrone API.
 *
 * OTP must be running locally (or at OTP_BASE_URL) with GTFS + OSM data
 * for the NYC metro area loaded.
 *
 * Endpoint: GET /otp/routers/default/isochrone
 * Returns a GeoJSON FeatureCollection with one polygon per cutoff.
 */

import type {
  IsochroneRequest,
  IsochroneResponse,
  IsochronePolygon,
} from "./types";

const OTP_BASE_URL =
  process.env.OTP_BASE_URL ?? "http://localhost:8080";

const ISOCHRONE_PATH = "/otp/routers/default/isochrone";
const HEALTH_PATH = "/otp/routers/default";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1_000;
const REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the next weekday date string (YYYY-MM-DD) from today. */
function nextWeekday(): string {
  const d = new Date();
  const day = d.getDay();
  // 0 = Sun, 6 = Sat — advance to Monday
  if (day === 0) d.setDate(d.getDate() + 1);
  else if (day === 6) d.setDate(d.getDate() + 2);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Fetch with an AbortController timeout. */
async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Sleep for the given number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// OTP GeoJSON response shape
// ---------------------------------------------------------------------------

interface OtpFeature {
  type: "Feature";
  geometry: GeoJSON.Polygon;
  properties: Record<string, unknown>;
}

interface OtpFeatureCollection {
  type: "FeatureCollection";
  features: OtpFeature[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch isochrone polygons from OTP for a single origin point.
 *
 * Handles multiple cutoff values in one request (OTP supports this natively).
 * Retries up to 3 times with exponential backoff on transient failures.
 */
export async function fetchIsochrones(
  request: IsochroneRequest,
): Promise<IsochroneResponse> {
  const date = request.date ?? nextWeekday();
  const time = request.time ?? "09:00";

  // OTP expects cutoffSec repeated for each value
  const cutoffParams = request.cutoffMinutes
    .map((m) => `cutoffSec=${m * 60}`)
    .join("&");

  const url =
    `${OTP_BASE_URL}${ISOCHRONE_PATH}` +
    `?fromPlace=${request.lat},${request.lon}` +
    `&mode=${request.mode}` +
    `&date=${date}` +
    `&time=${encodeURIComponent(time)}` +
    `&${cutoffParams}`;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);

      if (!response.ok) {
        const body = await response.text().catch(() => "(no body)");
        throw new Error(
          `OTP returned ${response.status}: ${body}`,
        );
      }

      const geojson = (await response.json()) as OtpFeatureCollection;

      if (
        !geojson ||
        geojson.type !== "FeatureCollection" ||
        !Array.isArray(geojson.features)
      ) {
        throw new Error(
          "OTP response is not a valid GeoJSON FeatureCollection",
        );
      }

      // OTP returns features in order of ascending cutoff.
      // Each feature's properties may contain { time: <seconds> }.
      const polygons: IsochronePolygon[] = geojson.features.map(
        (feature, index) => ({
          cutoffMinutes:
            typeof feature.properties?.time === "number"
              ? feature.properties.time / 60
              : request.cutoffMinutes[index] ?? 0,
          geometry: feature.geometry,
        }),
      );

      return {
        origin: { lat: request.lat, lon: request.lon },
        mode: request.mode,
        polygons,
      };
    } catch (err) {
      lastError =
        err instanceof Error ? err : new Error(String(err));

      // Abort errors (timeout) or network errors are retryable
      const isRetryable =
        lastError.name === "AbortError" ||
        lastError.message.includes("fetch failed") ||
        lastError.message.includes("ECONNREFUSED") ||
        (lastError.message.includes("OTP returned") &&
          /5\d\d/.test(lastError.message));

      if (!isRetryable || attempt === MAX_RETRIES) break;

      const backoff = INITIAL_BACKOFF_MS * 2 ** (attempt - 1);
      console.warn(
        `[otp-client] Attempt ${attempt}/${MAX_RETRIES} failed, retrying in ${backoff}ms: ${lastError.message}`,
      );
      await sleep(backoff);
    }
  }

  // If we get here, all retries failed
  if (
    lastError?.message.includes("ECONNREFUSED") ||
    lastError?.name === "AbortError"
  ) {
    throw new Error(
      `Cannot connect to OTP at ${OTP_BASE_URL}. Is OpenTripPlanner running? ` +
        `Start it with: java -Xmx4G -jar otp.jar --load ./graphs/nyc`,
    );
  }

  throw lastError ?? new Error("Unknown OTP error");
}

/**
 * Check if OTP is running and healthy.
 */
export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(
      `${OTP_BASE_URL}${HEALTH_PATH}`,
      5_000,
    );
    return response.ok;
  } catch {
    return false;
  }
}
