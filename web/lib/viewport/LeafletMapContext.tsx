'use client';

/**
 * LeafletMapContext — exposes the live Leaflet `Map` instance to consumers
 * outside the `<MapContainer>` subtree (e.g. SwipeView's deck-restore and
 * pin-visibility effects, the OcclusionDebugOverlay, GoToNearestMatch's
 * occlusion-aware center query).
 *
 * Why this exists: the legacy approach was to stash the map on
 * `window.__leafletMap` and poll for it via `setTimeout`. That had three
 * problems (see Blocker 3 in the pin-fix follow-up review):
 *   1. Race conditions on map remount (stale window ref).
 *   2. No teardown on map unmount (consumers held dead references).
 *   3. Required ad-hoc 200ms polling everywhere — leaks if the map never
 *      mounts.
 *
 * Multi-map disambiguation: SwipeView mounts up to TWO Leaflet maps on
 * mobile — the always-visible full-bleed backdrop AND a portal'd
 * "expanded" overlay map that is kept mounted-but-display-none for perf
 * (so re-opening it doesn't re-init Leaflet / re-fetch subway GeoJSON).
 * If both maps publish themselves to a single-slot context, the
 * last-mounted wins — and that's the wrong map (it's hidden, has 0x0
 * container, makes `getVisibleMapRect` return null, makes
 * `getVisibleCenter` silently fall back to `map.getCenter()` on a
 * 0-sized map). The architectural invariant we want is:
 *   `useLeafletMap()` returns the map the user is currently looking at.
 *
 * The provider tracks ALL registered maps in a list and `useLeafletMap()`
 * returns the most recently mounted map whose container has nonzero
 * dimensions and is not `display:none`. This makes occlusion-aware
 * helpers (getVisibleCenter, panMapToShowLatLng) automatically reason
 * about the visible map, not a hidden one.
 *
 * Production code paths must read the map via `useLeafletMap()`. The
 * `window.__leafletMap` global is preserved by `MapInner` solely so the
 * existing Playwright tests (`tests/verify-mobile-dots-autoshift.spec.ts`)
 * keep working — it must not be read from React components.
 *
 * Wiring:
 *   - `<LeafletMapProvider>` wraps the app root (sits inside the
 *     `OccluderProvider` in `web/app/page.tsx`).
 *   - Inside `MapContainer` (in `MapInner`), the `<LeafletMapBinder/>`
 *     component calls react-leaflet's `useMap()` and pushes the instance
 *     into the context on mount, clears it on unmount.
 *   - Consumers call `useLeafletMap()` and re-render when the visible
 *     map changes (because we re-poll on a microtask).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Map as LeafletMap } from 'leaflet';

interface LeafletMapContextValue {
  /** Stable getter that returns the currently-visible map (or null). */
  getMap: () => LeafletMap | null;
  /** Subscribe to map-set / visibility changes (used by useLeafletMap). */
  subscribe: (cb: () => void) => () => void;
  /** Internal: register/deregister a mounted map. */
  registerMap: (map: LeafletMap) => () => void;
}

const LeafletMapContext = createContext<LeafletMapContextValue | null>(null);

/**
 * Returns true if the map's container is currently visible to the user
 * (nonzero rect AND not `display:none` anywhere in its ancestor chain).
 *
 * Why we need to walk up the ancestor chain: a map mounted inside a
 * portal'd `<div style={{display: showMobileMap ? 'block' : 'none'}}>`
 * still has a leaflet container DOM node, and Leaflet may have stamped
 * dimensions on it via `invalidateSize()` from before the parent went
 * `display:none`. Checking only the leaflet container's own rect would
 * report it as visible even though the user can't see it. Walking up
 * to the nearest `display:none` ancestor catches the portal case.
 */
function isMapContainerVisible(map: LeafletMap): boolean {
  if (typeof window === 'undefined') return false;
  let el: HTMLElement | null;
  try {
    el = map.getContainer();
  } catch {
    return false;
  }
  if (!el || !el.isConnected) return false;
  // Walk up looking for display:none. (offsetParent is also a fast check
  // but it returns null for position:fixed elements even when visible —
  // so we use computed style.)
  let cur: HTMLElement | null = el;
  while (cur) {
    const style = window.getComputedStyle(cur);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    cur = cur.parentElement;
  }
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export function LeafletMapProvider({ children }: { children: ReactNode }) {
  // Stable storage for all currently-mounted maps (insertion-ordered).
  const mapsRef = useRef<LeafletMap[]>([]);
  const subscribersRef = useRef<Set<() => void>>(new Set());

  // Bumped whenever the set of registered maps changes OR a tracked map's
  // container visibility might have changed. Subscribers (useLeafletMap)
  // re-poll `getMap()` on every change.
  const [, setVersion] = useState(0);

  const notify = useCallback(() => {
    setVersion((v) => v + 1);
    for (const cb of subscribersRef.current) cb();
  }, []);

  const registerMap = useCallback((map: LeafletMap) => {
    if (!mapsRef.current.includes(map)) {
      mapsRef.current.push(map);
      notify();
    }
    return () => {
      const idx = mapsRef.current.indexOf(map);
      if (idx >= 0) {
        mapsRef.current.splice(idx, 1);
        notify();
      }
    };
  }, [notify]);

  const getMap = useCallback((): LeafletMap | null => {
    // Return the most-recently mounted map whose container is visible.
    // Iterate in reverse so the most recently mounted visible map wins —
    // matches the prior single-slot "last mount wins" semantic for the
    // common single-map case.
    let resolved: LeafletMap | null = null;
    for (let i = mapsRef.current.length - 1; i >= 0; i--) {
      const m = mapsRef.current[i];
      if (isMapContainerVisible(m)) { resolved = m; break; }
    }
    // No visible map. Fall back to the most recently registered map (if
    // any) so callers can still read state on a hidden map without
    // crashing — they should treat an invisible-but-non-null map the same
    // way they treated null before this change.
    if (!resolved) resolved = mapsRef.current[mapsRef.current.length - 1] ?? null;
    // Expose the resolved (visible) map on window for test-only use.
    // Production code MUST read this via `useLeafletMap()` — this global
    // is an E2E escape hatch, same pattern as `__leafletMap`.
    if (typeof window !== 'undefined') {
      (window as unknown as { __visibleLeafletMap?: LeafletMap | null }).__visibleLeafletMap = resolved;
    }
    return resolved;
  }, []);

  const subscribe = useCallback((cb: () => void) => {
    subscribersRef.current.add(cb);
    return () => {
      subscribersRef.current.delete(cb);
    };
  }, []);

  const value = useMemo<LeafletMapContextValue>(
    () => ({ getMap, subscribe, registerMap }),
    [getMap, subscribe, registerMap],
  );

  return <LeafletMapContext.Provider value={value}>{children}</LeafletMapContext.Provider>;
}

/**
 * Returns the live Leaflet map the user is currently looking at, or
 * `null` until at least one mounts. When maps mount/unmount or the
 * "currently visible" map changes, consumers re-render automatically.
 */
export function useLeafletMap(): LeafletMap | null {
  const ctx = useContext(LeafletMapContext);
  // We want to re-render when the visible map could have changed.
  // Subscribe to the registry's notify hook AND a periodic visibility
  // poll (because a parent display:none toggle isn't a registry event,
  // it just changes which mounted map is currently visible).
  const [, force] = useState(0);
  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    const unsub = ctx.subscribe(() => force((v) => v + 1));
    // Lightweight visibility poll. 250ms is well under any user-perceivable
    // latency; the cost is one getComputedStyle per mounted map. We can't
    // easily observe display:none changes (no native event), so polling
    // is the simplest correct option until a mutation/intersection
    // observer is wired up.
    const interval = setInterval(() => {
      if (!cancelled) force((v) => v + 1);
    }, 250);
    return () => {
      cancelled = true;
      clearInterval(interval);
      unsub();
    };
  }, [ctx]);
  return ctx?.getMap() ?? null;
}

/**
 * Internal hook used by `<LeafletMapBinder/>` (mounted inside MapContainer).
 * Returns a stable function the binder calls in its mount/unmount effect.
 *
 * Backward-compatible signature: `(map | null) => void`. Passing a map
 * registers it; passing null deregisters the most recently registered
 * (matching the prior single-slot setMap(null) semantic).
 *
 * Internally we route through `registerMap` so multiple binders can
 * coexist without clobbering each other's slot.
 */
export function useLeafletMapSetter(): (map: LeafletMap | null) => void {
  const ctx = useContext(LeafletMapContext);
  // Track the most recent registration's deregister fn so a follow-up
  // setMap(null) call from the same binder cleans up correctly.
  const lastUnregisterRef = useRef<(() => void) | null>(null);
  return useCallback(
    (map: LeafletMap | null) => {
      if (!ctx) {
        if (typeof window !== 'undefined') {
          console.warn('[LeafletMapContext] useLeafletMapSetter called outside <LeafletMapProvider>; map will not be exposed to consumers.');
        }
        return;
      }
      // Unregister any prior map this setter registered.
      if (lastUnregisterRef.current) {
        lastUnregisterRef.current();
        lastUnregisterRef.current = null;
      }
      if (map) {
        lastUnregisterRef.current = ctx.registerMap(map);
      }
    },
    [ctx],
  );
}
