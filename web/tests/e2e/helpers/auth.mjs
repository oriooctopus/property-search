// Shared Playwright login helper for the dedicated test account.
// Usage:
//   import { chromium } from 'playwright';
//   import { loginAsTestUser } from './helpers/auth.mjs';
//   const page = await context.newPage();
//   await loginAsTestUser(page);
//
// Reads TEST_USER_EMAIL / TEST_USER_PASSWORD from process.env. Caller must
// load web/.env.local first (e.g. via `node --env-file=web/.env.local script.mjs`
// or by importing dotenv).
//
// Returns when the page is on a non-login URL with a session cookie. Throws on
// failure so callers don't proceed silently into a "not logged in" state.

const LOGIN_URL = 'http://localhost:8000/auth/login';
const HOME_URL = 'http://localhost:8000/';

export async function loginAsTestUser(page, { skipIfAlreadyLoggedIn = true } = {}) {
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;
  if (!email || !password) {
    throw new Error('loginAsTestUser: TEST_USER_EMAIL/TEST_USER_PASSWORD missing — load web/.env.local before calling');
  }

  if (skipIfAlreadyLoggedIn) {
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
    const alreadyIn = await page.locator('nav img').count().then((c) => c > 0).catch(() => false);
    if (alreadyIn) return;
  }

  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  // wait for hydration — controlled inputs need React to mount before fill works
  await page.waitForFunction(() => !!document.querySelector('form'));
  await page.waitForTimeout(500);

  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('button[type="submit"]').first().click();

  await page.waitForURL((u) => !u.pathname.startsWith('/auth/login'), { timeout: 15000 });
  // Give the session a moment to settle so subsequent navigations don't bounce
  await page.waitForTimeout(1500);
}
