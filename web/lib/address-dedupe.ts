/**
 * Dedupe + disambiguate Nominatim address results for display in
 * SearchModal's suggestion list.
 *
 * Nominatim's `display_name` is "most specific first, least specific
 * last" — e.g. "Jefferson Street, Dongan Hills, Staten Island, Richmond
 * County, New York, 10304, United States". Two problems fall out of that
 * for a mobile suggestion row that 2-line-clamps its text:
 *
 *  1. TRUE duplicates: the same physical street is frequently split into
 *     several OSM "way" segments, each geocoded as its own row with a
 *     near-identical display_name and coordinates a few meters apart —
 *     Nominatim itself does not de-dupe these. Left alone, the same street
 *     shows up 2-3 times in a row.
 *  2. Genuinely distinct places (e.g. two different "Jefferson Street"s in
 *     different neighborhoods) share a long common prefix, and the ONE
 *     field that actually distinguishes them — the postal code — sits at
 *     the very end of display_name. Under a 2-line clamp at mobile width,
 *     the zip is exactly what gets truncated away, so two unrelated
 *     streets render as byte-identical text (see the "Jefferson Street,
 *     Dongan Hills, Staten Island, Richmond County, New York," pair this
 *     module was written to fix).
 *
 * This module is the single place that decides what to keep and how to
 * label it, so SearchModal.tsx (and any future consumer) doesn't have to
 * reimplement the truncation-awareness by hand. Mirrors the shape of
 * dedupeStationMatches in SearchModal.tsx: same "collapse true dupes,
 * disambiguate genuine near-misses" goal, applied to Nominatim's data
 * shape instead of SUBWAY_STATIONS'.
 */

import { parseGeo, type NominatimResult } from './geocode';

/** Two results within this radius sharing a leading label are treated as
 *  the same physical place (duplicate OSM way segments for one street),
 *  not two distinct addresses. 50m is comfortably smaller than the
 *  shortest real NYC block (~80m) so it can never merge two actually
 *  different streets that happen to share a name. */
const DEDUPE_RADIUS_METERS = 50;

const EARTH_RADIUS_METERS = 6371000;

export interface AddressSuggestion {
  place_id: number;
  /** Distinguishing display text — see module comment. Guaranteed unique
   *  within one dedupeAndLabelAddresses() call. */
  label: string;
  /** Nominatim's `type` (e.g. "residential", "station") — unchanged,
   *  rendered as-is by the caller; not used for dedupe or labelling. */
  type: string;
  lat: number;
  lon: number;
}

/** Great-circle distance in meters. Good enough at street scale — no need
 *  for anything more precise than the haversine approximation here. */
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
}

/** display_name's first comma-separated segment, normalised for
 *  comparison (Nominatim capitalization is already consistent, but this
 *  guards against a stray case difference between two results anyway). */
function primarySegment(displayName: string): string {
  return (displayName.split(',')[0] ?? '').trim().toLowerCase();
}

function segments(displayName: string): string[] {
  return displayName
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Nominatim always appends "United States" for US results — it never
 *  distinguishes anything, so it's dropped from rebuilt labels. */
function withoutCountry(parts: string[]): string[] {
  return parts.filter((p) => p !== 'United States');
}

/** First 5-digit run in display_name — US ZIP codes. Nominatim puts this
 *  second-to-last (before "United States"), which is exactly the part a
 *  2-line clamp truncates away first; pulling it forward is what makes
 *  two same-named streets in different zips visually distinguishable. */
function extractZip(displayName: string): string | null {
  const m = /\b(\d{5})\b/.exec(displayName);
  return m ? m[1] : null;
}

/**
 * Dedupe true duplicates and build a distinguishing label for every
 * remaining Nominatim result.
 *
 * Invalid/out-of-bounds coordinates are dropped first (via parseGeo) —
 * same rule SearchModal already applied before this module existed, moved
 * here so a NaN/garbage row can't corrupt the distance comparison below.
 */
export function dedupeAndLabelAddresses(results: readonly NominatimResult[]): AddressSuggestion[] {
  const parsed = results
    .map((r) => {
      const geo = parseGeo(r.lat, r.lon);
      return geo ? { r, lat: geo.lat, lon: geo.lon } : null;
    })
    .filter((x): x is { r: NominatimResult; lat: number; lon: number } => x !== null);

  // Step 1 — drop true duplicates. Nominatim already orders by relevance,
  // so keeping the first occurrence in each cluster keeps the more
  // relevant of the near-identical rows.
  const kept: { r: NominatimResult; lat: number; lon: number }[] = [];
  for (const cand of parsed) {
    const candPrimary = primarySegment(cand.r.display_name);
    const isDuplicate = kept.some(
      (k) =>
        primarySegment(k.r.display_name) === candPrimary &&
        haversineMeters(k.lat, k.lon, cand.lat, cand.lon) <= DEDUPE_RADIUS_METERS,
    );
    if (!isDuplicate) kept.push(cand);
  }

  // Step 2 — figure out which surviving primaries are shared by more than
  // one result. Only those need a rebuilt, zip-forward label; a
  // one-of-a-kind street name can keep Nominatim's own display_name as-is.
  const primaryCounts = new Map<string, number>();
  for (const k of kept) {
    const p = primarySegment(k.r.display_name);
    primaryCounts.set(p, (primaryCounts.get(p) ?? 0) + 1);
  }

  // Step 3 — build labels, with a hard-guarantee fallback: if two rebuilt
  // labels still collide (e.g. neither result has a ZIP, or they share
  // one), append the Nominatim place_id — always unique — rather than
  // silently rendering two identical rows. This makes "no two rows share
  // visible text" true by construction, not just true for the cases this
  // module happened to anticipate.
  const seenLabels = new Set<string>();
  const out: AddressSuggestion[] = [];
  for (const k of kept) {
    const primary = (k.r.display_name.split(',')[0] ?? k.r.display_name).trim();
    const isAmbiguous = (primaryCounts.get(primarySegment(k.r.display_name)) ?? 0) > 1;

    let label: string;
    if (isAmbiguous) {
      const zip = extractZip(k.r.display_name);
      const rest = withoutCountry(segments(k.r.display_name).slice(1)).filter((s) => s !== zip);
      label = zip ? `${primary} (${zip}), ${rest.join(', ')}` : k.r.display_name;
    } else {
      label = k.r.display_name;
    }
    if (seenLabels.has(label)) {
      label = `${label} (#${k.r.place_id})`;
    }
    seenLabels.add(label);

    out.push({ place_id: k.r.place_id, label, type: k.r.type, lat: k.lat, lon: k.lon });
  }
  return out;
}
