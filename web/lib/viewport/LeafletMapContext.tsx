'use client';

/**
 * LeafletMapContext — exposes the live Leaflet `Map` instance to consumers
 * outside the `<MapContainer>` subtree (e.g. SwipeView's deck-restore and
 * pin-visibility effects, the OcclusionDebugOverlay).
 *
 * Why this exists: the legacy approach was to stash the map on
 * `window.__leafletMap` and poll for it via `setTimeout`. That had three
 * problems (see Blocker 3 in the pin-fix follow-up review):
 *   1. Race conditions on map remount (stale window ref).
 *   2. No teardown on map unmount (consumers held dead references).
 *   3. Required ad-hoc 200ms polling everywhere — leaks if the map never
 *      mounts.
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
 *   - Consumers call `useLeafletMap()` and re-render when the value flips
 *     between `null` and a real `L.Map`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Map as LeafletMap } from 'leaflet';

interface LeafletMapContextValue {
  map: LeafletMap | null;
  setMap: (map: LeafletMap | null) => void;
}

const LeafletMapContext = createContext<LeafletMapContextValue | null>(null);

export function LeafletMapProvider({ children }: { children: ReactNode }) {
  // useState (not useRef) so consumers re-render when the map mounts/unmounts.
  const [map, setMapState] = useState<LeafletMap | null>(null);

  const setMap = useCallback((next: LeafletMap | null) => {
    setMapState((prev) => (prev === next ? prev : next));
  }, []);

  const value = useMemo<LeafletMapContextValue>(
    () => ({ map, setMap }),
    [map, setMap],
  );

  return <LeafletMapContext.Provider value={value}>{children}</LeafletMapContext.Provider>;
}

/**
 * Returns the live Leaflet map, or `null` until it mounts. When the map
 * mounts/unmounts, consumers re-render automatically.
 */
export function useLeafletMap(): LeafletMap | null {
  return useContext(LeafletMapContext)?.map ?? null;
}

/**
 * Internal hook used by `<LeafletMapBinder/>` (mounted inside MapContainer).
 * Throws when called outside a `LeafletMapProvider` so misuse is loud.
 */
export function useLeafletMapSetter(): (map: LeafletMap | null) => void {
  const ctx = useContext(LeafletMapContext);
  if (!ctx) {
    // No-op fallback so unit tests / Storybook can render MapInner without
    // a provider — but we warn so production wiring isn't silently dropped.
    if (typeof window !== 'undefined') {
      console.warn('[LeafletMapContext] useLeafletMapSetter called outside <LeafletMapProvider>; map will not be exposed to consumers.');
    }
    return () => {};
  }
  return ctx.setMap;
}
