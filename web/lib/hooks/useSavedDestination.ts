'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CommuteRule } from '@/components/Filters';
import { PARK_COORDS } from '@/lib/park-coords';
import SUBWAY_STATIONS from '@/lib/isochrone/subway-stations';

const STORAGE_KEY = 'dwelligence.preferredDestination';
const EVENT_NAME = 'dwelligence:preferredDestinationChanged';

/**
 * A single saved destination is just a CommuteRule (same shape as the existing
 * commute filter rule). Stored in localStorage for now (per-device); cross-
 * device sync is a follow-up.
 */
export type SavedDestination = CommuteRule;

function readFromStorage(): SavedDestination | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedDestination;
    if (!parsed || typeof parsed !== 'object' || !parsed.type) return null;
    // Backward-compat: older saved destinations predate the `mode` field —
    // default to 'walk' so the destination chip's commute lookup has a mode.
    if (!parsed.mode) {
      parsed.mode = 'walk';
    }
    return parsed;
  } catch {
    return null;
  }
}

function notifyChange() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function useSavedDestination(): {
  destination: SavedDestination | null;
  setDestination: (d: SavedDestination | null) => void;
  clearDestination: () => void;
} {
  const [destination, setLocal] = useState<SavedDestination | null>(null);

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

  const setDestination = useCallback((d: SavedDestination | null) => {
    if (typeof window === 'undefined') return;
    try {
      if (d == null) {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
      }
    } catch {
      /* quota / private mode — ignore */
    }
    setLocal(d);
    notifyChange();
  }, []);

  const clearDestination = useCallback(() => setDestination(null), [setDestination]);

  return { destination, setDestination, clearDestination };
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
