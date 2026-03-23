/**
 * Backfill script: fetches listings from Realtor.com API and updates
 * last_update_date and availability_date for existing listings in Supabase.
 *
 * Usage: npx tsx scripts/backfill-dates.ts
 *
 * Requires RAPIDAPI_KEY and SUPABASE env vars from .env.local
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY!;
const RAPIDAPI_HOST = "realty-in-us.p.rapidapi.com";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface SearchConfig {
  city: string;
  state_code: string;
}

const SEARCHES: SearchConfig[] = [
  { city: "New York", state_code: "NY" },
  { city: "Brooklyn", state_code: "NY" },
];

/**
 * Extract a property_id from a realtor.com URL.
 * URLs look like: https://www.realtor.com/rentals/details/ADDRESS_CITY_STATE_ZIP_M12345-67890
 * The property_id is the M-number at the end.
 */
function extractPropertyId(url: string): string | null {
  const match = url.match(/(M\d+-\d+)$/);
  return match ? match[1] : null;
}

async function fetchPropertyDetail(propertyId: string) {
  try {
    const res = await fetch(
      `https://${RAPIDAPI_HOST}/properties/v3/detail?property_id=${propertyId}`,
      {
        method: "GET",
        headers: {
          "X-RapidAPI-Key": RAPIDAPI_KEY,
          "X-RapidAPI-Host": RAPIDAPI_HOST,
        },
      }
    );

    if (!res.ok) {
      console.log(`    API returned ${res.status}`);
      return null;
    }

    const text = await res.text();
    if (!text || text.trim().length === 0) {
      console.log(`    Empty response`);
      return null;
    }

    const data = JSON.parse(text);
    return data?.data?.home ?? null;
  } catch (err) {
    console.log(`    Fetch error: ${(err as Error).message}`);
    return null;
  }
}

async function fetchListings(search: SearchConfig) {
  const body = {
    limit: 200,
    offset: 0,
    city: search.city,
    state_code: search.state_code,
    status: ["for_rent"],
    sort: { direction: "desc", field: "list_date" },
    beds: { min: 4 },
    list_price: { min: 4000 },
  };

  const res = await fetch(`https://${RAPIDAPI_HOST}/properties/v3/list`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-RapidAPI-Key": RAPIDAPI_KEY,
      "X-RapidAPI-Host": RAPIDAPI_HOST,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error(
      `API error for ${search.city}: ${res.status} ${await res.text()}`
    );
    return [];
  }

  const data = await res.json();
  return data?.data?.home_search?.results ?? [];
}

async function main() {
  console.log("Starting backfill of last_update_date and availability_date...");

  // Get all existing listing URLs from DB
  const { data: existingListings, error } = await supabase
    .from("listings")
    .select("id, url");

  if (error) {
    console.error("Failed to fetch existing listings:", error);
    process.exit(1);
  }

  const urlToId = new Map<string, number>();
  for (const l of existingListings ?? []) {
    urlToId.set(l.url, l.id);
  }

  console.log(`Found ${urlToId.size} existing listings in DB`);

  let updatedCount = 0;
  const updatedIds = new Set<number>();

  for (const search of SEARCHES) {
    console.log(`\nFetching ${search.city}, ${search.state_code}...`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: any[] = await fetchListings(search);
    console.log(`  Got ${results.length} results from API`);

    // Log first 3 API hrefs for debugging
    for (let i = 0; i < Math.min(3, results.length); i++) {
      const sampleHref = results[i].href
        ? results[i].href.startsWith("http")
          ? results[i].href
          : `https://www.realtor.com${results[i].href}`
        : "";
      console.log(`  Sample API URL: ${sampleHref}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of results) {
      const href = r.href
        ? r.href.startsWith("http")
          ? r.href
          : `https://www.realtor.com${r.href}`
        : "";

      const dbId = urlToId.get(href);
      if (!dbId) continue; // not in our DB

      const lastUpdateDate = r.last_update_date ?? null;
      const availabilityDate = r.description?.available_date ?? null;

      if (!lastUpdateDate && !availabilityDate) continue;

      const updateFields: Record<string, string | null> = {};
      if (lastUpdateDate) updateFields.last_update_date = lastUpdateDate;
      if (availabilityDate) updateFields.availability_date = availabilityDate;

      const { error: updateError } = await supabase
        .from("listings")
        .update(updateFields)
        .eq("id", dbId);

      if (updateError) {
        console.error(`  Error updating listing ${dbId}:`, updateError);
      } else {
        updatedCount++;
        updatedIds.add(dbId);
        console.log(
          `  Updated listing ${dbId} (${href.slice(-40)}): last_update=${lastUpdateDate}, availability=${availabilityDate}`
        );
      }
    }

    // Small delay between API calls
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // For any remaining listings not found in bulk search, try individual property detail lookups
  const remainingUrls = [...urlToId.entries()].filter(
    ([, id]) => !updatedIds.has(id)
  );

  if (remainingUrls.length > 0) {
    console.log(
      `\nFetching individual property details for ${remainingUrls.length} remaining listings...`
    );

    for (const [url, id] of remainingUrls) {
      const propertyId = extractPropertyId(url);
      if (!propertyId) {
        console.log(`  Skipping listing ${id}: could not extract property ID from URL`);
        continue;
      }

      console.log(`  Fetching detail for property ${propertyId} (listing ${id})...`);
      const detail = await fetchPropertyDetail(propertyId);

      if (!detail) {
        console.log(`    No detail returned`);
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }

      const lastUpdateDate = detail.last_update_date ?? null;
      const availabilityDate = detail.description?.available_date ?? null;

      // Also log what date fields exist for diagnostics
      const dateFields = Object.keys(detail).filter(
        (k) => k.includes("date") || k.includes("time")
      );
      if (dateFields.length > 0) {
        console.log(`    Date fields found: ${dateFields.join(", ")}`);
        for (const f of dateFields) {
          console.log(`      ${f}: ${detail[f]}`);
        }
      }

      if (detail.description) {
        const descDateFields = Object.keys(detail.description).filter(
          (k) => k.includes("date") || k.includes("time") || k.includes("avail")
        );
        if (descDateFields.length > 0) {
          console.log(`    Description date fields: ${descDateFields.join(", ")}`);
          for (const f of descDateFields) {
            console.log(`      description.${f}: ${detail.description[f]}`);
          }
        }
      }

      if (!lastUpdateDate && !availabilityDate) {
        console.log(`    No date fields to update`);
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }

      const updateFields: Record<string, string | null> = {};
      if (lastUpdateDate) updateFields.last_update_date = lastUpdateDate;
      if (availabilityDate) updateFields.availability_date = availabilityDate;

      const { error: updateError } = await supabase
        .from("listings")
        .update(updateFields)
        .eq("id", id);

      if (updateError) {
        console.error(`    Error updating listing ${id}:`, updateError);
      } else {
        updatedCount++;
        console.log(
          `    Updated listing ${id}: last_update=${lastUpdateDate}, availability=${availabilityDate}`
        );
      }

      // Rate limit: small delay between individual API calls
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  console.log(`\nBackfill complete. Updated ${updatedCount} listings.`);
}

main().catch(console.error);
