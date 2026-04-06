/**
 * One-off: populate all SE Manhattan listings (full fetch, no incremental stop).
 * Usage: npx tsx scripts/populate-se-manhattan.ts
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
  console.log("Fetching SE Manhattan (all pages, no early stop)...");
  const { listings: raw } = await fetchStreetEasyListings({ city: "Manhattan", stateCode: "NY" });
  console.log(`Raw: ${raw.length}`);

  const { listings: validated } = validateAndNormalize(raw, "se-manhattan");
  console.log(`Validated: ${validated.length}`);

  const tagged = validated.filter((l) => {
    const tag = assignSearchTag(l.lat, l.lon, l.area);
    if (tag) { l.search_tag = tag; return true; }
    return false;
  });
  console.log(`Tagged: ${tagged.length}`);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

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

  const { count } = await supabase
    .from("listings")
    .select("*", { count: "exact", head: true })
    .eq("source", "streeteasy")
    .eq("search_tag", "manhattan");
  console.log(`SE Manhattan in DB now: ${count}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
