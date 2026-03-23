import { test, expect } from "@playwright/test";
import { login } from "./auth.helper";

test.describe("Profile", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("profile page loads after login", async ({ page }) => {
    await page.goto("/profile");

    // Wait for loading state to finish
    await page
      .getByText("Loading...")
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => {});

    await expect(
      page.getByRole("heading", { name: "Your Profile" }),
    ).toBeVisible();
  });

  test("shows display name, bio, and phone fields", async ({ page }) => {
    await page.goto("/profile");
    await page
      .getByText("Loading...")
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => {});

    await expect(page.locator("#displayName")).toBeVisible();
    await expect(page.locator("#bio")).toBeVisible();
    await expect(page.locator("#phone")).toBeVisible();
  });

  test("avatar upload area is visible", async ({ page }) => {
    await page.goto("/profile");
    await page
      .getByText("Loading...")
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => {});

    // The avatar area has "Click to upload avatar" text
    await expect(page.getByText("Click to upload avatar")).toBeVisible();
  });

  test("can update display name and save", async ({ page }) => {
    await page.goto("/profile");
    await page
      .getByText("Loading...")
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => {});

    const nameInput = page.locator("#displayName");
    const testName = `Test User ${Date.now()}`;

    await nameInput.clear();
    await nameInput.fill(testName);

    await page.getByRole("button", { name: "Save Profile" }).click();

    // Wait for the success toast
    await expect(
      page.getByText("Profile saved successfully."),
    ).toBeVisible({ timeout: 10_000 });
  });
});
