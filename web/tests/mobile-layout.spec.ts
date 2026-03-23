import { test } from "@playwright/test";

test("mobile layout screenshot at 375px", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("/", { waitUntil: "networkidle" });
  // Wait for content to render
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: "tests/screenshots/mobile-layout-375.png",
    fullPage: false,
  });
  await context.close();
});
