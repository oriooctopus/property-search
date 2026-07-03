/**
 * One-time cleanup of EXISTING duplicate active listings created by url churn
 * (Craigslist reposts / StreetEasy re-lists getting a fresh url each scrape).
 *
 * Groups active rows by the SAME apartment-identity key the ingest now uses
 * (lib/sources/identity.ts) and, within each group of >1, keeps the
 * most-recently-seen row (max last_seen_at, tiebreak max id). The older rows
 * are the duplicates.
 *
 *   npx tsx scripts/dedup-existing.ts            # DRY-RUN (default): prints only
 *   npx tsx scripts/dedup-existing.ts --apply     # actually mutates the DB
 *
 * --apply: before deleting a duplicate row, any wishlist_items / hidden_listings
 * that reference it are re-pointed to the kept row, then the duplicate is
 * hard-deleted. Uses SUPABASE_SERVICE_ROLE_KEY from web/.env.local.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { apartmentIdentityKey } from "../lib/sources/identity";

// ── env ────────────────────────────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url));
try {
  for (const l of readFileSync(resolve(__dir, "..", ".env.local"), "utf8").split("\n")) {
    if (!l || l.startsWith("#") || !l.includes("=")) continue;
    const i = l.indexOf("=");
    const k = l.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = l.slice(i + 1).trim();
  }
} catch {
  /* env file optional — CI injects vars */
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const APPLY = process.argv.includes("--apply");

interface Row {
  id: number;
  url: string;
  address: string;
  beds: number;
  price: number;
  source: string;
  last_seen_at: string | null;
}

/** Keep the most-recently-seen row: max last_seen_at, tiebreak max id. */
function isNewer(a: Row, b: Row): boolean {
  const at = a.last_seen_at ?? "";
  const bt = b.last_seen_at ?? "";
  if (at !== bt) return at > bt;
  return a.id > b.id;
}

function fmt(r: Row): string {
  const addr = (r.address ?? "").slice(0, 40).padEnd(40);
  return `id=${String(r.id).padEnd(7)} ${addr} beds=${r.beds} $${String(r.price).padEnd(6)} ${r.source.padEnd(11)} seen=${r.last_seen_at ?? "-"}  ${r.url}`;
}

async function fetchActive(): Promise<Row[]> {
  const rows: Row[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb
      .from("listings")
      .select("id, url, address, beds, price, source, last_seen_at")
      .is("delisted_at", null)
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`fetch active failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }
  return rows;
}

async function repointReferences(fromId: number, toId: number): Promise<void> {
  // Re-point web references from a to-be-removed duplicate onto the kept row so
  // a user's wishlist / hidden entry isn't orphaned by the delete.
  const { error: wErr } = await sb
    .from("wishlist_items")
    .update({ listing_id: toId })
    .eq("listing_id", fromId);
  if (wErr) throw new Error(`repoint wishlist_items ${fromId}->${toId}: ${wErr.message}`);

  const { error: hErr } = await sb
    .from("hidden_listings")
    .update({ listing_id: toId })
    .eq("listing_id", fromId);
  if (hErr) throw new Error(`repoint hidden_listings ${fromId}->${toId}: ${hErr.message}`);
}

async function main() {
  const active = await fetchActive();
  console.log(`Fetched ${active.length} active listings\n`);

  const groups = new Map<string, Row[]>();
  for (const r of active) {
    const k = apartmentIdentityKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  const dupGroups = Array.from(groups.entries()).filter(([, rs]) => rs.length > 1);
  console.log(
    `Identity keys: ${groups.size} | duplicate groups (>1 row): ${dupGroups.length}\n`,
  );

  let totalRemove = 0;
  const removeIdToKeepId = new Map<number, number>();

  for (const [key, rs] of dupGroups) {
    const keep = rs.reduce((best, r) => (isNewer(r, best) ? r : best), rs[0]);
    const remove = rs.filter((r) => r.id !== keep.id);
    totalRemove += remove.length;
    for (const r of remove) removeIdToKeepId.set(r.id, keep.id);

    console.log(`── key: ${key}`);
    console.log(`   KEEP   ${fmt(keep)}`);
    for (const r of remove) console.log(`   REMOVE ${fmt(r)}`);
    console.log("");
  }

  console.log("──────────────────────────────────────────────────────────────");
  console.log(`Groups with duplicates: ${dupGroups.length}`);
  console.log(`Rows that would be REMOVED: ${totalRemove}`);
  console.log(`Rows that would be KEPT (one per dup group): ${dupGroups.length}`);
  console.log(`Active rows after cleanup: ${active.length - totalRemove}`);

  if (!APPLY) {
    console.log("\nDRY-RUN — no changes made. Re-run with --apply to mutate.");
    return;
  }

  if (totalRemove === 0) {
    console.log("\nNothing to remove.");
    return;
  }

  console.log(`\n--apply: re-pointing references and deleting ${totalRemove} duplicate rows...`);
  let deleted = 0;
  for (const [removeId, keepId] of removeIdToKeepId) {
    await repointReferences(removeId, keepId);
    const { error } = await sb.from("listings").delete().eq("id", removeId);
    if (error) throw new Error(`delete listing ${removeId}: ${error.message}`);
    deleted++;
  }
  console.log(`Done. Deleted ${deleted} duplicate rows.`);
}

main().catch((e) => {
  console.error("dedup-existing FAILED:", e.message);
  process.exit(1);
});
