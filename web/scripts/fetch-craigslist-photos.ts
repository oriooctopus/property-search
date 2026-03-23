/**
 * Fetch fresh Craigslist listings (with photos) and output URL→photos mapping to stdout.
 * Used to backfill photo_urls on existing Craigslist listings in the DB.
 *
 * Usage: npx tsx scripts/fetch-craigslist-photos.ts
 */

import { fetchCraigslistListings } from "../lib/sources/craigslist";

async function main() {
  console.error("Fetching Craigslist listings with photos...");
  const result = await fetchCraigslistListings({
    city: "New York",
    stateCode: "NY",
    bedsMin: 5,
    priceMin: 4000,
    priceMax: 100000,
  });

  console.error(`Got ${result.listings.length} listings`);
  const withPhotos = result.listings.filter((l) => l.photo_urls.length > 0);
  console.error(`${withPhotos.length} have photos`);

  // Output just the URL + photo_urls pairs
  console.log(
    JSON.stringify(
      result.listings.map((l) => ({
        url: l.url,
        photos: l.photos,
        photo_urls: l.photo_urls,
      })),
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
