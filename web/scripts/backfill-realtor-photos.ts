/**
 * Backfill photo_urls for Realtor.com listings.
 * Re-fetches from the Realtor API and outputs URL→photo_urls mapping.
 *
 * Usage: npx tsx scripts/backfill-realtor-photos.ts
 */

import { fetchRealtorListings } from "../lib/sources/realtor";
import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, "..", ".env.local");
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

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY!;

async function main() {
  const allListings: Array<{ url: string; photo_urls: string[] }> = [];

  for (const search of [
    { city: "Brooklyn", stateCode: "NY" },
    { city: "New York", stateCode: "NY" },
  ]) {
    console.error(`Fetching Realtor.com for ${search.city}, ${search.stateCode}...`);
    const result = await fetchRealtorListings(
      {
        city: search.city,
        stateCode: search.stateCode,
        bedsMin: 5,
        bathsMin: 2,
        priceMin: 4000,
        priceMax: 100000,
      },
      RAPIDAPI_KEY,
    );
    console.error(`  Got ${result.listings.length} listings`);
    const withPhotos = result.listings.filter((l) => l.photo_urls.length > 0);
    console.error(`  ${withPhotos.length} have photo_urls`);

    for (const l of result.listings) {
      if (l.photo_urls.length > 0) {
        allListings.push({ url: l.url, photo_urls: l.photo_urls });
      }
    }

    // Rate limit delay
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.error(`\nTotal listings with photos: ${allListings.length}`);
  console.log(JSON.stringify(allListings, null, 2));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
