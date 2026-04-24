// Verify the Option A two-stacked-pills rendering for the multi-destination
// commute chip (DestinationChip.tsx).
//
// Run with:
//   cd web && node --env-file=.env.local tests/e2e/verify-commute-option-a.mjs

import { chromium } from 'playwright';
import { loginAsTestUser } from './helpers/auth.mjs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCREENSHOT_DIR =
  process.env.SCREENSHOT_DIR ??
  '/Users/oliverullman/Documents/coding/screenshots/property-search/commute-option-a';

const BASE = 'http://localhost:8000';

// Two destinations to inject. dest1 = green (Chess Forum / address), dest2 =
// amber (Office / address). Coordinates pick spots in NYC so OTP can resolve.
const DEST_GREEN = {
  id: 'dest-green',
  type: 'address',
  address: 'Marshall Chess Club, 23 W 10th St',
  addressLat: 40.733,
  addressLon: -73.998,
  maxMinutes: 60,
  mode: 'transit',
};
const DEST_AMBER = {
  id: 'dest-amber',
  type: 'address',
  address: '350 5th Ave, New York, NY (Empire State Bldg)',
  addressLat: 40.7484,
  addressLon: -73.9857,
  maxMinutes: 60,
  mode: 'walk',
};

// Long-name destination for truncation check.
const DEST_LONG_NAME = {
  id: 'dest-long',
  type: 'address',
  address: 'A Really Quite Long Destination Name That Should Truncate',
  addressLat: 40.7484,
  addressLon: -73.9857,
  maxMinutes: 60,
  mode: 'walk',
};

async function setDestinations(page, destinations) {
  await page.evaluate(({ key, eventName, destinations }) => {
    if (destinations.length === 0) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(
        key,
        JSON.stringify({ v: 2, destinations }),
      );
    }
    window.dispatchEvent(new CustomEvent(eventName));
  }, {
    key: 'dwelligence.preferredDestination',
    eventName: 'dwelligence:preferredDestinationChanged',
    destinations,
  });
}

async function findCommuteChip(page) {
  // Wait for at least one listing card with a commute chip to appear. Scroll
  // to trigger rendering if needed (results list can be virtualized).
  for (let attempt = 0; attempt < 3; attempt++) {
    const exists = await page
      .locator('[aria-label*="Commute"]')
      .first()
      .isVisible()
      .catch(() => false);
    if (exists) break;
    await page.evaluate(() => window.scrollBy(0, 400));
    await page.waitForTimeout(800);
  }
  await page.waitForSelector('[aria-label*="Commute"]', { timeout: 20000 });
  return page.locator('[aria-label*="Commute"]').first();
}

async function captureFullCard(page, chipLocator, outPath) {
  // Walk up to the listing card container and screenshot it for context.
  const cardHandle = await chipLocator.evaluateHandle((el) => {
    let cur = el;
    for (let i = 0; i < 12 && cur; i++) {
      cur = cur.parentElement;
      if (!cur) break;
      // Heuristic: find a parent with a meaningful min-width or that contains
      // the price chip text — an ancestor that visibly looks like the card.
      const rect = cur.getBoundingClientRect();
      if (rect.width >= 240 && rect.height >= 240) return cur;
    }
    return el;
  });
  const card = cardHandle.asElement();
  if (card) {
    await card.screenshot({ path: outPath });
  } else {
    await chipLocator.screenshot({ path: outPath });
  }
}

async function run() {
  await mkdir(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  const findings = [];

  try {
    console.log('[1/5] Logging in as test user…');
    await loginAsTestUser(page);

    // Navigate to the listings page first so localStorage is on the right origin.
    console.log('[2/5] Navigating to results page…');
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    // ─── Single-destination baseline ────────────────────────────────
    console.log('[3/5] Capturing single-destination state…');
    await setDestinations(page, [DEST_GREEN]);
    await page.waitForTimeout(2000);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const singleChip = await findCommuteChip(page);
    const singleCardPath = join(SCREENSHOT_DIR, '01-single-destination-card.png');
    const singleChipPath = join(SCREENSHOT_DIR, '02-single-destination-chip.png');
    await captureFullCard(page, singleChip, singleCardPath);
    await singleChip.screenshot({ path: singleChipPath });
    const singleAria = await singleChip.getAttribute('aria-label');
    findings.push({
      test: 'Single-destination chip renders unchanged',
      pass: !!singleAria && /Commute to destination/i.test(singleAria),
      detail: `aria-label="${singleAria}"`,
      screenshots: [singleCardPath, singleChipPath],
    });

    // ─── Two-destination Option A ───────────────────────────────────
    console.log('[4/5] Capturing two-destination Option A state…');
    await setDestinations(page, [DEST_GREEN, DEST_AMBER]);
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Should now render TWO pills (two ButtonBase elements with aria-label
    // containing "to <name>"). Find a card that has both.
    const allChips = page.locator('[aria-label*="Commute"]');
    await allChips.first().waitFor({ timeout: 15000 });
    const chipCount = await allChips.count();
    console.log(`  found ${chipCount} commute pill(s) on page`);

    // Take a card-level screenshot using the FIRST commute chip's nearest
    // listing-card ancestor.
    const firstDualChip = allChips.first();
    const dualCardPath = join(SCREENSHOT_DIR, '03-two-destination-card.png');
    await captureFullCard(page, firstDualChip, dualCardPath);

    // Crop the chip area itself (find ancestor div containing both pills).
    const dualChipContainerPath = join(SCREENSHOT_DIR, '04-two-destination-pills.png');
    const wrapperHandle = await firstDualChip.evaluateHandle((el) => {
      // Walk up to the immediate column-flex wrapper that holds both pills.
      let cur = el.parentElement;
      while (cur) {
        if (cur.classList && cur.classList.contains('flex-col')) return cur;
        cur = cur.parentElement;
      }
      return el;
    });
    const wrapperEl = wrapperHandle.asElement();
    if (wrapperEl) {
      await wrapperEl.screenshot({ path: dualChipContainerPath });
    } else {
      await firstDualChip.screenshot({ path: dualChipContainerPath });
    }

    // Verify pill colors via computed styles. Find the FIRST pair of pills
    // by walking up to the wrapper and then inspecting children.
    const colors = await page.evaluate(() => {
      const allBtn = Array.from(
        document.querySelectorAll('[aria-label*="Commute to"]'),
      );
      // Group by their flex-col parent.
      const groups = new Map();
      for (const btn of allBtn) {
        let parent = btn.parentElement;
        while (parent && !(parent.classList && parent.classList.contains('flex-col'))) {
          parent = parent.parentElement;
          if (!parent) break;
        }
        if (!parent) continue;
        if (!groups.has(parent)) groups.set(parent, []);
        groups.get(parent).push(btn);
      }
      // Find the first group with 2 pills.
      for (const [, pills] of groups) {
        if (pills.length === 2) {
          return pills.map((p) => {
            const cs = window.getComputedStyle(p);
            return {
              borderColor: cs.borderColor,
              backgroundColor: cs.backgroundColor,
              color: cs.color,
              text: p.textContent.trim(),
              ariaLabel: p.getAttribute('aria-label'),
            };
          });
        }
      }
      return null;
    });

    findings.push({
      test: 'Two destinations render as two stacked color-coded pills',
      pass: !!colors && colors.length === 2,
      detail: colors
        ? `pill 1: ${colors[0].text} (color=${colors[0].color})\npill 2: ${colors[1].text} (color=${colors[1].color})`
        : 'no two-pill group found',
      screenshots: [dualCardPath, dualChipContainerPath],
    });

    // Confirm green/amber color match.
    if (colors && colors.length === 2) {
      const greenOk = colors[0].color.includes('126, 231, 135');
      const amberOk = colors[1].color.includes('240, 184, 120');
      findings.push({
        test: 'Pill 1 uses the green palette (#7ee787)',
        pass: greenOk,
        detail: `color=${colors[0].color}; border=${colors[0].borderColor}; bg=${colors[0].backgroundColor}`,
        screenshots: [],
      });
      findings.push({
        test: 'Pill 2 uses the amber palette (#f0b878)',
        pass: amberOk,
        detail: `color=${colors[1].color}; border=${colors[1].borderColor}; bg=${colors[1].backgroundColor}`,
        screenshots: [],
      });
    }

    // ─── Tap behavior: click pill 2, verify popup opens for amber dest ─
    console.log('  testing pill-click → popup opens…');
    if (colors && colors.length === 2) {
      // Click the SECOND pill of the FIRST card.
      await page.evaluate(() => {
        const allBtn = Array.from(
          document.querySelectorAll('[aria-label*="Commute to"]'),
        );
        const groups = new Map();
        for (const btn of allBtn) {
          let parent = btn.parentElement;
          while (parent && !(parent.classList && parent.classList.contains('flex-col'))) {
            parent = parent.parentElement;
            if (!parent) break;
          }
          if (!parent) continue;
          if (!groups.has(parent)) groups.set(parent, []);
          groups.get(parent).push(btn);
        }
        for (const [, pills] of groups) {
          if (pills.length === 2) {
            pills[1].click();
            return;
          }
        }
      });
      await page.waitForTimeout(800);
      const popupVisible = await page
        .locator('[role="dialog"]')
        .isVisible()
        .catch(() => false);
      const popupText = popupVisible
        ? await page.locator('[role="dialog"]').first().textContent()
        : '';
      const popupPath = join(SCREENSHOT_DIR, '05-popup-from-pill-2.png');
      if (popupVisible) {
        await page.screenshot({ path: popupPath, fullPage: false });
      }
      findings.push({
        test: 'Tapping pill 2 opens the commute popup focused on destination 2',
        pass: popupVisible && /Empire State|350 5th/i.test(popupText ?? ''),
        detail: `popup visible=${popupVisible}; text snippet="${(popupText ?? '').slice(0, 200)}"`,
        screenshots: popupVisible ? [popupPath] : [],
      });
      // Close popup
      if (popupVisible) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
      }
    }

    // ─── Truncation check ────────────────────────────────────────────
    console.log('[5/5] Capturing long-name truncation state…');
    await setDestinations(page, [DEST_LONG_NAME, DEST_AMBER]);
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const truncChip = page.locator('[aria-label*="Commute"]').first();
    await truncChip.waitFor({ timeout: 15000 });
    const truncPath = join(SCREENSHOT_DIR, '06-truncation-check.png');
    await captureFullCard(page, truncChip, truncPath);
    const truncWrapperPath = join(SCREENSHOT_DIR, '07-truncation-pills.png');
    const truncWrapHandle = await truncChip.evaluateHandle((el) => {
      let cur = el.parentElement;
      while (cur) {
        if (cur.classList && cur.classList.contains('flex-col')) return cur;
        cur = cur.parentElement;
      }
      return el;
    });
    const truncWrapEl = truncWrapHandle.asElement();
    if (truncWrapEl) {
      await truncWrapEl.screenshot({ path: truncWrapperPath });
    }

    const truncText = await page.evaluate(() => {
      const btns = Array.from(
        document.querySelectorAll('[aria-label*="Commute to"]'),
      );
      return btns.length > 0 ? btns[0].textContent.trim() : null;
    });
    findings.push({
      test: 'Long destination names truncate at ~12 characters',
      pass: !!truncText && truncText.includes('…'),
      detail: `pill 1 visible text: "${truncText}"`,
      screenshots: [truncPath, truncWrapperPath],
    });

    // ─── Cleanup: clear destinations so the test account isn't polluted ─
    await setDestinations(page, []);
  } catch (err) {
    findings.push({
      test: 'Verify run completed without throwing',
      pass: false,
      detail: `${err && err.stack ? err.stack : err}`,
      screenshots: [],
    });
    console.error(err);
  } finally {
    await browser.close();
  }

  // ─── Write HTML report ────────────────────────────────────────────
  const allPass = findings.every((f) => f.pass);
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Commute Option A Verify</title>
<style>
  body { font: 14px -apple-system, system-ui, sans-serif; max-width: 1100px; margin: 24px auto; padding: 0 16px; background: #0d1117; color: #e1e4e8; }
  h1 { margin: 0 0 8px; font-size: 22px; }
  .summary { padding: 12px 16px; border-radius: 8px; font-weight: 600; margin-bottom: 24px; }
  .summary.pass { background: #1e3a1e; color: #7ee787; border: 1px solid #2ea043; }
  .summary.fail { background: #3a1e1e; color: #ff7b72; border: 1px solid #da3633; }
  .test { border: 1px solid #30363d; border-radius: 8px; padding: 14px 16px; margin-bottom: 14px; background: #161b22; }
  .test-h { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .badge { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; }
  .badge.pass { background: #2ea043; color: white; }
  .badge.fail { background: #da3633; color: white; }
  .test-name { font-weight: 600; }
  .test-detail { color: #8b949e; font-size: 12px; white-space: pre-wrap; margin: 6px 0 12px; font-family: ui-monospace, monospace; }
  .shots { display: flex; flex-wrap: wrap; gap: 12px; }
  .shot { border: 1px solid #30363d; border-radius: 6px; overflow: hidden; }
  .shot img { display: block; max-width: 360px; height: auto; }
  .shot .cap { padding: 6px 8px; font-size: 11px; color: #8b949e; background: #0d1117; }
</style>
</head><body>
<h1>Commute Multi-Destination Option A — Verify Report</h1>
<div class="summary ${allPass ? 'pass' : 'fail'}">${allPass ? 'PASS' : 'FAIL'} — ${findings.filter(f => f.pass).length}/${findings.length} checks</div>
${findings.map((f) => `
<div class="test">
  <div class="test-h">
    <span class="badge ${f.pass ? 'pass' : 'fail'}">${f.pass ? 'PASS' : 'FAIL'}</span>
    <span class="test-name">${escapeHtml(f.test)}</span>
  </div>
  <div class="test-detail">${escapeHtml(f.detail)}</div>
  ${f.screenshots.length ? `<div class="shots">${f.screenshots.map((p) => {
    const rel = p.split('/').pop();
    return `<div class="shot"><img src="${rel}" alt=""><div class="cap">${rel}</div></div>`;
  }).join('')}</div>` : ''}
</div>
`).join('')}
</body></html>`;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  const reportPath = join(SCREENSHOT_DIR, 'report.html');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(reportPath, html);
  console.log(`\nReport: ${reportPath}`);
  console.log(`Result: ${allPass ? 'PASS' : 'FAIL'}`);
  process.exit(allPass ? 0 : 1);
}

run();
