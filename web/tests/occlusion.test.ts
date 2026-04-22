/**
 * Unit tests for the viewport-occlusion model.
 *
 * Run with: npx vitest run tests/occlusion.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  isPinVisible,
  findVisiblePosition,
  projectPinToViewport,
  getVisibleMapRect,
  PIN_RADIUS_PX,
  MIN_CLEARANCE_PX,
  type Occluder,
  type ProjectableMap,
} from '../lib/viewport/occlusion';

// DOMRect polyfill for the Vitest node environment. The real browser
// DOMRect has `top/right/bottom/left` derived from x/y/width/height.
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

// Polyfill DOMRect globally so the lib code can call `new DOMRect(...)`.
if (typeof (globalThis as { DOMRect?: typeof DOMRect }).DOMRect === 'undefined') {
  (globalThis as unknown as { DOMRect: typeof TestDOMRect }).DOMRect = TestDOMRect;
}

const r = (x: number, y: number, w: number, h: number): DOMRect =>
  new TestDOMRect(x, y, w, h) as unknown as DOMRect;

const occluder = (id: string, rect: DOMRect | null): Occluder => ({
  id,
  getRect: () => rect,
});

// iPhone 13 viewport: 390 x 844.
const MAP_RECT = r(0, 0, 390, 844);

// Action pill is centered, ~52px tall, sits ~12px above the bottom.
const ACTION_PILL = r(80, 780, 230, 52);
// Swipe card covers the bottom ~60% of the screen.
const SWIPE_CARD = r(12, 380, 366, 380);

describe('isPinVisible', () => {
  it('reports visible when pin is fully clear of all occluders and inside the map', () => {
    const result = isPinVisible(
      { x: 195, y: 100 },
      MAP_RECT,
      [occluder('swipe-card', SWIPE_CARD), occluder('action-pill', ACTION_PILL)],
    );
    expect(result.visible).toBe(true);
    expect(result.occludedBy).toBeNull();
    expect(result.margin).toBeGreaterThan(MIN_CLEARANCE_PX);
  });

  it('reports occluded when pin sits under the swipe card', () => {
    const result = isPinVisible(
      { x: 195, y: 500 },
      MAP_RECT,
      [occluder('swipe-card', SWIPE_CARD), occluder('action-pill', ACTION_PILL)],
    );
    expect(result.visible).toBe(false);
    expect(result.occludedBy).toBe('swipe-card');
  });

  it('reports occluded when pin sits under the action pill', () => {
    const result = isPinVisible(
      { x: 195, y: 800 },
      MAP_RECT,
      [
        occluder('swipe-card', r(12, 12, 366, 200)), // small card up top so it's not the cause
        occluder('action-pill', ACTION_PILL),
      ],
    );
    expect(result.visible).toBe(false);
    expect(result.occludedBy).toBe('action-pill');
  });

  it('treats a 4px clip of the card edge as occluded due to hysteresis', () => {
    // Card top edge is at y=380. Place pin so its bottom (= y + radius) is at 384.
    // That's 4px inside the card's vertical extent → fails MIN_CLEARANCE check.
    const pinY = 380 + 4 - PIN_RADIUS_PX; // = 372 → bottom at 384
    const result = isPinVisible(
      { x: 195, y: pinY },
      MAP_RECT,
      [occluder('swipe-card', SWIPE_CARD)],
    );
    expect(result.visible).toBe(false);
    expect(result.occludedBy).toBe('swipe-card');
  });

  it('treats a 20px clearance above the card as visible', () => {
    // Pin bottom = 380 - 20 = 360 → pin center y = 360 - PIN_RADIUS_PX
    const pinY = 380 - 20 - PIN_RADIUS_PX;
    const result = isPinVisible(
      { x: 195, y: pinY },
      MAP_RECT,
      [occluder('swipe-card', SWIPE_CARD)],
    );
    expect(result.visible).toBe(true);
    expect(result.margin).toBeGreaterThanOrEqual(MIN_CLEARANCE_PX);
  });

  it('reports off-screen pin (above the map rect) as occluded by map-bounds', () => {
    const result = isPinVisible(
      { x: 195, y: -50 },
      MAP_RECT,
      [],
    );
    expect(result.visible).toBe(false);
    expect(result.occludedBy).toBe('map-bounds');
  });

  it('reports off-screen pin (right of the map rect) as occluded by map-bounds', () => {
    const result = isPinVisible(
      { x: 500, y: 100 },
      MAP_RECT,
      [],
    );
    expect(result.visible).toBe(false);
    expect(result.occludedBy).toBe('map-bounds');
  });

  it('handles multiple occluders, returning the worst overlap', () => {
    const result = isPinVisible(
      { x: 195, y: 500 }, // smack in the middle of the swipe card
      MAP_RECT,
      [occluder('action-pill', ACTION_PILL), occluder('swipe-card', SWIPE_CARD)],
    );
    expect(result.visible).toBe(false);
    expect(result.occludedBy).toBe('swipe-card');
  });

  it('ignores zero-sized or null-rect occluders', () => {
    const result = isPinVisible(
      { x: 195, y: 100 },
      MAP_RECT,
      [
        occluder('null-occ', null),
        occluder('zero-occ', r(0, 0, 0, 0)),
      ],
    );
    expect(result.visible).toBe(true);
  });

  it('respects custom pinRadius and minClearance options', () => {
    // With huge pin radius, the pin no longer fits next to the card.
    const result = isPinVisible(
      { x: 195, y: 360 }, // 20px above card top, normally OK
      MAP_RECT,
      [occluder('swipe-card', SWIPE_CARD)],
      { pinRadius: 30, minClearance: 30 },
    );
    expect(result.visible).toBe(false);
  });
});

describe('findVisiblePosition', () => {
  it('returns zero deltas when pin is already visible', () => {
    const out = findVisiblePosition(
      { x: 195, y: 100 },
      MAP_RECT,
      [occluder('swipe-card', SWIPE_CARD), occluder('action-pill', ACTION_PILL)],
    );
    expect(out.deltaY).toBe(0);
    expect(out.deltaX).toBe(0);
  });

  it('finds an upper band when pin is under the swipe card', () => {
    const out = findVisiblePosition(
      { x: 195, y: 500 }, // under card
      MAP_RECT,
      [occluder('swipe-card', SWIPE_CARD), occluder('action-pill', ACTION_PILL)],
    );
    expect(out.deltaY).not.toBeNull();
    expect(out.target).not.toBeNull();
    // Should land above the card (y + radius < card.top - clearance).
    expect(out.target!.y + PIN_RADIUS_PX).toBeLessThanOrEqual(SWIPE_CARD.top - MIN_CLEARANCE_PX);
  });

  it('returns null when occluders cover every horizontal slab in the pin column', () => {
    // Two stacked occluders that together cover the entire map vertically
    // in the pin's column.
    const top = r(0, 0, 390, 422);
    const bot = r(0, 422, 390, 422);
    const out = findVisiblePosition(
      { x: 195, y: 400 },
      MAP_RECT,
      [occluder('top', top), occluder('bot', bot)],
    );
    expect(out.deltaY).toBeNull();
    expect(out.target).toBeNull();
  });

  it('ignores occluders that do not overlap the pin column horizontally', () => {
    // Occluder is on the LEFT edge only. Pin is on the right.
    const leftPanel = r(0, 0, 80, 844);
    const out = findVisiblePosition(
      { x: 300, y: 400 },
      MAP_RECT,
      [occluder('left-panel', leftPanel)],
    );
    expect(out.deltaY).toBe(0);
  });
});

describe('getVisibleMapRect', () => {
  it('returns the full map rect when there are no occluders', () => {
    const out = getVisibleMapRect(MAP_RECT, []);
    expect(out).not.toBeNull();
    expect(out!.top).toBe(0);
    expect(out!.bottom).toBe(844);
    expect(out!.left).toBe(0);
    expect(out!.right).toBe(390);
  });

  it('shrinks the bottom edge for a bottom-anchored swipe card', () => {
    const out = getVisibleMapRect(MAP_RECT, [occluder('swipe-card', SWIPE_CARD)]);
    expect(out).not.toBeNull();
    expect(out!.top).toBe(0);
    // Swipe card top is 380 — visible region ends MIN_CLEARANCE_PX above
    // the card so it stays in sync with isPinVisible's hysteresis.
    expect(out!.bottom).toBe(380 - MIN_CLEARANCE_PX);
    expect(out!.left).toBe(0);
    expect(out!.right).toBe(390);
  });

  it('uses the highest top edge among multiple bottom-anchored occluders', () => {
    // Action pill (top=780) and swipe card (top=380). Swipe card wins
    // because its top is HIGHER (smaller y) — it occludes more.
    const out = getVisibleMapRect(MAP_RECT, [
      occluder('action-pill', ACTION_PILL),
      occluder('swipe-card', SWIPE_CARD),
    ]);
    expect(out).not.toBeNull();
    expect(out!.bottom).toBe(380 - MIN_CLEARANCE_PX);
  });

  it('shrinks the top edge for a top-anchored nav bar', () => {
    // Top nav: 60px tall at the top of the viewport.
    const topNav = r(0, 0, 390, 60);
    const out = getVisibleMapRect(MAP_RECT, [occluder('top-nav', topNav)]);
    expect(out).not.toBeNull();
    expect(out!.top).toBe(60 + MIN_CLEARANCE_PX);
    expect(out!.bottom).toBe(844);
  });

  it('handles top + bottom occluders simultaneously (L-shape collapsed to bbox)', () => {
    const topNav = r(0, 0, 390, 60);
    const out = getVisibleMapRect(MAP_RECT, [
      occluder('top-nav', topNav),
      occluder('swipe-card', SWIPE_CARD),
    ]);
    expect(out).not.toBeNull();
    expect(out!.top).toBe(60 + MIN_CLEARANCE_PX);
    expect(out!.bottom).toBe(380 - MIN_CLEARANCE_PX);
  });

  it('returns null when an occluder fully covers the map', () => {
    const cover = r(0, 0, 390, 844);
    const out = getVisibleMapRect(MAP_RECT, [occluder('cover', cover)]);
    expect(out).toBeNull();
  });

  it('ignores occluders that do not overlap the map horizontally', () => {
    // Off to the right of the map (map is 0..390).
    const sidePanel = r(500, 100, 100, 400);
    const out = getVisibleMapRect(MAP_RECT, [occluder('side', sidePanel)]);
    expect(out).not.toBeNull();
    expect(out!.bottom).toBe(844);
    expect(out!.top).toBe(0);
  });

  it('ignores occluders that do not overlap the map vertically', () => {
    // Above the map (map starts at y=0).
    const above = r(0, -200, 390, 100);
    const out = getVisibleMapRect(MAP_RECT, [occluder('above', above)]);
    expect(out).not.toBeNull();
    expect(out!.top).toBe(0);
    expect(out!.bottom).toBe(844);
  });

  it('ignores zero-sized and null-rect occluders', () => {
    const out = getVisibleMapRect(MAP_RECT, [
      occluder('null', null),
      occluder('zero', r(0, 0, 0, 0)),
    ]);
    expect(out!.top).toBe(0);
    expect(out!.bottom).toBe(844);
  });

  it('returns null for a degenerate map rect', () => {
    expect(getVisibleMapRect(r(0, 0, 0, 0), [])).toBeNull();
    expect(getVisibleMapRect(r(0, 0, 100, 0), [])).toBeNull();
  });

  // Invariant: a pin sitting exactly at an edge of the visible rect
  // that was shrunk by an occluder MUST also be considered visible by
  // isPinVisible given the same map rect + occluders. This guarantees
  // no "phantom pin auto-pan" where the bounds query includes a pin
  // that isPinVisible's 16px hysteresis then rejects.
  //
  // NOTE: the invariant applies only to edges actually SHRUNK by an
  // occluder. Edges left at mapRect.top/bottom are separately governed
  // by isPinVisible's own map-bounds clearance — that's a different
  // contract (keeping pins off the very edge of the viewport).
  it('invariant: a pin at the bottom edge of the visible rect passes isPinVisible (shrunk-edge case)', () => {
    const occluders = [
      occluder('swipe-card', SWIPE_CARD),
      occluder('action-pill', ACTION_PILL),
    ];
    const visible = getVisibleMapRect(MAP_RECT, occluders);
    expect(visible).not.toBeNull();

    // Pin centered horizontally inside the visible rect, hugging the
    // bottom edge (pin-center.y = visible.bottom - PIN_RADIUS_PX so the
    // pin's bottom coincides with the visible rect's bottom).
    const pinAtBottomEdge = {
      x: visible!.left + visible!.width / 2,
      y: visible!.bottom - PIN_RADIUS_PX,
    };
    const bottomResult = isPinVisible(pinAtBottomEdge, MAP_RECT, occluders);
    expect(bottomResult.visible).toBe(true);
    expect(bottomResult.occludedBy).toBeNull();
  });

  it('invariant: a pin at the top edge of the visible rect passes isPinVisible when top was shrunk', () => {
    const topNav = r(0, 0, 390, 60);
    const occluders = [
      occluder('top-nav', topNav),
      occluder('swipe-card', SWIPE_CARD),
    ];
    const visible = getVisibleMapRect(MAP_RECT, occluders);
    expect(visible).not.toBeNull();

    const pinAtTopEdge = {
      x: visible!.left + visible!.width / 2,
      y: visible!.top + PIN_RADIUS_PX,
    };
    const topResult = isPinVisible(pinAtTopEdge, MAP_RECT, occluders);
    expect(topResult.visible).toBe(true);
    expect(topResult.occludedBy).toBeNull();

    const pinAtBottomEdge = {
      x: visible!.left + visible!.width / 2,
      y: visible!.bottom - PIN_RADIUS_PX,
    };
    const bottomResult = isPinVisible(pinAtBottomEdge, MAP_RECT, occluders);
    expect(bottomResult.visible).toBe(true);
    expect(bottomResult.occludedBy).toBeNull();
  });
});

describe('projectPinToViewport', () => {
  // Tiny mock that mimics the slice of Leaflet's `Map` interface we depend
  // on. Container rect is (10, 20, 390, 844) — i.e. shifted off the
  // viewport origin so the projection's add-of-rect-offset is exercised.
  const mockMap = (
    containerPointFn: (latlng: [number, number]) => { x: number; y: number },
  ): ProjectableMap => ({
    latLngToContainerPoint: containerPointFn,
    getContainer: () => ({
      getBoundingClientRect: () => r(10, 20, 390, 844),
    }),
  });

  it('returns container-rect-offset viewport coords on success', () => {
    const map = mockMap(() => ({ x: 100, y: 200 }));
    const out = projectPinToViewport(map, 40.7128, -74.006);
    expect(out).toEqual({ x: 110, y: 220 }); // (10 + 100, 20 + 200)
  });

  it('returns null when latLngToContainerPoint throws', () => {
    const map = mockMap(() => {
      throw new Error('detached map');
    });
    const out = projectPinToViewport(map, 40.7128, -74.006);
    expect(out).toBeNull();
  });

  it('returns null when projection yields NaN (degenerate map size)', () => {
    const map = mockMap(() => ({ x: NaN, y: NaN }));
    const out = projectPinToViewport(map, 40.7128, -74.006);
    expect(out).toBeNull();
  });

  it('handles negative container points (pin off-screen)', () => {
    const map = mockMap(() => ({ x: -50, y: -75 }));
    const out = projectPinToViewport(map, 40.7128, -74.006);
    expect(out).toEqual({ x: -40, y: -55 });
  });
});
