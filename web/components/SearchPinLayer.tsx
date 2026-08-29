'use client';

/**
 * SearchPinLayer — the sticky pin dropped after selecting a result in
 * SearchModal. Visually distinct from listing markers (a solid orange
 * teardrop vs. the app's listing dots/hearts), and persists across pans
 * and zooms until explicitly cleared via the small × in its popup, or
 * replaced by a new search.
 *
 * Mounted once, at the HomeClient level, rather than inside Map/SwipeView's
 * own subtree — `useLeafletMap()` always resolves to whichever Leaflet map
 * instance is currently visible (desktop map, mobile list/map view, or
 * mobile swipe view's backdrop map are separate Leaflet instances; see
 * LeafletMapContext's header comment), so a single instance of this layer
 * re-parents the marker onto whichever map becomes current on a view
 * switch instead of needing one copy per surface.
 *
 * Leaflet touches `window` at import time, so — like MapInner.tsx and
 * DetailMapInner.tsx — this only ever calls into it from inside a
 * client-only effect (dynamic `import('leaflet')`), never at module scope,
 * so this file stays safe to import statically into HomeClient without an
 * `ssr: false` wrapper.
 */

import { useEffect, useRef } from 'react';
import type { Marker as LeafletMarker } from 'leaflet';
import { useLeafletMap } from '@/lib/viewport/LeafletMapContext';

export interface SearchPin {
  id: string;
  lat: number;
  lon: number;
  label: string;
}

export default function SearchPinLayer({
  pin,
  onClear,
}: {
  pin: SearchPin | null;
  onClear: () => void;
}) {
  const map = useLeafletMap();
  const markerRef = useRef<LeafletMarker | null>(null);
  // Read via a ref inside the imperative Leaflet callback below so the
  // marker/popup don't get torn down and rebuilt just because the caller
  // passed a fresh onClear closure on some unrelated re-render.
  const onClearRef = useRef(onClear);
  onClearRef.current = onClear;

  useEffect(() => {
    if (!map || !pin) return;
    let cancelled = false;

    import('leaflet').then((mod) => {
      if (cancelled) return;
      const L = mod.default;
      const icon = L.divIcon({
        className: 'search-pin-icon',
        html:
          '<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);' +
          'background:#f97316;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.5);"></div>',
        iconSize: [26, 26],
        iconAnchor: [13, 26],
        popupAnchor: [0, -28],
      });
      const marker = L.marker([pin.lat, pin.lon], { icon, zIndexOffset: 1000, keyboard: false }).addTo(map);

      const popupEl = document.createElement('div');
      popupEl.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;max-width:220px;';
      const labelEl = document.createElement('span');
      labelEl.textContent = pin.label;
      labelEl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.textContent = '×';
      clearBtn.setAttribute('aria-label', 'Clear search pin');
      clearBtn.style.cssText =
        'cursor:pointer;border:none;background:transparent;font-size:16px;line-height:1;padding:0 2px;color:#6e7681;flex-shrink:0;';
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClearRef.current();
      });
      popupEl.appendChild(labelEl);
      popupEl.appendChild(clearBtn);
      // autoPan: false is load-bearing — do NOT drop it to "simplify" this.
      // panMapToShowLatLng (called synchronously by the search-select
      // handler, just before this effect's dynamic `import('leaflet')`
      // resolves) kicks off an animated `map.setView`, which Leaflet drives
      // via `map._panAnim`. Popup's default `autoPan: true` makes
      // `Popup.onAdd` -> `update()` -> `_adjustPan()` call
      // `this._map._panAnim.stop()` synchronously the instant the popup is
      // added (see node_modules/leaflet/src/layer/Popup.js `_adjustPan`).
      // Since marker creation + `openPopup()` here race that in-flight pan
      // (both are gated on the same dynamic import, but on unpredictable
      // relative timing), calling `openPopup()` with autoPan on freezes the
      // map wherever the pan animation happened to be, up to ~400px off
      // target, non-deterministically. This popup never needs to "auto
      // pan" the map to stay visible anyway — it always opens right where
      // panMapToShowLatLng already made room for it.
      marker.bindPopup(popupEl, {
        closeButton: false,
        className: 'search-pin-popup',
        autoClose: false,
        autoPan: false,
      });
      marker.openPopup();

      markerRef.current = marker;
    });

    return () => {
      cancelled = true;
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pin?.id, pin?.lat, pin?.lon, pin?.label]);

  return null;
}
