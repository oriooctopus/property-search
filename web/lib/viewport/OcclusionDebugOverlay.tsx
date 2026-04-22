'use client';

/**
 * Debug overlay for the viewport-occlusion model.
 *
 * Activated by appending `?debug=pins` to any URL. Renders translucent
 * red rectangles over every registered occluder, plus a green ring
 * around the currently-active map pin with a label like
 * `occluded by: action-pill (margin -4px)`.
 *
 * Pure overlay — `pointer-events: none`. Ships to prod but invisible
 * unless the URL param is present. Zero perf cost when off (returns
 * null early, no rAF loop running).
 */

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useOccluders } from './OccluderRegistry';
import { useLeafletMap } from './LeafletMapContext';
import { isPinVisible, PIN_RADIUS_PX, getVisibleMapRect, type ViewportPoint } from './occlusion';

const COLORS = {
  occluder: 'rgba(239, 68, 68, 0.30)', // red @ 30% alpha
  occluderBorder: 'rgba(239, 68, 68, 0.85)',
  pinVisible: 'rgba(34, 197, 94, 0.85)', // green
  pinOccluded: 'rgba(239, 68, 68, 0.85)', // red
  visibleRect: 'rgba(34, 197, 94, 0.95)', // green outline of the queried (visible) bounds
  label: '#ffffff',
  labelBg: 'rgba(0, 0, 0, 0.78)',
};

interface OverlayState {
  rects: Array<{ id: string; rect: DOMRect }>;
  pin: ViewportPoint | null;
  mapRect: DOMRect | null;
  visibleRect: DOMRect | null;
  visibility: { visible: boolean; occludedBy: string | null; margin: number } | null;
}

export function OcclusionDebugOverlay() {
  const params = useSearchParams();
  const enabled = params?.get('debug') === 'pins';
  const occluders = useOccluders();
  const map = useLeafletMap();
  const [state, setState] = useState<OverlayState>({
    rects: [],
    pin: null,
    mapRect: null,
    visibleRect: null,
    visibility: null,
  });
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !occluders) return;

    const tick = () => {
      const list = occluders.getAll();
      const rects: Array<{ id: string; rect: DOMRect }> = [];
      for (const occ of list) {
        const r = occ.getRect();
        if (r && r.width > 0 && r.height > 0) rects.push({ id: occ.id, rect: r });
      }

      // Find the active map pin. The Leaflet map handle now comes from
      // `useLeafletMap()` (LeafletMapContext) instead of polling
      // `window.__leafletMap`. The active marker is identified via its
      // `.dw-active-pin` SVG class (set in MapInner).
      let pin: ViewportPoint | null = null;
      let mapRect: DOMRect | null = null;
      if (map) {
        mapRect = map.getContainer().getBoundingClientRect();
        const activeEl = document.querySelector('.dw-active-pin') as SVGGraphicsElement | null;
        if (activeEl) {
          const r = activeEl.getBoundingClientRect();
          pin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
      }

      const visibility = pin && mapRect
        ? isPinVisible(pin, mapRect, list)
        : null;

      // Visible rect = the queried-bounds region (what the listings
      // search sees). Mirrors the BoundsWatcher computation so it's
      // obvious what the search is actually looking at.
      const visibleRect = mapRect ? getVisibleMapRect(mapRect, list) : null;

      setState({ rects, pin, mapRect, visibleRect, visibility });
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [enabled, occluders, map]);

  if (!enabled) return null;

  const { rects, pin, visibleRect, visibility } = state;
  const pinColor = visibility?.visible ? COLORS.pinVisible : COLORS.pinOccluded;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        pointerEvents: 'none',
      }}
      aria-hidden
      data-testid="occlusion-debug-overlay"
    >
      {visibleRect && (
        <div
          style={{
            position: 'fixed',
            left: visibleRect.left,
            top: visibleRect.top,
            width: visibleRect.width,
            height: visibleRect.height,
            border: `2px dashed ${COLORS.visibleRect}`,
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              position: 'absolute',
              bottom: 4,
              left: 4,
              padding: '2px 6px',
              fontSize: 10,
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              color: COLORS.label,
              background: COLORS.labelBg,
              borderRadius: 3,
            }}
          >
            visible bounds (queried)
          </div>
        </div>
      )}

      {rects.map(({ id, rect }) => (
        <div
          key={id}
          style={{
            position: 'fixed',
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            background: COLORS.occluder,
            border: `1px solid ${COLORS.occluderBorder}`,
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 4,
              left: 4,
              padding: '2px 6px',
              fontSize: 10,
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              color: COLORS.label,
              background: COLORS.labelBg,
              borderRadius: 3,
            }}
          >
            {id}
          </div>
        </div>
      ))}

      {pin && (
        <>
          <div
            style={{
              position: 'fixed',
              left: pin.x - PIN_RADIUS_PX,
              top: pin.y - PIN_RADIUS_PX,
              width: PIN_RADIUS_PX * 2,
              height: PIN_RADIUS_PX * 2,
              border: `2px solid ${pinColor}`,
              borderRadius: '50%',
              boxSizing: 'border-box',
            }}
          />
          {visibility && (
            <div
              style={{
                position: 'fixed',
                left: Math.max(8, Math.min(pin.x + 16, (state.mapRect?.right ?? 9999) - 220)),
                top: Math.max(8, pin.y - 8),
                padding: '3px 7px',
                fontSize: 10,
                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                color: COLORS.label,
                background: COLORS.labelBg,
                borderRadius: 4,
                maxWidth: 220,
              }}
            >
              {visibility.visible
                ? `visible (margin ${Math.round(visibility.margin)}px)`
                : `occluded by: ${visibility.occludedBy} (margin ${Math.round(visibility.margin)}px)`}
            </div>
          )}
        </>
      )}
    </div>
  );
}
