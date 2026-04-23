#!/usr/bin/env node
/* eslint-disable no-console */
// Verify script v2 for tour-guide-redo: mobile default-to-swipe + conditional steps.
// Uses the shared loginAsTestUser helper to avoid the controlled-input race
// that stalled the prior verify run.
//
// Usage: node --env-file=web/.env.local web/tests/verify-tour-guide-redo-v2.mjs
//
// Reads TEST_USER_EMAIL / TEST_USER_PASSWORD from process.env (loaded via
// --env-file). Runs headless Playwright. Writes screenshots + report.html
// under ~/Documents/coding/screenshots/property-search/tour-guide-redo-v2/.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import os from 'node:os';
import { loginAsTestUser } from './e2e/helpers/auth.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const BASE = 'http://localhost:8000';
const SHOTS_DIR = path.join(
  os.homedir(),
  'Documents/coding/screenshots/property-search/tour-guide-redo-v2',
);

// If the user invoked us without --env-file, load .env.local manually.
if (!process.env.TEST_USER_EMAIL) {
  try {
    const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
    for (const line of envTxt.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch (e) {
    console.error('[verify] could not load web/.env.local:', e.message);
  }
}

if (!process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD) {
  console.error('Missing TEST_USER_EMAIL / TEST_USER_PASSWORD');
  process.exit(2);
}

console.log(`[verify] using ${process.env.TEST_USER_EMAIL}`);
fs.mkdirSync(SHOTS_DIR, { recursive: true });

const results = []; // { scenario, passed, notes, screenshots: [] }

function hb(msg) {
  console.log(`[hb ${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function shot(page, name) {
  const file = `${name}.png`;
  const full = path.join(SHOTS_DIR, file);
  await page.screenshot({ path: full, fullPage: false });
  hb(`shot ${file}`);
  return file;
}

async function freshLogin(browser, viewport) {
  hb(`fresh context viewport=${viewport.width}x${viewport.height}`);
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  // clear storage to simulate a fresh client (cookies are already empty in
  // a brand-new context — this also nukes any localStorage from a prior
  // session inside the same browser process).
  await context.clearCookies();
  await loginAsTestUser(page);
  // After login, also wipe any client-side state the app may have stashed
  // (returning-user flag, dismissed banners, etc.). Tour gating is
  // server-driven via the profile, but localStorage cleanup is cheap
  // insurance.
  await page.evaluate(() => {
    try { localStorage.clear(); } catch {}
    try { sessionStorage.clear(); } catch {}
  });
  return { context, page };
}

async function waitForListingsLoaded(page, timeout = 25_000) {
  // The page shows "Finding your next home..." while listings load. Wait for
  // it to vanish before doing any landing/tour assertions; otherwise
  // [data-tour="swipe-card"] / [data-tour="view-modes"] don't exist yet.
  await page
    .getByText(/finding your next home/i)
    .waitFor({ state: 'hidden', timeout })
    .catch(() => {});
}

async function walkTour(page, name, maxSteps = 12) {
  const stepIdsSeen = [];
  const shots = [];
  const notes = [];

  for (let i = 0; i < maxSteps; i++) {
    const tooltip = page.locator('[data-tour-tooltip]');
    const exists = await tooltip.count();
    if (!exists) {
      notes.push(`After ${i} clicks, no tooltip → tour ended`);
      break;
    }
    const stepId = await tooltip.getAttribute('data-tour-step-id').catch(() => null);
    stepIdsSeen.push(stepId ?? '(?)');
    shots.push(await shot(page, `${name}-step-${String(i).padStart(2, '0')}-${stepId ?? 'unknown'}`));

    const debug = await page.evaluate(() => {
      const tip = document.querySelector('[data-tour-tooltip]');
      if (!tip) return null;
      const id = tip.getAttribute('data-tour-step-id');
      const allTargets = Array.from(document.querySelectorAll('[data-tour]')).map(
        (el) => el.getAttribute('data-tour'),
      );
      return { id, allTargets };
    });
    notes.push(`step ${i}: id=${stepId} | available targets in DOM: ${debug?.allTargets?.join(',') ?? '(?)'}`);

    // CRITICAL: scope the Next-button locator inside the tooltip so we don't
    // pick up a "Next photo" button from the underlying card carousel.
    const btn = tooltip
      .locator('button')
      .filter({ hasText: /next|let's go|start exploring/i })
      .first();
    const btnExists = await btn.count();
    if (!btnExists) {
      notes.push(`No advance button at step ${i}, breaking`);
      break;
    }
    // Tour overlay is on top — force the click through the SVG mask. The
    // tour buttons sit at z-index 2002 inside the same portal, so the click
    // resolves to them; the SVG dim layer is just a cosmetic overlay
    // beneath.
    await btn.click({ timeout: 5000, force: true }).catch((e) => {
      notes.push(`click failed at step ${i}: ${e.message}`);
    });
    // Wait for fade transition + DOM settle. Mid-tour view switches need
    // the longer 350ms delay TourGuide uses internally.
    await page.waitForTimeout(900);
  }
  return { stepIdsSeen, shots, notes };
}

async function runScenario(browser, scenario) {
  const { name, viewport, expectations } = scenario;
  hb(`>> scenario: ${name} (viewport ${viewport.width}x${viewport.height})`);
  const allShots = [];
  const allNotes = [];
  let passed = true;
  let context;

  try {
    const fresh = await freshLogin(browser, viewport);
    context = fresh.context;
    const page = fresh.page;

    // Land on / first to verify default view (no ?tour=1 yet)
    if (expectations.landingViewMustBe) {
      hb(`landing check: ${expectations.landingViewMustBe}`);
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await waitForListingsLoaded(page);
      await page.waitForTimeout(1000); // mobile-default effect + render
      allShots.push(await shot(page, `${name}-01-landing`));

      const finalView = await page.evaluate(
        () => new URL(window.location.href).searchParams.get('view'),
      );
      const swipeCardVisible = await page
        .locator('[data-tour="swipe-card"]')
        .first()
        .isVisible()
        .catch(() => false);
      const viewModesVisible = await page
        .locator('[data-tour="view-modes"]')
        .first()
        .isVisible()
        .catch(() => false);

      allNotes.push(
        `landing: ?view=${finalView ?? '(none)'} | swipe-card visible=${swipeCardVisible} | view-modes visible=${viewModesVisible}`,
      );

      if (expectations.landingViewMustBe === 'swipe') {
        // Mobile: must show swipe card. URL might or might not say view=swipe
        // since it's the default and the buildQueryString omits view=list.
        if (!swipeCardVisible) {
          passed = false;
          allNotes.push(`FAIL: expected mobile landing to show swipe card`);
        }
      } else if (expectations.landingViewMustBe === 'list') {
        // Desktop: list view shows the view-modes toggle in the header.
        if (!viewModesVisible) {
          passed = false;
          allNotes.push(`FAIL: expected desktop landing to show list view (view-modes toggle)`);
        }
      }
    }

    // Trigger the tour
    if (expectations.openTour) {
      const tourUrl = expectations.openTourUrl ?? '/?tour=1';
      hb(`trigger tour via ${tourUrl}`);
      await page.goto(`${BASE}${tourUrl}`, { waitUntil: 'domcontentloaded' });
      await waitForListingsLoaded(page);
      // tour mount waits for `profile` to load; give it a beat
      await page
        .locator('[data-tour-tooltip]')
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 })
        .catch(() => {});
      await page.waitForTimeout(500);
      allShots.push(await shot(page, `${name}-02-tour-welcome`));

      const walk = await walkTour(page, name, 12);
      allShots.push(...walk.shots);
      allNotes.push(...walk.notes);
      allNotes.push(`Steps seen: ${walk.stepIdsSeen.join(' → ')}`);

      if (expectations.stepsMustInclude) {
        for (const id of expectations.stepsMustInclude) {
          if (!walk.stepIdsSeen.includes(id)) {
            passed = false;
            allNotes.push(`FAIL: expected step '${id}' was not shown`);
          }
        }
      }
      if (expectations.stepsMustExclude) {
        for (const id of expectations.stepsMustExclude) {
          if (walk.stepIdsSeen.includes(id)) {
            passed = false;
            allNotes.push(`FAIL: step '${id}' should NOT have shown but did`);
          }
        }
      }
    }

    // Mid-tour view switch (desktop → swipe should reveal swipe-only steps)
    if (expectations.midTourSwitchView) {
      hb(`mid-tour view switch: ${expectations.midTourSwitchView}`);
      // Visit tour with explicit view param so swipe-mode steps are
      // eligible from the start (a true mid-tour switch is exercised by
      // the tour's own switchView mechanism — covered by mobile-fresh).
      await page.goto(`${BASE}/?tour=1&view=${expectations.midTourSwitchView}`, {
        waitUntil: 'domcontentloaded',
      });
      await waitForListingsLoaded(page);
      await page
        .locator('[data-tour-tooltip]')
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 })
        .catch(() => {});
      await page.waitForTimeout(500);
      allShots.push(await shot(page, `${name}-mid-01-tour-on-swipe`));

      const walk2 = await walkTour(page, `${name}-mid`, 12);
      allShots.push(...walk2.shots);
      allNotes.push(...walk2.notes);
      allNotes.push(`Mid-tour-switch steps seen: ${walk2.stepIdsSeen.join(' → ')}`);

      if (expectations.midSwitchStepsMustInclude) {
        for (const id of expectations.midSwitchStepsMustInclude) {
          if (!walk2.stepIdsSeen.includes(id)) {
            passed = false;
            allNotes.push(`FAIL (mid-switch): expected step '${id}' was not shown`);
          }
        }
      }
    }

    // Returning user: no ?tour=1 → no tour
    if (expectations.noTourWithoutParam) {
      hb(`returning-user: visit / without ?tour=1`);
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await waitForListingsLoaded(page);
      await page.waitForTimeout(1500);
      const tooltipCount = await page.locator('[data-tour-tooltip]').count();
      allNotes.push(`tooltip count without ?tour=1: ${tooltipCount}`);
      allShots.push(await shot(page, `${name}-returning-no-tour`));
      if (tooltipCount > 0) {
        passed = false;
        allNotes.push(`FAIL: tour fired without ?tour=1`);
      }
    }
  } catch (e) {
    passed = false;
    allNotes.push(`EXCEPTION: ${e.message}\n${e.stack}`);
  } finally {
    if (context) await context.close().catch(() => {});
  }

  hb(`<< scenario done: ${name} → ${passed ? 'PASS' : 'FAIL'}`);
  results.push({ name, viewport, passed, notes: allNotes, shots: allShots });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    // Scenario 1: Mobile, fresh — landing must be swipe view.
    await runScenario(browser, {
      name: 'mobile-fresh',
      viewport: { width: 390, height: 844 },
      expectations: {
        landingViewMustBe: 'swipe',
        openTour: true,
        stepsMustInclude: ['welcome', 'swipe-card', 'wishlists', 'done'],
        stepsMustExclude: ['view-modes', 'filters-desktop'],
      },
    });

    // Scenario 2: Desktop, fresh — landing must be list view.
    await runScenario(browser, {
      name: 'desktop-fresh',
      viewport: { width: 1440, height: 900 },
      expectations: {
        landingViewMustBe: 'list',
        openTour: true,
        stepsMustInclude: ['welcome', 'view-modes', 'filters-desktop', 'wishlists', 'done'],
        stepsMustExclude: ['filters-mobile', 'swipe-action-pill'],
      },
    });

    // Scenario 3: Returning user (no ?tour=1) — no tour fires.
    await runScenario(browser, {
      name: 'mobile-returning',
      viewport: { width: 390, height: 844 },
      expectations: {
        noTourWithoutParam: true,
      },
    });

    // Scenario 4: Desktop user lands in list, then visits /?tour=1&view=swipe
    // — swipe-mode steps must surface.
    await runScenario(browser, {
      name: 'desktop-switch-to-swipe',
      viewport: { width: 1440, height: 900 },
      expectations: {
        midTourSwitchView: 'swipe',
        midSwitchStepsMustInclude: ['swipe-card'],
      },
    });

    // Scenario 5: Mobile user explicitly visits ?view=list&tour=1 — list
    // view chosen by URL, mobile-only filters-mobile suppressed (it only
    // fires in swipe view), and view-modes/filters-desktop still suppressed
    // because viewport is mobile.
    await runScenario(browser, {
      name: 'mobile-list-tour',
      viewport: { width: 390, height: 844 },
      url: '/?tour=1&view=list',
      expectations: {
        openTour: true,
        openTourUrl: '/?tour=1&view=list',
        stepsMustInclude: ['welcome', 'wishlists', 'done'],
        stepsMustExclude: ['view-modes', 'filters-desktop', 'swipe-card', 'swipe-action-pill', 'filters-mobile'],
      },
    });
  } finally {
    await browser.close();
  }

  // Build HTML report
  const allPass = results.every((r) => r.passed);
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Tour Guide Redo Verify v2</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 24px; background: #0d1117; color: #e1e4e8; }
  h1 { font-size: 24px; }
  .pass { color: #3fb950; font-weight: 700; }
  .fail { color: #f85149; font-weight: 700; }
  .scenario { margin-bottom: 48px; padding: 16px; background: #161b22; border-radius: 8px; border: 1px solid #30363d; }
  .scenario h2 { margin-top: 0; }
  pre { white-space: pre-wrap; background: #0d1117; padding: 10px; border-radius: 6px; font-size: 12px; overflow-x: auto; }
  img { max-width: 360px; border: 1px solid #30363d; margin: 6px; border-radius: 6px; display: inline-block; vertical-align: top; }
  .grid { display: flex; flex-wrap: wrap; }
  .caption { font-size: 11px; color: #8b949e; text-align: center; max-width: 360px; margin: 0 6px 6px 6px; word-break: break-all; }
</style></head>
<body>
<h1>Tour Guide Redo Verify v2 — <span class="${allPass ? 'pass' : 'fail'}">${allPass ? 'PASS' : 'FAIL'}</span></h1>
<p>Date: ${new Date().toISOString()}</p>
<p>Scenarios: ${results.length} — Passed: ${results.filter((r) => r.passed).length} / Failed: ${results.filter((r) => !r.passed).length}</p>
${results
  .map(
    (r) => `
  <div class="scenario">
    <h2>${r.name} <span class="${r.passed ? 'pass' : 'fail'}">${r.passed ? 'PASS' : 'FAIL'}</span></h2>
    <p>Viewport: ${r.viewport.width}×${r.viewport.height}</p>
    <h3>Notes</h3>
    <pre>${r.notes.map((n) => String(n).replace(/</g, '&lt;')).join('\n')}</pre>
    <h3>Screenshots (${r.shots.length})</h3>
    <div class="grid">
      ${r.shots.map((s) => `<div><img src="${s}" alt="${s}"><div class="caption">${s}</div></div>`).join('')}
    </div>
  </div>
`,
  )
  .join('')}
</body></html>`;

  const reportPath = path.join(SHOTS_DIR, 'report.html');
  fs.writeFileSync(reportPath, html, 'utf8');
  console.log(`[verify] report: ${reportPath}`);
  console.log(`[verify] overall: ${allPass ? 'PASS' : 'FAIL'}`);

  process.exit(allPass ? 0 : 1);
})().catch((e) => {
  console.error('[verify] fatal error', e);
  process.exit(3);
});
