'use client';

/**
 * Per-listing destination commute lookup.
 *
 * Given a saved destination + a list of listings, fetches the trip-plan
 * total minutes for each (listing → destination) pair via /api/trip-plan and
 * exposes a Map<listingId, { minutes, mode }>.
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
// switches (list ↔ map ↔ swipe).
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
  });
  const res = await fetch(`/api/trip-plan?${params}`, { signal });
  if (!res.ok) return null;
  const data = (await res.json()) as { totalDuration?: number; error?: string };
  if (data.error || data.totalDuration == null) return null;
  return data.totalDuration;
}

export function useDestinationCommutes(
  listings: ListingLike[],
  destination: SavedDestination | null,
): Map<number, DestinationCommute> {
  const [, force] = useState(0);
  const inflightKeysRef = useRef<Set<string>>(new Set());

  const cacheKey = destinationCacheKey(destination);
  const coords = useMemo(() => destinationCoords(destination), [destination]);
  const mode = (destination?.mode ?? 'walk') as 'walk' | 'transit' | 'bike';
  const otpMode = destinationOtpMode(destination);

  // The Map returned to the consumer — built fresh from the module cache on
  // every render so React sees identity changes when entries fill in.
  const result = useMemo(() => {
    const out = new Map<number, DestinationCommute>();
    if (!destination || !cacheKey || !coords) return out;
    for (const l of listings) {
      const key = `${l.id}:${cacheKey}`;
      const cached = cache.get(key);
      if (cached) {
        out.set(l.id, cached);
      } else if (l.lat == null || l.lon == null) {
        out.set(l.id, { minutes: null, mode, loading: false, errored: true });
      } else {
        out.set(l.id, { minutes: null, mode, loading: true, errored: false });
      }
    }
    return out;
  }, [listings, destination, cacheKey, coords, mode]);

  // Schedule fetches for any listing that doesn't have a cached entry yet.
  useEffect(() => {
    if (!destination || !cacheKey || !coords) return;
    const ac = new AbortController();
    let cancelled = false;

    // Build the work queue
    const queue: ListingLike[] = [];
    for (const l of listings) {
      if (l.lat == null || l.lon == null) continue;
      const key = `${l.id}:${cacheKey}`;
      if (cache.has(key)) continue;
      if (inflightKeysRef.current.has(key)) continue;
      queue.push(l);
    }
    if (queue.length === 0) return;

    let active = 0;
    let idx = 0;

    function pump() {
      if (cancelled) return;
      while (active < CONCURRENCY && idx < queue.length) {
        const l = queue[idx++];
        const key = `${l.id}:${cacheKey}`;
        inflightKeysRef.current.add(key);
        active++;
        const timeoutId = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
        fetchOne(l.lat as number, l.lon as number, coords!.lat, coords!.lon, otpMode, ac.signal)
          .then((minutes) => {
            cache.set(key, {
              minutes,
              mode,
              loading: false,
              errored: minutes == null,
            });
            notifyKey(key);
          })
          .catch(() => {
            cache.set(key, { minutes: null, mode, loading: false, errored: true });
            notifyKey(key);
          })
          .finally(() => {
            clearTimeout(timeoutId);
            inflightKeysRef.current.delete(key);
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
  }, [listings, destination, cacheKey, coords, mode, otpMode]);

  return result;
}

/**
 * Per-listing reader. Subscribes to cache changes for a single listing+
 * destination combo. Used by SwipeCard / ListingCard so they re-render only
 * their own chip, not the whole grid, when commute info resolves.
 *
 * Returns `null` when no destination is set or when the listing has no
 * coordinates. Returns a placeholder `loading: true` entry when the lookup
 * is pending — note that the actual fetch must be triggered elsewhere (via
 * `useDestinationCommutes` mounted at the page level) since per-card readers
 * never start their own OTP burst.
 */
export function useListingDestinationCommute(
  listing: { id: number; lat?: number | null; lon?: number | null } | null | undefined,
  destination: SavedDestination | null,
): DestinationCommute | null {
  const cacheKey = destinationCacheKey(destination);
  const coords = destination ? destinationCoords(destination) : null;
  const key = listing && cacheKey ? `${listing.id}:${cacheKey}` : null;
  const [, force] = useState(0);

  useEffect(() => {
    if (!key) return;
    return subscribeKey(key, () => force((n) => n + 1));
  }, [key]);

  if (!destination || !cacheKey || !coords || !listing) return null;
  if (listing.lat == null || listing.lon == null) {
    return { minutes: null, mode: destination.mode, loading: false, errored: true };
  }
  const cached = cache.get(`${listing.id}:${cacheKey}`);
  if (cached) return cached;
  return { minutes: null, mode: destination.mode, loading: true, errored: false };
}

/** For tests / dev: clear the in-memory commute cache. */
export function _clearDestinationCommuteCache(): void {
  cache.clear();
}
