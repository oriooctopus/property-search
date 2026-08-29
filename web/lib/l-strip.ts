/**
 * Always-on server-side location gate for the listings search API.
 *
 * Product rule: every listing returned by /api/listings/search (outside
 * wishlist mode — the user must still see everything they saved) must fall
 * within a 12-minute WALK isochrone of one of the 8 L-train stops from
 * Bedford Av to DeKalb Av. This is not a user-facing filter toggle — it's a
 * hard gate on the whole endpoint.
 *
 * The 8 stations are identified by GTFS stopId (not name — several of these
 * station *names* collide with stops on other lines elsewhere in the
 * system, e.g. "Grand St" also exists on the B/D in Manhattan, "DeKalb Av"
 * on the B/Q/R in downtown Brooklyn). We disambiguate purely by coordinate
 * (see `isNearStation`), not by name.
 *
 * IMPORTANT, found live: `isochrones.origin_name` is NOT a reliable key for
 * these stations. The table holds parallel generation runs with different
 * naming conventions for the same physical station (e.g. "Bedford Av" vs
 * "Bedford Ave"), and — critically — for the two colliding names the PLAIN
 * name belongs to the OTHER borough's station while the L-train row is
 * suffixed, e.g. "Grand St" (id 1559 lives under "Grand St (L)") is the
 * Manhattan B/D stop at 40.718267,-73.993753, and "DeKalb Av" is the B/Q/R
 * stop at 40.690635,-73.981824 — the correct L-train row is
 * "DeKalb Ave (L)" at 40.7035,-73.9183. Querying `.in("origin_name", [...])`
 * with the plain names (as originally designed) therefore SQL-filters the
 * correct rows out before they ever reach the coordinate check, and the
 * zero-match invariant below fires for a station that actually has a walk
 * isochrone — just under an unexpected name. Fix: fetch every walk/12
 * isochrone row (428 rows live, cheap) and let `isNearStation` do 100% of
 * the disambiguation. origin_name is no longer used as a filter at all —
 * only for the thrown error message.
 */

import SUBWAY_STATIONS from "@/lib/isochrone/subway-stations";
import type { SubwayStation } from "@/lib/isochrone/types";

export const L_STRIP_STOP_IDS = [
  "L08", // Bedford Av
  "L10", // Lorimer St
  "L11", // Graham Av
  "L12", // Grand St
  "L13", // Montrose Av
  "L14", // Morgan Av
  "L15", // Jefferson St
  "L16", // DeKalb Av
] as const;

export const L_STRIP_MAX_WALK_MINUTES = 12;

// Degrees. ~0.002 deg is ~220m at NYC latitude — comfortably wider than any
// floating-point/rounding drift between subway-stations.ts and the isochrone
// rows' stored origin_lat/origin_lon, while still narrow enough to reject a
// same-named station in a different part of the city (the closest such
// collision, DeKalb Av B/Q/R, is ~1.3km away).
export const L_STRIP_COORD_TOLERANCE = 0.002;

export interface IsochroneRow {
  id: number;
  origin_name: string;
  origin_lat: number;
  origin_lon: number;
  travel_mode: string;
  cutoff_minutes: number;
}

/** The 8 L-strip stations, resolved from subway-stations.ts by stopId. */
export function lStripStations(): SubwayStation[] {
  const byStopId = new Map(SUBWAY_STATIONS.map((s) => [s.stopId, s]));
  return L_STRIP_STOP_IDS.map((stopId) => {
    const station = byStopId.get(stopId);
    if (!station) {
      throw new Error(`l-strip: stopId ${stopId} not found in subway-stations.ts`);
    }
    return station;
  });
}

function isNearStation(row: IsochroneRow, station: SubwayStation): boolean {
  return (
    Math.abs(row.origin_lat - station.lat) <= L_STRIP_COORD_TOLERANCE &&
    Math.abs(row.origin_lon - station.lon) <= L_STRIP_COORD_TOLERANCE
  );
}

/**
 * Pure selection logic: given raw isochrone rows (any origin_name — NOT
 * pre-filtered by station, see module header — and not yet checked for
 * mode/cutoff), return the ids of the rows that are the genuine 12-minute
 * walk isochrone for one of the 8 L-strip stations, disambiguated purely by
 * coordinate.
 *
 * Invariant: every one of the 8 stations MUST have exactly one matching row
 * in a healthy DB. If a station ends up with zero matches (e.g. the walk
 * isochrone for that station was never generated, or got deleted), we THROW
 * rather than silently return a gate that's missing a station — a shrunk
 * gate would silently exclude an entire station's walkshed for what looks
 * like an unrelated data problem, and a widened/no-op gate is the failure
 * mode this whole feature exists to prevent.
 */
export function selectLStripIsochroneIds(
  rows: IsochroneRow[],
  stations: SubwayStation[] = lStripStations(),
): number[] {
  const candidateRows = rows.filter(
    (r) => r.travel_mode.toLowerCase() === "walk" && r.cutoff_minutes === L_STRIP_MAX_WALK_MINUTES,
  );

  const ids = new Set<number>();
  for (const station of stations) {
    const matches = candidateRows.filter((r) => isNearStation(r, station));
    if (matches.length === 0) {
      throw new Error(
        `l-strip: no ${L_STRIP_MAX_WALK_MINUTES}-minute walk isochrone found for station "${station.name}" (${station.stopId})`,
      );
    }
    for (const m of matches) ids.add(m.id);
  }

  return [...ids].sort((a, b) => a - b);
}

// Isochrones only change when regenerated (an infrequent offline batch job),
// so re-resolving on every search request is wasted DB round-trips. Cache
// the resolved id list for an hour.
const CACHE_TTL_MS = 60 * 60 * 1000;
let cache: { ids: number[]; expiresAt: number } | null = null;

/** Test-only: clear the module-level cache so each test starts fresh. */
export function resetLStripCache(): void {
  cache = null;
}

// Supabase query builder type is complex; use `any` locally to avoid
// fighting the chain-style return types from the SDK (matches the existing
// pattern in route.ts / commute-resolver.ts).
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function resolveLStripIsochroneIds(supabase: any): Promise<number[]> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.ids;
  }

  const stations = lStripStations();

  // Deliberately NOT filtered by origin_name — see the module header comment
  // for why that silently drops the correct row for the Grand St / DeKalb Av
  // collisions. cutoff_minutes + travel_mode narrows this to ~400 rows
  // (measured live), cheap to fetch whole; isNearStation does the rest.
  const { data, error } = await supabase
    .from("isochrones")
    .select("id, origin_name, origin_lat, origin_lon, travel_mode, cutoff_minutes")
    .ilike("travel_mode", "walk")
    .eq("cutoff_minutes", L_STRIP_MAX_WALK_MINUTES);

  if (error) {
    throw new Error(`l-strip: isochrones query failed: ${error.message}`);
  }

  const ids = selectLStripIsochroneIds((data ?? []) as IsochroneRow[], stations);
  cache = { ids, expiresAt: Date.now() + CACHE_TTL_MS };
  return ids;
}
