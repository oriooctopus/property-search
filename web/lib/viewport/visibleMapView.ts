/**
 * visibleMapView — canonical, occlusion-aware queries against a Leaflet map.
 *
 * Every code path that asks one of:
 *   - "what point on the map is the user actually looking at?"
 *   - "where should I pan so this listing's pin is actually visible?"
 *
 * MUST go through this module. Callers do not get to read `map.getCenter()`
 * or call `map.setView([lat,lng], ...)` directly when the answer needs to
 * respect mobile chrome (swipe card, action pill, top nav, etc.).
 *
 * Why this exists: we already have `getVisibleMapRect` for reasoning about
 * *which area* of the map is visible, but the rest of the map API
 * (`getCenter`, `setView`, `panTo`) reasons about the FULL container. Using
 * those raw APIs in occluded-mobile mode silently picks pins behind the
 * swipe card or pans them out of sight. The fix is to wrap them in helpers
 * that take an `occluders` argument and translate "visible center" /
 * "visible target" into the corresponding raw container coordinates Leaflet
 * needs.
 *
 * Design notes:
 *   - Both helpers REQUIRE an `occluders` argument. There is no optional
 *     escape hatch — a caller that genuinely doesn't have occluders can
 *     pass an empty list, and the helper degrades gracefully (full-rect
 *     center, no offset). This is intentional: forcing the parameter at
 *     the type level makes the wrong choice loud (you have to type
 *     literally `[]`) instead of silent (you forget to read it).
 *   - On desktop or any environment where no occluders are registered,
 *     `getVisibleMapRect` returns the full map rect unchanged, so these
 *     helpers behave identically to the raw Leaflet APIs.
 */

import type { Map as LeafletMap, LatLng } from 'leaflet';
import { getVisibleMapRect, type Occluder } from './occlusion';

interface OccluderSource {
  getAll: () => Occluder[];
}

/**
 * Returns the geographic point at the center of the visible (occlusion-aware)
 * map rect. On desktop / no-occluder environments this matches
 * `map.getCenter()`. On mobile with chrome registered, it shifts upward (or
 * inward) so the returned point sits in the actually-visible band.
 *
 * Use this any time you need "where the user is looking" — for example, the
 * `nearestTo` payload sent to `/api/listings/search` from the empty-state
 * "Find nearest" CTA. NEVER call `map.getCenter()` for that purpose: on
 * mobile it points to a spot underneath the swipe card and the API will
 * happily return a listing whose pin lands behind the card.
 *
 * @param map        Live Leaflet map.
 * @param occluders  Currently-mounted occluders (pass `[]` if genuinely none).
 * @returns          The visible-center as a Leaflet LatLng. Falls back to
 *                   `map.getCenter()` when the occlusion model can't compute
 *                   a visible rect (e.g. occluders cover everything).
 */
export function getVisibleCenter(
  map: LeafletMap,
  occluders: Occluder[] | OccluderSource,
): LatLng {
  const list = Array.isArray(occluders) ? occluders : occluders.getAll();
  const mapRect = map.getContainer().getBoundingClientRect();
  const visible = getVisibleMapRect(mapRect, list);
  if (!visible) {
    // Fully occluded — best we can do is the raw center.
    return map.getCenter();
  }
  // Translate the viewport-space visible center into the map's container
  // coordinate space, then to LatLng.
  const containerX = visible.left + visible.width / 2 - mapRect.left;
  const containerY = visible.top + visible.height / 2 - mapRect.top;
  return map.containerPointToLatLng([containerX, containerY]);
}

export interface PanToShowOptions {
  /** Minimum zoom level after the pan. Never zooms further OUT than `map.getZoom()`. */
  minZoom?: number;
  /** Forwarded to `map.setView` (animate, duration, easeLinearity, etc.). */
  setViewOptions?: Parameters<LeafletMap['setView']>[2];
}

/**
 * Pan (and optionally zoom in to) the given lat/lng such that it lands at
 * the center of the visible (occlusion-aware) map rect — NOT at the
 * container center. On mobile this means the target pin lands above the
 * swipe card / action pill instead of behind them.
 *
 * Concretely: the new map center is offset from the target by half the gap
 * between the visible-rect center and the container center. Leaflet then
 * renders the target at the visible center.
 *
 * If the visible rect can't be computed (occluders cover everything), this
 * falls back to a plain `map.setView(target, …)` so the pan still happens.
 *
 * @param map        Live Leaflet map.
 * @param lat        Target latitude.
 * @param lng        Target longitude.
 * @param occluders  Currently-mounted occluders (pass `[]` if genuinely none).
 * @param opts       Zoom + Leaflet setView options.
 */
export function panMapToShowLatLng(
  map: LeafletMap,
  lat: number,
  lng: number,
  occluders: Occluder[] | OccluderSource,
  opts: PanToShowOptions = {},
): void {
  const list = Array.isArray(occluders) ? occluders : occluders.getAll();
  const mapRect = map.getContainer().getBoundingClientRect();
  const visible = getVisibleMapRect(mapRect, list);

  const currentZoom = map.getZoom();
  const targetZoom = opts.minZoom != null ? Math.max(currentZoom, opts.minZoom) : currentZoom;
  const setViewOptions = opts.setViewOptions ?? { animate: true };

  if (!visible) {
    map.setView([lat, lng], targetZoom, setViewOptions);
    return;
  }

  // We want the TARGET to render at the visible-rect center. Leaflet renders
  // `map.getCenter()` at the container center. Therefore the new center
  // must be the target shifted by the OPPOSITE of (visible-center - container-center).
  // i.e. newCenter = target - (visibleCenter - containerCenter)
  //                = target + (containerCenter - visibleCenter)
  //
  // We compute that delta in CONTAINER pixel space, project the target into
  // container space at the new zoom, add the delta, then unproject back to
  // LatLng to feed setView.
  const containerCenterX = mapRect.width / 2;
  const containerCenterY = mapRect.height / 2;
  const visibleCenterX = visible.left + visible.width / 2 - mapRect.left;
  const visibleCenterY = visible.top + visible.height / 2 - mapRect.top;
  const dx = containerCenterX - visibleCenterX;
  const dy = containerCenterY - visibleCenterY;

  // Project at the TARGET zoom (pixel offsets are zoom-dependent in Leaflet).
  const targetPoint = map.project([lat, lng], targetZoom);
  // Leaflet's Point.subtract accepts a [number, number] PointExpression.
  const newCenterPoint = targetPoint.subtract([dx, dy]);
  const newCenter = map.unproject(newCenterPoint, targetZoom);

  map.setView(newCenter, targetZoom, setViewOptions);
}
