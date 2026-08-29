/**
 * @vitest-environment jsdom
 *
 * Regression test for the search-pin-lands-off-center race
 * (components/SearchPinLayer.tsx).
 *
 * Root cause (see SearchPinLayer.tsx's inline comment above `bindPopup`):
 * Leaflet's real `Popup._adjustPan()` — invoked synchronously from
 * `Popup.onAdd`, i.e. the instant `marker.openPopup()` runs — calls
 * `this._map._panAnim.stop()` whenever the popup's `autoPan` option is on
 * (Leaflet's default). SearchPinLayer's marker/popup are created inside a
 * `.then()` off a dynamic `import('leaflet')`, which resolves on
 * unpredictable timing relative to the in-flight `panMapToShowLatLng`
 * animation the search-select handler just started — so `openPopup()`
 * freezes that pan wherever it happened to be, landing the pin up to
 * ~400px off target.
 *
 * This test exercises the REAL `leaflet` package's real `Popup._adjustPan`
 * (not a hand-rolled stand-in for it), so it fails for the right reason: it
 * doesn't just check that source code contains the string "autoPan: false",
 * it checks that Leaflet's own pan-interrupting code path never fires.
 *
 * Proof this test bites: temporarily removing `autoPan: false` from the
 * `bindPopup` call in SearchPinLayer.tsx (restoring the old bug) makes this
 * test fail with "panAnim.stop was called" — see the implementer report for
 * the actual before/after console output.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type L from 'leaflet';

// react-dom's `act()` warns unless this flag is set — there's no test-runner
// integration (no @testing-library/react) doing it for us here.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/lib/viewport/LeafletMapContext', () => ({
  useLeafletMap: () => (globalThis as unknown as { __testMap: L.Map }).__testMap,
}));

describe('SearchPinLayer popup does not interrupt an in-flight pan', () => {
  let container: HTMLDivElement;
  let root: Root;
  let map: L.Map;

  beforeEach(() => {
    container = document.createElement('div');
    // jsdom gives every element a zero-size bounding rect; Leaflet tolerates
    // that fine for map/marker/popup construction (only pixel math like
    // real pixel positions is meaningless here — irrelevant to this test,
    // which only checks whether `_panAnim.stop()` gets invoked).
    document.body.appendChild(container);
  });

  it('leaves an in-flight map pan alone when a search-pin popup opens (autoPan: false)', async () => {
    // Dynamic import so this file only pulls in leaflet (which touches
    // `window` at import time) once jsdom's `window` already exists.
    const L = (await import('leaflet')).default;
    map = L.map(container, { center: [0, 0], zoom: 10 });
    // Simulate "a pan animation is currently running" — exactly the state
    // SearchPinLayer's marker/popup race against in the real bug. Leaflet
    // only creates `_panAnim` lazily on an actual animated `setView`; a spy
    // stand-in here is enough because the only thing under test is whether
    // Popup's real `_adjustPan()` calls `.stop()` on it.
    const stop = vi.fn();
    (map as unknown as { _panAnim: { stop: () => void } })._panAnim = { stop };
    (globalThis as unknown as { __testMap: L.Map }).__testMap = map;

    const { default: SearchPinLayer } = await import('@/components/SearchPinLayer');
    const { createElement } = await import('react');

    const mapContainer = document.createElement('div');
    document.body.appendChild(mapContainer);
    root = createRoot(mapContainer);

    await act(async () => {
      root.render(
        createElement(SearchPinLayer, {
          pin: { id: 'p1', lat: 1, lon: 1, label: 'Test Station' },
          onClear: () => {},
        }),
      );
      // Flush the dynamic import('leaflet') microtask + the marker/popup
      // creation that runs in its `.then()`.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The popup DID open (sanity check the effect actually ran) ...
    expect(document.querySelector('.search-pin-popup')).not.toBeNull();
    // ... but it must NOT have stopped the in-flight pan.
    expect(stop).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    map.remove();
  });
});
