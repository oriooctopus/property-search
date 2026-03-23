import { test, expect } from "@playwright/test";
import { waitForListingsLoaded } from "./auth.helper";

test.describe("Filters", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForListingsLoaded(page);
  });

  test("changing Min Beds filter reduces listing count", async ({ page }) => {
    // Read the initial listing count from the "X listings" text
    const countText = page.locator("text=/\\d+ listings?/");
    const initialText = await countText.textContent();
    const initialCount = parseInt(initialText!);

    // Set Min Beds to 6+
    const minBedsSelect = page.locator("select").first();
    await minBedsSelect.selectOption("6");

    // Wait briefly for the filter to apply (client-side)
    await page.waitForTimeout(300);

    const filteredText = await countText.textContent();
    const filteredCount = parseInt(filteredText!);

    expect(filteredCount).toBeLessThanOrEqual(initialCount);
  });

  test("search tag tabs filter listings by category", async ({ page }) => {
    // Get initial count with "All" selected
    const countText = page.locator("text=/\\d+ listings?/");
    const initialText = await countText.textContent();
    const initialCount = parseInt(initialText!);

    // Click the "Fulton St" tab to filter
    await page.getByRole("button", { name: "Fulton St" }).click();
    await page.waitForTimeout(300);

    const filteredText = await countText.textContent();
    const filteredCount = parseInt(filteredText!);

    // Fulton St subset should be smaller or equal to all listings
    expect(filteredCount).toBeLessThanOrEqual(initialCount);

    // Click "All" to go back
    await page.getByRole("button", { name: "All" }).click();
    await page.waitForTimeout(300);

    const restoredText = await countText.textContent();
    const restoredCount = parseInt(restoredText!);
    expect(restoredCount).toBe(initialCount);
  });

  test("sort by price works", async ({ page }) => {
    // Change sort to "Price"
    const sortSelect = page.locator("select").last();
    await sortSelect.selectOption("price");
    await page.waitForTimeout(300);

    // Get the price text from the first two cards
    const prices = page.locator('[style*="color: rgb(126, 231, 135)"]');
    const firstPriceText = await prices.first().textContent();
    const secondPriceText = await prices.nth(1).textContent();

    if (firstPriceText && secondPriceText) {
      const firstPrice = parseInt(firstPriceText.replace(/[^0-9]/g, ""));
      const secondPrice = parseInt(secondPriceText.replace(/[^0-9]/g, ""));
      expect(firstPrice).toBeLessThanOrEqual(secondPrice);
    }
  });

  test("filters persist when switching between list/map on mobile", async ({
    page,
  }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await waitForListingsLoaded(page);

    // Set Min Beds to 6+
    const minBedsSelect = page.locator("select").first();
    await minBedsSelect.selectOption("6");
    await page.waitForTimeout(300);

    // Read the filtered count
    const countText = page.locator("text=/\\d+ listings?/");
    const filteredText = await countText.textContent();
    const filteredCount = parseInt(filteredText!);

    // Switch to map view
    await page.getByRole("button", { name: "Map" }).click();
    await page.waitForTimeout(500);

    // Switch back to list view
    await page.getByRole("button", { name: "List" }).click();
    await page.waitForTimeout(300);

    // The filter should still be applied
    const afterText = await countText.textContent();
    const afterCount = parseInt(afterText!);
    expect(afterCount).toBe(filteredCount);

    // The select should still show "6+"
    await expect(minBedsSelect).toHaveValue("6");
  });
});
