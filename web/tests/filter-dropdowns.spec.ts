import { test, expect } from "@playwright/test";
import path from "path";

/**
 * Wait for the app to finish loading so filter chips are available.
 */
async function waitForAppReady(page: import("@playwright/test").Page) {
  await page
    .getByText("Finding your next home")
    .waitFor({ state: "hidden", timeout: 15_000 })
    .catch(() => {});
  await page
    .getByText("Loading listings...")
    .waitFor({ state: "hidden", timeout: 10_000 })
    .catch(() => {});
  await page.waitForTimeout(300);
}

/**
 * Expand the filter chip row by clicking the Filters toggle button.
 */
async function expandFilters(page: import("@playwright/test").Page) {
  const filtersBtn = page.getByRole("button", { name: /Filters/ }).first();
  await filtersBtn.click();
  await page.waitForTimeout(300);
}

test.describe("Filter chip dropdowns", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await waitForAppReady(page);
    await expandFilters(page);
  });

  // ─── Source dropdown ──────────────────────────────────────────────────────

  test("Source dropdown is visible when clicked", async ({ page }) => {
    // The filter chip row contains a button whose text is exactly "Source"
    // (distinct from the sort button which has different text)
    const sourceChip = page
      .locator("button")
      .filter({ hasText: /^Source$/ })
      .first();
    await expect(sourceChip).toBeVisible();
    await sourceChip.click();
    await page.waitForTimeout(300);

    // The dropdown contains source checkboxes. Locate by content.
    const dropdown = page
      .locator(".absolute.rounded-xl")
      .filter({ hasText: "Realtor.com" })
      .first();

    await expect(dropdown).toBeVisible();

    // Assert the dropdown is within the viewport (not clipped off-screen)
    const bb = await dropdown.boundingBox();
    expect(bb).not.toBeNull();
    if (bb) {
      const viewport = page.viewportSize()!;
      expect(bb.y).toBeGreaterThanOrEqual(0);
      expect(bb.x).toBeGreaterThanOrEqual(0);
      expect(bb.y + bb.height).toBeLessThanOrEqual(viewport.height);
      expect(bb.x + bb.width).toBeLessThanOrEqual(viewport.width);
    }

    // Verify it contains the expected checkboxes
    await expect(dropdown.getByRole("checkbox").first()).toBeVisible();
    await expect(dropdown.getByText("Realtor.com")).toBeVisible();
    await expect(dropdown.getByText("Craigslist")).toBeVisible();

    // Screenshot for evidence (saved to test-results dir, not snapshots)
    await page.screenshot({
      path: "tests/screenshots/filter-dropdown-source.png",
    });
  });

  // ─── Price dropdown ───────────────────────────────────────────────────────

  test("Price dropdown is visible when clicked", async ({ page }) => {
    // "Price" chip — uniquely identified by its text; avoids the sort button
    // which may have multi-word text in the sort dropdown.
    const priceChip = page
      .locator("button")
      .filter({ hasText: /^Price$/ })
      .first();
    await expect(priceChip).toBeVisible();
    await priceChip.click();
    await page.waitForTimeout(300);

    // Price dropdown contains range sliders labelled "Min Price" / "Max Price"
    const dropdown = page
      .locator(".absolute.rounded-xl")
      .filter({ hasText: "Min Price" })
      .first();

    await expect(dropdown).toBeVisible();

    // Assert the dropdown is within the viewport
    const bb = await dropdown.boundingBox();
    expect(bb).not.toBeNull();
    if (bb) {
      const viewport = page.viewportSize()!;
      expect(bb.y).toBeGreaterThanOrEqual(0);
      expect(bb.x).toBeGreaterThanOrEqual(0);
      expect(bb.y + bb.height).toBeLessThanOrEqual(viewport.height);
      expect(bb.x + bb.width).toBeLessThanOrEqual(viewport.width);
    }

    // Verify it contains the range sliders
    await expect(dropdown.getByText("Min Price")).toBeVisible();
    await expect(dropdown.getByText("Max Price")).toBeVisible();

    await page.screenshot({
      path: "tests/screenshots/filter-dropdown-price.png",
    });
  });

  // ─── Beds / Baths dropdown ────────────────────────────────────────────────

  test("Beds/Baths dropdown is visible when clicked", async ({ page }) => {
    const bedsBathsChip = page
      .locator("button")
      .filter({ hasText: /^Beds \/ Baths$/ })
      .first();
    await expect(bedsBathsChip).toBeVisible();
    await bedsBathsChip.click();
    await page.waitForTimeout(300);

    // Beds/Baths dropdown contains "Bedrooms" and "Bathrooms" section titles
    const dropdown = page
      .locator(".absolute.rounded-xl")
      .filter({ hasText: "Bedrooms" })
      .first();

    await expect(dropdown).toBeVisible();

    // Assert the dropdown is within the viewport
    const bb = await dropdown.boundingBox();
    expect(bb).not.toBeNull();
    if (bb) {
      const viewport = page.viewportSize()!;
      expect(bb.y).toBeGreaterThanOrEqual(0);
      expect(bb.x).toBeGreaterThanOrEqual(0);
      expect(bb.y + bb.height).toBeLessThanOrEqual(viewport.height);
      expect(bb.x + bb.width).toBeLessThanOrEqual(viewport.width);
    }

    // Verify both sections are present
    await expect(dropdown.getByText("Bedrooms")).toBeVisible();
    await expect(dropdown.getByText("Bathrooms")).toBeVisible();

    await page.screenshot({
      path: "tests/screenshots/filter-dropdown-beds-baths.png",
    });
  });

  // ─── Only one dropdown open at a time ─────────────────────────────────────

  test("opening a second chip closes the first", async ({ page }) => {
    // Open Source
    const sourceChip = page
      .locator("button")
      .filter({ hasText: /^Source$/ })
      .first();
    await sourceChip.click();
    await page.waitForTimeout(300);

    const sourceDropdown = page
      .locator(".absolute.rounded-xl")
      .filter({ hasText: "Realtor.com" })
      .first();
    await expect(sourceDropdown).toBeVisible();

    // Open Price — Source should close
    const priceChip = page
      .locator("button")
      .filter({ hasText: /^Price$/ })
      .first();
    await priceChip.click();
    await page.waitForTimeout(300);

    await expect(sourceDropdown).not.toBeVisible();

    const priceDropdown = page
      .locator(".absolute.rounded-xl")
      .filter({ hasText: "Min Price" })
      .first();
    await expect(priceDropdown).toBeVisible();
  });

  // ─── Dropdown closes when chip is clicked again ───────────────────────────

  test("clicking an open chip closes its dropdown", async ({ page }) => {
    const sourceChip = page
      .locator("button")
      .filter({ hasText: /^Source$/ })
      .first();
    await sourceChip.click();
    await page.waitForTimeout(300);

    const dropdown = page
      .locator(".absolute.rounded-xl")
      .filter({ hasText: "Realtor.com" })
      .first();
    await expect(dropdown).toBeVisible();

    // Click the chip again to close
    await sourceChip.click();
    await page.waitForTimeout(300);

    await expect(dropdown).not.toBeVisible();
  });
});
