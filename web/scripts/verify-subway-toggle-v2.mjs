// Verify subway-overlay toggle: bottom-left, new icon, size, on/off states, persistence.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(os.homedir(), 'Documents/coding/screenshots/property-search/subway-toggle-v2');
mkdirSync(OUT_DIR, { recursive: true });

const TEST_EMAIL = 'oliverullman@gmail.com';
const TEST_PASSWORD = 'better4You@88';
const BASE = 'http://localhost:8000';

async function login(page) {
  await page.goto(`${BASE}/auth/login`);
  await page.locator('#email').fill(TEST_EMAIL);
  await page.locator('#password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(`${BASE}/`, { timeout: 20_000 }).catch(() => {});
  // Navigate to map view — the subway chip only renders inside the listings map
  await page.goto(`${BASE}/?view=map`);
  await page
    .getByText('Loading listings...')
    .waitFor({ state: 'hidden', timeout: 15_000 })
    .catch(() => {});
}

async function waitForMap(page) {
  await page.locator('.leaflet-container').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(800);
}

function getChipInfo() {
  return `
    (() => {
      const btn = document.querySelector('button[aria-label="Show subway lines"], button[aria-label="Hide subway lines"]');
      if (!btn) return { found: false };
      const rect = btn.getBoundingClientRect();
      const mapEl = document.querySelector('.leaflet-container');
      const mapRect = mapEl ? mapEl.getBoundingClientRect() : null;
      const attribution = document.querySelector('.leaflet-control-attribution');
      const attrRect = attribution ? attribution.getBoundingClientRect() : null;
      const svg = btn.querySelector('svg');
      const circles = svg ? svg.querySelectorAll('circle').length : 0;
      const lines = svg ? svg.querySelectorAll('line').length : 0;
      const subwayLinesPresent = !!document.querySelector('.leaflet-overlay-pane path[stroke]');
      return {
        found: true,
        label: btn.getAttribute('aria-label'),
        pressed: btn.getAttribute('aria-pressed'),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom, right: rect.right },
        mapRect: mapRect ? { x: mapRect.x, y: mapRect.y, width: mapRect.width, height: mapRect.height } : null,
        attrRect: attrRect ? { x: attrRect.x, y: attrRect.y, width: attrRect.width, height: attrRect.height } : null,
        svg: { circles, lines },
        subwayLinesPresent,
        collisionWithAttribution: attrRect
          ? !(rect.right < attrRect.left || rect.left > attrRect.right || rect.bottom < attrRect.top || rect.top > attrRect.bottom)
          : false,
      };
    })()
  `;
}

async function runViewport(browser, label, viewport, findings) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  try {
    await login(page);
    await waitForMap(page);

    // OFF state screenshot
    // Make sure it's OFF by clearing localStorage
    await page.evaluate(() => localStorage.removeItem('dwelligence.subwayOverlay'));
    await page.reload();
    await waitForMap(page);

    let offInfo = await page.evaluate(getChipInfo());
    findings[`${label}_off_info`] = offInfo;
    await page.screenshot({ path: join(OUT_DIR, `${label}-1-off.png`), fullPage: false });

    // Click to turn ON
    await page.locator('button[aria-label="Show subway lines"]').click();
    await page.waitForTimeout(1500);
    let onInfo = await page.evaluate(getChipInfo());
    findings[`${label}_on_info`] = onInfo;
    await page.screenshot({ path: join(OUT_DIR, `${label}-2-on.png`), fullPage: false });

    // Persist check: reload and confirm ON still
    await page.reload();
    await waitForMap(page);
    await page.waitForTimeout(1000);
    let persistInfo = await page.evaluate(getChipInfo());
    findings[`${label}_persist_info`] = persistInfo;
    await page.screenshot({ path: join(OUT_DIR, `${label}-3-persist-reload.png`), fullPage: false });

    // Click again to turn OFF and confirm toggle still works
    await page.locator('button[aria-label="Hide subway lines"]').click();
    await page.waitForTimeout(600);
    let offAgainInfo = await page.evaluate(getChipInfo());
    findings[`${label}_off_again_info`] = offAgainInfo;
    await page.screenshot({ path: join(OUT_DIR, `${label}-4-toggle-back-off.png`), fullPage: false });
  } finally {
    await ctx.close();
  }
}

const browser = await chromium.launch();
const findings = {};
await runViewport(browser, 'desktop', { width: 1280, height: 800 }, findings);
await runViewport(browser, 'mobile', { width: 390, height: 844 }, findings);
await browser.close();

// Evaluate pass/fail criteria
const problems = [];
for (const label of ['desktop', 'mobile']) {
  const off = findings[`${label}_off_info`];
  const on = findings[`${label}_on_info`];
  const persist = findings[`${label}_persist_info`];
  if (!off?.found) problems.push(`${label}: chip not found in OFF state`);
  if (!on?.found) problems.push(`${label}: chip not found in ON state`);

  if (off?.found && off.mapRect) {
    // Bottom-left check: button bottom should be within 60px of map bottom; button left < 60px from map left
    const fromBottom = off.mapRect.y + off.mapRect.height - off.rect.bottom;
    const fromLeft = off.rect.x - off.mapRect.x;
    if (fromBottom < 0 || fromBottom > 80) problems.push(`${label}: chip not near map bottom (gap=${fromBottom}px)`);
    if (fromLeft < 0 || fromLeft > 80) problems.push(`${label}: chip not near map left (gap=${fromLeft}px)`);

    // Expected size
    const expected = label === 'desktop' ? 32 : 36;
    const size = Math.round(off.rect.width);
    if (Math.abs(size - expected) > 2) problems.push(`${label}: chip size ${size}px !== expected ${expected}px (±2)`);

    // Icon content
    if (off.svg.circles !== 2 || off.svg.lines !== 1) {
      problems.push(`${label}: svg expected 2 circles + 1 line, got circles=${off.svg.circles} lines=${off.svg.lines}`);
    }
    if (off.collisionWithAttribution) problems.push(`${label}: collision with Leaflet attribution`);
  }
  if (on?.found) {
    if (on.pressed !== 'true') problems.push(`${label}: aria-pressed not 'true' in ON state`);
    if (!on.subwayLinesPresent) problems.push(`${label}: subway overlay lines did NOT render after clicking`);
  }
  if (persist?.found) {
    if (persist.pressed !== 'true') problems.push(`${label}: did NOT persist ON across reload`);
  }
}

const passed = problems.length === 0;
const status = passed ? 'PASS' : 'FAIL';

const reportHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Subway Toggle v2 — Verify Report</title>
<style>
  body { background:#0f1117; color:#e1e4e8; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; padding:32px; }
  h1 { font-size:22px; margin-bottom:8px; }
  .status { display:inline-block; padding:4px 10px; border-radius:6px; font-weight:700; font-size:13px; margin-bottom:20px; }
  .pass { background:#1a3a1f; color:#7ee787; border:1px solid #3fb950; }
  .fail { background:#3a1a1f; color:#f97583; border:1px solid #f85149; }
  h2 { font-size:16px; margin:28px 0 10px; color:#58a6ff; }
  .pair { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:24px; }
  .col { background:#1c2028; border:1px solid #2d333b; border-radius:10px; padding:14px; }
  .col h3 { font-size:13px; color:#8b949e; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.05em; }
  img { max-width:100%; border-radius:6px; border:1px solid #2d333b; display:block; }
  pre { background:#0f1117; border:1px solid #2d333b; border-radius:6px; padding:10px; font-size:11px; color:#c9d1d9; overflow-x:auto; }
  ul.problems { color:#f97583; }
  .grid4 { display:grid; grid-template-columns:repeat(4, 1fr); gap:12px; }
</style>
</head>
<body>
<h1>Subway Toggle v2 — Verification</h1>
<div class="status ${passed ? 'pass' : 'fail'}">${status}</div>

${problems.length ? `<h2>Problems</h2><ul class="problems">${problems.map((p) => `<li>${p}</li>`).join('')}</ul>` : '<p>All checks passed.</p>'}

<h2>Desktop (1280×800) vs Mobile (390×844) — OFF state</h2>
<div class="pair">
  <div class="col"><h3>Desktop OFF</h3><img src="desktop-1-off.png" alt="desktop off"></div>
  <div class="col"><h3>Mobile OFF</h3><img src="mobile-1-off.png" alt="mobile off"></div>
</div>

<h2>ON state (after click)</h2>
<div class="pair">
  <div class="col"><h3>Desktop ON</h3><img src="desktop-2-on.png" alt="desktop on"></div>
  <div class="col"><h3>Mobile ON</h3><img src="mobile-2-on.png" alt="mobile on"></div>
</div>

<h2>After reload — persistence check</h2>
<div class="pair">
  <div class="col"><h3>Desktop reload (should still be ON)</h3><img src="desktop-3-persist-reload.png" alt="desktop persist"></div>
  <div class="col"><h3>Mobile reload (should still be ON)</h3><img src="mobile-3-persist-reload.png" alt="mobile persist"></div>
</div>

<h2>Toggle back OFF</h2>
<div class="pair">
  <div class="col"><h3>Desktop OFF again</h3><img src="desktop-4-toggle-back-off.png" alt="desktop off again"></div>
  <div class="col"><h3>Mobile OFF again</h3><img src="mobile-4-toggle-back-off.png" alt="mobile off again"></div>
</div>

<h2>Findings</h2>
<pre>${JSON.stringify(findings, null, 2)}</pre>
</body>
</html>`;

writeFileSync(join(OUT_DIR, 'report.html'), reportHtml);
console.log(`Report: ${join(OUT_DIR, 'report.html')}`);
console.log(`Status: ${status}`);
if (!passed) {
  console.log('Problems:');
  problems.forEach((p) => console.log(`  - ${p}`));
  process.exit(1);
}
