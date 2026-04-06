/**
 * Cross-batch dedup: fetches all DB listings, runs deduplicateAndComposite,
 * and deletes the losers. Safe to run repeatedly.
 *
 * Usage: npx tsx scripts/dedup-db.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { createClient } from "@supabase/supabase-js";
import { deduplicateAndComposite } from "../lib/sources/dedup";

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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // Paginate to avoid Supabase's default 1000-row limit
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any[] = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data: page, error: pageErr } = await supabase
      .from("listings")
      .select("*")
      .range(offset, offset + PAGE - 1);
    if (pageErr || !page) {
      console.error(`Fetch error at offset ${offset}:`, pageErr?.message);
      process.exit(1);
    }
    data.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  console.log(`Fetched ${data.length} listings from DB`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listings = data.map((row: any) => ({
    ...row,
    lat: Number(row.lat) || 0,
    lon: Number(row.lon) || 0,
    price: Number(row.price) || 0,
    beds: Number(row.beds) || 0,
    baths: Number(row.baths) || 0,
    photos: Number(row.photos) || 0,
    photo_urls: row.photo_urls ?? [],
    sources: row.sources ?? [row.source],
    source_urls: row.source_urls ?? { [row.source]: row.url },
    quality: { beds: "parsed", baths: "parsed", price: "parsed", geo: "parsed", photos: "parsed" },
  }));

  const deduped = deduplicateAndComposite(listings);
  console.log(`After dedup: ${deduped.length}`);

  const keepUrls = new Set(deduped.map((l) => l.url));
  const toDelete = data.filter((row) => !keepUrls.has(row.url));
  console.log(`Duplicates to remove: ${toDelete.length}`);

  if (toDelete.length > 0) {
    for (const d of toDelete.slice(0, 15)) {
      console.log(`  DEL: ${(d.address as string)?.slice(0, 60)} — ${d.source} — $${d.price}`);
    }
    if (toDelete.length > 15) console.log(`  ... and ${toDelete.length - 15} more`);

    const ids = toDelete.map((r) => r.id);
    const { error: delErr } = await supabase.from("listings").delete().in("id", ids);
    if (delErr) {
      console.error("Delete error:", delErr.message);
    } else {
      console.log(`Deleted ${ids.length} duplicates`);
    }
  }

  const { count } = await supabase.from("listings").select("*", { count: "exact", head: true });
  console.log(`Final DB count: ${count}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
