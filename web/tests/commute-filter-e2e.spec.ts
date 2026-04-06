import { test, expect, type Page } from "@playwright/test";
import { waitForListingsLoaded } from "./auth.helper";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse the listing count text (e.g. "42" or "1,234") into a number. */
async function getListingCount(page: Page): Promise<number> {
  const el = page.getByTestId("listing-count");
  await expect(el).toBeVisible({ timeout: 15_000 });
  const text = await el.textContent();
  const num = parseInt((text ?? "0").replace(/[^\d]/g, ""), 10);
  return Number.isNaN(num) ? 0 : num;
}

/** Expand the filters row (if collapsed) and open the Commute chip dropdown. */
async function openCommuteDropdown(page: Page) {
  const commuteChip = page.getByTestId("commute-chip");

  // The commute chip lives in the expandable second row — click "Filters" to reveal it
  if (!(await commuteChip.isVisible().catch(() => false))) {
    const filtersToggle = page
      .getByRole("button", { name: /filters/i })
      .first();
    await filtersToggle.click();
    await expect(commuteChip).toBeVisible({ timeout: 5_000 });
  }

  await commuteChip.click();
  // Verify the commute rules section opened
  await expect(page.locator("text=Commute Rules")).toBeVisible({ timeout: 5_000 });
}

/** Click "Add commute filter" button in the empty state of the commute dropdown. */
async function addCommuteFilter(page: Page) {
  const addBtn = page.getByRole("button", { name: /add commute filter/i });
  await expect(addBtn).toBeVisible();
  await addBtn.click();
}

/** Click the "Done" button in the commute dropdown to apply filters. */
async function clickDone(page: Page) {
  const doneBtn = page.getByRole("button", { name: /^done$/i });
  await expect(doneBtn).toBeVisible();
  await doneBtn.click();
}

/**
 * Wait for the commute-filter API call to complete and return its JSON body.
 * Must be called BEFORE the action that triggers the fetch.
 */
function waitForCommuteResponse(page: Page) {
  return page.waitForResponse(
    (resp) =>
      resp.url().includes("/api/commute-filter") && resp.status() === 200,
    { timeout: 45_000 },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Commute filter e2e", () => {
  // OTP calls can take 10-20s, so give each test plenty of room
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForListingsLoaded(page);
  });

  // -------------------------------------------------------------------------
  // 1. Address commute filter triggers API and returns results
  // -------------------------------------------------------------------------
  test("address commute filter calls API and shows filtered results", async ({
    page,
  }) => {
    const initialCount = await getListingCount(page);
    expect(initialCount).toBeGreaterThan(0);

    // Open commute filter and add a rule
    await openCommuteDropdown(page);
    await addCommuteFilter(page);

    // Switch rule type to "Address"
    const typeSelect = page.locator("select").first();
    await typeSelect.selectOption("address");

    // Type an address and wait for autocomplete suggestions
    const addressInput = page.getByPlaceholder("Search address...");
    await expect(addressInput).toBeVisible();
    await addressInput.click();
    await addressInput.pressSequentially("Times Square, New York", {
      delay: 40,
    });

    // Wait for autocomplete suggestions to appear
    const suggestion = page
      .locator("button")
      .filter({ hasText: /Times Square/i })
      .first();
    await expect(suggestion).toBeVisible({ timeout: 10_000 });
    await suggestion.click();

    // Now click "Done" to apply the filter, which triggers the API call
    const responsePromise = waitForCommuteResponse(page);
    await clickDone(page);

    const response = await responsePromise;
    const body = await response.json();

    // The API should return a listingIds array
    expect(body).toHaveProperty("listingIds");
    expect(Array.isArray(body.listingIds)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. Short commute time yields fewer results than long commute time
  // -------------------------------------------------------------------------
  test("commute filter reduces listing count compared to unfiltered", async ({
    page,
  }) => {
    // Capture the initial unfiltered listing count
    const initialCount = await getListingCount(page);
    expect(initialCount).toBeGreaterThan(0);

    // Apply an address commute filter — 30 min walk from Union Square
    await openCommuteDropdown(page);
    await addCommuteFilter(page);

    const typeSelect = page.locator("select").first();
    await typeSelect.selectOption("address");

    const addressInput = page.getByPlaceholder("Search address...");
    await addressInput.click();
    await addressInput.pressSequentially("Union Square, New York", {
      delay: 40,
    });

    const suggestion = page
      .locator("button")
      .filter({ hasText: /Union Square/i })
      .first();
    await expect(suggestion).toBeVisible({ timeout: 10_000 });
    await suggestion.click();

    // Apply the filter (default 30 min walk)
    const responsePromise = waitForCommuteResponse(page);
    await clickDone(page);
    const response = await responsePromise;
    const body = await response.json();

    expect(body).toHaveProperty("listingIds");
    expect(Array.isArray(body.listingIds)).toBe(true);

    // Wait for UI to update
    await page.waitForTimeout(1_500);
    const filteredCount = await getListingCount(page);

    // A 30-min walk from Union Square shouldn't cover ALL listings in NYC
    expect(filteredCount).toBeLessThan(initialCount);
    expect(filteredCount).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 3. Removing commute filter restores all listings
  // -------------------------------------------------------------------------
  test("removing commute filter restores full listing count", async ({
    page,
  }) => {
    const initialCount = await getListingCount(page);
    expect(initialCount).toBeGreaterThan(0);

    // Apply a subway line filter (L train) — uses precomputed isochrones, faster
    await openCommuteDropdown(page);
    await addCommuteFilter(page);

    // Default type is subway-line — click the L line button
    const lButton = page.locator("button").filter({ hasText: /^L$/ }).first();
    await expect(lButton).toBeVisible();
    await lButton.click();

    // Click Done to apply
    const responsePromise = waitForCommuteResponse(page);
    await clickDone(page);
    await responsePromise;

    // Wait for the UI to update with filtered results
    await page.waitForTimeout(1_500);
    const filteredCount = await getListingCount(page);
    expect(filteredCount).toBeLessThanOrEqual(initialCount);

    // Now reopen and click Reset to clear the commute rules
    await openCommuteDropdown(page);
    const resetBtn = page.getByRole("button", { name: /^reset$/i });
    await expect(resetBtn).toBeVisible();
    await resetBtn.click();

    // After reset, commuteMatchIds resets to null and all listings show
    await page.waitForTimeout(2_000);
    const restoredCount = await getListingCount(page);

    expect(restoredCount).toBeGreaterThanOrEqual(filteredCount);
    // Restored count should be close to initial (allow viewport variance)
    expect(restoredCount).toBeGreaterThanOrEqual(initialCount * 0.9);
  });

  // -------------------------------------------------------------------------
  // 4. Subway line filter works end-to-end
  // -------------------------------------------------------------------------
  test("subway line filter returns matching listings from DB", async ({
    page,
  }) => {
    await openCommuteDropdown(page);
    await addCommuteFilter(page);

    // Default type is subway-line — select the 1 train
    const line1Button = page
      .locator("button")
      .filter({ hasText: /^1$/ })
      .first();
    await expect(line1Button).toBeVisible();
    await line1Button.click();

    // Click Done to apply and trigger the API
    const responsePromise = waitForCommuteResponse(page);
    await clickDone(page);
    const response = await responsePromise;
    const body = await response.json();

    // The 1 train runs through Manhattan — should have results
    expect(body).toHaveProperty("listingIds");
    expect(Array.isArray(body.listingIds)).toBe(true);
    expect(body.listingIds.length).toBeGreaterThan(0);

    // The UI should reflect the filtered count
    await page.waitForTimeout(1_000);
    const filteredCount = await getListingCount(page);
    expect(filteredCount).toBeGreaterThan(0);
  });
});
