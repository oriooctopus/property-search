/**
 * Quick test: fetch FB Marketplace rentals in NYC via Apify adapter.
 */
import { fetchFacebookMarketplaceListings } from "../lib/sources/facebook-marketplace";

async function main() {
  console.log("Fetching Facebook Marketplace listings via Apify...");

  const result = await fetchFacebookMarketplaceListings({
    city: "New York",
    stateCode: "NY",
    bedsMin: 5,
    priceMin: 4000,
    priceMax: 100000,
  });

  console.log(`\nFound ${result.listings.length} listings`);

  for (const listing of result.listings) {
    console.log(`\n  ${listing.address}`);
    console.log(`  Price: $${listing.price} | Beds: ${listing.beds} | Baths: ${listing.baths}`);
    console.log(`  Area: ${listing.area}`);
    console.log(`  Photos: ${listing.photo_urls.length}`);
    console.log(`  URL: ${listing.url}`);
  }

  // Output full JSON for DB insertion
  if (result.listings.length > 0) {
    console.log("\n\n--- LISTINGS_JSON_START ---");
    console.log(JSON.stringify(result.listings));
    console.log("--- LISTINGS_JSON_END ---");
  }
}

main().catch(console.error);
