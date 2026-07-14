/**
 * E2E proof of the saved-search location round-trip through the REAL UI.
 *
 * Past regressions in this area were "fixed" and "verified" by seeding a
 * saved search directly via the API (bypassing the app's own capture code),
 * which meant the tests could never catch a bug in the capture path itself.
 * This test instead:
 *   1. Logs in through the UI.
 *   2. Pans the live Leaflet map to a distinctive spot.
 *   3. Saves the current search THROUGH THE APP'S OWN SAVE FLOW (clicking
 *      through Filters -> Saved -> "Save current search as...").
 *   4. Stars it as default via an in-page authenticated PATCH (the star
 *      button itself is exercised elsewhere; this test's focus is the
 *      capture + restore of the location).
 *   5. Opens a brand-new browser context (no shared storage) and asserts
 *      the map lands back at the same place on fresh load.
 *
 * Run:
 *   npx playwright test tests/saved-location-roundtrip.spec.ts --config=playwright.roundtrip.config.ts
 */

import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Load .env.local (same pattern as tests/ingest.integration.test.ts)
// ---------------------------------------------------------------------------
function loadDotEnvLocal() {
  const envPath = resolve(__dirname, "..", ".env.local");
  try {
    const envContent = readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx);
      const val = trimmed.slice(eqIdx + 1);
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // optional
  }
}
loadDotEnvLocal();

const TEST_EMAIL = process.env.TEST_USER_EMAIL;
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD;

if (!TEST_EMAIL || !TEST_PASSWORD) {
  throw new Error(
    "TEST_USER_EMAIL / TEST_USER_PASSWORD must be set in web/.env.local. " +
      "NEVER use the real oliverullman@gmail.com account for this test.",
  );
}
if (TEST_EMAIL.includes("oliverullman")) {
  throw new Error("Refusing to run: TEST_USER_EMAIL resolves to the real personal account.");
}

const SAVE_NAME = "E2E-ROUNDTRIP";
const TARGET_LAT = 40.681;
const TARGET_LNG = -73.983;
const TARGET_ZOOM = 14;
const MAX_DRIFT_METERS = 60;

async function loginViaUi(page: Page) {
  await page.goto("/auth/login");
  await page.locator("#email").fill(TEST_EMAIL!);
  await page.locator("#password").fill(TEST_PASSWORD!);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL("/", { timeout: 15_000 });
  await page
    .getByText("Loading listings...")
    .waitFor({ state: "hidden", timeout: 15_000 })
    .catch(() => {});
}

/** Poll for window.__visibleLeafletMap to exist (Leaflet init is async). */
async function waitForVisibleMap(page: Page) {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __visibleLeafletMap?: { getCenter?: unknown } };
      return !!w.__visibleLeafletMap && typeof w.__visibleLeafletMap.getCenter === "function";
    },
    { timeout: 20_000 },
  );
}

/**
 * The user-meaning invariant is "center of what I see", not the raw Leaflet
 * container center — the swipe-card / action-pill occluders cover part of
 * the map, and save vs restore can legitimately differ in which occluders
 * are on screen (browsing in list/map view vs restoring into swipe view).
 * `dlog('viewport-query', ...)` already records the occluder-adjusted
 * visible bounds (see HomeClient's loadForViewport -> dlog call) on every
 * viewport load, buffered on `window.__dwellLog`. Reading its midpoint at
 * each end gives an oracle that's meaningful regardless of which view is
 * active, unlike comparing raw `map.getCenter()` before/after.
 */
async function readLatestVisibleCenter(page: Page): Promise<{ lat: number; lng: number; zoom: number }> {
  return page.evaluate(() => {
    type DwellLogEntry = {
      event: string;
      bounds?: { latMin: number; latMax: number; lonMin: number; lonMax: number };
    };
    const w = window as unknown as {
      __dwellLog?: DwellLogEntry[];
      __visibleLeafletMap?: { getZoom: () => number };
    };
    const log = w.__dwellLog ?? [];
    const entry = [...log].reverse().find((e) => e.event === "viewport-query" && e.bounds);
    if (!entry?.bounds) {
      throw new Error("No viewport-query entry found in window.__dwellLog");
    }
    const { latMin, latMax, lonMin, lonMax } = entry.bounds;
    return {
      lat: (latMin + latMax) / 2,
      lng: (lonMin + lonMax) / 2,
      zoom: w.__visibleLeafletMap!.getZoom(),
    };
  });
}

/** Haversine distance in meters between two lat/lng points. */
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------------------------------------------------------------------------
// In-page authenticated fetch helpers against /api/saved-searches (cookie
// auth — the browser context is already logged in, so these ride the same
// session cookies a real client-side fetch() would use).
// ---------------------------------------------------------------------------

type SavedSearchRow = {
  id: number;
  name: string;
  filters: { mapPosition?: { lat: number; lng: number; zoom: number } };
  is_default: boolean;
};

async function listSavedSearches(page: Page): Promise<SavedSearchRow[]> {
  return page.evaluate(async () => {
    const res = await fetch("/api/saved-searches");
    const json = await res.json();
    return json.savedSearches ?? [];
  });
}

async function patchSavedSearch(page: Page, id: number, body: Record<string, unknown>) {
  await page.evaluate(
    async ({ id, body }) => {
      await fetch(`/api/saved-searches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    { id, body },
  );
}

async function deleteSavedSearch(page: Page, id: number) {
  await page.evaluate(async (id) => {
    await fetch(`/api/saved-searches/${id}`, { method: "DELETE" });
  }, id);
}

test.describe("Saved search location round-trip (real UI)", () => {
  let context: BrowserContext;
  let page: Page;
  let savedSearchId: number | null = null;
  let priorDefaultId: number | null = null;

  test.afterEach(async () => {
    // Cleanup must happen even on assertion failure.
    if (page && savedSearchId != null) {
      try {
        await patchSavedSearch(page, savedSearchId, { is_default: false });
      } catch {
        /* best-effort */
      }
      try {
        await deleteSavedSearch(page, savedSearchId);
      } catch {
        /* best-effort */
      }
      if (priorDefaultId != null) {
        try {
          await patchSavedSearch(page, priorDefaultId, { is_default: true });
        } catch {
          /* best-effort */
        }
      }
    }
    await context?.close();
  });

  test("save via UI, fresh load restores the same map location", async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();

    // 1. Log in through the real UI.
    await loginViaUi(page);
    await page.waitForTimeout(4_000);
    await waitForVisibleMap(page);

    // Record whatever was default before, so we can restore it in cleanup.
    const before = await listSavedSearches(page);
    priorDefaultId = before.find((s) => s.is_default)?.id ?? null;

    // 2. Pan the visible map to a distinctive, deterministic spot.
    await page.evaluate(
      ({ lat, lng, zoom }) => {
        const w = window as unknown as { __visibleLeafletMap?: { setView: (c: [number, number], z: number) => void } };
        w.__visibleLeafletMap!.setView([lat, lng], zoom);
      },
      { lat: TARGET_LAT, lng: TARGET_LNG, zoom: TARGET_ZOOM },
    );
    await page.waitForTimeout(2_000);

    // M0: the visible-band center that was actually driving results at
    // save-click time (occluder-adjusted, via __dwellLog's viewport-query
    // bounds) — NOT raw map.getCenter(), which doesn't account for whatever
    // occluders are on screen in the current view.
    const c0 = await readLatestVisibleCenter(page);

    // The default mobile view is "swipe", where the sidebar Filters bar
    // (and its "Saved" cluster button) is hidden via CSS
    // (body[data-swipe-mobile="1"] [data-swipe-sidebar="1"] { display: none })
    // — the app's own escape hatch back to it is the "List view" icon in the
    // swipe action pill. Use that (a real in-app control) to reach the
    // sidebar, exactly as a mobile user would.
    await page.getByLabel("List view").click();
    await page.waitForTimeout(500);

    // 3. Save current search THROUGH THE UI.
    // Open the mobile filters sheet and set one real filter (listing-age
    // slider) so the "Save current search as..." action isn't disabled
    // (it requires activeCount > 0; mapPosition alone doesn't count).
    // In list view (unlike swipe view) the MobileMenuPill is unmounted, so
    // the mobile "Filters" pill inside the sidebar's own Row 1 is the entry
    // point (no testid on that button, only visible text).
    await page.locator('button', { hasText: "Filters" }).first().click();
    const sheet = page.locator('[data-testid="mobile-filters-sheet"]');
    await sheet.waitFor({ state: "visible" });

    await sheet.locator('[data-testid="filter-chip-listingAge"]').click();
    const rangeInput = page.locator('input[type="range"]').first();
    await rangeInput.waitFor({ state: "visible" });
    await rangeInput.focus();
    await rangeInput.press("ArrowRight");
    await rangeInput.press("ArrowRight");
    await page.getByRole("button", { name: "Done" }).click();

    // Close the mobile sheet so the "Saved" cluster button (rendered once,
    // outside the sheet) is clickable.
    await sheet.getByLabel("Close").click();
    await sheet.waitFor({ state: "hidden" });

    await page.getByLabel("Saved (filter by wishlist or save current search)").click();
    const savePanel = page.locator('[data-save-wishlist-panel]');
    await savePanel.getByRole("button", { name: "Save current search as…" }).click();
    // The expanded sticky-footer input has no id/testid — it's the only
    // text input rendered inside the save panel at this point.
    const saveInput = savePanel.locator('input[type="text"]');
    await saveInput.waitFor({ state: "visible" });
    await saveInput.fill(SAVE_NAME);
    await saveInput.press("Enter");

    // 4. Confirm via authenticated in-page fetch that it was actually saved
    // with the captured map position, then star it as default.
    await expect
      .poll(async () => {
        const rows = await listSavedSearches(page);
        return rows.find((s) => s.name === SAVE_NAME) ?? null;
      }, { timeout: 10_000 })
      .not.toBeNull();

    const rows = await listSavedSearches(page);
    const created = rows.find((s) => s.name === SAVE_NAME)!;
    savedSearchId = created.id;

    expect(created.filters.mapPosition).toBeTruthy();
    console.log("Saved filters.mapPosition:", created.filters.mapPosition);

    await patchSavedSearch(page, created.id, { is_default: true });

    // 5. Fresh context, no shared storage — reuse the same login (a second
    // real UI login, not storageState-copying) so the restore path is
    // exercised exactly as a returning user would hit it.
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    try {
      await loginViaUi(page2);
      await page2.waitForTimeout(8_000);
      await waitForVisibleMap(page2);

      // M1: the visible-band center after fresh-context restore + settle,
      // same occluder-adjusted oracle as M0.
      const c1 = await readLatestVisibleCenter(page2);
      const driftMeters = haversineMeters(c0, c1);

      console.log("C0 (post-save, pre-reload):", c0);
      console.log("C1 (fresh load, post-restore):", c1);
      console.log("Drift (meters):", driftMeters);

      expect(c1.zoom).toBe(c0.zoom);
      expect(driftMeters).toBeLessThan(MAX_DRIFT_METERS);
    } finally {
      // Use page (not page2) for cleanup fetches — page2's session is
      // equally authenticated, but page is already wired into afterEach.
      await context2.close();
    }
  });
});
