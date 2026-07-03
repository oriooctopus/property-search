/**
 * sync-test-account.ts — copy the REAL user's DB-backed app data into the
 * sacrificial test account so a verify/test run reproduces what the user sees.
 *
 * READ-ONLY on the real account (oliverullman@gmail.com): we only SELECT its
 * rows. All writes target the test account (claude-verify@dwelligence.test),
 * whose data is wiped and replaced. Hard-guarded against writing anywhere else.
 *
 *   npx tsx scripts/sync-test-account.ts
 *
 * Covers: hidden_listings, saved_searches, wishlists + wishlist_items,
 * user_tiers (subscription tier). NOT covered: swipe "pass" state (per-device
 * localStorage, not in the DB) and wishlist_shares (sharing metadata).
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dir = dirname(fileURLToPath(import.meta.url));
try {
  for (const l of readFileSync(resolve(__dir, "..", ".env.local"), "utf8").split("\n")) {
    if (!l || l.startsWith("#") || !l.includes("=")) continue;
    const i = l.indexOf("="); const k = l.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = l.slice(i + 1).trim();
  }
} catch { /* env file optional — CI injects vars */ }
import { createClient } from "@supabase/supabase-js";

const REAL_EMAIL = process.env.REAL_USER_EMAIL || "oliverullman@gmail.com";
const TEST_EMAIL = "claude-verify@dwelligence.test"; // hard-coded: never write elsewhere

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function findUser(email: string): Promise<string> {
  // paginate admin.listUsers until found
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
    if (u) return u.id;
    if (data.users.length < 200) break;
  }
  throw new Error(`user not found: ${email}`);
}

async function main() {
  const realId = await findUser(REAL_EMAIL);
  const testId = await findUser(TEST_EMAIL);
  if (testId === realId) throw new Error("test and real ids are equal — aborting");
  // Safety: everything below writes with .eq('user_id', testId) or into wishlists
  // owned by testId. Never touches realId rows.
  console.log(`sync ${REAL_EMAIL} (${realId.slice(0, 8)}) -> ${TEST_EMAIL} (${testId.slice(0, 8)})`);

  // ---- WIPE test-account rows (children before parents) ----
  const { data: testWls } = await sb.from("wishlists").select("id").eq("user_id", testId);
  const testWlIds = (testWls ?? []).map((w) => w.id);
  if (testWlIds.length) await sb.from("wishlist_items").delete().in("wishlist_id", testWlIds);
  await sb.from("wishlists").delete().eq("user_id", testId);
  await sb.from("hidden_listings").delete().eq("user_id", testId);
  await sb.from("saved_searches").delete().eq("user_id", testId);
  await sb.from("user_tiers").delete().eq("user_id", testId);

  // ---- hidden_listings ----
  const { data: hid } = await sb.from("hidden_listings").select("listing_id").eq("user_id", realId);
  if (hid?.length) {
    const rows = hid.map((r) => ({ user_id: testId, listing_id: r.listing_id }));
    for (let i = 0; i < rows.length; i += 500) await sb.from("hidden_listings").insert(rows.slice(i, i + 500));
  }
  console.log(`  hidden_listings: ${hid?.length ?? 0}`);

  // ---- saved_searches ----
  const { data: ss } = await sb.from("saved_searches").select("name, filters, notify_sms").eq("user_id", realId);
  if (ss?.length) await sb.from("saved_searches").insert(ss.map((s) => ({ user_id: testId, name: s.name, filters: s.filters, notify_sms: s.notify_sms })));
  console.log(`  saved_searches: ${ss?.length ?? 0}`);

  // ---- wishlists + items (remap wishlist ids) ----
  const { data: wls } = await sb.from("wishlists").select("id, name").eq("user_id", realId);
  let itemCount = 0;
  for (const wl of wls ?? []) {
    // ALWAYS private: copying is_public from the real wishlist made the test
    // account's clone publicly visible — it showed up as a duplicate
    // "Williamsburg" in the real user's own Manage Wishlists UI. The test
    // copy only needs to be readable by the test account itself.
    const { data: nw, error } = await sb.from("wishlists").insert({ user_id: testId, name: wl.name, is_public: false }).select("id").single();
    if (error || !nw) { console.log(`  wishlist "${wl.name}" insert failed: ${error?.message}`); continue; }
    const { data: items } = await sb.from("wishlist_items").select("listing_id").eq("wishlist_id", wl.id);
    if (items?.length) {
      await sb.from("wishlist_items").insert(items.map((it) => ({ wishlist_id: nw.id, listing_id: it.listing_id, added_by: testId })));
      itemCount += items.length;
    }
  }
  console.log(`  wishlists: ${wls?.length ?? 0} (${itemCount} items)`);

  // ---- user_tiers (subscription tier) ----
  const { data: tier } = await sb.from("user_tiers").select("tier_id").eq("user_id", realId).maybeSingle();
  if (tier) await sb.from("user_tiers").insert({ user_id: testId, tier_id: tier.tier_id });
  console.log(`  user_tier: ${tier?.tier_id ?? "(none)"}`);

  console.log("done. Note: swipe 'pass' state is per-device localStorage and is NOT synced.");
}
main().catch((e) => { console.error("SYNC FAILED:", e.message); process.exit(1); });
