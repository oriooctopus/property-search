/**
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
import { getVisibleCenter, panMapToShowLatLng } from '../lib/viewport/visibleMapView';
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
