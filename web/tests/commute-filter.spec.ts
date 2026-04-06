import { test, expect } from "@playwright/test";
import { waitForListingsLoaded } from "./auth.helper";

test.describe("Commute filter", () => {
  test("typing an address in the commute input works (no mocking)", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForListingsLoaded(page);

    // --- 1. Expand filter chips by clicking "Filters" button -------------
    // The commute chip is in the expandable Row 2, behind the Filters toggle.
    const filtersToggle = page.getByRole("button", { name: /filters/i }).first();
    await filtersToggle.click();

    // --- 2. Open the Commute chip ----------------------------------------
    const commuteChip = page.getByRole("button", { name: /^commute/i });
    await expect(commuteChip).toBeVisible();
    await commuteChip.click();

    // --- 3. Add a commute rule -------------------------------------------
    const addRuleBtn = page.getByRole("button", { name: /add commute filter/i });
    await expect(addRuleBtn).toBeVisible();
    await addRuleBtn.click();

    // --- 4. Switch rule type to "Address" --------------------------------
    const typeSelect = page.locator("select").filter({ hasText: /subway line/i }).first();
    await typeSelect.selectOption("address");

    // --- 5. Address input should be visible and typeable -----------------
    const addressInput = page.getByPlaceholder("Search address...");
    await expect(addressInput).toBeVisible();

    await addressInput.click();
    await addressInput.pressSequentially("219 Thompson St", { delay: 30 });

    // --- 6. Screenshot proof ----------------------------------------------
    await page.screenshot({
      path: "/Users/oliverullman/Documents/coding/property-search/web/e2e-typing-proof.png",
      fullPage: false,
    });

    // --- 7. Assert the value is exactly what we typed --------------------
    await expect(addressInput).toHaveValue("219 Thompson St");
  });
});
