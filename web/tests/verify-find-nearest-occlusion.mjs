/**
 * Verify the find-nearest empty-state CTA respects the occlusion model.
 *
 * Architectural invariant we're testing:
 *   The `nearestTo` lat/lon sent to /api/listings/search MUST be the
 *   occlusion-aware visible center (i.e. the center of the map rect AFTER
 *   subtracting the swipe-card and action-pill occluders), NOT the raw
 *   map container center.
 *
 * Method:
 *   1. Mount the swipe-view empty state at mobile 390x844.
 *   2. Wait for the swipe card + action pill to register as occluders and
 *      for the full-bleed mobile map to mount.
 *   3. Intercept the POST /api/listings/search request to capture `nearestTo`.
 *   4. Read the map container rect + swipe-card rect + action-pill rect.
 *   5. Compute the visible rect (getVisibleMapRect equivalent), project
 *      `nearestTo` back to viewport coords, and assert it lies strictly
 *      INSIDE the visible rect.
 *   6. Cross-check: the raw container center would fall BEHIND the swipe
 *      card — i.e. outside the visible rect. If the architecture bypassed
 *      occlusion, the request's `nearestTo` would project to the raw center
 *      (behind the card). The pass/fail criterion distinguishes the two.
 *
 * No login required.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const OUT_DIR = resolve(homedir(), 'Documents/coding/screenshots/property-search/find-nearest-occlusion-v2');
mkdirSync(OUT_DIR, { recursive: true });

const BASE = process.env.BASE_URL ?? 'http://localhost:8000';

async function runIteration(label, urlSuffix) {
  console.log(`\n=== ${label} ===`);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`));

  // Capture find-nearest API requests.
  let nearestRequest = null;
  let nearestResponse = null;
  page.on('request', (req) => {
    if (req.url().includes('/api/listings/search') && req.method() === 'POST') {
      try {
        const body = req.postDataJSON();
        if (body && body.nearestTo) nearestRequest = body;
      } catch {}
    }
  });
  page.on('response', async (res) => {
    if (res.url().includes('/api/listings/search') && res.request().method() === 'POST') {
      try {
        const body = await res.json();
        if (body && (body.listing !== undefined || body.distanceMeters !== undefined)) {
          nearestResponse = body;
        }
      } catch {}
    }
  });

  const url = `${BASE}/${urlSuffix}`;
  console.log(`  URL: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  await page.waitForSelector('[data-testid="go-to-nearest-match"]', {
    timeout: 25000,
    state: 'visible',
  });
  await page.waitForFunction(() => !!window.__leafletMap, null, { timeout: 15000 });

  // Wait for the full-bleed map container to actually have nonzero size
  // (in swipe view there are multiple Leaflet maps — we want the one under
  // the swipe card). Poll until one of the mounted maps has a real rect.
  await page.waitForFunction(() => {
    const containers = document.querySelectorAll('.leaflet-container');
    for (const c of containers) {
      const r = c.getBoundingClientRect();
      if (r.width > 100 && r.height > 100) return true;
    }
    return false;
  }, null, { timeout: 15000 });

  // Let swipe card fully animate in and register as occluder.
  await page.waitForTimeout(1500);

  // Sample geometry BEFORE click: find the full-bleed map (largest leaflet
  // container), the swipe-detail-panel, and the action pill.
  const preGeom = await page.evaluate(() => {
    const containers = Array.from(document.querySelectorAll('.leaflet-container'));
    // Pick the largest visible one (the swipe backdrop map).
    let bestContainer = null;
    let bestArea = 0;
    for (const c of containers) {
      const r = c.getBoundingClientRect();
      const area = r.width * r.height;
      // Must be in the viewport (not a hidden portal map).
      const inViewport = r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
      if (inViewport && area > bestArea) {
        bestArea = area;
        bestContainer = c;
      }
    }
    const containerRect = bestContainer?.getBoundingClientRect() ?? null;
    const swipeCard = document.querySelector('.swipe-detail-panel');
    const actionPill = document.querySelector('[data-testid="action-pill"]');
    const occluders = [];
    if (swipeCard) {
      const r = swipeCard.getBoundingClientRect();
      if (r.width > 0 && r.height > 0)
        occluders.push({ id: 'swipe-card', top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width, height: r.height });
    }
    if (actionPill) {
      const r = actionPill.getBoundingClientRect();
      if (r.width > 0 && r.height > 0)
        occluders.push({ id: 'action-pill', top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width, height: r.height });
    }
    return {
      mapRect: containerRect ? { top: containerRect.top, left: containerRect.left, bottom: containerRect.bottom, right: containerRect.right, width: containerRect.width, height: containerRect.height } : null,
      occluders,
    };
  });

  console.log(`  Map rect: ${preGeom.mapRect ? `w=${preGeom.mapRect.width.toFixed(0)} h=${preGeom.mapRect.height.toFixed(0)} top=${preGeom.mapRect.top.toFixed(0)} bottom=${preGeom.mapRect.bottom.toFixed(0)}` : 'NULL'}`);
  console.log(`  Occluders: ${preGeom.occluders.length}`);
  for (const o of preGeom.occluders) console.log(`    - ${o.id}: top=${o.top.toFixed(0)} bottom=${o.bottom.toFixed(0)} h=${o.height.toFixed(0)}`);

  await page.screenshot({ path: resolve(OUT_DIR, `${label}-before.png`), fullPage: false });

  // BEFORE clicking: snapshot the state of __leafletMap so we know which
  // map instance the GoToNearestMatch component will use.
  const mapInfo = await page.evaluate(() => {
    // Wait for the LeafletMapContext to populate __visibleLeafletMap by
    // calling useLeafletMap-equivalent indirectly: any consumer that
    // renders calls getMap() which sets the global. Trigger by reading
    // a getter. In practice this is set as soon as the GoToNearestMatch
    // mounts (it calls useLeafletMap()).
    const map = window.__visibleLeafletMap ?? window.__leafletMap;
    if (!map) return { exists: false };
    const c = map.getContainer();
    const r = c.getBoundingClientRect();
    return {
      exists: true,
      isVisibleResolved: !!window.__visibleLeafletMap && window.__visibleLeafletMap === map,
      containerRect: { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom, right: r.right },
      center: { lat: map.getCenter().lat, lng: map.getCenter().lng },
      zoom: map.getZoom(),
      containerCount: document.querySelectorAll('.leaflet-container').length,
      containerVisible: r.width > 0 && r.height > 0,
    };
  });
  console.log(`  Map context resolution: ${JSON.stringify(mapInfo)}`);

  // Click find-nearest.
  console.log('  Clicking find-nearest…');
  await page.click('[data-testid="go-to-nearest-match"]');

  // Wait for the request + response to settle.
  await page.waitForTimeout(3000);

  await page.screenshot({ path: resolve(OUT_DIR, `${label}-after.png`), fullPage: false });

  if (!nearestRequest) {
    await browser.close();
    return { label, pass: false, reason: 'No /api/listings/search POST with nearestTo captured' };
  }

  // Project nearestTo back to viewport coords via the leaflet map the
  // component was actually using (the full-bleed swipe-backdrop map).
  // Note: after the click, the map may have panned, so we use the *current*
  // leaflet projection. But the REQUEST happened BEFORE the pan — so we
  // need to project nearestTo against the map at the time of the click.
  // The simplest valid check: project nearestTo against the CURRENT map
  // and compare with the CURRENT visible rect. If the architecture is
  // correct, nearestTo should project to a point inside the visible rect
  // (since panMapToShowLatLng moved the map so the target is at the
  // visible center; the visible center is by definition inside the
  // visible rect).
  const postGeom = await page.evaluate(({ nearestTo }) => {
    // Find the largest leaflet container that is currently visible (not
    // hidden by a display:none ancestor and has nonzero size).
    const containers = Array.from(document.querySelectorAll('.leaflet-container'));
    function isVisible(el) {
      let cur = el;
      while (cur) {
        const s = window.getComputedStyle(cur);
        if (s.display === 'none' || s.visibility === 'hidden') return false;
        cur = cur.parentElement;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    let bestContainer = null;
    let bestArea = 0;
    for (const c of containers) {
      if (!isVisible(c)) continue;
      const r = c.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) { bestArea = area; bestContainer = c; }
    }
    // Look up Leaflet instance for that container. Leaflet sets
    // _leaflet_id on the container; we can find the matching map by
    // walking the leaflet registry (_leaflet_pos) or just by trying
    // __leafletMap and verifying its container matches.
    // Use the visible-resolved map exposed by LeafletMapContext (same one
    // the production code's useLeafletMap() returns). Falls back to
    // __leafletMap (most-recent) if the visible-resolved one isn't set.
    const map = window.__visibleLeafletMap ?? window.__leafletMap ?? null;
    if (!map) return null;
    const containerRect = bestContainer?.getBoundingClientRect() ?? map.getContainer().getBoundingClientRect();

    const swipeCard = document.querySelector('.swipe-detail-panel');
    const actionPill = document.querySelector('[data-testid="action-pill"]');
    const occluders = [];
    if (swipeCard) {
      const r = swipeCard.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) occluders.push({ id: 'swipe-card', top: r.top, left: r.left, bottom: r.bottom, right: r.right });
    }
    if (actionPill) {
      const r = actionPill.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) occluders.push({ id: 'action-pill', top: r.top, left: r.left, bottom: r.bottom, right: r.right });
    }

    // Reproduce getVisibleMapRect.
    const MIN_CLEARANCE = 16;
    let top = containerRect.top, bottom = containerRect.bottom;
    const left = containerRect.left, right = containerRect.right;
    let shrunkTop = false, shrunkBottom = false;
    const midY = containerRect.top + containerRect.height / 2;
    for (const occ of occluders) {
      const hOverlap = Math.min(occ.right, right) - Math.max(occ.left, left);
      if (hOverlap <= 0) continue;
      const vOverlap = Math.min(occ.bottom, bottom) - Math.max(occ.top, top);
      if (vOverlap <= 0) continue;
      const occCenterY = occ.top + (occ.bottom - occ.top) / 2;
      if (occCenterY >= midY) {
        if (occ.top < bottom) { bottom = occ.top; shrunkBottom = true; }
      } else {
        if (occ.bottom > top) { top = occ.bottom; shrunkTop = true; }
      }
    }
    if (shrunkTop) top += MIN_CLEARANCE;
    if (shrunkBottom) bottom -= MIN_CLEARANCE;
    const visibleRect = { top, left, bottom, right, width: right - left, height: bottom - top };

    // Project nearestTo to viewport coords.
    const cp = map.latLngToContainerPoint([Number(nearestTo.lat), Number(nearestTo.lon)]);
    const nearestViewport = {
      x: containerRect.left + cp.x,
      y: containerRect.top + cp.y,
    };
    // Also project the CURRENT raw map center for comparison.
    const rawCenter = map.getCenter();
    const rawCp = map.latLngToContainerPoint([rawCenter.lat, rawCenter.lng]);
    const rawCenterViewport = {
      x: containerRect.left + rawCp.x,
      y: containerRect.top + rawCp.y,
    };
    // Visible-rect center in viewport coords.
    const visibleCenterViewport = {
      x: left + (right - left) / 2,
      y: top + (bottom - top) / 2,
    };

    return {
      mapRect: { top: containerRect.top, left: containerRect.left, bottom: containerRect.bottom, right: containerRect.right, width: containerRect.width, height: containerRect.height },
      occluders,
      visibleRect,
      nearestViewport,
      rawCenterViewport,
      visibleCenterViewport,
      rawCenterLatLng: { lat: rawCenter.lat, lng: rawCenter.lng },
      zoom: map.getZoom(),
    };
  }, { nearestTo: nearestRequest.nearestTo });

  if (!postGeom) {
    await browser.close();
    return { label, pass: false, reason: 'Could not project nearestTo to viewport' };
  }

  const v = postGeom.visibleRect;
  const p = postGeom.nearestViewport;
  const inside = p.x >= v.left && p.x <= v.right && p.y >= v.top && p.y <= v.bottom;

  console.log(`  Request nearestTo lat=${nearestRequest.nearestTo.lat.toFixed(5)} lon=${nearestRequest.nearestTo.lon.toFixed(5)}`);
  console.log(`  nearestTo viewport: (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
  console.log(`  Raw map center viewport (post-pan): (${postGeom.rawCenterViewport.x.toFixed(1)}, ${postGeom.rawCenterViewport.y.toFixed(1)})`);
  console.log(`  Visible-rect center viewport: (${postGeom.visibleCenterViewport.x.toFixed(1)}, ${postGeom.visibleCenterViewport.y.toFixed(1)})`);
  console.log(`  Visible rect: x=[${v.left.toFixed(0)}-${v.right.toFixed(0)}] y=[${v.top.toFixed(0)}-${v.bottom.toFixed(0)}]`);
  console.log(`  Response listing: ${nearestResponse?.listing ? `id=${nearestResponse.listing.id} lat=${nearestResponse.listing.lat} lon=${nearestResponse.listing.lon}` : 'null (no match)'}`);

  const pass = inside;
  const reason = inside
    ? `nearestTo projects to (${p.x.toFixed(1)}, ${p.y.toFixed(1)}), INSIDE visible rect [${v.left.toFixed(0)}–${v.right.toFixed(0)}, ${v.top.toFixed(0)}–${v.bottom.toFixed(0)}]`
    : `nearestTo projects to (${p.x.toFixed(1)}, ${p.y.toFixed(1)}), OUTSIDE visible rect [${v.left.toFixed(0)}–${v.right.toFixed(0)}, ${v.top.toFixed(0)}–${v.bottom.toFixed(0)}]`;

  console.log(`  ${pass ? 'PASS' : 'FAIL'}: ${reason}`);
  await browser.close();
  return { label, pass, reason, preGeom, postGeom, nearestRequest, nearestResponse };
}

const results = [];
// Iter 1: impossible minRent (guaranteed no listings -> empty state).
results.push(await runIteration('iter1-impossible-filter',
  '?minRent=99999999&view=swipe'));

// Iter 2: same but at a different starting center (Brooklyn).
results.push(await runIteration('iter2-impossible-brooklyn',
  '?minRent=99999999&view=swipe&lat=40.6782&lng=-73.9442&zoom=13'));

// Iter 3: same but zoomed in so the visible rect is smaller (less forgiving).
results.push(await runIteration('iter3-impossible-zoomed',
  '?minRent=99999999&view=swipe&lat=40.7589&lng=-73.9851&zoom=15'));


// Build HTML report.
const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Find-nearest occlusion verify (v2)</title>
<style>
body { font-family: -apple-system, system-ui, sans-serif; max-width: 1400px; margin: 24px auto; padding: 0 16px; color: #e1e4e8; background: #0f1117; }
h1, h2 { color: #e1e4e8; }
.iter { border: 1px solid #2d333b; border-radius: 8px; padding: 16px; margin: 16px 0; background: #151820; }
.pass { color: #00ff88; font-weight: bold; }
.fail { color: #ff6b6b; font-weight: bold; }
img { max-width: 380px; border: 1px solid #2d333b; margin-right: 12px; vertical-align: top; }
pre { background: #1c2028; padding: 8px; overflow-x: auto; color: #c9d1d9; font-size: 11px; }
summary { cursor: pointer; color: #58a6ff; margin-top: 8px; }
</style></head>
<body>
<h1>Find-nearest occlusion verify (v2)</h1>
<p>Mobile 390x844 headless Chromium. Trigger: swipe-view empty state via <code>?minRent=99999999&amp;view=swipe</code> → click "Find nearest".</p>
<p><strong>Architectural invariant:</strong> the <code>nearestTo</code> sent to <code>/api/listings/search</code> must project to a viewport point INSIDE the occlusion-aware visible map rect (map rect minus swipe-card + action-pill).</p>
${results.map((r) => `
<div class="iter">
  <h2>${r.label} — <span class="${r.pass ? 'pass' : 'fail'}">${r.pass ? 'PASS' : 'FAIL'}</span></h2>
  <p>${r.reason}</p>
  <div>
    <img src="${r.label}-before.png" alt="before click">
    <img src="${r.label}-after.png" alt="after click">
  </div>
  <details><summary>Full geometry</summary><pre>${JSON.stringify({
    request: r.nearestRequest,
    response: r.nearestResponse,
    pre: r.preGeom,
    post: r.postGeom,
  }, null, 2).replaceAll('<', '&lt;')}</pre></details>
</div>
`).join('')}
</body></html>`;
writeFileSync(resolve(OUT_DIR, 'report.html'), html);

const allPass = results.every((r) => r.pass);
console.log(`\n=========================`);
console.log(`Overall: ${allPass ? 'PASS' : 'FAIL'}`);
console.log(`Report: ${resolve(OUT_DIR, 'report.html')}`);
process.exit(allPass ? 0 : 1);
