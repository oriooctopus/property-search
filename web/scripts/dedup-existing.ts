/**
 * One-time cleanup of EXISTING duplicate active listings created by url churn
 * (Craigslist reposts / StreetEasy re-lists getting a fresh url each scrape).
 *
 * Groups active rows by the SAME apartment-identity key the ingest now uses
 * (lib/sources/identity.ts) and, within each group of >1, keeps the
 * most-recently-seen row: max list_date (the user's explicit rule — "newest
 * version always wins"), tiebreak max last_seen_at, tiebreak max id (list_date
 * is frequently IDENTICAL across an entire repost-storm cluster scraped in
 * one ingest batch — e.g. a confirmed 3-row craigslist cluster all sharing
 * list_date "2026-07-16 02:27:59" — so last_seen_at/id are load-bearing
 * tiebreaks, not just cosmetic). The older rows are the duplicates.
 *
 *   npx tsx scripts/dedup-existing.ts            # DRY-RUN (default): prints only
 *   npx tsx scripts/dedup-existing.ts --apply     # actually mutates the DB
 *
 * --apply: before deleting a duplicate row, any wishlist_items / hidden_listings
 * that reference it are re-pointed to the kept row — COLLISION-SAFE: both
 * tables carry a UNIQUE(wishlist_id/user_id, listing_id) constraint, so if
 * the same wishlist/user already has an item pointing at the SURVIVOR, a
 * blind UPDATE onto the survivor's id would violate that constraint. Instead
 * each reference is checked first: if the survivor is already referenced,
 * the duplicate's reference row is deleted (collapses to one entry); only if
 * the survivor is NOT yet referenced does the row get updated onto it. Then
 * the duplicate listing row itself is hard-deleted (ON DELETE CASCADE would
 * also clean up any missed references, but explicit repoint runs first so
 * cascading delete is never what actually reassigns a user's data). Uses
 * SUPABASE_SERVICE_ROLE_KEY from web/.env.local.
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
  list_date: string | null;
  lat: number | null;
  lon: number | null;
}

/**
 * Keep the most-recently-seen row: max list_date (the user's explicit
 * "newest version wins" rule), tiebreak max last_seen_at, tiebreak max id.
 * list_date is frequently identical across an entire same-batch repost
 * cluster, so the tiebreaks are load-bearing, not cosmetic.
 */
function isNewer(a: Row, b: Row): boolean {
  const ald = a.list_date ?? "";
  const bld = b.list_date ?? "";
  if (ald !== bld) return ald > bld;
  const at = a.last_seen_at ?? "";
  const bt = b.last_seen_at ?? "";
  if (at !== bt) return at > bt;
  return a.id > b.id;
}

function fmt(r: Row): string {
  const addr = (r.address ?? "").slice(0, 40).padEnd(40);
  return `id=${String(r.id).padEnd(7)} ${addr} beds=${r.beds} $${String(r.price).padEnd(6)} ${r.source.padEnd(11)} listed=${r.list_date ?? "-"} seen=${r.last_seen_at ?? "-"}  ${r.url}`;
}

async function fetchActive(): Promise<Row[]> {
  const rows: Row[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb
      .from("listings")
      .select("id, url, address, beds, price, source, last_seen_at, list_date, lat, lon")
      .is("delisted_at", null)
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`fetch active failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }
  return rows;
}

/**
 * Re-points one table's references from a to-be-removed duplicate listing
 * onto the kept row — collision-safe against the table's
 * UNIQUE(groupCol, listing_id) constraint: if the group (wishlist/user)
 * already has a row pointing at the survivor, the duplicate's row is
 * DELETED (collapses to one entry) instead of updated (which would violate
 * the constraint); otherwise it's updated onto the survivor.
 */
/**
 * @param dryRun When true, performs the exact same read-only collision
 *   check (so the returned counts are accurate) but skips the actual
 *   update/delete — lets the dry-run report real wishlist/hidden-listing
 *   impact counts before anything is mutated.
 */
async function repointTable(
  table: "wishlist_items" | "hidden_listings",
  groupCol: "wishlist_id" | "user_id",
  fromId: number,
  toId: number,
  dryRun: boolean,
): Promise<{ updated: number; collapsed: number }> {
  const { data: fromRows, error: fetchErr } = await sb
    .from(table)
    .select(`id, ${groupCol}`)
    .eq("listing_id", fromId);
  if (fetchErr) throw new Error(`fetch ${table} for listing ${fromId}: ${fetchErr.message}`);
  if (!fromRows || fromRows.length === 0) return { updated: 0, collapsed: 0 };

  let updated = 0;
  let collapsed = 0;
  for (const row of fromRows as Array<{ id: number } & Record<string, unknown>>) {
    const groupValue = row[groupCol];
    const { data: existing, error: existingErr } = await sb
      .from(table)
      .select("id")
      .eq(groupCol, groupValue as string)
      .eq("listing_id", toId)
      .maybeSingle();
    if (existingErr) throw new Error(`check ${table} collision for ${groupCol}=${groupValue}: ${existingErr.message}`);

    if (existing) {
      // Survivor already referenced by this wishlist/user — the duplicate's
      // reference row is now redundant. Delete it rather than update (which
      // would violate the UNIQUE constraint).
      collapsed++;
      if (!dryRun) {
        const { error: delErr } = await sb.from(table).delete().eq("id", row.id);
        if (delErr) throw new Error(`collapse ${table} row ${row.id}: ${delErr.message}`);
      }
    } else {
      updated++;
      if (!dryRun) {
        const { error: updErr } = await sb.from(table).update({ listing_id: toId }).eq("id", row.id);
        if (updErr) throw new Error(`repoint ${table} row ${row.id} -> listing ${toId}: ${updErr.message}`);
      }
    }
  }
  return { updated, collapsed };
}

async function repointReferences(
  fromId: number,
  toId: number,
  dryRun: boolean,
): Promise<{ wishlistUpdated: number; wishlistCollapsed: number; hiddenUpdated: number; hiddenCollapsed: number }> {
  const w = await repointTable("wishlist_items", "wishlist_id", fromId, toId, dryRun);
  const h = await repointTable("hidden_listings", "user_id", fromId, toId, dryRun);
  return {
    wishlistUpdated: w.updated,
    wishlistCollapsed: w.collapsed,
    hiddenUpdated: h.updated,
    hiddenCollapsed: h.collapsed,
  };
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

  // Compute reference-repoint impact (real counts via the same collision
  // check used by --apply, just without mutating) so this is visible BEFORE
  // anything is written, not just after.
  let wishlistUpdated = 0;
  let wishlistCollapsed = 0;
  let hiddenUpdated = 0;
  let hiddenCollapsed = 0;
  for (const [removeId, keepId] of removeIdToKeepId) {
    const r = await repointReferences(removeId, keepId, /* dryRun */ !APPLY);
    wishlistUpdated += r.wishlistUpdated;
    wishlistCollapsed += r.wishlistCollapsed;
    hiddenUpdated += r.hiddenUpdated;
    hiddenCollapsed += r.hiddenCollapsed;
  }
  console.log(
    `wishlist_items: ${wishlistUpdated} repointed onto survivor, ${wishlistCollapsed} collapsed (survivor already present)`,
  );
  console.log(
    `hidden_listings: ${hiddenUpdated} repointed onto survivor, ${hiddenCollapsed} collapsed (survivor already present)`,
  );

  if (!APPLY) {
    console.log("\nDRY-RUN — no changes made (repoint counts above are accurate previews). Re-run with --apply to mutate.");
    return;
  }

  if (totalRemove === 0) {
    console.log("\nNothing to remove.");
    return;
  }

  console.log(`\n--apply: deleting ${totalRemove} duplicate listing rows (references already repointed above)...`);
  let deleted = 0;
  for (const [removeId] of removeIdToKeepId) {
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
