// Run-now harness for the canonical swipe scenarios. Uses CDP
// Input.dispatchTouchEvent (the same primitive as the prior working
// verify runs) — page.evaluate(new TouchEvent(...)) doesn't fire
// pointer events that @use-gesture/react listens for.
//
// Usage: cd web && node tests/swipe-scenarios-cdp.mjs

import { chromium, devices } from 'playwright';

const URL_TARGET = 'http://localhost:8000/?view=swipe';
const ITER = 10;

async function setup() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    hasTouch: true,
    isMobile: true,
  });
  await context.addInitScript(() => {
    try { localStorage.setItem('dwelligence_swipe_onboarded', '1'); } catch {}
  });
  const page = await context.newPage();
  return { browser, context, page };
}

async function waitForCardReady(page) {
  await page.waitForFunction(() => {
    const panel = document.querySelector('[data-testid="swipe-detail-panel"]');
    if (!panel) return false;
    const addr = panel.querySelector('div.text-base');
    return !!(addr && addr.textContent && addr.textContent.trim().length > 0);
  }, null, { timeout: 20000 });
  await page.waitForTimeout(250);
}

async function gotoSwipe(page) {
  await page.goto(URL_TARGET, { waitUntil: 'domcontentloaded' });
  await waitForCardReady(page);
}

async function getAddr(page) {
  return await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="swipe-detail-panel"]');
    if (!panel) return null;
    const addr = panel.querySelector('div.text-base');
    return addr ? (addr.textContent || '').trim() : null;
  });
}

async function getMaxTransform(page, ms = 700) {
  return await page.evaluate(async (durationMs) => {
    function read() {
      const panel = document.querySelector('[data-testid="swipe-detail-panel"]');
      if (!panel) return { x: 0, y: 0 };
      let mx = 0, my = 0;
      panel.querySelectorAll('div').forEach((d) => {
        const t = d.style.transform;
        if (!t) return;
        const xm = t.match(/translateX\(([-\d.]+)px\)/);
        const ym = t.match(/translateY\(([-\d.]+)px\)/);
        if (xm && Math.abs(parseFloat(xm[1])) > Math.abs(mx)) mx = parseFloat(xm[1]);
        if (ym && Math.abs(parseFloat(ym[1])) > Math.abs(my)) my = parseFloat(ym[1]);
      });
      return { x: mx, y: my };
    }
    let max = { x: 0, y: 0 };
    const start = performance.now();
    while (performance.now() - start < durationMs) {
      const cur = read();
      if (Math.abs(cur.x) > Math.abs(max.x)) max.x = cur.x;
      if (Math.abs(cur.y) > Math.abs(max.y)) max.y = cur.y;
      await new Promise((r) => setTimeout(r, 16));
    }
    return max;
  }, ms);
}

let _cdp = null;
async function cdp(page) {
  if (_cdp) return _cdp;
  _cdp = await page.context().newCDPSession(page);
  return _cdp;
}

async function touchSwipe(page, fromX, fromY, toX, toY, durationMs = 100, steps = 10) {
  const c = await cdp(page);
  await c.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: fromX, y: fromY, id: 1, radiusX: 5, radiusY: 5, force: 1 }],
  });
  const stepDelay = durationMs / steps;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = fromX + (toX - fromX) * t;
    const y = fromY + (toY - fromY) * t;
    await c.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y, id: 1, radiusX: 5, radiusY: 5, force: 1 }],
    });
    await new Promise((r) => setTimeout(r, stepDelay));
  }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function reset(page) {
  _cdp = null;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForCardReady(page);
}

async function runScenario(name, ms, fn) {
  let pass = 0, fail = 0;
  const failures = [];
  for (let i = 0; i < ITER; i++) {
    try {
      const ok = await fn(i);
      if (ok) pass++; else { fail++; failures.push(i); }
    } catch (e) {
      fail++;
      failures.push(`${i}:${e.message?.slice(0, 60)}`);
    }
  }
  console.log(`${name}: ${pass}/${ITER}${failures.length ? ` failures=${failures.slice(0, 3).join(',')}` : ''}`);
  return { name, pass, fail, total: ITER };
}

async function main() {
  const { browser, page } = await setup();
  const results = [];

  await gotoSwipe(page);

  // T1: fast horizontal flick from card center
  results.push(await runScenario('T1 fast-flick-center', 700, async () => {
    const before = await getAddr(page);
    await touchSwipe(page, 195, 480, 600, 480, 100, 8);
    await page.waitForTimeout(700);
    const after = await getAddr(page);
    const ok = before !== after;
    await reset(page);
    return ok;
  }));

  // T5: vertical drag below threshold snaps back
  results.push(await runScenario('T5 vertical-snapback', 800, async () => {
    const before = await getAddr(page);
    await touchSwipe(page, 195, 480, 195, 510, 200, 5);
    await page.waitForTimeout(900);
    const after = await getAddr(page);
    const ok = before === after;
    await reset(page);
    return ok;
  }));

  // T7: horizontal flick STARTING ON PHOTO commits card swipe
  results.push(await runScenario('T7 photo-flick-commits', 700, async () => {
    const before = await getAddr(page);
    await touchSwipe(page, 195, 200, 600, 200, 100, 8);
    await page.waitForTimeout(700);
    const after = await getAddr(page);
    const ok = before !== after;
    await reset(page);
    return ok;
  }));

  // T12: vertical drag starting on photo snaps back
  results.push(await runScenario('T12 photo-vertical-snapback', 900, async () => {
    const before = await getAddr(page);
    await touchSwipe(page, 195, 200, 195, 400, 250, 8);
    await page.waitForTimeout(900);
    const after = await getAddr(page);
    const ok = before === after;
    await reset(page);
    return ok;
  }));

  // T14: scroll panel down, then horizontal flick still commits
  results.push(await runScenario('T14 scroll-then-flick', 900, async () => {
    const before = await getAddr(page);
    await page.evaluate(() => {
      const p = document.querySelector('.dark-scrollbar');
      if (p) p.scrollTop = 200;
    });
    await page.waitForTimeout(200);
    // Flick somewhere clearly inside the now-scrolled panel
    await touchSwipe(page, 195, 600, 600, 600, 100, 8);
    await page.waitForTimeout(700);
    const after = await getAddr(page);
    const ok = before !== after;
    await reset(page);
    return ok;
  }));

  // T23: preload — listen for image requests AFTER load, then trigger swipe,
  // confirm the next listing's photo was already cached (request count
  // doesn't grow when next card becomes top).
  console.log('T23 preload — observational check, see image cache below');
  const imgRequestsAfterLoad = [];
  page.on('request', (req) => {
    if (req.resourceType() === 'image') imgRequestsAfterLoad.push(req.url());
  });
  // Wait for any background preload effects to fire after the current load
  await page.waitForTimeout(1500);
  console.log(`T23 image requests during idle (post-load preload window): ${imgRequestsAfterLoad.length}`);

  await browser.close();

  const total = results.reduce((s, r) => s + r.pass, 0);
  const max = results.length * ITER;
  console.log(`\nTOTAL: ${total}/${max}`);
  process.exit(total === max ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
