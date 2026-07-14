import { defineConfig, devices } from "@playwright/test";

/**
 * Standalone config for tests/saved-location-roundtrip.spec.ts.
 *
 * The main playwright.config.ts points baseURL at :5001 and boots its own
 * dev server there. This test instead targets the already-running dev
 * server on :8001 (this project's pinned port — see ~/.claude/rules/ports.md)
 * and uses full absolute URLs in the test itself, so no webServer block is
 * needed here — booting one would conflict with the pinned-port rule.
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: "saved-location-roundtrip.spec.ts",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: "http://localhost:8001",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    actionTimeout: 10_000,
    ...devices["iPhone 13"],
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
