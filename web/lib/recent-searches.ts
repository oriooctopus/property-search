/**
 * Validation + shaping for the "recent location searches" feature.
 *
 * Pulled out of the API route (app/api/recent-searches/route.ts) so the
 * request-body validation is testable as a pure function without booting a
 * route handler — see tests/recent-searches.test.ts.
 */

export const RECENT_SEARCH_KINDS = ["station", "address"] as const;
export type RecentSearchKind = (typeof RECENT_SEARCH_KINDS)[number];

/** Max rows returned by GET — matches the API contract ("max 8"). */
export const MAX_RECENT_SEARCHES = 8;

/** Labels are truncated rather than rejected outright once past this length. */
export const MAX_LABEL_LENGTH = 200;

export interface RecentSearch {
  id: string;
  label: string;
  sublabel: string | null;
  lat: number;
  lon: number;
  kind: RecentSearchKind;
  createdAt: string;
}

export type ValidatedRecentSearchInput = {
  label: string;
  sublabel: string | null;
  lat: number;
  lon: number;
  kind: RecentSearchKind;
};

export type ValidationResult =
  | { ok: true; value: ValidatedRecentSearchInput }
  | { ok: false; error: string };

/**
 * Coerce a POST body value to a finite number.
 *
 * Numeric strings ("40.7") are accepted — the UI may pass values straight out
 * of URL params or geocoder JSON, which arrive as strings. `Number()` (not
 * `parseFloat`) is used so trailing garbage ("40.7abc") is rejected rather
 * than silently truncated, and `""`/whitespace-only strings (which `Number`
 * would otherwise coerce to 0) are rejected explicitly.
 */
function coerceFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    if (value.trim() === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Validates and normalizes a raw POST /api/recent-searches body.
 *
 * This is the system boundary — untrusted client input is checked here once,
 * and everything downstream (the DB insert) can assume valid shape. No
 * defensive re-checking belongs in the route handler beyond calling this.
 */
export function validateRecentSearchInput(
  body: unknown,
): ValidationResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Request body must be an object" };
  }
  const b = body as Record<string, unknown>;

  const rawLabel = b.label;
  if (typeof rawLabel !== "string" || rawLabel.trim().length === 0) {
    return { ok: false, error: "label is required and must be non-empty" };
  }
  const label = rawLabel.trim().slice(0, MAX_LABEL_LENGTH);

  let sublabel: string | null = null;
  if (b.sublabel !== undefined && b.sublabel !== null) {
    if (typeof b.sublabel !== "string") {
      return { ok: false, error: "sublabel must be a string or null" };
    }
    const trimmed = b.sublabel.trim();
    sublabel = trimmed.length > 0 ? trimmed.slice(0, MAX_LABEL_LENGTH) : null;
  }

  const lat = coerceFiniteNumber(b.lat);
  if (lat === null || lat < -90 || lat > 90) {
    return { ok: false, error: "lat must be a finite number in [-90, 90]" };
  }

  const lon = coerceFiniteNumber(b.lon);
  if (lon === null || lon < -180 || lon > 180) {
    return { ok: false, error: "lon must be a finite number in [-180, 180]" };
  }

  if (
    typeof b.kind !== "string" ||
    !RECENT_SEARCH_KINDS.includes(b.kind as RecentSearchKind)
  ) {
    return {
      ok: false,
      error: `kind must be one of: ${RECENT_SEARCH_KINDS.join(", ")}`,
    };
  }
  const kind = b.kind as RecentSearchKind;

  return { ok: true, value: { label, sublabel, lat, lon, kind } };
}

/** Caps and orders a list of recent searches per the API contract (newest first, max 8). */
export function capRecentSearches(rows: RecentSearch[]): RecentSearch[] {
  return rows.slice(0, MAX_RECENT_SEARCHES);
}
