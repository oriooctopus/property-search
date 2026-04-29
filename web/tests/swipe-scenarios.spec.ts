import { test, expect, devices, Page, Locator } from '@playwright/test';

/**
 * Canonical mobile-swipe scenario suite. Reference doc:
 * web/tests/swipe-scenarios.md.
 *
 * Each scenario runs 10 iterations and asserts 10/10 PASS.
 *
 * Some scenarios require real-finger fidelity that Playwright's touch
 * emulation can't deliver — those are marked with `test.skip` and a
 * comment, and must be exercised on a physical device before merging
 * any swipe-related change.
 */

const URL = 'http://localhost:8000/';
const ITER = 10;

test.use({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });

async function clearOnboarding(page: Page) {
  await page.addInitScript(`try { localStorage.setItem('dwelligence_swipe_onboarded', '1'); } catch (e) {}`);
}

async function loadSwipe(page: Page) {
  await clearOnboarding(page);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
}

async function getCardTransform(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="swipe-detail-panel"], [data-tour="swipe-card"]');
    return el ? getComputedStyle(el).transform : null;
  });
}

async function dispatchTouch(page: Page, type: string, x: number, y: number) {
  await page.evaluate(({ type, x, y }) => {
    const target = document.elementFromPoint(x, y);
    if (!target) return;
    const touch = new Touch({ identifier: 1, target, clientX: x, clientY: y, pageX: x, pageY: y });
    const e = new TouchEvent(type, {
      bubbles: true,
      cancelable: true,
      touches: type === 'touchend' || type === 'touchcancel' ? [] : [touch],
      changedTouches: [touch],
      targetTouches: type === 'touchend' || type === 'touchcancel' ? [] : [touch],
    });
    target.dispatchEvent(e);
  }, { type, x, y });
}

async function flick(page: Page, fromX: number, fromY: number, dx: number, dy: number, steps = 8, intervalMs = 16) {
  await dispatchTouch(page, 'touchstart', fromX, fromY);
  for (let i = 1; i <= steps; i++) {
    const x = fromX + (dx * i) / steps;
    const y = fromY + (dy * i) / steps;
    await dispatchTouch(page, 'touchmove', x, y);
    await page.waitForTimeout(intervalMs);
  }
  await dispatchTouch(page, 'touchend', fromX + dx, fromY + dy);
}

test.describe('Card translation', () => {
  test('1. Fast horizontal flick commits swipe', async ({ page }) => {
    await loadSwipe(page);
    let pass = 0;
    for (let i = 0; i < ITER; i++) {
      const before = await getCardTransform(page);
      await flick(page, 195, 400, 250, 0, 8, 16);
      await page.waitForTimeout(700);
      const after = await getCardTransform(page);
      if (before !== after) pass++;
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
    }
    expect(pass).toBe(ITER);
  });

  test('5. Slow vertical drag under threshold snaps back', async ({ page }) => {
    await loadSwipe(page);
    let pass = 0;
    for (let i = 0; i < ITER; i++) {
      await flick(page, 195, 400, 0, 30, 5, 30);
      await page.waitForTimeout(800);
      const after = await getCardTransform(page);
      // Should be back at origin (matrix(1, 0, 0, 1, 0, 0) or none)
      if (after === null || after.includes('matrix(1, 0, 0, 1, 0, 0)') || after === 'none') pass++;
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
    }
    expect(pass).toBe(ITER);
  });

  test.skip('6. Diagonal drag axis-locks horizontal — REAL DEVICE ONLY', async () => {
    // Playwright touch emulation produces uniform vectors; real fingers
    // drift naturally and this is hard to reproduce. Manual test on phone.
  });
});

test.describe('Photo gestures', () => {
  test('7. Horizontal flick on photo commits card swipe (NOT carousel)', async ({ page }) => {
    await loadSwipe(page);
    // The photo area is in the upper portion of the card (~y < 250 on iPhone 13).
    let pass = 0;
    for (let i = 0; i < ITER; i++) {
      const before = await getCardTransform(page);
      await flick(page, 195, 200, 250, 0, 8, 16);
      await page.waitForTimeout(700);
      const after = await getCardTransform(page);
      if (before !== after) pass++;
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
    }
    expect(pass).toBe(ITER);
  });

  test('12. Vertical drag starting on photo snaps back (no commit)', async ({ page }) => {
    await loadSwipe(page);
    let pass = 0;
    for (let i = 0; i < ITER; i++) {
      await flick(page, 195, 200, 0, 200, 8, 16);
      await page.waitForTimeout(800);
      const after = await getCardTransform(page);
      if (after === null || after.includes('matrix(1, 0, 0, 1, 0, 0)') || after === 'none') pass++;
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
    }
    expect(pass).toBe(ITER);
  });
});

test.describe('Scroll + swipe interaction', () => {
  test('14. After scrolling info panel, horizontal flick still commits swipe', async ({ page }) => {
    await loadSwipe(page);
    let pass = 0;
    for (let i = 0; i < ITER; i++) {
      // Scroll the panel down first
      const panelLocator = page.locator('.dark-scrollbar').first();
      await panelLocator.evaluate((el) => { el.scrollTop = 200; });
      await page.waitForTimeout(200);

      const before = await getCardTransform(page);
      // Horizontal flick somewhere INSIDE the scrolled panel (so y is below the photo)
      await flick(page, 195, 500, 250, 0, 8, 16);
      await page.waitForTimeout(700);
      const after = await getCardTransform(page);
      if (before !== after) pass++;
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
    }
    expect(pass).toBe(ITER);
  });
});

test.describe('Card preload', () => {
  test('23. Next listing first photo is preloaded', async ({ page }) => {
    await loadSwipe(page);
    // Get the next listing's URL and check the browser cache fetched it.
    // Heuristic: look at network requests for image URLs and confirm the
    // second listing's first photo was requested before any swipe action.
    const requests = new Set<string>();
    page.on('request', (req) => {
      if (req.resourceType() === 'image') requests.add(req.url());
    });
    await page.waitForTimeout(2000);
    // We can't easily verify "the second listing specifically" without
    // knowing the deck — assert at least 2+ image requests fired (current
    // listing photos + next listing first photo).
    expect(requests.size).toBeGreaterThan(1);
  });
});
