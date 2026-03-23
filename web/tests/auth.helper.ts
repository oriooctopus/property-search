import { type Page } from "@playwright/test";

const TEST_EMAIL = "oliverullman@gmail.com";
const TEST_PASSWORD = "better4You@88";

/**
 * Log in via the login page UI. Waits for the home page to finish loading
 * after a successful login so subsequent tests start from a ready state.
 */
export async function login(page: Page) {
  await page.goto("/auth/login");
  await page.locator("#email").fill(TEST_EMAIL);
  await page.locator("#password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();

  // Wait until we land on the home page and listings finish loading
  await page.waitForURL("/", { timeout: 15_000 });
  await waitForListingsLoaded(page);
}

/**
 * Wait for the home page loading state to finish. The app shows
 * "Loading listings..." while fetching from Supabase.
 */
export async function waitForListingsLoaded(page: Page) {
  // Wait for the loading text to disappear (it may already be gone)
  await page
    .getByText("Loading listings...")
    .waitFor({ state: "hidden", timeout: 15_000 })
    .catch(() => {
      // Already loaded — nothing to wait for
    });
}
