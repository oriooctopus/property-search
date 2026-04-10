import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("Fetching listings that need isochrone enrichment...");

  // Paginate through all listings (Supabase default limit is 1000)
  const allListings: Array<{ listing_id: number; lat: number; lon: number }> = [];
  let offset = 0;
  const PAGE_SIZE = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("listings")
      .select("id, lat, lon")
      .not("lat", "is", null)
      .not("lon", "is", null)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error("Error fetching listings:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (row.lat && row.lon) {
        allListings.push({
          listing_id: row.id,
          lat: Number(row.lat),
          lon: Number(row.lon),
        });
      }
    }

    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  console.log(`Found ${allListings.length} listings with coordinates.`);

  if (allListings.length === 0) {
    console.log("Nothing to enrich.");
    return;
  }

  const BATCH_SIZE = 100;
  let enriched = 0;
  let errors = 0;

  for (let i = 0; i < allListings.length; i += BATCH_SIZE) {
    const batch = allListings.slice(i, i + BATCH_SIZE);
    const { error: enrichErr } = await supabase.rpc("batch_enrich_listing_isochrones", {
      p_listings: batch,
    });

    if (enrichErr) {
      console.error(`  Batch ${i}-${i + batch.length} error: ${enrichErr.message}`);
      errors++;
    } else {
      enriched += batch.length;
    }

    // Progress every 10 batches
    if ((Math.floor(i / BATCH_SIZE) + 1) % 10 === 0 || i + BATCH_SIZE >= allListings.length) {
      console.log(`  Progress: ${Math.min(i + BATCH_SIZE, allListings.length)}/${allListings.length} (${enriched} enriched, ${errors} batch errors)`);
    }
  }

  console.log(`\nDone! Enriched ${enriched} listings. ${errors} batch errors.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
