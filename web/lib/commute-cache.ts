/**
 * 24h-TTL cache wrapper around the Google Directions API.
 *
 * Persists (listing → destination, mode) → minutes lookups in the
 * `commute_cache` Supabase table so repeat lookups don't hammer the
 * Directions API (and don't burn $$ on Google billing). Coordinates are
 * rounded to 4 decimals to keep cache hits high without losing useful
 * precision (~11m at NYC latitude).
 *
 * Server-only — uses the service-role Supabase key to read/write.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import {
  getTransitDuration,
  type DirectionsMode,
} from "./google-directions";

const CACHE_TTL_HOURS = 24;

function roundCoord(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "[commute-cache] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient<Database>(url, key);
}

export interface GetOrFetchCommuteParams {
  listingId: number;
  listingLat: number;
  listingLon: number;
  destLat: number;
  destLon: number;
  mode: DirectionsMode;
}

export interface CommuteResult {
  minutes: number;
  /** True if the value came from the cache; false if freshly fetched. */
  fromCache: boolean;
  /** Encoded polyline if available (only set on fresh fetches). */
  polyline?: string;
}

/**
 * Look up a (listing, destination, mode) commute. If the cache has a fresh
 * (<24h) entry, return it. Otherwise fetch from Google Directions, upsert
 * the result, and return it. Returns `null` when both cache and Google fail.
 */
export async function getOrFetchCommute(
  params: GetOrFetchCommuteParams,
): Promise<CommuteResult | null> {
  const destLat = roundCoord(params.destLat);
  const destLon = roundCoord(params.destLon);

  let supabase: ReturnType<typeof getAdminClient>;
  try {
    supabase = getAdminClient();
  } catch (err) {
    // No Supabase config — fall through to direct fetch (no caching).
    console.error(
      `[commute-cache] no supabase admin client: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return fetchAndReturn(params, destLat, destLon, null);
  }

  // 1. Cache lookup
  const cutoff = new Date(
    Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000,
  ).toISOString();

  const { data: cached, error: lookupErr } = await supabase
    .from("commute_cache")
    .select("duration_minutes, fetched_at")
    .eq("listing_id", params.listingId)
    .eq("dest_lat", destLat)
    .eq("dest_lon", destLon)
    .eq("mode", params.mode)
    .gte("fetched_at", cutoff)
    .maybeSingle();

  if (lookupErr) {
    console.error(`[commute-cache] lookup error: ${lookupErr.message}`);
    // fall through to fetch
  } else if (cached) {
    return {
      minutes: cached.duration_minutes,
      fromCache: true,
    };
  }

  // 2. Cache miss → fetch from Google
  return fetchAndReturn(params, destLat, destLon, supabase);
}

async function fetchAndReturn(
  params: GetOrFetchCommuteParams,
  destLat: number,
  destLon: number,
  supabase: ReturnType<typeof getAdminClient> | null,
): Promise<CommuteResult | null> {
  const result = await getTransitDuration({
    origin: { lat: params.listingLat, lon: params.listingLon },
    destination: { lat: destLat, lon: destLon },
    mode: params.mode,
  });

  if (!result) return null;

  // 3. Upsert into cache (best-effort — don't block on failure)
  if (supabase) {
    const { error: upsertErr } = await supabase
      .from("commute_cache")
      .upsert(
        {
          listing_id: params.listingId,
          dest_lat: destLat,
          dest_lon: destLon,
          mode: params.mode,
          duration_minutes: result.minutes,
          polyline: result.polyline ?? null,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "listing_id,dest_lat,dest_lon,mode" },
      );
    if (upsertErr) {
      console.error(`[commute-cache] upsert error: ${upsertErr.message}`);
    }
  }

  return {
    minutes: result.minutes,
    fromCache: false,
    polyline: result.polyline,
  };
}
