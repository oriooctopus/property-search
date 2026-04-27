'use client';

/**
 * Per-listing destination commute lookup.
 *
 * Given saved destinations (1 or more) + a list of listings, fetches the
 * trip-plan total minutes for each (listing → destination) pair via
 * /api/trip-plan and exposes a Map<listingId, DestinationCommute[]> — one
 * commute entry per saved destination, in the same order as the destinations
 * array.
 *
 * Throttled to a small concurrency cap so the OTP server isn't blasted with
 * 50 simultaneous requests when the user first sets a destination. Results
 * are cached in-memory keyed by `${listingId}:${destinationCacheKey}` so
 * panning the map / scrolling the list doesn't recompute anything that's
 * already been resolved.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  destinationCacheKey,
  destinationCoords,
  destinationOtpMode,
  type SavedDestination,
} from './useSavedDestination';

export interface DestinationCommute {
  /** Total minutes to destination, or null while loading / on error. */
  minutes: number | null;
  /** Walk / transit / bike — mirrors the user's requested mode. */
  mode: 'walk' | 'transit' | 'bike';
  /** True while the OTP fetch is in flight. */
  loading: boolean;
  /** True if OTP returned an error or the listing has no coords. */
  errored: boolean;
}

interface ListingLike {
  id: number;
  lat?: number | null;
  lon?: number | null;
}

const CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 25_000;

// Module-level cache so the data survives component re-mounts and view
// switches (list ↔ map ↔ swipe). Keyed by `${listingId}:${destCacheKey}`.
const cache = new Map<string, DestinationCommute>();

// Subscribers (per-listing readers) — each card re-renders when its own
// cache entry resolves, without re-rendering all the others.
const subscribers = new Map<string, Set<() => void>>();

function notifyKey(key: string) {
  const subs = subscribers.get(key);
  if (!subs) return;
  for (const fn of subs) fn();
}

function subscribeKey(key: string, cb: () => void): () => void {
  let set = subscribers.get(key);
  if (!set) {
    set = new Set();
    subscribers.set(key, set);
  }
  set.add(cb);
  return () => {
    const s = subscribers.get(key);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) subscribers.delete(key);
  };
}

async function fetchOne(
  listingId: number,
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  mode: string,
  signal: AbortSignal,
): Promise<number | null> {
  const params = new URLSearchParams({
    fromLat: String(fromLat),
    fromLon: String(fromLon),
    toLat: String(toLat),
    toLon: String(toLon),
    mode,
    // Opt into the cached, summary-only path — we only need totalDuration.
    summary: '1',
    listingId: String(listingId),
  });
  const res = await fetch(`/api/trip-plan?${params}`, { signal });
  if (!res.ok) return null;
  const data = (await res.json()) as { totalDuration?: number; error?: string };
  if (data.error || data.totalDuration == null) return null;
  return data.totalDuration;
}

/**
 * Fetch commute data for every (listing, destination) pair. Returns a
 * Map<listingId, DestinationCommute[]> where the inner array mirrors the
 * order of the `destinations` argument.
 */
export function useDestinationCommutes(
  listings: ListingLike[],
  destinations: SavedDestination[],
): Map<number, DestinationCommute[]> {
  const [, force] = useState(0);
  const inflightKeysRef = useRef<Set<string>>(new Set());

  // Pre-compute resolution data per destination
  const destMeta = useMemo(() => {
    return destinations.map((d) => ({
      destination: d,
      cacheKey: destinationCacheKey(d),
      coords: destinationCoords(d),
      mode: (d.mode ?? 'walk') as 'walk' | 'transit' | 'bike',
      otpMode: destinationOtpMode(d),
    }));
  }, [destinations]);

  // The Map returned to the consumer — built fresh from the module cache on
  // every render so React sees identity changes when entries fill in.
  const result = useMemo(() => {
    const out = new Map<number, DestinationCommute[]>();
    if (destMeta.length === 0) return out;
    for (const l of listings) {
      const arr: DestinationCommute[] = destMeta.map((meta) => {
        if (!meta.cacheKey || !meta.coords) {
          return { minutes: null, mode: meta.mode, loading: false, errored: true };
        }
        if (l.lat == null || l.lon == null) {
          return { minutes: null, mode: meta.mode, loading: false, errored: true };
        }
        const key = `${l.id}:${meta.cacheKey}`;
        const cached = cache.get(key);
        if (cached) return cached;
        return { minutes: null, mode: meta.mode, loading: true, errored: false };
      });
      out.set(l.id, arr);
    }
    return out;
  }, [listings, destMeta]);

  // Schedule fetches for any (listing, destination) pair that doesn't have a
  // cached entry yet. Concurrency is capped across the whole queue (not per
  // destination) so two destinations × 50 listings still pumps at 4-wide.
  useEffect(() => {
    if (destMeta.length === 0) return;
    const ac = new AbortController();
    let cancelled = false;

    interface QueueItem {
      listing: ListingLike;
      destLat: number;
      destLon: number;
      otpMode: string;
      mode: 'walk' | 'transit' | 'bike';
      key: string;
    }

    const queue: QueueItem[] = [];
    for (const meta of destMeta) {
      if (!meta.cacheKey || !meta.coords) continue;
      for (const l of listings) {
        if (l.lat == null || l.lon == null) continue;
        const key = `${l.id}:${meta.cacheKey}`;
        if (cache.has(key)) continue;
        if (inflightKeysRef.current.has(key)) continue;
        queue.push({
          listing: l,
          destLat: meta.coords.lat,
          destLon: meta.coords.lon,
          otpMode: meta.otpMode,
          mode: meta.mode,
          key,
        });
      }
    }
    if (queue.length === 0) return;

    let active = 0;
    let idx = 0;

    function pump() {
      if (cancelled) return;
      while (active < CONCURRENCY && idx < queue.length) {
        const item = queue[idx++];
        inflightKeysRef.current.add(item.key);
        active++;
        const timeoutId = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
        fetchOne(
          item.listing.id,
          item.listing.lat as number,
          item.listing.lon as number,
          item.destLat,
          item.destLon,
          item.otpMode,
          ac.signal,
        )
          .then((minutes) => {
            cache.set(item.key, {
              minutes,
              mode: item.mode,
              loading: false,
              errored: minutes == null,
            });
            notifyKey(item.key);
          })
          .catch(() => {
            cache.set(item.key, {
              minutes: null,
              mode: item.mode,
              loading: false,
              errored: true,
            });
            notifyKey(item.key);
          })
          .finally(() => {
            clearTimeout(timeoutId);
            inflightKeysRef.current.delete(item.key);
            active--;
            if (cancelled) return;
            // Trigger a re-render so the consumer Map updates loading flags
            force((n) => n + 1);
            pump();
          });
      }
    }
    pump();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [listings, destMeta]);

  return result;
}

/**
 * Per-listing reader. Subscribes to cache changes for a single listing
 * across ALL saved destinations. Used by SwipeCard / ListingCard so they
 * re-render only their own chip(s), not the whole grid, when commute info
 * resolves.
 *
 * Returns an array (one entry per destination) or `null` when no
 * destinations are saved or no listing was provided. Returns placeholder
 * `loading: true` entries when lookups are pending — note that the actual
 * fetch must be triggered elsewhere (via `useDestinationCommutes` mounted at
 * the page level) since per-card readers never start their own OTP burst.
 */
export function useListingDestinationCommutes(
  listing: { id: number; lat?: number | null; lon?: number | null } | null | undefined,
  destinations: SavedDestination[],
): DestinationCommute[] | null {
  const [, force] = useState(0);

  // Build subscription keys (one per destination) and re-subscribe whenever
  // the destination set or the listing identity changes.
  const keys = useMemo(() => {
    if (!listing) return [];
    return destinations.map((d) => {
      const ck = destinationCacheKey(d);
      return ck ? `${listing.id}:${ck}` : null;
    });
  }, [listing, destinations]);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    for (const k of keys) {
      if (!k) continue;
      unsubs.push(subscribeKey(k, () => force((n) => n + 1)));
    }
    return () => {
      for (const u of unsubs) u();
    };
  }, [keys]);

  if (!listing || destinations.length === 0) return null;

  return destinations.map((d, i) => {
    const ck = destinationCacheKey(d);
    const coords = destinationCoords(d);
    const mode = (d.mode ?? 'walk') as 'walk' | 'transit' | 'bike';
    if (!ck || !coords) {
      return { minutes: null, mode, loading: false, errored: true };
    }
    if (listing.lat == null || listing.lon == null) {
      return { minutes: null, mode, loading: false, errored: true };
    }
    const key = keys[i];
    const cached = key ? cache.get(key) : undefined;
    if (cached) return cached;
    return { minutes: null, mode, loading: true, errored: false };
  });
}

/**
 * @deprecated Single-destination reader retained for backward compatibility.
 * Prefer `useListingDestinationCommutes` (plural). Returns the first
 * destination's commute, or null.
 */
export function useListingDestinationCommute(
  listing: { id: number; lat?: number | null; lon?: number | null } | null | undefined,
  destination: SavedDestination | null,
): DestinationCommute | null {
  const arr = useListingDestinationCommutes(
    listing,
    destination ? [destination] : [],
  );
  return arr && arr.length > 0 ? arr[0] : null;
}

/** For tests / dev: clear the in-memory commute cache. */
export function _clearDestinationCommuteCache(): void {
  cache.clear();
}
