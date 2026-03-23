import { test, expect } from "@playwright/test";
import { login } from "./auth.helper";

test.describe("Auth", () => {
  test("login page loads with email and password fields", async ({ page }) => {
    await page.goto("/auth/login");

    await expect(
      page.getByRole("heading", { name: "Log in" }),
    ).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Log in" }),
    ).toBeVisible();
  });

  test("signup page loads with email and password fields", async ({
    page,
  }) => {
    await page.goto("/auth/signup");

    await expect(
      page.getByRole("heading", { name: "Sign up" }),
    ).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign up" }),
    ).toBeVisible();
  });

  test("can log in with valid credentials", async ({ page }) => {
    await login(page);

    // After login the navbar should show authenticated links
    await expect(page.locator("nav").getByText("Log out")).toBeVisible();
  });

  test("after login, navbar shows authenticated links", async ({ page }) => {
    await login(page);

    const nav = page.locator("nav");
    await expect(nav.getByText("Profile")).toBeVisible();
    await expect(nav.getByText("Favorites")).toBeVisible();
    await expect(nav.getByText("Search")).toBeVisible();
    await expect(nav.getByText("Log out")).toBeVisible();
  });

  test("can log out and navbar returns to unauthenticated state", async ({
    page,
  }) => {
    await login(page);

    // Click log out
    await page.locator("nav").getByText("Log out").click();

    // Should see the unauthenticated navbar links
    await expect(
      page.locator("nav").getByText("Log in"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("nav").getByText("Sign up")).toBeVisible();
  });
});
