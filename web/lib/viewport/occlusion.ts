/**
 * Pure viewport-occlusion math for the mobile pin-visibility model.
 *
 * Replaces the two ad-hoc geometry checks that used to live inline in
 * SwipeView (`isVisibleAboveCard`) and MapInner (`EnsurePinVisibleOnMobile`).
 *
 * Single source of truth for "is the active pin actually visible to the
 * user, treating the pin as a circle and every UI chrome element as a
 * rectangular occluder." All math is in viewport coordinates (DOMRect
 * space) — no mixing with map's container-relative space at this layer.
 */

export const PIN_RADIUS_PX = 12;
export const MIN_CLEARANCE_PX = 16;

export interface Occluder {
  /** Stable identifier (e.g. "swipe-card", "action-pill", "top-nav"). */
  id: string;
  /** Returns the occluder's current viewport rect, or null if not mounted. */
  getRect: () => DOMRect | null;
}

export interface ViewportPoint {
  x: number;
  y: number;
}

export interface VisibilityResult {
  visible: boolean;
  /** First occluder that fails the clearance test, or null if visible. */
  occludedBy: string | null;
  /**
   * Signed margin in pixels.
   *  - When `visible`: smallest clearance to any occluder edge or to the
   *    map rect's edges (positive). Larger = more clearance.
   *  - When NOT visible: signed overlap (≤ minClearance). Negative or
   *    zero values mean the pin's circle either intersects an occluder
   *    or sits closer than the hysteresis allows.
   */
  margin: number;
}

export interface IsPinVisibleOptions {
  pinRadius?: number;
  minClearance?: number;
}

/**
 * Returns the rectangle that bounds the pin's circle in viewport coords.
 */
export function pinRect(point: ViewportPoint, radius: number = PIN_RADIUS_PX): DOMRect {
  return new DOMRect(point.x - radius, point.y - radius, radius * 2, radius * 2);
}

/**
 * Distance the moving rect would have to be pushed away from the static
 * rect to stop overlapping. Negative distances mean they DON'T overlap;
 * the absolute value is the gap between them on the closest axis.
 *
 * Concretely: if `moving` and `static` intersect, returns the smallest
 * axis-aligned overlap (positive). If they don't intersect, returns the
 * negation of the smallest axis-aligned gap (so callers can compare a
 * single number against a clearance threshold: `overlap >= -clearance`
 * means "fails clearance").
 */
function rectOverlap(moving: DOMRect, target: DOMRect): number {
  const overlapX = Math.min(moving.right, target.right) - Math.max(moving.left, target.left);
  const overlapY = Math.min(moving.bottom, target.bottom) - Math.max(moving.top, target.top);

  if (overlapX > 0 && overlapY > 0) {
    // Intersecting: positive overlap == the smaller of the two axis overlaps.
    return Math.min(overlapX, overlapY);
  }

  // Not intersecting: gap is the larger of the two negative axis distances
  // (closer to zero means smaller gap). Return as a negative number whose
  // magnitude is the smallest gap.
  const gapX = overlapX <= 0 ? -overlapX : 0;
  const gapY = overlapY <= 0 ? -overlapY : 0;
  // The actual minimum gap is the larger of the two non-zero axis gaps
  // ONLY when both are non-zero (diagonal separation). When only one
  // axis separates them, that axis IS the gap.
  let gap: number;
  if (gapX > 0 && gapY > 0) gap = Math.hypot(gapX, gapY);
  else if (gapX > 0) gap = gapX;
  else gap = gapY;
  return -gap;
}

/**
 * Is the pin (treated as a circle of `pinRadius`) visible inside the
 * map rect, with at least `minClearance` clearance from every occluder
 * AND from the map rect's own edges?
 *
 * All inputs are in VIEWPORT coordinates (the same coord space as
 * `Element.getBoundingClientRect()`).
 *
 * @param pinViewportPoint  Center of the pin in viewport coords.
 * @param mapRect           Bounding rect of the map container in viewport coords.
 * @param occluders         List of currently-mounted occluders (action pill,
 *                          swipe card, top nav, etc.). `getRect()` is invoked
 *                          synchronously; callers should sample once per frame.
 * @param opts.pinRadius    Defaults to PIN_RADIUS_PX.
 * @param opts.minClearance Defaults to MIN_CLEARANCE_PX. Hysteresis margin —
 *                          a pin clipping an occluder by less than this
 *                          counts as occluded so we don't oscillate.
 */
export function isPinVisible(
  pinViewportPoint: ViewportPoint,
  mapRect: DOMRect,
  occluders: Occluder[],
  opts: IsPinVisibleOptions = {},
): VisibilityResult {
  const pinRadius = opts.pinRadius ?? PIN_RADIUS_PX;
  const minClearance = opts.minClearance ?? MIN_CLEARANCE_PX;
  const pin = pinRect(pinViewportPoint, pinRadius);

  // 1. Pin must lie fully inside the map rect (with clearance).
  const insetMap = new DOMRect(
    mapRect.left + minClearance,
    mapRect.top + minClearance,
    Math.max(0, mapRect.width - 2 * minClearance),
    Math.max(0, mapRect.height - 2 * minClearance),
  );
  if (
    pin.left < insetMap.left ||
    pin.right > insetMap.right ||
    pin.top < insetMap.top ||
    pin.bottom > insetMap.bottom
  ) {
    // Compute how far we're outside the inset (positive == out of bounds amount).
    const outLeft = insetMap.left - pin.left;
    const outRight = pin.right - insetMap.right;
    const outTop = insetMap.top - pin.top;
    const outBottom = pin.bottom - insetMap.bottom;
    const overflow = Math.max(outLeft, outRight, outTop, outBottom);
    return {
      visible: false,
      occludedBy: 'map-bounds',
      margin: -overflow,
    };
  }

  // 2. Pin must clear every occluder by ≥ minClearance.
  let worstOccluder: string | null = null;
  let worstMargin = Number.POSITIVE_INFINITY; // Track the smallest clearance among occluders.

  for (const occ of occluders) {
    const rect = occ.getRect();
    if (!rect) continue;
    if (rect.width <= 0 || rect.height <= 0) continue;

    const overlap = rectOverlap(pin, rect);
    // overlap > 0          → intersecting
    // overlap == 0         → touching
    // -minClearance <= overlap <= 0 → too close (fails hysteresis)
    // overlap < -minClearance → safely clear of this occluder
    if (overlap > -minClearance) {
      // This occluder defeats visibility. Pick the worst (most overlapping).
      if (overlap > -minClearance && (worstOccluder === null || overlap > worstMargin)) {
        worstOccluder = occ.id;
        worstMargin = overlap;
      }
    } else {
      // Track best (smallest) clearance for the visible-result margin.
      const clearance = -overlap; // positive: how far we cleared this occluder.
      if (clearance < worstMargin) worstMargin = clearance;
    }
  }

  if (worstOccluder !== null) {
    return { visible: false, occludedBy: worstOccluder, margin: worstMargin };
  }

  // Visible. `worstMargin` here is the smallest occluder clearance, OR
  // POSITIVE_INFINITY if no occluders. Clamp the latter to a sensible
  // value so callers can format it.
  const margin = Number.isFinite(worstMargin) ? worstMargin : Math.max(mapRect.width, mapRect.height);
  return { visible: true, occludedBy: null, margin };
}

/**
 * Sample every occluder's rect plus the map rect in a single synchronous
 * sweep. Use this when calling `isPinVisible` to ensure all rects are
 * read in the same frame (no async waits between reads).
 */
export function sampleAllRects(
  occluders: Occluder[],
): Map<string, DOMRect> {
  const out = new Map<string, DOMRect>();
  for (const occ of occluders) {
    const rect = occ.getRect();
    if (rect) out.set(occ.id, rect);
  }
  return out;
}

export interface FindVisiblePositionResult {
  /**
   * Pixel delta to add to the pin's CURRENT viewport y so it lands in a
   * visible region. Positive = move down, negative = move up. Null if no
   * visible region exists in the map rect (e.g. occluders cover everything).
   */
  deltaY: number | null;
  /** Pixel delta on the x axis. Null when no visible region exists. */
  deltaX: number | null;
  /** Target viewport-space center of the pin. Null when no region exists. */
  target: ViewportPoint | null;
}

/**
 * Compute the closest viewport point that satisfies `isPinVisible`.
 *
 * Used by EnsurePinVisibleOnMobile to compute a pan offset: it finds the
 * tallest non-occluded horizontal band inside the map rect and snaps the
 * pin into the vertical center of that band (subject to clearance).
 *
 * The X axis is left untouched (we never want lateral pans for
 * occlusion). Only Y is adjusted unless the pin is also outside the map
 * rect horizontally, in which case we clamp.
 */
export function findVisiblePosition(
  pinViewportPoint: ViewportPoint,
  mapRect: DOMRect,
  occluders: Occluder[],
  opts: IsPinVisibleOptions = {},
): FindVisiblePositionResult {
  const pinRadius = opts.pinRadius ?? PIN_RADIUS_PX;
  const minClearance = opts.minClearance ?? MIN_CLEARANCE_PX;

  // Already visible? No move needed.
  const current = isPinVisible(pinViewportPoint, mapRect, occluders, opts);
  if (current.visible) {
    return { deltaY: 0, deltaX: 0, target: { ...pinViewportPoint } };
  }

  // Determine the open vertical bands inside the map rect by subtracting
  // the y-extent of any occluder whose x-extent overlaps the pin's column.
  // We take a SLAB at the pin's x position: only occluders that horizontally
  // intersect the pin's vertical column matter. (Occluders entirely to the
  // left or right of the pin don't actually cover the pin if we just pan up
  // or down.)
  const pinLeft = pinViewportPoint.x - pinRadius;
  const pinRight = pinViewportPoint.x + pinRadius;

  type Band = { top: number; bottom: number };
  // Start with the full inset map rect as one open band.
  let openBands: Band[] = [
    { top: mapRect.top + minClearance + pinRadius, bottom: mapRect.bottom - minClearance - pinRadius },
  ];

  for (const occ of occluders) {
    const r = occ.getRect();
    if (!r) continue;
    if (r.width <= 0 || r.height <= 0) continue;
    // Does this occluder's horizontal extent overlap the pin column?
    const hOverlap = Math.min(r.right, pinRight) - Math.max(r.left, pinLeft);
    if (hOverlap <= 0) continue;
    // Forbidden y range = occluder y bounds expanded by clearance + pin radius.
    const forbiddenTop = r.top - minClearance - pinRadius;
    const forbiddenBottom = r.bottom + minClearance + pinRadius;

    const next: Band[] = [];
    for (const b of openBands) {
      // Subtract [forbiddenTop, forbiddenBottom] from [b.top, b.bottom].
      if (forbiddenBottom <= b.top || forbiddenTop >= b.bottom) {
        next.push(b);
        continue;
      }
      if (forbiddenTop > b.top) next.push({ top: b.top, bottom: Math.min(b.bottom, forbiddenTop) });
      if (forbiddenBottom < b.bottom) next.push({ top: Math.max(b.top, forbiddenBottom), bottom: b.bottom });
    }
    openBands = next.filter((b) => b.bottom - b.top >= 1);
    if (openBands.length === 0) break;
  }

  if (openBands.length === 0) {
    return { deltaY: null, deltaX: null, target: null };
  }

  // Pick the band whose center is closest to the pin's current y. Ties
  // broken by larger band height (more breathing room).
  let bestBand = openBands[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const b of openBands) {
    const center = (b.top + b.bottom) / 2;
    const distance = Math.abs(center - pinViewportPoint.y);
    if (distance < bestScore) {
      bestScore = distance;
      bestBand = b;
    }
  }

  // Target y: clamp pin's current y into the band so we move as little
  // as possible (snap-to-band rather than snap-to-center). This avoids
  // unnecessary large pans when the pin is just barely in a forbidden
  // strip.
  const targetY = Math.min(bestBand.bottom, Math.max(bestBand.top, pinViewportPoint.y));
  const targetX = pinViewportPoint.x;

  return {
    deltaY: targetY - pinViewportPoint.y,
    deltaX: targetX - pinViewportPoint.x,
    target: { x: targetX, y: targetY },
  };
}
