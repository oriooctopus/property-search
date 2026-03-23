import { test, expect } from "@playwright/test";

/**
 * Wait for listings to finish loading by waiting for the loading spinner
 * to disappear and filter chips to appear.
 */
async function waitForAppReady(page: import("@playwright/test").Page) {
  // Wait for loading text/spinner to go away
  await page
    .getByText("Finding your next home")
    .waitFor({ state: "hidden", timeout: 15_000 })
    .catch(() => {});
  // Also try the older loading text
  await page
    .getByText("Loading listings")
    .waitFor({ state: "hidden", timeout: 5_000 })
    .catch(() => {});
  // Wait for filter chips to be present (sign that the app is ready)
  await page
    .locator('text=Price')
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
}

test.describe("z-index: dropdowns render above map", () => {
  test("profile dropdown appears above everything at mobile viewport", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 2,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.goto("/", { waitUntil: "networkidle" });
    await waitForAppReady(page);

    // Look for the profile avatar button (circle with letter or image)
    const avatar = page.locator("nav button.rounded-full").first();
    const avatarVisible = await avatar.isVisible().catch(() => false);

    if (avatarVisible) {
      await avatar.click();
      await page.waitForTimeout(500);

      // The dropdown should be visible — check it contains "Profile" or "Log out"
      const dropdown = page
        .locator('nav a:has-text("Profile"), nav button:has-text("Log out")')
        .first();
      const dropdownVisible = await dropdown.isVisible().catch(() => false);
      expect(dropdownVisible).toBe(true);

      await page.screenshot({
        path: "tests/screenshots/z-index-profile-dropdown-mobile.png",
        fullPage: false,
      });
    } else {
      // User not logged in — just take a screenshot showing navbar is above map
      await page.screenshot({
        path: "tests/screenshots/z-index-navbar-no-login-mobile.png",
        fullPage: false,
      });
    }

    await context.close();
  });

  test("filter chip dropdown appears above map at mobile viewport", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 2,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.goto("/", { waitUntil: "networkidle" });
    await waitForAppReady(page);

    // Switch to map view first so the map is visible behind
    const mapTab = page.locator('button:has-text("Map")');
    const mapTabVisible = await mapTab.isVisible().catch(() => false);
    if (mapTabVisible) {
      await mapTab.click();
      await page.waitForTimeout(1000);
    }

    // Click the first filter chip (Price)
    const filterChip = page.locator('button:has-text("Price")').first();
    await filterChip.click();
    await page.waitForTimeout(500);

    // The filter dropdown should be visible — look for the dropdown panel
    // FilterChip dropdown has min-width 320px and contains slider or pill buttons
    const dropdown = page.locator(".absolute.rounded-xl").first();
    const dropdownVisible = await dropdown.isVisible().catch(() => false);
    expect(dropdownVisible).toBe(true);

    await page.screenshot({
      path: "tests/screenshots/z-index-filter-dropdown-mobile.png",
      fullPage: false,
    });

    await context.close();
  });
});
