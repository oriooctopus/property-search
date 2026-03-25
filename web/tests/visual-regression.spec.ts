/**
 * Visual Regression Tests
 *
 * Captures screenshots at key viewports and compares against baselines.
 * Uses mock data so screenshots are deterministic and unaffected by live DB.
 * Run: npm run test:visual
 * Update baselines after approval: npm run test:visual:update
 */
import { test, expect, type Page } from "@playwright/test";
import { MOCKS } from "./fixtures";

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const TABLET = { width: 768, height: 1024 };

/**
 * Intercepts all Supabase REST API calls and returns mock data.
 * Must be called BEFORE page.goto() so requests are caught on first load.
 */
async function mockSupabase(page: Page) {
  for (const [table, data] of Object.entries(MOCKS)) {
    await page.route(`**/rest/v1/${table}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(data),
      })
    );
  }
}

test.describe("Visual Regression — Desktop (1440×900)", () => {
  test.use({ viewport: DESKTOP });

  test("home page layout", async ({ page }) => {
    await mockSupabase(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500); // let map tiles + images settle
    await expect(page).toHaveScreenshot("desktop-home.png", {
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    });
  });

  test("listing detail modal", async ({ page }) => {
    await mockSupabase(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    // Click the first listing card to open detail
    const card = page
      .locator('[class*="rounded-lg"][class*="cursor-pointer"]')
      .first();
    if (await card.isVisible()) {
      await card.click();
      await page.waitForTimeout(500);
      await expect(page).toHaveScreenshot("desktop-detail.png", {
        maxDiffPixelRatio: 0.01,
        animations: "disabled",
      });
    }
  });
});

test.describe("Visual Regression — Mobile (390×844)", () => {
  test.use({ viewport: MOBILE, isMobile: true });

  test("home page layout", async ({ page }) => {
    await mockSupabase(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await expect(page).toHaveScreenshot("mobile-home.png", {
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    });
  });

  test("swipe mode", async ({ page }) => {
    await mockSupabase(page);
    await page.goto("/?view=swipe", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await expect(page).toHaveScreenshot("mobile-swipe.png", {
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    });
  });

  test("filter area", async ({ page }) => {
    await mockSupabase(page);
    await page.goto("/?view=list", { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    // Screenshot just the filter section
    const filterArea = page.locator('[class*="z-[1100]"]');
    if (await filterArea.isVisible()) {
      await expect(filterArea).toHaveScreenshot("mobile-filters.png", {
        maxDiffPixelRatio: 0.01,
        animations: "disabled",
      });
    }
  });
});

test.describe("Visual Regression — Tablet (768×1024)", () => {
  test.use({ viewport: TABLET });

  test("home page layout", async ({ page }) => {
    await mockSupabase(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await expect(page).toHaveScreenshot("tablet-home.png", {
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    });
  });
});
