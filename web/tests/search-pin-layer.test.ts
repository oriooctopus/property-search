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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

/**
 * Regression tests for the popup auto-hide behavior (user ask: "the banner
 * above should go away after a couple seconds and just the orange marker
 * should remain").
 *
 * The catch this guards against: the × in the popup is the ONLY way to clear
 * the sticky pin (see SearchPinLayer.tsx's header comment). If auto-hide
 * shipped without a reopen path, the pin would become permanently stuck the
 * moment its popup timed out. So every test here that closes the popup is
 * paired with proof the marker/pin survives and the popup can come back.
 */
describe('SearchPinLayer popup auto-hide + marker-click reopen', () => {
  let container: HTMLDivElement;
  let mapContainer: HTMLDivElement;
  let root: Root;
  let map: L.Map;

  // POPUP_AUTO_HIDE_MS is not exported — it's an internal implementation
  // constant, not part of this component's public contract (the `pin` /
  // `onClear` props). Mirroring the literal here (with this comment as the
  // tripwire) is preferable to exporting a constant whose only consumer
  // would be this test file.
  const AUTO_HIDE_MS = 2500;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    mapContainer = document.createElement('div');
    document.body.appendChild(mapContainer);
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    map?.remove();
    vi.useRealTimers();
  });

  /** Mounts a real Leaflet map + SearchPinLayer(pin) and flushes the dynamic import('leaflet'). */
  async function mount(pin: { id: string; lat: number; lon: number; label: string }) {
    const L = (await import('leaflet')).default;
    map = L.map(container, { center: [0, 0], zoom: 10 });
    (globalThis as unknown as { __testMap: L.Map }).__testMap = map;

    const { default: SearchPinLayer } = await import('@/components/SearchPinLayer');
    const { createElement } = await import('react');
    root = createRoot(mapContainer);

    await act(async () => {
      root.render(createElement(SearchPinLayer, { pin, onClear: () => {} }));
      // Flush the dynamic import('leaflet') microtask + marker/popup setup
      // that runs in its `.then()` — same pattern as the test above.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  /** Re-renders the already-mounted layer with a new pin (or onClear). */
  async function rerender(pin: { id: string; lat: number; lon: number; label: string } | null, onClear: () => void = () => {}) {
    const { default: SearchPinLayer } = await import('@/components/SearchPinLayer');
    const { createElement } = await import('react');
    await act(async () => {
      root.render(createElement(SearchPinLayer, { pin, onClear }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  // The marker icon lives inside Leaflet's map pane (`container`), not the
  // React root (`mapContainer`) — SearchPinLayer renders nothing itself
  // (`return null`), it only drives Leaflet imperatively onto `map`.
  function markerIcon(): HTMLElement | null {
    return container.querySelector('.search-pin-icon');
  }

  function popupEl(): HTMLElement | null {
    return document.querySelector('.search-pin-popup');
  }

  /** Simulates a real user click on the marker — goes through Leaflet's actual
   * DOM event delegation (Map._findEventTargets walks up from e.target through
   * parentNode looking for a registered interactive target), not a direct call
   * into any Leaflet/React internals, so this exercises the exact same code
   * path a real tap on the map would. */
  function clickMarker() {
    const icon = markerIcon();
    if (!icon) throw new Error('marker icon not found in DOM');
    icon.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  it('opens the popup immediately after a place is selected', async () => {
    await mount({ id: 'p1', lat: 1, lon: 1, label: 'Jefferson St' });
    expect(popupEl()).not.toBeNull();
    expect(popupEl()?.textContent).toContain('Jefferson St');
    expect(markerIcon()).not.toBeNull();
  });

  it('closes the popup after the auto-hide timeout, leaving the marker on the map', async () => {
    await mount({ id: 'p1', lat: 1, lon: 1, label: 'Jefferson St' });
    expect(popupEl()).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(AUTO_HIDE_MS);
    });

    expect(popupEl()).toBeNull();
    // The whole point of pairing auto-hide with a reopen path: the marker
    // itself must survive the popup closing, or the pin is stuck forever.
    expect(markerIcon()).not.toBeNull();
  });

  it('reopens the popup on a marker click after auto-hide, with autoPan still off', async () => {
    await mount({ id: 'p1', lat: 1, lon: 1, label: 'Jefferson St' });
    await act(async () => {
      vi.advanceTimersByTime(AUTO_HIDE_MS);
    });
    expect(popupEl()).toBeNull();

    // Simulate an in-flight pan animation exactly like the autoPan
    // regression test above, so a reopen that regresses `autoPan: false`
    // fails here the same concrete way (`_panAnim.stop()` called) rather
    // than by reading a config flag off the popup instance.
    const stop = vi.fn();
    (map as unknown as { _panAnim: { stop: () => void } })._panAnim = { stop };

    await act(async () => {
      clickMarker();
    });

    expect(popupEl()).not.toBeNull();
    expect(popupEl()?.textContent).toContain('Jefferson St');
    expect(stop).not.toHaveBeenCalled();
  });

  it('reopened popup still auto-clears the pin via its × button', async () => {
    await mount({ id: 'p1', lat: 1, lon: 1, label: 'Jefferson St' });
    await act(async () => {
      vi.advanceTimersByTime(AUTO_HIDE_MS);
    });

    const onClear = vi.fn();
    await rerender({ id: 'p1', lat: 1, lon: 1, label: 'Jefferson St' }, onClear);
    await act(async () => {
      clickMarker();
    });
    expect(popupEl()).not.toBeNull();

    const clearBtn = popupEl()?.querySelector('button') as HTMLButtonElement | null;
    expect(clearBtn).not.toBeNull();
    await act(async () => {
      clearBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('does not let a stale timer from the first pin close the second pin\'s popup early', async () => {
    await mount({ id: 'p1', lat: 1, lon: 1, label: 'Jefferson St' });
    expect(popupEl()?.textContent).toContain('Jefferson St');

    // Let most, but not all, of pin A's auto-hide window elapse, then select
    // a different place. SearchPinLayer's effect dependency array includes
    // pin.id, so this tears down A's marker/timer and mounts a fresh B.
    await act(async () => {
      vi.advanceTimersByTime(AUTO_HIDE_MS - 500);
    });
    await rerender({ id: 'p2', lat: 2, lon: 2, label: 'Adams Ave' });
    expect(popupEl()?.textContent).toContain('Adams Ave');

    // Advance exactly the remainder of A's original window. If A's timer
    // had survived (a bug this test exists to catch), it would fire here
    // and close B's popup well before B's own full 2.5s has elapsed.
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(popupEl()).not.toBeNull();
    expect(popupEl()?.textContent).toContain('Adams Ave');

    // Sanity: B does still auto-hide on its own schedule.
    await act(async () => {
      vi.advanceTimersByTime(AUTO_HIDE_MS - 500);
    });
    expect(popupEl()).toBeNull();
    expect(markerIcon()).not.toBeNull();
  });

  it('clears the auto-hide timer on unmount (no late close, no error)', async () => {
    await mount({ id: 'p1', lat: 1, lon: 1, label: 'Jefferson St' });
    expect(popupEl()).not.toBeNull();

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => {
      root.unmount();
    });

    // Advancing time past the auto-hide window post-unmount must be a
    // no-op — no "closePopup on a removed marker" throw, no React
    // "state update after unmount" warning (this component is imperative
    // Leaflet, not React state, but a leaked timer touching a detached
    // marker/map would still throw or warn here if the cleanup were wrong).
    expect(() => {
      vi.advanceTimersByTime(AUTO_HIDE_MS + 1000);
    }).not.toThrow();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    // map.remove() happens in afterEach; root.unmount() above already ran
    // (afterEach's root?.unmount() on an already-unmounted root is a no-op).
  });
});
