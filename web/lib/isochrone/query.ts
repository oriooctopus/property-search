/**
 * PostGIS query functions for isochrone lookups.
 *
 * These run SQL via the Supabase client to find which isochrone polygons
 * contain a given point (listing location), enabling "how far to the
 * nearest subway?" queries without calling Google Maps every time.
 */

import { createClient } from "@supabase/supabase-js";
import type { StationProximity, SubwayStation, IsochroneInfo } from "./types";
import SUBWAY_STATIONS from "./subway-stations";

// ---------------------------------------------------------------------------
// Supabase admin client
// ---------------------------------------------------------------------------

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars",
    );
  }

  return createClient(url, key);
}

// ---------------------------------------------------------------------------
// Station lookup helper
// ---------------------------------------------------------------------------

const stationsByStopId = new Map<string, SubwayStation>(
  SUBWAY_STATIONS.map((s) => [s.stopId, s]),
);

function lookupStation(stopId: string, name: string): SubwayStation {
  return (
    stationsByStopId.get(stopId) ?? {
      stopId,
      name,
      lat: 0,
      lon: 0,
      lines: [],
    }
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find the nearest subway stations to a point by checking which walk
 * isochrone polygons contain it. Returns results sorted by walk time
 * (ascending), picking only the smallest (tightest) band per station.
 *
 * @param lat  Listing latitude
 * @param lon  Listing longitude
 * @param maxWalkMinutes  Only consider isochrones up to this many minutes (default 15)
 */
export async function getNearestSubwayStations(
  lat: number,
  lon: number,
  maxWalkMinutes = 15,
): Promise<StationProximity[]> {
  const supabase = getAdminClient();

  // Use the PostGIS function ST_Contains to find all isochrones containing the point.
  // We call the Supabase RPC wrapper `find_containing_isochrones` which must exist
  // in the DB (see migration).
  const { data, error } = await supabase.rpc("find_containing_isochrones", {
    p_lat: lat,
    p_lon: lon,
    p_mode: "WALK",
    p_max_minutes: maxWalkMinutes,
  });

  if (error) {
    throw new Error(`find_containing_isochrones failed: ${error.message}`);
  }

  if (!data || !Array.isArray(data) || data.length === 0) {
    return [];
  }

  // Group by station, keep the smallest cutoff (tightest polygon)
  const bestPerStation = new Map<
    string,
    { stopId: string; name: string; cutoff: number }
  >();

  for (const row of data) {
    const stopId = row.station_stop_id as string;
    const cutoff = row.cutoff_minutes as number;
    const existing = bestPerStation.get(stopId);
    if (!existing || cutoff < existing.cutoff) {
      bestPerStation.set(stopId, {
        stopId,
        name: row.station_name as string,
        cutoff,
      });
    }
  }

  // Sort by walk time ascending
  const sorted = Array.from(bestPerStation.values()).sort(
    (a, b) => a.cutoff - b.cutoff,
  );

  return sorted.map((s) => ({
    station: lookupStation(s.stopId, s.name),
    walkMinutes: s.cutoff,
  }));
}

/**
 * Get all isochrone bands a listing falls within.
 * Returns info about every isochrone polygon that contains the listing's location.
 */
export async function getListingIsochrones(
  listingId: number,
): Promise<IsochroneInfo[]> {
  const supabase = getAdminClient();

  const { data, error } = await supabase.rpc("get_listing_isochrones", {
    p_listing_id: listingId,
  });

  if (error) {
    throw new Error(`get_listing_isochrones failed: ${error.message}`);
  }

  if (!data || !Array.isArray(data)) return [];

  return data.map((row) => ({
    isochroneId: row.isochrone_id as number,
    stationStopId: row.station_stop_id as string,
    stationName: row.station_name as string,
    cutoffMinutes: row.cutoff_minutes as number,
    mode: row.mode as string,
  }));
}

/**
 * Get all listing IDs that fall within a given isochrone polygon.
 */
export async function getListingsInIsochrone(
  isochroneId: number,
): Promise<number[]> {
  const supabase = getAdminClient();

  const { data, error } = await supabase.rpc("get_listings_in_isochrone", {
    p_isochrone_id: isochroneId,
  });

  if (error) {
    throw new Error(`get_listings_in_isochrone failed: ${error.message}`);
  }

  if (!data || !Array.isArray(data)) return [];

  return data.map((row) => row.listing_id as number);
}

/**
 * Enrich a single listing with isochrone data by finding which isochrone
 * polygons contain it and inserting into the `listing_isochrones` junction table.
 */
export async function enrichListingWithIsochrones(
  listingId: number,
  lat: number,
  lon: number,
): Promise<void> {
  const supabase = getAdminClient();

  const { error } = await supabase.rpc("enrich_listing_isochrones", {
    p_listing_id: listingId,
    p_lat: lat,
    p_lon: lon,
  });

  if (error) {
    throw new Error(`enrich_listing_isochrones failed: ${error.message}`);
  }
}

/**
 * Efficiently enrich multiple listings at once using a single SQL call.
 * Much faster than calling enrichListingWithIsochrones in a loop.
 */
export async function batchEnrichListings(
  listings: Array<{ id: number; lat: number; lon: number }>,
): Promise<void> {
  if (listings.length === 0) return;

  const supabase = getAdminClient();

  // Pass listings as a JSON array to a single RPC call
  const { error } = await supabase.rpc("batch_enrich_listing_isochrones", {
    p_listings: listings.map((l) => ({
      listing_id: l.id,
      lat: l.lat,
      lon: l.lon,
    })),
  });

  if (error) {
    throw new Error(
      `batch_enrich_listing_isochrones failed: ${error.message}`,
    );
  }
}
