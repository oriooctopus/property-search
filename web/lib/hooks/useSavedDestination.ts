'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CommuteRule } from '@/components/Filters';
import { PARK_COORDS } from '@/lib/park-coords';
import SUBWAY_STATIONS from '@/lib/isochrone/subway-stations';

const STORAGE_KEY = 'dwelligence.preferredDestination';
const EVENT_NAME = 'dwelligence:preferredDestinationChanged';

/** Maximum number of destinations a user can save at once. */
export const MAX_DESTINATIONS = 2;

/**
 * A single saved destination is just a CommuteRule (same shape as the existing
 * commute filter rule). Stored in localStorage for now (per-device); cross-
 * device sync is a follow-up.
 */
export type SavedDestination = CommuteRule;

/**
 * Storage shape (versioned). v2 stores an array of up to MAX_DESTINATIONS
 * destinations. v1 stored a single object — we migrate transparently on read.
 */
interface StoredV2 {
  v: 2;
  destinations: SavedDestination[];
}

function ensureMode(d: SavedDestination): SavedDestination {
  // Backward-compat: older saved destinations predate the `mode` field —
  // default to 'walk' so the destination chip's commute lookup has a mode.
  if (!d.mode) {
    return { ...d, mode: 'walk' };
  }
  return d;
}

function isValidDestination(x: unknown): x is SavedDestination {
  if (!x || typeof x !== 'object') return false;
  const d = x as { type?: unknown };
  return typeof d.type === 'string';
}

function readFromStorage(): SavedDestination[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;

    // v2 array shape
    if (
      parsed &&
      typeof parsed === 'object' &&
      'v' in (parsed as Record<string, unknown>) &&
      (parsed as { v: unknown }).v === 2 &&
      Array.isArray((parsed as StoredV2).destinations)
    ) {
      const arr = (parsed as StoredV2).destinations
        .filter(isValidDestination)
        .slice(0, MAX_DESTINATIONS)
        .map(ensureMode);
      return arr;
    }

    // v1 single-object shape — migrate to a 1-element array
    if (isValidDestination(parsed)) {
      return [ensureMode(parsed)];
    }

    return [];
  } catch {
    return [];
  }
}

function writeToStorage(destinations: SavedDestination[]) {
  if (typeof window === 'undefined') return;
  try {
    if (destinations.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      const payload: StoredV2 = {
        v: 2,
        destinations: destinations.slice(0, MAX_DESTINATIONS),
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    }
  } catch {
    /* quota / private mode — ignore */
  }
}

function notifyChange() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

/**
 * Primary hook — returns the array of saved destinations (0–MAX) plus
 * mutation helpers.
 *
 * Backward-compat note: the legacy `destination` (singular) accessor still
 * works and returns the FIRST destination in the array, so callers that only
 * care about "is there at least one destination" don't need to be updated.
 */
export function useSavedDestination(): {
  /** Array of saved destinations (0..MAX_DESTINATIONS). */
  destinations: SavedDestination[];
  /** Convenience accessor for callers that only care about the first. */
  destination: SavedDestination | null;
  /** Replace the entire array. Truncated to MAX_DESTINATIONS. */
  setDestinations: (d: SavedDestination[]) => void;
  /** Replace the first destination (legacy single-destination API). */
  setDestination: (d: SavedDestination | null) => void;
  /** Append a destination if room remains (no-op if already at MAX). */
  addDestination: (d: SavedDestination) => void;
  /** Remove the destination at the given index. */
  removeDestinationAt: (idx: number) => void;
  /** Clear all destinations. */
  clearDestination: () => void;
} {
  const [destinations, setLocal] = useState<SavedDestination[]>([]);

  // Hydrate after mount (avoid SSR mismatches)
  useEffect(() => {
    setLocal(readFromStorage());
  }, []);

  // React to changes from other tabs OR other components in the same tab
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setLocal(readFromStorage());
    };
    const onCustom = () => setLocal(readFromStorage());
    window.addEventListener('storage', onStorage);
    window.addEventListener(EVENT_NAME, onCustom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(EVENT_NAME, onCustom);
    };
  }, []);

  const setDestinations = useCallback((next: SavedDestination[]) => {
    const trimmed = next.slice(0, MAX_DESTINATIONS);
    writeToStorage(trimmed);
    setLocal(trimmed);
    notifyChange();
  }, []);

  const setDestination = useCallback(
    (d: SavedDestination | null) => {
      // Replace the FIRST destination only; preserve any second destination.
      // If d is null, clear ALL (matches legacy single-destination semantics
      // where setting null removed the saved destination).
      if (d == null) {
        writeToStorage([]);
        setLocal([]);
        notifyChange();
        return;
      }
      setDestinations([d]);
    },
    [setDestinations],
  );

  const addDestination = useCallback(
    (d: SavedDestination) => {
      setLocal((prev) => {
        if (prev.length >= MAX_DESTINATIONS) return prev;
        const next = [...prev, d];
        writeToStorage(next);
        notifyChange();
        return next;
      });
    },
    [],
  );

  const removeDestinationAt = useCallback((idx: number) => {
    setLocal((prev) => {
      if (idx < 0 || idx >= prev.length) return prev;
      const next = prev.filter((_, i) => i !== idx);
      writeToStorage(next);
      notifyChange();
      return next;
    });
  }, []);

  const clearDestination = useCallback(() => {
    writeToStorage([]);
    setLocal([]);
    notifyChange();
  }, []);

  return {
    destinations,
    destination: destinations[0] ?? null,
    setDestinations,
    setDestination,
    addDestination,
    removeDestinationAt,
    clearDestination,
  };
}

/**
 * Stable cache key for a saved destination. Used to memoize per-listing
 * commute lookups so we only recompute when the user actually changes their
 * destination (not on every viewport pan / re-render).
 */
export function destinationCacheKey(d: SavedDestination | null): string | null {
  if (!d) return null;
  switch (d.type) {
    case 'address':
      return `addr:${d.addressLat?.toFixed(5)},${d.addressLon?.toFixed(5)}:${d.mode}`;
    case 'park':
      return `park:${d.parkName ?? ''}:${d.mode}`;
    case 'station':
      return `station:${d.stationName ?? ''}:${d.mode}`;
    case 'subway-line':
      return `line:${(d.lines ?? []).join(',')}:${(d.stops ?? []).join(',')}:${d.mode}`;
    default:
      return null;
  }
}

/**
 * Resolve a saved destination to lat/lon coordinates. Returns null when the
 * destination has no resolvable coordinates (e.g. unspecified subway line).
 * Park coords come from the bundled PARK_COORDS table; address coords are
 * stored when the user picks a Nominatim suggestion.
 */
export function destinationCoords(
  d: SavedDestination | null,
): { lat: number; lon: number; label: string } | null {
  if (!d) return null;
  if (d.type === 'address' && d.addressLat != null && d.addressLon != null) {
    const label = d.address ? d.address.split(',')[0].trim() : 'Destination';
    return { lat: d.addressLat, lon: d.addressLon, label };
  }
  if (d.type === 'park' && d.parkName) {
    const coords = PARK_COORDS[d.parkName];
    if (coords) return { lat: coords.lat, lon: coords.lon, label: d.parkName };
  }
  if (d.type === 'station' && d.stationName) {
    const station = SUBWAY_STATIONS.find((s) => s.name === d.stationName);
    if (station) return { lat: station.lat, lon: station.lon, label: station.name };
  }
  if (d.type === 'subway-line') {
    // First explicit stop, else first station serving the first selected line
    if (d.stops && d.stops.length > 0) {
      const station = SUBWAY_STATIONS.find((s) => s.name === d.stops![0]);
      if (station) return { lat: station.lat, lon: station.lon, label: station.name };
    }
    if (d.lines && d.lines.length > 0) {
      const line = d.lines[0];
      const station = SUBWAY_STATIONS.find((s) => s.lines.includes(line));
      if (station) return { lat: station.lat, lon: station.lon, label: station.name };
    }
  }
  return null;
}

/** Short, human-readable name for the chip / pill. Truncated to ~14 chars. */
export function destinationShortName(d: SavedDestination | null, max = 14): string {
  if (!d) return 'Destination';
  let name = '';
  if (d.type === 'address' && d.address) name = d.address.split(',')[0].trim();
  else if (d.type === 'park' && d.parkName) name = d.parkName;
  else if (d.type === 'station' && d.stationName) name = d.stationName;
  else if (d.type === 'subway-line') {
    if (d.stops && d.stops.length > 0) name = d.stops[0];
    else if (d.lines && d.lines.length > 0) name = `${d.lines.join('/')} train`;
  }
  if (!name) name = 'Destination';
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

/** OTP mode string for the trip-plan API. */
export function destinationOtpMode(d: SavedDestination | null): string {
  if (!d) return 'TRANSIT,WALK';
  switch (d.mode) {
    case 'walk':
      return 'WALK';
    case 'bike':
      return 'BICYCLE';
    case 'transit':
    default:
      return 'TRANSIT,WALK';
  }
}
