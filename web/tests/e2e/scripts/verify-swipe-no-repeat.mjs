// Verify the swipe deck never re-shows a card the user already swiped on
// before the empty state appears. Reproduces the bug reported as:
//   "I'm sometimes re-seeing things I've already swiped on right before
//    I run out of items. The last one before I run out of items is a repeat."
//
// Strategy:
//   1. Apply a restrictive filter via URL params so the deck is small (5-12 cards)
//   2. Swipe through every card, capturing each card's address text in order
//   3. Confirm the empty state appears
//   4. Assert no address appears twice in the swipe sequence
//   5. Repeat across 3 different filter sets (different deck sizes / mixes)
//
// Run from repo root:
//   node --env-file=web/.env.local web/tests/e2e/scripts/verify-swipe-no-repeat.mjs

import { chromium } from 'playwright';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loginAsTestUser } from '../helpers/auth.mjs';

const SCREENSHOT_DIR = path.join(
  process.env.HOME ?? '',
  'Documents/coding/screenshots/property-search/swipe-no-repeat',
);
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const BASE = 'http://localhost:8000';

function hb(msg) {
  // eslint-disable-next-line no-console
  console.log(`[hb ${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

// Three filter scenarios — each chosen to yield a small but non-trivial deck.
// We try a few rent ranges; the count varies with the live data, but anything
// in 4-15 cards is fine for the test. We log how many we actually swept.
const SCENARIOS = [
  {
    name: 'narrow-rent-band-A',
    // Use the URL-shape the app actually parses. Filters live in URL search params.
    // We pass a tight rent band — the page's filter logic reads these and feeds the API.
    qs: 'minRent=4000&maxRent=4200',
  },
  {
    name: 'narrow-rent-band-B',
    qs: 'minRent=2200&maxRent=2400',
  },
  {
    name: 'narrow-rent-band-C',
    qs: 'minRent=6000&maxRent=6500',
  },
];

async function getCardAddress(page) {
  // Grab the visible address inside the active swipe card.
  // The card uses a div with text-base font-semibold containing listing.address.
  // We scope to the live (non-`.invisible`) card to avoid the layout-only ghost.
  const handle = await page.evaluateHandle(() => {
    // Find the top swipe card — has data-tour="swipe-card" and z-index=2.
    // There's a hidden ".invisible" sibling for layout sizing — skip it.
    const cards = Array.from(document.querySelectorAll('[data-tour="swipe-card"]'));
    for (const card of cards) {
      const parent = card.closest('.invisible');
      if (parent) continue; // skip the invisible layout-sizer card
      // Read the address from the rendered card body. The address renders as
      // a div with class containing "text-base font-semibold" inside the card.
      const addrNode = card.querySelector('div.text-base.font-semibold');
      if (addrNode && addrNode.textContent) return addrNode.textContent.trim();
    }
    return null;
  });
  const addr = await handle.jsonValue();
  await handle.dispose();
  return addr;
}

async function isEmptyState(page) {
  // Empty state shows the "You've seen all listings!" copy.
  return await page.evaluate(() => {
    return document.body.innerText.includes("You've seen all listings");
  });
}

async function isNoListingsState(page) {
  return await page.evaluate(() => {
    return document.body.innerText.includes('No listings found');
  });
}

// Swipe by clicking the mobile dock button (Reject = X button).
async function swipeReject(page) {
  // The mobile dock has a button with aria-label="Reject"
  await page.locator('button[aria-label="Reject"]').first().click({ timeout: 5000 });
  // Wait a beat for the card to swap.
  await page.waitForTimeout(450);
}

async function swipeSave(page) {
  await page.locator('button[aria-label="Save"]').first().click({ timeout: 5000 });
  await page.waitForTimeout(450);
}

async function runScenario(page, scenario, idx) {
  hb(`scenario ${idx + 1}/${SCENARIOS.length} (${scenario.name}): navigating with filter`);
  await page.goto(`${BASE}/?${scenario.qs}`, { waitUntil: 'domcontentloaded' });

  // Wait for the swipe card to render OR no-listings state.
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      if (text.includes('No listings found')) return true;
      if (text.includes("You've seen all listings")) return true;
      // Look for the active swipe card with an address.
      const cards = document.querySelectorAll('[data-tour="swipe-card"]');
      for (const c of cards) {
        if (c.closest('.invisible')) continue;
        const a = c.querySelector('div.text-base.font-semibold');
        if (a && a.textContent && a.textContent.trim().length > 0) return true;
      }
      return false;
    },
    { timeout: 20000 },
  );

  if (await isNoListingsState(page)) {
    hb(`  -> filter returned 0 listings, skipping`);
    return { name: scenario.name, skipped: true, reason: 'no listings for filter' };
  }
  if (await isEmptyState(page)) {
    hb(`  -> already in empty state (no cards left), skipping`);
    return { name: scenario.name, skipped: true, reason: 'empty state on load' };
  }

  // Capture initial screenshot.
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${scenario.name}-01-start.png`) });

  const seen = [];
  let safetyCounter = 0;
  const MAX_CARDS = 50; // hard ceiling so we never loop forever

  while (safetyCounter < MAX_CARDS) {
    safetyCounter++;
    if (await isEmptyState(page)) {
      hb(`  -> empty state reached after ${seen.length} swipes`);
      break;
    }
    const addr = await getCardAddress(page);
    if (!addr) {
      hb(`  -> WARN: no address captured at iter ${safetyCounter}`);
      break;
    }
    seen.push(addr);
    // Alternate Reject / Save / Reject — mix of left and right.
    const direction = safetyCounter % 2 === 0 ? 'save' : 'reject';
    hb(`  swipe ${safetyCounter}: ${direction} -> "${addr}"`);
    if (direction === 'save') {
      await swipeSave(page);
    } else {
      await swipeReject(page);
    }
  }

  // Final screenshot of the empty state (or wherever we ended).
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${scenario.name}-99-end.png`) });

  // Detect duplicates in the seen sequence.
  const seenCount = new Map();
  const duplicates = [];
  for (let i = 0; i < seen.length; i++) {
    const a = seen[i];
    const prev = seenCount.get(a);
    if (prev !== undefined) {
      duplicates.push({ first: prev, repeat: i, address: a });
    }
    seenCount.set(a, i);
  }

  return {
    name: scenario.name,
    skipped: false,
    seen,
    duplicates,
    reachedEmptyState: await isEmptyState(page),
  };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone 14 Pro mobile viewport
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  page.on('pageerror', (err) => hb(`PAGE ERROR: ${err.message}`));

  hb('logging in as test user');
  await loginAsTestUser(page);

  // Clear any prior session-state side effects: refresh first to make sure
  // we're not carrying state from an earlier run. The bug is in-session
  // (swipedIds is in-memory) so a fresh load resets it.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  const results = [];
  for (let i = 0; i < SCENARIOS.length; i++) {
    const r = await runScenario(page, SCENARIOS[i], i);
    results.push(r);
  }

  hb('summary');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(results, null, 2));

  // Build HTML report.
  let allPass = true;
  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Swipe No-Repeat Verify</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 900px; margin: 24px auto; padding: 0 16px; color: #1c2028; }
  h1 { margin-bottom: 8px; }
  .scenario { border: 1px solid #d0d7de; border-radius: 8px; padding: 16px; margin: 16px 0; }
  .pass { color: #1a7f37; font-weight: 600; }
  .fail { color: #cf222e; font-weight: 600; }
  .skip { color: #8b949e; font-weight: 600; }
  ol { font-size: 13px; }
  .dup { background: #ffebe9; padding: 4px 8px; border-radius: 4px; }
  img { max-width: 360px; border: 1px solid #d0d7de; border-radius: 6px; margin-right: 8px; }
</style>
</head><body>
<h1>Swipe deck no-repeat verification</h1>
<p>Bug: "the last card before the empty state is a duplicate of one already swiped".</p>
<p>For each scenario we apply a tight rent filter, then alternately Reject/Save every card until empty state. We assert no address text appears twice in the swipe sequence.</p>
`;

  for (const r of results) {
    html += `<div class="scenario"><h2>${r.name}</h2>`;
    if (r.skipped) {
      html += `<div class="skip">SKIPPED: ${r.reason}</div>`;
    } else {
      const pass = r.duplicates.length === 0 && r.reachedEmptyState;
      if (!pass) allPass = false;
      html += `<div class="${pass ? 'pass' : 'fail'}">${pass ? 'PASS' : 'FAIL'}</div>`;
      html += `<p>Cards swiped: <b>${r.seen.length}</b>. Reached empty state: <b>${r.reachedEmptyState}</b>. Duplicates found: <b>${r.duplicates.length}</b>.</p>`;
      html += `<ol>`;
      const dupSet = new Set();
      for (const d of r.duplicates) dupSet.add(d.repeat);
      for (let i = 0; i < r.seen.length; i++) {
        const isDup = dupSet.has(i);
        html += `<li ${isDup ? 'class="dup"' : ''}>${r.seen[i]}${isDup ? ' &larr; REPEAT' : ''}</li>`;
      }
      html += `</ol>`;
      html += `<div><img src="${r.name}-01-start.png" alt="start"><img src="${r.name}-99-end.png" alt="end"></div>`;
    }
    html += `</div>`;
  }
  html += `<h2>${allPass ? '<span class="pass">OVERALL PASS</span>' : '<span class="fail">OVERALL FAIL</span>'}</h2>`;
  html += `</body></html>`;
  const reportPath = path.join(SCREENSHOT_DIR, 'report.html');
  writeFileSync(reportPath, html, 'utf8');
  hb(`report written to ${reportPath}`);

  await browser.close();
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(2);
});
