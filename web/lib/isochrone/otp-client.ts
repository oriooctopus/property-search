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
  process.env.OTP_BASE_URL ?? "http://localhost:9090";

const ISOCHRONE_PATH = "/otp/traveltime/isochrone";
const HEALTH_PATH = "/otp/";

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
 * Fetch a single isochrone from OTP with retries.
 */
async function fetchSingleIsochrone(
  url: string,
): Promise<OtpFeatureCollection> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);

      if (!response.ok) {
        const body = await response.text().catch(() => "(no body)");
        throw new Error(`OTP returned ${response.status}: ${body}`);
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

      return geojson;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

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

  if (
    lastError?.message.includes("ECONNREFUSED") ||
    lastError?.name === "AbortError"
  ) {
    throw new Error(
      `Cannot connect to OTP at ${OTP_BASE_URL}. Is OpenTripPlanner running? ` +
        `Start it with: docker compose --profile serve up`,
    );
  }

  throw lastError ?? new Error("Unknown OTP error");
}

/**
 * Fetch isochrone polygons from OTP for a single origin point.
 *
 * OTP 2.5 TravelTime sandbox: one request per cutoff with ISO 8601 duration.
 * Retries up to 3 times with exponential backoff on transient failures.
 */
export async function fetchIsochrones(
  request: IsochroneRequest,
): Promise<IsochroneResponse> {
  const date = request.date ?? nextWeekday();
  const time = request.time ?? "09:00";

  // Mode mapping: WALK -> WALK, TRANSIT,WALK -> TRANSIT, BICYCLE -> BICYCLE
  const otpMode = request.mode === "TRANSIT,WALK" ? "TRANSIT" : request.mode;
  const isoTime = `${date}T${time}:00-04:00`;

  const polygons: IsochronePolygon[] = [];

  for (const minutes of request.cutoffMinutes) {
    const url =
      `${OTP_BASE_URL}${ISOCHRONE_PATH}` +
      `?location=${request.lat},${request.lon}` +
      `&modes=${otpMode}` +
      `&time=${encodeURIComponent(isoTime)}` +
      `&cutoff=PT${minutes}M`;

    const geojson = await fetchSingleIsochrone(url);

    for (const feature of geojson.features) {
      polygons.push({
        cutoffMinutes: minutes,
        geometry: feature.geometry,
      });
    }
  }

  return {
    origin: { lat: request.lat, lon: request.lon },
    mode: request.mode,
    polygons,
  };
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
