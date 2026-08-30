import { test, expect, devices } from "@playwright/test";

// Regression test for the "flash behind the card after a swipe" bug.
//
// SwipeView.tsx renders the next card underneath the current one in an
// always-mounted layer (data-testid="next-card-layer") so it's visible the
// instant the top card starts moving — during a drag AND during the 180ms
// fly-out tween that plays after release. `onSwiped` calls `commitSwipe()`
// (which starts that tween) and then immediately calls
// `onDragStateChange(false)`, so `isDragging` goes false while the card is
// still mid-flight. If the next-card layer's visibility is gated on
// `isDragging` (`visibility: isDragging ? 'visible' : 'hidden'`), it snaps
// to hidden the instant of release — well before the fly-out finishes —
// producing a blank flash behind the exiting card. This test proves the
// layer's visibility is never "hidden" while a swipe is in flight, by
// recording every `style` mutation on the layer (a MutationObserver, not
// a polling loop, so it can't miss a transient state between samples).
//
// Uses TEST_USER_EMAIL / TEST_USER_PASSWORD from web/.env.local — never the
// real account. See tests/e2e/helpers/auth.mjs for the source of this
// pattern (tests/auth.helper.ts elsewhere in this suite still hardcodes the
// real account's credentials and should not be used as a reference).
try {
  process.loadEnvFile(`${__dirname}/../.env.local`);
} catch {
  // already loaded (e.g. CI sets env directly)
}

test.use({ ...devices["iPhone 13"], hasTouch: true, isMobile: true });

// A Brooklyn coordinate with real test-account listing data. The app's own
// default-location resolution races (IP geolocation vs. a NYC-center
// fallback) and can land on a data-sparse spot — observed: lower Manhattan,
// 40.7128/-74.0060, "No listings found". Navigating with an explicit
// lat/lng after login sidesteps that race entirely.
const KNOWN_GOOD_LOCATION = "lat=40.7037&lng=-73.9412&zoom=15.0";

test("next-card layer never goes visibility:hidden during a swipe fly-out", async ({
  page,
}) => {
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "TEST_USER_EMAIL/TEST_USER_PASSWORD missing — check web/.env.local",
    );
  }

  await page.goto("/auth/login", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!document.querySelector("form"));
  await page.waitForTimeout(500);
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/login"), {
    timeout: 15_000,
  });
  await page.waitForTimeout(1000);
  await page.goto(`/?view=swipe&${KNOWN_GOOD_LOCATION}`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByText("Loading listings...")
    .waitFor({ state: "hidden", timeout: 15_000 })
    .catch(() => {});
  await page.waitForTimeout(2500);

  const nextLayer = page.locator('[data-testid="next-card-layer"]');
  const topLayer = page.locator('[data-testid="top-card-layer"]');
  await topLayer.waitFor({ state: "attached", timeout: 20_000 });
  await nextLayer.waitFor({ state: "attached", timeout: 20_000 });

  let box = await topLayer.boundingBox();
  for (let i = 0; i < 40 && (!box || box.height < 100); i++) {
    await page.waitForTimeout(300);
    box = await topLayer.boundingBox();
  }
  if (!box) throw new Error("top card never rendered with a real size");

  // Drag starting BELOW the photo area (which owns its own carousel-swipe
  // gesture) so this registers as a card-level swipe, not photo navigation.
  const startX = box.x + box.width * 0.5;
  const startY = box.y + box.height * 0.82;
  const endX = startX + 320; // clears SWIPE_X_THRESHOLD (50px) comfortably
  const endY = startY;

  // Arm a MutationObserver on the next-card layer's style attribute before
  // the drag starts, so every value it's ever set to during the drag +
  // release + fly-out is recorded with an exact timestamp — no polling gaps.
  await page.evaluate(() => {
    (window as any).__hiddenEvents = [];
    const el = document.querySelector('[data-testid="next-card-layer"]');
    if (!el) return;
    const mo = new MutationObserver(() => {
      const vis = getComputedStyle(el).visibility;
      if (vis === "hidden") {
        (window as any).__hiddenEvents.push({
          t: performance.now(),
          visibility: vis,
        });
      }
    });
    mo.observe(el, { attributes: true, attributeFilter: ["style"] });
    (window as any).__mo = mo;
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: startX, y: startY, id: 1 }],
  });
  await page.waitForTimeout(30);
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const x = startX + ((endX - startX) * i) / steps;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: endY, id: 1 }],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });

  // Poll the layer's visibility directly too, as a second, independent
  // signal — every 5ms for 1s covers the 180ms fly-out with wide margin.
  const polledHidden: { t: number; visibility: string }[] =
    await page.evaluate(async () => {
      const el = document.querySelector('[data-testid="next-card-layer"]');
      const t0 = performance.now();
      const hits: { t: number; visibility: string }[] = [];
      await new Promise<void>((resolve) => {
        const iv = setInterval(() => {
          const t = performance.now() - t0;
          if (el) {
            const vis = getComputedStyle(el).visibility;
            if (vis === "hidden") hits.push({ t, visibility: vis });
          }
          if (t >= 1000) {
            clearInterval(iv);
            resolve();
          }
        }, 5);
      });
      return hits;
    });

  const mutationHidden = await page.evaluate(
    () => (window as any).__hiddenEvents,
  );

  expect(
    mutationHidden.length,
    `next-card-layer went visibility:hidden via ${mutationHidden.length} style mutation(s) during the swipe: ${JSON.stringify(mutationHidden)}`,
  ).toBe(0);
  expect(
    polledHidden.length,
    `next-card-layer polled as visibility:hidden ${polledHidden.length} time(s) during the swipe: ${JSON.stringify(polledHidden.slice(0, 5))}`,
  ).toBe(0);
});
