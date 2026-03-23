import { test, expect } from "@playwright/test";

const PROD_URL = "https://web-seven-chi-63.vercel.app";

test.describe("Production Verification", () => {
  test.use({
    baseURL: PROD_URL,
    viewport: { width: 1280, height: 800 },
  });

  test("homepage loads, listings and map markers appear, no JS errors", async ({
    page,
  }) => {
    const jsErrors: string[] = [];
    page.on("pageerror", (err) => jsErrors.push(err.message));

    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page).toHaveTitle(/.+/);

    // Verify listing cards are visible
    await expect(
      page.getByRole("link", { name: "View listing" }).first()
    ).toBeVisible({ timeout: 15000 });

    const listingCount = await page
      .getByRole("link", { name: "View listing" })
      .count();
    console.log(`Found ${listingCount} listing cards`);
    expect(listingCount).toBeGreaterThan(0);

    // Count map markers
    const circleCount = await page.evaluate(() => {
      return document.querySelectorAll(
        ".leaflet-overlay-pane path.leaflet-interactive"
      ).length;
    });
    console.log(`Found ${circleCount} map circle markers`);
    expect(circleCount).toBeGreaterThan(0);

    await page.screenshot({
      path: "tests/screenshots/prod-listings-loaded.png",
      fullPage: false,
    });

    // Verify no JS errors
    console.log("JS errors:", jsErrors.length ? jsErrors : "None");
    expect(jsErrors).toHaveLength(0);
  });

  test("clicking map marker opens popup, clicking popup opens detail modal", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    // Wait for markers
    await page.waitForSelector(
      ".leaflet-overlay-pane path.leaflet-interactive",
      { timeout: 15000 }
    );

    // Use Leaflet's internal API to simulate a click on a CircleMarker
    // This is more reliable than mouse.click on SVG paths
    await page.evaluate(() => {
      const paths = document.querySelectorAll(
        ".leaflet-overlay-pane path.leaflet-interactive"
      );
      const idx = Math.min(2, paths.length - 1);
      const path = paths[idx] as SVGPathElement;
      // Dispatch a native click event that Leaflet will handle
      const rect = path.getBoundingClientRect();
      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: rect.x + rect.width / 2,
        clientY: rect.y + rect.height / 2,
        view: window,
      });
      path.dispatchEvent(clickEvent);
    });

    // Wait for popup
    await page.waitForSelector(".leaflet-popup", {
      state: "visible",
      timeout: 5000,
    });

    // Wait for wirePopupHandlers (uses requestAnimationFrame)
    await page.waitForTimeout(500);

    await page.screenshot({
      path: "tests/screenshots/prod-popup-visible.png",
      fullPage: false,
    });

    // Now click the detail card inside the popup
    await page.evaluate(() => {
      const detailCard = document.querySelector(
        '.leaflet-popup [data-action="open-detail"]'
      ) as HTMLElement | null;
      if (detailCard) {
        detailCard.click();
      }
    });

    // Wait for the detail modal overlay
    await page.waitForSelector(".fixed.inset-0", {
      state: "visible",
      timeout: 5000,
    });

    await page.screenshot({
      path: "tests/screenshots/prod-detail-modal.png",
      fullPage: false,
    });

    console.log("Detail modal opened successfully");
  });
});
