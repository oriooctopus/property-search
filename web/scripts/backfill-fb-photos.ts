/**
 * Backfill Facebook Marketplace listing photos by downloading them from
 * Facebook CDN and re-uploading to Supabase Storage.
 *
 * Facebook CDN URLs (fbcdn.net) expire after a few days, so any listings
 * that still have working CDN URLs get migrated to permanent storage.
 * Expired URLs are logged and the listing's photo_urls is cleared.
 *
 * Usage: npx tsx scripts/backfill-fb-photos.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { createClient } from "@supabase/supabase-js";

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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

// ---------------------------------------------------------------------------
// Fetch Facebook listings with fbcdn.net photo URLs
// ---------------------------------------------------------------------------

async function fetchFbListingsWithCdnPhotos(): Promise<
  Array<{ id: string; photo_urls: string[] }>
> {
  const results: Array<{ id: string; photo_urls: string[] }> = [];
  let offset = 0;
  const PAGE = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("listings")
      .select("id, photo_urls")
      .eq("source", "facebook")
      .not("photo_urls", "is", null)
      .range(offset, offset + PAGE - 1);

    if (error) {
      console.error(`Fetch error at offset ${offset}:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;

    // Filter to only those with fbcdn.net URLs
    for (const row of data) {
      const urls = row.photo_urls as string[];
      if (urls && urls.some((u: string) => u.includes("fbcdn.net"))) {
        results.push({ id: row.id, photo_urls: urls });
      }
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  return results;
}

// ---------------------------------------------------------------------------
// Download + upload a single photo
// ---------------------------------------------------------------------------

async function persistPhoto(
  cdnUrl: string,
  listingId: string,
  index: number,
): Promise<string | null> {
  try {
    const res = await fetch(cdnUrl, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      console.log(`  [${listingId}] CDN returned ${res.status} — URL likely expired`);
      return null;
    }

    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpg";
    const buffer = Buffer.from(await res.arrayBuffer());
    const path = `facebook/${listingId}/${index}.${ext}`;

    const { error } = await supabase.storage
      .from("listing-photos")
      .upload(path, buffer, { contentType, upsert: true });

    if (error) {
      console.log(`  [${listingId}] Upload failed: ${error.message}`);
      return null;
    }

    const { data } = supabase.storage.from("listing-photos").getPublicUrl(path);
    return data.publicUrl;
  } catch (err) {
    console.log(
      `  [${listingId}] Fetch failed: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Facebook Marketplace Photo Backfill ===\n");

  const listings = await fetchFbListingsWithCdnPhotos();
  console.log(`Found ${listings.length} Facebook listings with fbcdn.net URLs\n`);

  if (listings.length === 0) {
    console.log("Nothing to backfill!");
    return;
  }

  let migrated = 0;
  let expired = 0;
  let failed = 0;

  for (let i = 0; i < listings.length; i++) {
    const listing = listings[i];
    console.log(`[${i + 1}/${listings.length}] Processing ${listing.id}...`);

    const newUrls: string[] = [];

    for (let j = 0; j < listing.photo_urls.length; j++) {
      const url = listing.photo_urls[j];
      if (!url.includes("fbcdn.net")) {
        // Already migrated, keep it
        newUrls.push(url);
        continue;
      }

      const permanentUrl = await persistPhoto(url, listing.id, j);
      if (permanentUrl) {
        newUrls.push(permanentUrl);
      }
    }

    // Update the listing in the database
    const { error } = await supabase
      .from("listings")
      .update({
        photo_urls: newUrls,
        photos: newUrls.length,
      })
      .eq("id", listing.id);

    if (error) {
      console.log(`  [${listing.id}] DB update failed: ${error.message}`);
      failed++;
    } else if (newUrls.length > 0) {
      console.log(`  [${listing.id}] Migrated ${newUrls.length} photo(s)`);
      migrated++;
    } else {
      console.log(`  [${listing.id}] All photos expired — cleared`);
      expired++;
    }
  }

  console.log("\n=== RESULTS ===");
  console.log(`  Total Facebook listings with CDN URLs: ${listings.length}`);
  console.log(`  Migrated to Storage:  ${migrated}`);
  console.log(`  All photos expired:   ${expired}`);
  console.log(`  Failed:               ${failed}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
