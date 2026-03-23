import { test, expect } from "@playwright/test";
import { waitForListingsLoaded } from "./auth.helper";

test.describe("Home page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForListingsLoaded(page);
  });

  test("page loads and shows Dwelligence in navbar", async ({ page }) => {
    const brand = page.locator("nav").getByText("Dwelligence");
    await expect(brand).toBeVisible();
  });

  test("listing cards are displayed", async ({ page }) => {
    // Each listing card contains the address text inside a styled div
    const cards = page.locator('[class*="rounded-lg"][class*="cursor-pointer"]');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThanOrEqual(1);
  });

  test("filter controls are visible", async ({ page }) => {
    await expect(page.getByText("Max $/Bed")).toBeVisible();
    await expect(page.getByText("Min Beds")).toBeVisible();
    await expect(page.getByText("Max Rent")).toBeVisible();
    await expect(page.getByText("Sort")).toBeVisible();
  });

  test("search tag tabs are visible", async ({ page }) => {
    for (const label of [
      "All",
      "Fulton St",
      "L Train",
      "Manhattan",
      "Brooklyn 14th",
    ]) {
      await expect(page.getByRole("button", { name: label })).toBeVisible();
    }
  });

  test("map is visible on desktop viewport", async ({ page }) => {
    // Leaflet injects a container with class "leaflet-container"
    const map = page.locator(".leaflet-container");
    await expect(map).toBeVisible({ timeout: 10_000 });
  });

  test("mobile list/map toggle works", async ({ page }) => {
    // Resize to mobile width so the toggle buttons appear
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await waitForListingsLoaded(page);

    const listBtn = page.getByRole("button", { name: "List" });
    const mapBtn = page.getByRole("button", { name: "Map" });

    await expect(listBtn).toBeVisible();
    await expect(mapBtn).toBeVisible();

    // Switch to map view
    await mapBtn.click();
    const map = page.locator(".leaflet-container");
    await expect(map).toBeVisible({ timeout: 10_000 });

    // Switch back to list view
    await listBtn.click();
    const firstCard = page.locator(
      '[class*="rounded-lg"][class*="cursor-pointer"]',
    );
    await expect(firstCard.first()).toBeVisible();
  });

  test("clicking a listing card highlights it", async ({ page }) => {
    const card = page
      .locator('[class*="rounded-lg"][class*="cursor-pointer"]')
      .first();
    await card.click();

    // The selected card gets a blue border via inline style
    await expect(card).toHaveCSS("border-color", "rgb(88, 166, 255)");
  });

  test("clicking Details button opens the detail modal", async ({ page }) => {
    // Click the first "Details" button
    const detailsBtn = page.getByText("Details").first();
    await detailsBtn.click();

    // The modal overlay is a fixed div with z-[1000]
    const modal = page.locator(".fixed.inset-0.z-\\[1000\\]");
    await expect(modal).toBeVisible();
  });

  test("detail modal shows listing info", async ({ page }) => {
    const detailsBtn = page.getByText("Details").first();
    await detailsBtn.click();

    const modal = page.locator(".fixed.inset-0.z-\\[1000\\]");
    await expect(modal).toBeVisible();

    // Modal should show address (h2), price ($), beds/baths
    const heading = modal.locator("h2");
    await expect(heading).toBeVisible();
    const headingText = await heading.textContent();
    expect(headingText!.length).toBeGreaterThan(0);

    // Price is displayed with a $ sign
    await expect(modal.getByText(/\$[\d,]+/)).toBeVisible();

    // Beds and Baths labels
    await expect(modal.getByText("Beds")).toBeVisible();
    await expect(modal.getByText("Baths")).toBeVisible();
  });

  test("detail modal can be closed with X button", async ({ page }) => {
    const detailsBtn = page.getByText("Details").first();
    await detailsBtn.click();

    const modal = page.locator(".fixed.inset-0.z-\\[1000\\]");
    await expect(modal).toBeVisible();

    // Close button is the button with an SVG that has x1="18" (the X icon)
    const closeBtn = modal.locator("button").first();
    await closeBtn.click();

    await expect(modal).not.toBeVisible();
  });

  test("detail modal can be closed with Escape key", async ({ page }) => {
    const detailsBtn = page.getByText("Details").first();
    await detailsBtn.click();

    const modal = page.locator(".fixed.inset-0.z-\\[1000\\]");
    await expect(modal).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(modal).not.toBeVisible();
  });
});
