#!/usr/bin/env node
/**
 * Verify Google Directions migration for the trip-plan API + commute_cache.
 *
 * - Hits /api/trip-plan with a few fixtures and asserts:
 *   1. summary path returns 200 with totalDuration
 *   2. cache hit on second call (X-Commute-Source: cache)
 *   3. value is within 1 min of Google Directions direct call
 * - Opens a listing detail page in headless Playwright and screenshots
 *   the commute itinerary.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8001";
const SCREENSHOT_DIR =
  process.env.SCREENSHOT_DIR ??
  `${process.env.HOME}/Documents/coding/screenshots/property-search/google-transit-v1`;

if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });

// Times Square destination
const DEST_LAT = 40.758;
const DEST_LON = -73.9855;

function readEnvLocal() {
  try {
    const txt = readFileSync(
      "/Users/oliverullman/Documents/coding/property-search/web/.env.local",
      "utf8",
    );
    const env = {};
    for (const line of txt.split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) env[m[1]] = m[2];
    }
    return env;
  } catch {
    return {};
  }
}

const env = readEnvLocal();

const findings = [];
function record(name, ok, detail) {
  findings.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
}

async function getListings() {
  const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/listings?select=id,lat,lon,address&lat=not.is.null&order=id&limit=3`;
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`listings fetch failed: ${res.status}`);
  return res.json();
}

async function callTripPlan({ listing, mode = "transit", summary = true }) {
  const params = new URLSearchParams({
    fromLat: String(listing.lat),
    fromLon: String(listing.lon),
    toLat: String(DEST_LAT),
    toLon: String(DEST_LON),
    mode,
    listingId: String(listing.id),
  });
  if (summary) params.set("summary", "1");
  const res = await fetch(`${BASE_URL}/api/trip-plan?${params}`);
  return {
    status: res.status,
    source: res.headers.get("x-commute-source"),
    body: res.ok ? await res.json() : null,
  };
}

async function callGoogleDirect(listing) {
  const params = new URLSearchParams({
    origin: `${listing.lat},${listing.lon}`,
    destination: `${DEST_LAT},${DEST_LON}`,
    mode: "transit",
    departure_time: "now",
    key: env.GOOGLE_API_KEY,
  });
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/directions/json?${params}`,
  );
  const data = await res.json();
  if (data.status !== "OK") return null;
  return Math.round(data.routes[0].legs[0].duration.value / 60);
}

async function checkCommuteCacheRow(listingId) {
  const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/commute_cache?listing_id=eq.${listingId}&select=*`;
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  return res.ok ? await res.json() : null;
}

async function main() {
  console.log(`BASE=${BASE_URL}  SCREENSHOTS=${SCREENSHOT_DIR}`);

  const listings = await getListings();
  if (listings.length < 3) throw new Error("need >= 3 listings");
  console.log(`got ${listings.length} listings: ${listings.map((l) => l.id).join(", ")}`);

  // Test 1: first call -> google
  const r1 = await callTripPlan({ listing: listings[0] });
  record(
    "first call returns 200 + totalDuration",
    r1.status === 200 && typeof r1.body?.totalDuration === "number",
    `status=${r1.status} mins=${r1.body?.totalDuration} src=${r1.source}`,
  );

  // Test 2: second call -> cache
  await new Promise((r) => setTimeout(r, 500));
  const r2 = await callTripPlan({ listing: listings[0] });
  record(
    "second call hits cache",
    r2.status === 200 && r2.source === "cache",
    `status=${r2.status} src=${r2.source} mins=${r2.body?.totalDuration}`,
  );

  // Test 3: value within 1 min of direct Google
  const direct = await callGoogleDirect(listings[0]);
  const apiMins = r1.body?.totalDuration;
  const delta = Math.abs((direct ?? 0) - (apiMins ?? 0));
  record(
    "API value matches direct Google (±1 min)",
    direct != null && delta <= 1,
    `direct=${direct} api=${apiMins} delta=${delta}`,
  );

  // Test 4: third listing populates cache
  const r3 = await callTripPlan({ listing: listings[2] });
  await new Promise((r) => setTimeout(r, 500));
  const row = await checkCommuteCacheRow(listings[2].id);
  record(
    "third listing creates commute_cache row",
    Array.isArray(row) && row.length > 0,
    `rows=${row?.length ?? "(query failed)"}`,
  );

  // Playwright
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`  [browser err] ${m.text()}`);
  });

  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle", timeout: 30000 });
  await page.screenshot({ path: join(SCREENSHOT_DIR, "screenshot-1-home.png"), fullPage: false });
  console.log("captured home");

  // Click first listing card
  try {
    const card = await page.locator('[data-listing-id]').first();
    if (await card.isVisible({ timeout: 5000 })) {
      await card.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(SCREENSHOT_DIR, "screenshot-2-listing-detail.png"), fullPage: false });
      console.log("captured listing detail");
    } else {
      console.log("no listing card found — will skip UI screenshots");
    }
  } catch (err) {
    console.log(`UI capture skipped: ${err.message}`);
  }

  await browser.close();

  // Write HTML report
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Google Transit Verify</title>
<style>
  body { font: 14px/1.5 -apple-system, Helvetica, sans-serif; max-width: 900px; margin: 24px auto; color: #1c2028; padding: 0 16px; }
  h1 { margin-bottom: 4px; }
  .meta { color: #6a737d; margin-bottom: 24px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 24px; }
  th, td { border: 1px solid #d1d5da; padding: 8px 12px; text-align: left; }
  th { background: #f6f8fa; }
  .pass { color: #108a17; font-weight: 600; }
  .fail { color: #d73a49; font-weight: 600; }
  img { max-width: 100%; border: 1px solid #d1d5da; margin-bottom: 16px; }
  h2 { margin-top: 32px; }
</style></head>
<body>
<h1>Google Transit Migration — Verify Report</h1>
<div class="meta">${new Date().toISOString()} · base=${BASE_URL}</div>
<table>
  <tr><th>Check</th><th>Result</th><th>Detail</th></tr>
  ${findings
    .map(
      (f) =>
        `<tr><td>${f.name}</td><td class="${f.ok ? "pass" : "fail"}">${f.ok ? "PASS" : "FAIL"}</td><td><code>${f.detail}</code></td></tr>`,
    )
    .join("")}
</table>
<h2>Screenshots</h2>
<img src="screenshot-1-home.png" alt="home">
<img src="screenshot-2-listing-detail.png" alt="listing detail">
</body></html>`;
  writeFileSync(join(SCREENSHOT_DIR, "report.html"), html);
  console.log(`\nReport: ${join(SCREENSHOT_DIR, "report.html")}`);

  const failed = findings.filter((f) => !f.ok);
  if (failed.length > 0) {
    console.log(`\n${failed.length} FAILED`);
    process.exit(1);
  }
  console.log(`\nALL PASS (${findings.length}/${findings.length})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
