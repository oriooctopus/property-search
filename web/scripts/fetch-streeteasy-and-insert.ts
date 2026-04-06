/**
 * Fetch StreetEasy listings for Manhattan and Brooklyn, insert without clearing existing data.
 * Usage: npx tsx scripts/fetch-streeteasy-and-insert.ts
 */

import { fetchStreetEasyListings } from "../lib/sources/streeteasy";
import { validateAndNormalize } from "../lib/sources/pipeline";
import { assignSearchTag } from "../lib/tag-constants";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envContent = readFileSync(resolve(__dirname, "..", ".env.local"), "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  if (!process.env[trimmed.slice(0, eq)]) process.env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Count existing listings BEFORE
  console.log("\n=== BEFORE INSERTION ===");
  const { count: beforeCraigslist } = await supabase
    .from("listings")
    .select("*", { count: "exact", head: true })
    .eq("source", "craigslist");
  const { count: beforeFacebook } = await supabase
    .from("listings")
    .select("*", { count: "exact", head: true })
    .eq("source", "facebook");
  const { count: beforeStreeteasy } = await supabase
    .from("listings")
    .select("*", { count: "exact", head: true })
    .eq("source", "streeteasy");
  const { count: beforeTotal } = await supabase
    .from("listings")
    .select("*", { count: "exact", head: true });

  console.log(`Craigslist: ${beforeCraigslist}`);
  console.log(`Facebook: ${beforeFacebook}`);
  console.log(`StreetEasy: ${beforeStreeteasy}`);
  console.log(`Total: ${beforeTotal}`);

  // Fetch StreetEasy for both areas
  console.log("\n=== FETCHING STREETEASY ===");

  const areas = ["Manhattan", "Brooklyn"];
  let allRawListings = [];

  for (const area of areas) {
    console.log(`\nFetching ${area}...`);
    const { listings: raw } = await fetchStreetEasyListings({ city: area, stateCode: "NY" });
    console.log(`Raw from ${area}: ${raw.length}`);
    allRawListings = allRawListings.concat(raw);
  }

  console.log(`\nTotal raw from SE: ${allRawListings.length}`);

  // Validate
  const { listings: validated } = validateAndNormalize(allRawListings, "fetch-streeteasy");
  console.log(`Validated: ${validated.length}`);

  // Tag
  const tagged = validated.filter((l) => {
    const tag = assignSearchTag(l.lat, l.lon, l.area);
    if (tag) { l.search_tag = tag; return true; }
    return false;
  });
  console.log(`Tagged: ${tagged.length}`);

  // Insert (using upsert to avoid duplicates if re-run)
  console.log(`\n=== INSERTING INTO DATABASE ===`);
  const BATCH = 50;
  let upserted = 0;
  for (let i = 0; i < tagged.length; i += BATCH) {
    const batch = tagged.slice(i, i + BATCH).map((l) => ({
      address: l.address,
      area: l.area,
      price: l.price,
      beds: l.beds,
      baths: l.baths,
      sqft: l.sqft,
      lat: l.lat,
      lon: l.lon,
      photos: l.photo_urls.length,
      photo_urls: l.photo_urls,
      url: l.url,
      search_tag: l.search_tag,
      list_date: l.list_date,
      last_update_date: l.last_update_date,
      availability_date: l.availability_date,
      source: l.source,
      sources: l.sources ?? [l.source],
      source_urls: l.source_urls ?? { [l.source]: l.url },
    }));
    const { error } = await supabase
      .from("listings")
      .upsert(batch, { onConflict: "url", ignoreDuplicates: false });
    if (error) console.error(`Batch ${i} error:`, error.message);
    else upserted += batch.length;
    process.stdout.write(".");
  }
  console.log();
  console.log(`Upserted: ${upserted}`);

  // Count after insertion
  console.log("\n=== AFTER INSERTION (before dedup) ===");
  const { count: afterCraigslist } = await supabase
    .from("listings")
    .select("*", { count: "exact", head: true })
    .eq("source", "craigslist");
  const { count: afterFacebook } = await supabase
    .from("listings")
    .select("*", { count: "exact", head: true })
    .eq("source", "facebook");
  const { count: afterStreeteasy } = await supabase
    .from("listings")
    .select("*", { count: "exact", head: true })
    .eq("source", "streeteasy");
  const { count: afterTotal } = await supabase
    .from("listings")
    .select("*", { count: "exact", head: true });

  const crDiff = (afterCraigslist || 0) - (beforeCraigslist || 0);
  const fbDiff = (afterFacebook || 0) - (beforeFacebook || 0);
  const seDiff = (afterStreeteasy || 0) - (beforeStreeteasy || 0);
  const totalDiff = (afterTotal || 0) - (beforeTotal || 0);

  console.log(`Craigslist: ${afterCraigslist} (${crDiff > 0 ? '+' : ''}${crDiff})`);
  console.log(`Facebook: ${afterFacebook} (${fbDiff > 0 ? '+' : ''}${fbDiff})`);
  console.log(`StreetEasy: ${afterStreeteasy} (${seDiff > 0 ? '+' : ''}${seDiff})`);
  console.log(`Total: ${afterTotal} (${totalDiff > 0 ? '+' : ''}${totalDiff})`);

  console.log("\n=== DONE ===");
  console.log("Run 'npm run refresh' to deduplicate across sources.");
}

main().catch((err) => { console.error(err); process.exit(1); });
