/**
 * Unit tests for the viewport-occlusion model.
 *
 * Run with: npx vitest run tests/occlusion.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  isPinVisible,
  findVisiblePosition,
  PIN_RADIUS_PX,
  MIN_CLEARANCE_PX,
  type Occluder,
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
