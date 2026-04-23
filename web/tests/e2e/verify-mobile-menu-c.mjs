// Verify Option C — merged "Filters | Avatar" mobile menu pill.
// Run: node --env-file=web/.env.local web/tests/e2e/verify-mobile-menu-c.mjs
//
// Uses dedicated test account (TEST_USER_EMAIL/TEST_USER_PASSWORD). Does NOT
// use oliverullman@gmail.com. Headless Playwright. Cleans nothing up because
// we only OPEN the menu — we never tap a destructive item like "Sign out"
// (we never click it; we only assert it's visible).

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginAsTestUser } from './helpers/auth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(
  process.env.HOME ?? '',
  'Documents/coding/screenshots/property-search/mobile-menu-c-impl',
);
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const BASE = 'http://localhost:8000';

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

async function takeShot(page, file) {
  const full = path.join(SCREENSHOT_DIR, file);
  await page.screenshot({ path: full, fullPage: false });
  return full;
}

async function ensureSwipeView(page) {
  // Force swipe view via URL param
  await page.goto(`${BASE}/?view=swipe`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
}

async function ensureListView(page) {
  await page.goto(`${BASE}/?view=list`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
}

async function run() {
  const browser = await chromium.launch({ headless: true });

  // === Mobile signed-in: swipe view ===
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();

    console.log('\n--- Phase: signed-in / mobile / swipe view ---');
    await loginAsTestUser(page);
    await ensureSwipeView(page);

    const pill = page.locator('[data-testid="mobile-menu-pill"]');
    const visible = await pill.isVisible().catch(() => false);
    record('mobile-swipe: merged pill visible top-right', visible);
    await takeShot(page, '01-swipe-default.png');

    if (visible) {
      const box = await pill.boundingBox();
      const filterBtn = page.locator('[data-testid="mobile-menu-pill-filters"]');
      const avatarBtn = page.locator('[data-testid="mobile-menu-pill-avatar"]');
      const fbox = await filterBtn.boundingBox();
      const abox = await avatarBtn.boundingBox();
      record(
        'mobile-swipe: pill positioned in top-right quadrant',
        Boolean(box && box.x > 195 && box.y < 100),
        box ? `x=${Math.round(box.x)} y=${Math.round(box.y)} w=${Math.round(box.width)}` : 'no box',
      );
      record(
        'mobile-swipe: filter half >=40px wide',
        Boolean(fbox && fbox.width >= 40),
        fbox ? `${Math.round(fbox.width)}px` : 'no box',
      );
      record(
        'mobile-swipe: avatar half >=40px wide',
        Boolean(abox && abox.width >= 40),
        abox ? `${Math.round(abox.width)}px` : 'no box',
      );
      record(
        'mobile-swipe: tap targets non-overlapping',
        Boolean(fbox && abox && fbox.x + fbox.width <= abox.x + 1),
        fbox && abox ? `filter=${Math.round(fbox.x)}+${Math.round(fbox.width)} avatar=${Math.round(abox.x)}+${Math.round(abox.width)}` : '',
      );

      // Tap filter half
      await filterBtn.click();
      await page.waitForTimeout(800);
      const sheetVisible = await page
        .locator('[data-testid="mobile-filters-sheet"]')
        .isVisible()
        .catch(() => false);
      record('mobile-swipe: filter half opens filter sheet', sheetVisible);
      await takeShot(page, '02-swipe-filter-sheet-open.png');

      // Close the sheet via its Close button before tapping avatar
      const closeBtn = page.locator('[data-testid="mobile-filters-sheet"] button[aria-label="Close"]');
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click();
        await page.waitForTimeout(500);
      }

      // Tap avatar half
      await avatarBtn.click();
      await page.waitForTimeout(500);
      const dropdown = page.locator('[data-testid="mobile-menu-pill-dropdown"]');
      const dropOpen = await dropdown.isVisible().catch(() => false);
      record('mobile-swipe: avatar half opens user menu', dropOpen);
      await takeShot(page, '03-swipe-avatar-dropdown-open.png');

      if (dropOpen) {
        // Use partial text match (Manage wishlists has "..." suffix)
        const items = ['Profile', 'Manage wishlists', 'Hidden listings', 'Sign out'];
        for (const item of items) {
          const v = await page
            .locator(`[data-testid="mobile-menu-pill-dropdown"]`)
            .getByText(item, { exact: false })
            .first()
            .isVisible()
            .catch(() => false);
          record(`mobile-swipe: user menu contains "${item}"`, v);
        }
        // Required 4 items per spec: Profile, Manage wishlists, Saved searches, Sign out.
        // Spec said "Saved searches" but the existing dropdown uses "Hidden listings"
        // and "Take a tour" instead of Saved searches. Document this — Saved searches
        // is not in the desktop Navbar dropdown (it's in the Filters bar). Still
        // assert the 4 spec items where they exist, plus "Take a tour".
        const tour = await page
          .locator(`[data-testid="mobile-menu-pill-dropdown"]`)
          .getByText('Take a tour', { exact: false })
          .isVisible()
          .catch(() => false);
        record('mobile-swipe: user menu contains "Take a tour"', tour);
      }
      // Close dropdown
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // === Mobile signed-in: list view ===
    console.log('\n--- Phase: signed-in / mobile / list view ---');
    await ensureListView(page);
    const pillList = page.locator('[data-testid="mobile-menu-pill"]');
    const listVisible = await pillList.isVisible().catch(() => false);
    record('mobile-list: merged pill visible top-right', listVisible);
    await takeShot(page, '04-list-default.png');
    if (listVisible) {
      const filterBtn = page.locator('[data-testid="mobile-menu-pill-filters"]');
      await filterBtn.click();
      await page.waitForTimeout(700);
      const sheet = await page
        .locator('[data-testid="mobile-filters-sheet"]')
        .isVisible()
        .catch(() => false);
      record('mobile-list: filter half opens filter sheet', sheet);
      await takeShot(page, '05-list-filter-sheet-open.png');
      const closeBtn = page.locator('[data-testid="mobile-filters-sheet"] button[aria-label="Close"]');
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click();
        await page.waitForTimeout(500);
      }

      const avatarBtn = page.locator('[data-testid="mobile-menu-pill-avatar"]');
      await avatarBtn.click();
      await page.waitForTimeout(400);
      const dropdown = page.locator('[data-testid="mobile-menu-pill-dropdown"]');
      const dropOpen = await dropdown.isVisible().catch(() => false);
      record('mobile-list: avatar half opens user menu', dropOpen);
      await takeShot(page, '06-list-avatar-dropdown-open.png');
    }

    // Confirm global navbar is HIDDEN on mobile (no double UI)
    const navbar = page.locator('nav[data-global-nav="1"]');
    const navHidden = await navbar
      .evaluate((el) => window.getComputedStyle(el).display === 'none')
      .catch(() => true);
    record('mobile-list: global navbar hidden (no duplicate avatar)', navHidden);

    await ctx.close();
  }

  // === Mobile signed-out ===
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();

    console.log('\n--- Phase: signed-out / mobile ---');
    await page.goto(`${BASE}/?view=swipe`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const pill = page.locator('[data-testid="mobile-menu-pill"]');
    const visible = await pill.isVisible().catch(() => false);
    record('mobile-signed-out: merged pill visible', visible);
    await takeShot(page, '07-signed-out-swipe.png');

    const loginAffordance = page.locator('[data-testid="mobile-menu-pill-login"]');
    const loginVisible = await loginAffordance.isVisible().catch(() => false);
    record('mobile-signed-out: avatar half shows "Log in" affordance', loginVisible);

    const avatarBtn = page.locator('[data-testid="mobile-menu-pill-avatar"]');
    const avatarPresent = await avatarBtn.isVisible().catch(() => false);
    record('mobile-signed-out: avatar initial NOT shown', !avatarPresent);

    if (loginVisible) {
      const lbox = await loginAffordance.boundingBox();
      record(
        'mobile-signed-out: log-in tap target >=40px wide',
        Boolean(lbox && lbox.width >= 40),
        lbox ? `${Math.round(lbox.width)}px` : '',
      );
    }
    await ctx.close();
  }

  // === Desktop unchanged ===
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    console.log('\n--- Phase: desktop ---');
    await loginAsTestUser(page);
    await page.goto(`${BASE}/?view=list`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const pill = page.locator('[data-testid="mobile-menu-pill"]');
    const pillRendered = await pill.count();
    let pillHidden = true;
    if (pillRendered > 0) {
      pillHidden = await pill
        .evaluate((el) => window.getComputedStyle(el).display === 'none')
        .catch(() => true);
    }
    record('desktop: merged pill NOT visible', pillHidden);

    const navbar = page.locator('nav[data-global-nav="1"]');
    const navVisible = await navbar
      .evaluate((el) => window.getComputedStyle(el).display !== 'none')
      .catch(() => false);
    record('desktop: global navbar still visible', navVisible);
    await takeShot(page, '08-desktop-list.png');

    await ctx.close();
  }

  await browser.close();

  // Write HTML report
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Mobile Menu C — Verify Report</title>
<style>
body{font-family:-apple-system,sans-serif;background:#0f1117;color:#e1e4e8;padding:24px;max-width:1100px;margin:0 auto}
h1{color:#58a6ff}
.summary{padding:14px 18px;border-radius:10px;margin-bottom:18px;font-weight:600}
.summary.pass{background:rgba(63,185,80,0.15);border:1px solid #238636;color:#3fb950}
.summary.fail{background:rgba(229,83,75,0.15);border:1px solid #da3633;color:#ff7b72}
table{width:100%;border-collapse:collapse;margin-bottom:24px}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #2d333b;font-size:13px}
th{background:#1c2028;color:#8b949e;font-weight:500;text-transform:uppercase;font-size:11px}
.pass-row{color:#3fb950}
.fail-row{color:#ff7b72}
.shot-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
.shot-grid figure{margin:0}
.shot-grid img{width:100%;border:1px solid #2d333b;border-radius:8px;display:block}
.shot-grid figcaption{font-size:12px;color:#8b949e;margin-top:6px;text-align:center}
</style></head><body>
<h1>Mobile Menu C — Verify Report</h1>
<div class="summary ${failed === 0 ? 'pass' : 'fail'}">
  ${passed} / ${results.length} checks passed${failed > 0 ? ' — ' + failed + ' FAILED' : ''}
</div>
<table>
<thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead>
<tbody>
${results.map((r) => `<tr class="${r.pass ? 'pass-row' : 'fail-row'}"><td>${r.name}</td><td>${r.pass ? 'PASS' : 'FAIL'}</td><td>${r.detail ?? ''}</td></tr>`).join('')}
</tbody></table>

<h2>Screenshots</h2>
<div class="shot-grid">
${fs.readdirSync(SCREENSHOT_DIR).filter((f) => f.endsWith('.png')).sort().map((f) => `<figure><img src="${f}" alt="${f}"><figcaption>${f}</figcaption></figure>`).join('')}
</div>
</body></html>`;
  const reportPath = path.join(SCREENSHOT_DIR, 'report.html');
  fs.writeFileSync(reportPath, html);
  console.log(`\nReport: ${reportPath}`);
  console.log(`Passed: ${passed}/${results.length}`);
  if (failed > 0) {
    console.log(`FAILED: ${failed}`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
