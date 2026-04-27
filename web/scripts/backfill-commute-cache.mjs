#!/usr/bin/env node
/**
 * Backfill script for the commute_cache table.
 *
 * For each NYC listing, fetches the transit commute time to a small set of
 * "hot" destinations (Times Square, Wall Street) via the /api/trip-plan
 * endpoint and lets the API populate the cache as a side-effect.
 *
 * Manual invocation only — do NOT wire into a cron without rate-limit
 * sanity checks. Google Directions is billed per request.
 *
 * Usage (from /web):
 *   BASE_URL=http://localhost:8000 node scripts/backfill-commute-cache.mjs
 *   BASE_URL=https://dwelligence.vercel.app node scripts/backfill-commute-cache.mjs
 *
 * Env:
 *   BASE_URL              — defaults to http://localhost:8000
 *   NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — required for listing fetch
 *   QPS                    — max requests per second (default 20; Google's
 *                            soft cap is 50 for the Directions API)
 *   LIMIT                  — only process the first N listings (default: all)
 */

import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8000";
const QPS = Math.max(1, Number(process.env.QPS ?? 20));
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : null;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars",
  );
  process.exit(1);
}

const HOT_DESTINATIONS = [
  { name: "Times Square", lat: 40.758, lon: -73.9855 },
  { name: "Wall Street", lat: 40.7074, lon: -74.0113 },
];

const MODE = "transit"; // walking/bicycling are cheap; transit is the bulk.

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fetchListings() {
  let query = supabase
    .from("listings")
    .select("id, lat, lon")
    .not("lat", "is", null)
    .not("lon", "is", null)
    .order("id");
  if (LIMIT) query = query.limit(LIMIT);
  const { data, error } = await query;
  if (error) throw new Error(`listings fetch failed: ${error.message}`);
  return data ?? [];
}

async function callTripPlan(listing, dest) {
  const params = new URLSearchParams({
    fromLat: String(listing.lat),
    fromLon: String(listing.lon),
    toLat: String(dest.lat),
    toLon: String(dest.lon),
    mode: MODE,
    summary: "1",
    listingId: String(listing.id),
  });
  const url = `${BASE_URL}/api/trip-plan?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    return { ok: false, status: res.status };
  }
  const data = await res.json();
  return { ok: true, minutes: data.totalDuration, source: res.headers.get("x-commute-source") };
}

async function main() {
  console.log(
    `Backfill starting | base=${BASE_URL} | qps=${QPS} | limit=${LIMIT ?? "all"}`,
  );
  const listings = await fetchListings();
  const total = listings.length * HOT_DESTINATIONS.length;
  console.log(
    `${listings.length} listings × ${HOT_DESTINATIONS.length} destinations = ${total} requests`,
  );

  const minIntervalMs = Math.ceil(1000 / QPS);
  let done = 0;
  let cached = 0;
  let google = 0;
  let failed = 0;

  for (const listing of listings) {
    for (const dest of HOT_DESTINATIONS) {
      const t0 = Date.now();
      try {
        const r = await callTripPlan(listing, dest);
        if (!r.ok) {
          failed++;
        } else {
          if (r.source === "cache") cached++;
          else google++;
        }
      } catch (err) {
        failed++;
        console.error(
          `req ${listing.id}→${dest.name} error: ${err?.message ?? err}`,
        );
      }
      done++;
      if (done % 50 === 0) {
        console.log(
          `  ${done}/${total}  cache=${cached} google=${google} failed=${failed}`,
        );
      }
      const elapsed = Date.now() - t0;
      const wait = minIntervalMs - elapsed;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  }

  console.log(
    `Done. ${done}/${total}  cache=${cached} google=${google} failed=${failed}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
