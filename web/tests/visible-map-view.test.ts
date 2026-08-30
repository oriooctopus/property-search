/**
 * @vitest-environment jsdom
 *
 * Round-trip invariant for the saved-search map location.
 *
 * The bug: SAVE captured the container center but RESTORE placed the saved
 * point at the occluder-adjusted VISIBLE center, so reopening a saved search
 * landed the map ~a quarter-screen off. The fix makes save capture the visible
 * center too (getVisibleCenter), which is the exact inverse of the restore pan
 * (panMapToShowLatLng) at equal zoom + equal occluders.
 *
 * This test locks in that inverse property: panning a point to the visible
 * center and then reading the visible center back must return the same point.
 * It also guards the panMapToShowLatLng sign (a `.subtract` vs `.add` bug
 * previously shifted the target the wrong way).
 *
 * Run with: npx vitest run tests/visible-map-view.test.ts
 */

import { describe, it, expect } from 'vitest';
import { getVisibleCenter, panMapToShowLatLng, boundsForZoom15AtPoint } from '../lib/viewport/visibleMapView';
import type { Occluder } from '../lib/viewport/occlusion';

class TestDOMRect implements DOMRect {
  x: number; y: number; width: number; height: number;
  constructor(x: number, y: number, width: number, height: number) {
    this.x = x; this.y = y; this.width = width; this.height = height;
  }
  get top() { return this.y; }
  get left() { return this.x; }
  get right() { return this.x + this.width; }
  get bottom() { return this.y + this.height; }
  toJSON() { return { x: this.x, y: this.y, width: this.width, height: this.height }; }
}
if (typeof (globalThis as { DOMRect?: typeof DOMRect }).DOMRect === 'undefined') {
  (globalThis as unknown as { DOMRect: typeof TestDOMRect }).DOMRect = TestDOMRect;
}

const occluder = (id: string, rect: DOMRect | null): Occluder => ({ id, getRect: () => rect });

// Minimal Leaflet Point with the .add/.subtract used by the module under test.
function pt(x: number, y: number) {
  return {
    x, y,
    add(o: [number, number] | { x: number; y: number }) {
      const [ax, ay] = Array.isArray(o) ? o : [o.x, o.y];
      return pt(x + ax, y + ay);
    },
    subtract(o: [number, number] | { x: number; y: number }) {
      const [ax, ay] = Array.isArray(o) ? o : [o.x, o.y];
      return pt(x - ax, y - ay);
    },
  };
}

/**
 * A faithful *linear* Leaflet mock: a constant scale `k` px/degree, y inverted
 * so larger lat renders higher on screen (smaller y), and getCenter() rendered
 * at the container center. project/unproject/containerPointToLatLng are all
 * mutually consistent, so getVisibleCenter and panMapToShowLatLng are exact
 * inverses — exactly the property under test.
 */
function makeMap(center: { lat: number; lng: number }, zoom = 14, W = 390, H = 800, k = 4096) {
  const map = {
    getContainer: () => ({ getBoundingClientRect: () => new TestDOMRect(0, 0, W, H) }),
    getZoom: () => zoom,
    getMaxZoom: () => 20,
    getCenter: () => ({ lat: center.lat, lng: center.lng }),
    setView(c: [number, number] | { lat: number; lng: number }, z?: number) {
      const ll = Array.isArray(c) ? { lat: c[0], lng: c[1] } : c;
      center = { lat: ll.lat, lng: ll.lng };
      if (z != null) zoom = z;
      return map;
    },
    project(latlng: [number, number] | { lat: number; lng: number }) {
      const ll = Array.isArray(latlng) ? { lat: latlng[0], lng: latlng[1] } : latlng;
      return pt(ll.lng * k, -ll.lat * k);
    },
    unproject(point: { x: number; y: number }) {
      return { lat: -point.y / k, lng: point.x / k };
    },
    containerPointToLatLng(cp: [number, number] | { x: number; y: number }) {
      const [cx, cy] = Array.isArray(cp) ? cp : [cp.x, cp.y];
      const cproj = map.project(center);
      const world = pt(cproj.x + (cx - W / 2), cproj.y + (cy - H / 2));
      return map.unproject(world);
    },
  };
  return map as unknown as import('leaflet').Map;
}

describe('save↔restore visible-center round-trip', () => {
  it('getVisibleCenter after panMapToShowLatLng returns the saved point (bottom occluder)', () => {
    // Swipe card covers the bottom ~44% of the map → visible center sits north
    // of the container center. This is the case where the old asymmetry showed.
    const occ = [occluder('swipe-card', new TestDOMRect(0, 450, 390, 350))];
    const saved = { lat: 40.68099601981586, lng: -73.98322105407716 };
    // Map starts somewhere else entirely — restore must move it to `saved`.
    const map = makeMap({ lat: 40.75, lng: -73.9 }, 14);

    panMapToShowLatLng(map, saved.lat, saved.lng, occ);
    const restored = getVisibleCenter(map, occ);

    expect(restored.lat).toBeCloseTo(saved.lat, 6);
    expect(restored.lng).toBeCloseTo(saved.lng, 6);
  });

  it('with no occluders, visible center equals container center after pan', () => {
    const saved = { lat: 40.7, lng: -74.0 };
    const map = makeMap({ lat: 40.6, lng: -73.8 }, 13);
    panMapToShowLatLng(map, saved.lat, saved.lng, []);
    const restored = getVisibleCenter(map, []);
    expect(restored.lat).toBeCloseTo(saved.lat, 6);
    expect(restored.lng).toBeCloseTo(saved.lng, 6);
    // And with no occluders the container center IS the saved point.
    expect(map.getCenter().lat).toBeCloseTo(saved.lat, 6);
  });
});

/**
 * boundsForZoom15AtPoint — the mobile-list-view fallback search area.
 *
 * Regression coverage for the bug: mobile LIST view's map panel is CSS
 * `display:none`, so `.leaflet-container` measures 0x0. Repro (see the
 * implementer report / repro-list-search.mjs): selecting a place there
 * still panned that 0-sized map "successfully" internally, but
 * `map.getBounds()` on it collapsed to a degenerate single-point box
 * (`latMin === latMax`), which MapInner's BoundsWatcher explicitly refuses
 * to fire a query on — so the listings list never changed. These tests
 * pin down `boundsForZoom15AtPoint`'s actual geometry so a future edit
 * can't quietly reintroduce a degenerate or off-center box.
 *
 * Scope: NYC-latitude only (~40-41°N), matching this app's only market —
 * not validated near the poles or the antimeridian (see the function's own
 * header comment on why the latitude approximation is safe here).
 */
describe('boundsForZoom15AtPoint', () => {
  // Real Jefferson St (Bushwick, Brooklyn) coordinates — the exact repro
  // case from the list-view bug.
  const JEFFERSON_ST = { lat: 40.706607, lon: -73.922913 };

  it('is centered on the given point and has a non-degenerate span', () => {
    const b = boundsForZoom15AtPoint(JEFFERSON_ST.lat, JEFFERSON_ST.lon);
    expect((b.latMin + b.latMax) / 2).toBeCloseTo(JEFFERSON_ST.lat, 9);
    expect((b.lonMin + b.lonMax) / 2).toBeCloseTo(JEFFERSON_ST.lon, 9);
    // The whole bug being fixed is a box collapsing to a point — assert
    // the span is meaningfully positive, not just technically nonzero.
    expect(b.latMax - b.latMin).toBeGreaterThan(0.001);
    expect(b.lonMax - b.lonMin).toBeGreaterThan(0.001);
  });

  it('produces a different, correctly-shifted box for a different point (Manhattan vs. Bushwick)', () => {
    const manhattan = boundsForZoom15AtPoint(40.7484, -73.9857); // Empire State Building-ish
    const bushwick = boundsForZoom15AtPoint(JEFFERSON_ST.lat, JEFFERSON_ST.lon);
    // The two boxes must not overlap — they're ~9km apart, and the zoom-15
    // span (see the next test) is under 2km wide.
    expect(manhattan.lonMax).toBeLessThan(bushwick.lonMin);
  });

  it("matches panMapToShowLatLng's real zoom-15 pan at the assumed viewport size", async () => {
    // This is the strongest form of "matches the map path's zoom-15
    // equivalent": drive the REAL `leaflet` package (not a linear mock —
    // Web Mercator's y-axis is nonlinear in latitude, so only the real
    // projection can validate the latitude side of the math) with a
    // container stubbed to report exactly ASSUMED_VIEWPORT_PX (390x844,
    // ASSUMED_VIEWPORT_PX's whole reason for existing), pan to Jefferson
    // St the same way SearchModal does (`{ minZoom: 15 }`, no occluders),
    // and compare the map's real resulting bounds to this function's
    // output.
    const L = (await import('leaflet')).default;
    const container = document.createElement('div');
    document.body.appendChild(container);
    // jsdom reports 0x0 for every element by default — exactly the
    // production bug. Stub both the properties Leaflet's internal
    // `getSize()` reads (clientWidth/clientHeight) and the
    // getBoundingClientRect() panMapToShowLatLng reads directly, to the
    // size the map WOULD have if it were actually visible.
    Object.defineProperty(container, 'clientWidth', { value: 390, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 844, configurable: true });
    container.getBoundingClientRect = () => new TestDOMRect(0, 0, 390, 844);

    const map = L.map(container, { center: [40.6, -73.8], zoom: 10 });
    panMapToShowLatLng(map, JEFFERSON_ST.lat, JEFFERSON_ST.lon, [], {
      minZoom: 15,
      setViewOptions: { animate: false },
    });

    const real = map.getBounds();
    const derived = boundsForZoom15AtPoint(JEFFERSON_ST.lat, JEFFERSON_ST.lon);

    // toBeCloseTo(x, 3) = agreement to within ~0.0005° (~50m at this
    // latitude) — tight enough to catch a wrong constant (e.g. a stray
    // factor-of-2 or the wrong zoom level), loose enough to tolerate
    // Leaflet's own float/pixel-snapping in setView.
    expect(real.getSouth()).toBeCloseTo(derived.latMin, 3);
    expect(real.getNorth()).toBeCloseTo(derived.latMax, 3);
    expect(real.getWest()).toBeCloseTo(derived.lonMin, 3);
    expect(real.getEast()).toBeCloseTo(derived.lonMax, 3);

    map.remove();
  });
});
