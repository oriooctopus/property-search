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
  // newCenter = target + (containerCenter - visibleCenter) = target + (dx, dy)
  // (see derivation above). For a bottom occluder dy > 0, so the new center is
  // SOUTH of the target, which lifts the target UP into the visible band.
  // (Previously this used .subtract, which pushed the target the wrong way —
  // deeper into the occluded band — shifting viewport queries north of it.)
  const newCenterPoint = targetPoint.add([dx, dy]);
  const newCenter = map.unproject(newCenterPoint, targetZoom);

  map.setView(newCenter, targetZoom, setViewOptions);
}

export interface LatLngBounds {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

/**
 * Reference viewport (CSS px) used by `boundsForZoom15AtPoint` below when
 * there is no live map container to measure at all — see that function's
 * comment for why. 390x844 matches the device this was reproduced and
 * fixed against (an iPhone 12/13/14-class logical viewport): if the user
 * switched from list view to map/swipe view right now, THAT is
 * approximately the container panMapToShowLatLng would actually pan, so
 * using it here is what keeps the list-view search area agreeing with what
 * the map would show for the same selection.
 */
const ASSUMED_VIEWPORT_PX = { width: 390, height: 844 };

// Web Mercator / Leaflet tiling convention (matches L.CRS.EPSG3857):
// https://wiki.openstreetmap.org/wiki/Zoom_levels
const TILE_SIZE_PX = 256;
const EARTH_CIRCUMFERENCE_M = 40075016.686;
// Meters per degree of latitude. This varies slightly with latitude
// (~110,574m at the equator to ~111,694m at the poles) — 111,320 is the
// commonly-used mid-latitude approximation, accurate to well under 1% at
// NYC's ~40.7°N. Not validated near the poles.
const METERS_PER_DEGREE_LAT = 111320;

/**
 * Bounding box centered on (lat, lon) approximating what
 * `panMapToShowLatLng(map, lat, lon, [], { minZoom: 15 })` would put on
 * screen, computed WITHOUT a live map instance.
 *
 * Why this exists: mobile LIST view has no visible Leaflet container — the
 * map panel is CSS `display:none` there (see HomeClient.tsx's
 * `mapPanelMobileClass`), so `.leaflet-container` measures 0x0. Repro
 * (before this fix): selecting a place in list view still called
 * `panMapToShowLatLng` on that 0-sized map, which set its internal view
 * fine, but `map.getBounds()` on a 0x0 container collapses to a
 * degenerate single-point box (`latMin === latMax`) — MapInner's
 * BoundsWatcher explicitly guards against firing on that degenerate box,
 * so the listings query never re-ran and the list never changed. Selecting
 * a place from list view still needs SOME search area, so this derives one
 * directly from the picked coordinates instead of reading it off the dead
 * map.
 *
 * Math: standard Web Mercator ground resolution at zoom z, latitude φ is
 * `metersPerPixel = EARTH_CIRCUMFERENCE_M * cos(φ) / (TILE_SIZE_PX * 2^z)`.
 * Longitude is linear in Web Mercator x, so converting a pixel width back
 * to degrees is `(px / (TILE_SIZE_PX * 2^z)) * 360` — the cos(φ) term
 * cancels out exactly (this is a property of the projection, not an
 * approximation: metersPerPixel * px / (111320 * cos φ) reduces to the same
 * expression). Latitude is NOT linear in Web Mercator y, but the
 * projection is locally conformal (isotropic) at any given point, so using
 * the same ground-resolution figure for the height and dividing by
 * METERS_PER_DEGREE_LAT is accurate to well under 1% at NYC's latitude.
 * NYC-only scope is intentional — see tests/visible-map-view.test.ts.
 */
export function boundsForZoom15AtPoint(lat: number, lon: number): LatLngBounds {
  const zoomScale = TILE_SIZE_PX * Math.pow(2, 15);
  const metersPerPixel = (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / zoomScale;
  const lonDeltaDeg = ((ASSUMED_VIEWPORT_PX.width / 2) / zoomScale) * 360;
  const latDeltaDeg = ((ASSUMED_VIEWPORT_PX.height / 2) * metersPerPixel) / METERS_PER_DEGREE_LAT;
  return {
    latMin: lat - latDeltaDeg,
    latMax: lat + latDeltaDeg,
    lonMin: lon - lonDeltaDeg,
    lonMax: lon + lonDeltaDeg,
  };
}
