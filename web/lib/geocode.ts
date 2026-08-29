/**
 * Client-side address geocoding via Nominatim (OpenStreetMap's free search
 * API). Extracted from Filters.tsx so the same lookup can be shared with
 * StationSearchBox (map-search empty-state box) without copy-pasting the
 * fetch/params — the two call sites must stay byte-identical or their
 * autocomplete results will silently diverge over time.
 */

export interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type: string;
  class: string;
}

/**
 * Look up free-text address matches, biased to the NYC metro area.
 *
 * `bounded: '1'` + `viewbox` restrict results to the metro bounding box
 * rather than merely preferring it — without `bounded`, Nominatim treats
 * the viewbox as a soft hint and still returns far-away matches for common
 * street names ("Jefferson St" exists in dozens of US cities).
 *
 * Pass an AbortSignal so callers can cancel a stale in-flight request when
 * the query changes again before this one resolves (both call sites debounce
 * ~250-300ms, but a slow network can still let two requests overlap).
 */
export async function fetchNominatimSuggestions(
  query: string,
  signal?: AbortSignal,
): Promise<NominatimResult[]> {
  if (!query.trim()) return [];
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    countrycodes: 'us',
    viewbox: '-74.3,40.4,-73.6,40.95',
    bounded: '1',
    limit: '5',
  });
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
    {
      signal,
      headers: { 'User-Agent': 'Dwelligence/1.0' },
    },
  );
  if (!res.ok) throw new Error('Nominatim request failed');
  return res.json();
}

/**
 * Nominatim returns lat/lon as strings and, for a malformed or unexpected
 * result, could hand back non-finite values or a lat/lon swap. Parse and
 * sanity-bound to roughly the NYC metro region (the API call is already
 * viewbox-restricted there) so a bad row can never center the map on
 * (0, 0) or the wrong hemisphere instead of silently being dropped.
 *
 * Exported (moved here from SearchModal.tsx) so lib/address-dedupe.ts can
 * share the exact same parse/validity rules — a suggestion that SearchModal
 * would refuse to render must also be excluded before the dedupe/distance
 * math runs, or a NaN coordinate could poison a "within 50m" comparison.
 */
export function parseGeo(latStr: string, lonStr: string): { lat: number; lon: number } | null {
  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat === 0 && lon === 0) return null;
  if (lat < 38 || lat > 43 || lon < -76 || lon > -71) return null;
  return { lat, lon };
}
