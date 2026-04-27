/**
 * Server-side client for Google Maps Directions API.
 *
 * Used by the commute cache + /api/trip-plan to compute transit/walk/bike/drive
 * durations between a listing and a destination. Replaces the self-hosted OTP
 * server, which was overshooting actual transit by ~10 min on average.
 *
 * Requires `GOOGLE_API_KEY` env var (server-side only — never expose to client).
 */

const DIRECTIONS_BASE_URL =
  "https://maps.googleapis.com/maps/api/directions/json";

export type DirectionsMode = "transit" | "walking" | "driving" | "bicycling";

export interface DirectionsResult {
  /** Duration in whole minutes (rounded). */
  minutes: number;
  /** Encoded overview polyline (Google's polyline algorithm). */
  polyline?: string;
}

interface GoogleDirectionsLeg {
  duration?: { value: number; text: string };
  duration_in_traffic?: { value: number; text: string };
}

interface GoogleDirectionsRoute {
  legs: GoogleDirectionsLeg[];
  overview_polyline?: { points: string };
}

interface GoogleDirectionsResponse {
  status: string;
  routes: GoogleDirectionsRoute[];
  error_message?: string;
}

export interface GetTransitDurationParams {
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number };
  mode: DirectionsMode;
  /** Override the API key (defaults to env). Useful for tests. */
  apiKey?: string;
}

/**
 * Calls the Google Directions API and returns the best route's duration.
 *
 * Returns `null` if the API returns no routes, an error status, or if the
 * `GOOGLE_API_KEY` env var is missing. Callers should fall back to a
 * secondary source (e.g. OTP) when this returns null.
 */
export async function getTransitDuration(
  params: GetTransitDurationParams,
): Promise<DirectionsResult | null> {
  const apiKey = params.apiKey ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.error(
      "[google-directions] GOOGLE_API_KEY missing — returning null",
    );
    return null;
  }

  const search = new URLSearchParams({
    origin: `${params.origin.lat},${params.origin.lon}`,
    destination: `${params.destination.lat},${params.destination.lon}`,
    mode: params.mode,
    key: apiKey,
  });
  // departure_time=now is required for transit duration_in_traffic / live data.
  // Drive mode also benefits from it (live traffic). Walk/bike ignore it.
  if (params.mode === "transit" || params.mode === "driving") {
    search.set("departure_time", "now");
  }

  const url = `${DIRECTIONS_BASE_URL}?${search.toString()}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      console.error(
        `[google-directions] HTTP ${res.status} for mode=${params.mode}`,
      );
      return null;
    }

    const data = (await res.json()) as GoogleDirectionsResponse;
    if (data.status !== "OK") {
      // ZERO_RESULTS is normal (e.g. no transit at this hour) — log quieter.
      if (data.status === "ZERO_RESULTS") {
        return null;
      }
      console.error(
        `[google-directions] status=${data.status} mode=${params.mode}: ${
          data.error_message ?? "(no message)"
        }`,
      );
      return null;
    }

    const route = data.routes[0];
    if (!route || !route.legs || route.legs.length === 0) return null;

    const leg = route.legs[0];
    const seconds =
      leg.duration_in_traffic?.value ?? leg.duration?.value ?? null;
    if (seconds == null) return null;

    return {
      minutes: Math.max(1, Math.round(seconds / 60)),
      polyline: route.overview_polyline?.points,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("aborted") || msg.includes("AbortError")) {
      console.error(
        `[google-directions] timeout for mode=${params.mode}`,
      );
    } else {
      console.error(`[google-directions] error mode=${params.mode}: ${msg}`);
    }
    return null;
  }
}
