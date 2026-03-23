import { test, expect } from "@playwright/test";
import { login, waitForListingsLoaded } from "./auth.helper";

test.describe("Favorites", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("favorites page loads", async ({ page }) => {
    await page.goto("/favorites");

    // Wait for loading to finish
    await page
      .getByText("Loading favorites...")
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => {});

    // Should see either "Your Favorites" heading or the empty state
    const hasFavorites = await page
      .getByRole("heading", { name: "Your Favorites" })
      .isVisible()
      .catch(() => false);
    const hasEmptyState = await page
      .getByText("No favorites yet")
      .isVisible()
      .catch(() => false);

    expect(hasFavorites || hasEmptyState).toBe(true);
  });

  test("shows empty state when no favorites", async ({ page }) => {
    // First, remove all existing favorites by navigating to favorites page
    await page.goto("/favorites");
    await page
      .getByText("Loading favorites...")
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => {});

    // Remove any existing favorites
    const removeButtons = page.getByRole("button", { name: "Remove" });
    const count = await removeButtons.count();
    for (let i = 0; i < count; i++) {
      await removeButtons.first().click();
      // Wait a moment for the removal to process
      await page.waitForTimeout(500);
    }

    // After removing all, the empty state should appear
    if (count > 0) {
      await expect(page.getByText("No favorites yet")).toBeVisible({
        timeout: 5_000,
      });
    } else {
      await expect(page.getByText("No favorites yet")).toBeVisible();
    }
  });

  test("can favorite a listing from the home page", async ({ page }) => {
    await page.goto("/");
    await waitForListingsLoaded(page);

    // Click the first favorite (star) button on a listing card.
    // The favorite button has title="Favorite"
    const favoriteBtn = page.locator('button[title="Favorite"]').first();
    await favoriteBtn.click();

    // The star should turn yellow (favorited state)
    await expect(favoriteBtn).toHaveCSS("color", "rgb(251, 191, 36)", {
      timeout: 5_000,
    });
  });

  test("favorited listing appears on favorites page", async ({ page }) => {
    await page.goto("/");
    await waitForListingsLoaded(page);

    // Get the address of the first listing before favoriting
    const firstCardAddress = await page
      .locator('[class*="rounded-lg"][class*="cursor-pointer"]')
      .first()
      .locator(".font-semibold")
      .first()
      .textContent();

    // Favorite the first listing
    const favoriteBtn = page.locator('button[title="Favorite"]').first();
    const isAlreadyFavorited =
      (await favoriteBtn.evaluate(
        (el) => (el as HTMLElement).style.color,
      )) === "rgb(251, 191, 36)";

    if (!isAlreadyFavorited) {
      await favoriteBtn.click();
      await page.waitForTimeout(1000);
    }

    // Navigate to favorites page
    await page.goto("/favorites");
    await page
      .getByText("Loading favorites...")
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => {});

    // The favorited listing address should appear on the favorites page
    if (firstCardAddress) {
      await expect(page.getByText(firstCardAddress)).toBeVisible({
        timeout: 5_000,
      });
    }
  });
});
