/**
 * One-off, idempotent backfill of `availability_date` for source='craigslist'
 * listings.
 *
 * Fixes two separate bugs:
 *   1. Newly-scraped rows (post-redesign) land with availability_date = ''
 *      or null because the pageFunction's selector went stale and — before
 *      the fix — the raw value was written straight through unparsed.
 *   2. PRE-EXISTING (pre-redesign) rows stored raw scraped text like
 *      "available may 1" / "available now" directly in availability_date —
 *      never normalized to ISO — which also silently fails the saved-search
 *      availability-date range filter (route.ts drops anything that isn't a
 *      comparable ISO date, same as it drops '' / null when
 *      includeNaAvailableDate is false).
 *
 * Uses the SAME normalizer as the live adapter (lib/sources/availability.ts)
 * — one implementation, not a re-derived copy — so the backfilled values and
 * newly-scraped values are guaranteed consistent.
 *
 * Transformations applied, per row:
 *   - '' or already-null                → null (only if not already null —
 *                                          counted as a distinct category so
 *                                          the report shows real work done)
 *   - raw text ("available now", etc.)  → parseAvailabilityDate(raw, list_date)
 *   - already valid ISO                 → left untouched (no-op, not counted
 *                                          as a write) — this is what makes
 *                                          the script safe to re-run
 *
 * Usage (from /web):
 *   npx tsx scripts/backfill-cl-availability-date.ts            # DRY-RUN (default)
 *   npx tsx scripts/backfill-cl-availability-date.ts --apply    # actually mutates the DB
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY from web/.env.local (or the environment —
 * CI/linked-project runs may inject it directly). Only ever touches
 * source='craigslist' rows' availability_date column.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { parseAvailabilityDate } from "../lib/sources/availability";

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
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Row {
  id: number;
  url: string;
  availability_date: string | null;
  list_date: string | null;
}

async function fetchCraigslistRows(): Promise<Row[]> {
  const rows: Row[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb
      .from("listings")
      .select("id, url, availability_date, list_date")
      .eq("source", "craigslist")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }
  return rows;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (will write)" : "DRY-RUN (no writes)"}\n`);

  const rows = await fetchCraigslistRows();
  console.log(`Fetched ${rows.length} source='craigslist' listings\n`);

  let alreadyValidIso = 0;
  let emptyOrNullToNull = 0;
  let rawTextParsedToDate = 0;
  let rawTextParsedToNull = 0;
  let unchangedNull = 0;

  const updates: Array<{ id: number; from: string | null; to: string | null }> = [];

  for (const row of rows) {
    const before = row.availability_date;

    if (before != null && ISO_RE.test(before)) {
      // Already a well-formed ISO string. Still run it through the
      // normalizer to reject an impossible calendar date (e.g. stray
      // "2026-02-30"), but otherwise this is a no-op.
      const validated = parseAvailabilityDate(before, row.list_date);
      if (validated === before) {
        alreadyValidIso++;
        continue;
      }
      // Fall through — validated is null (garbage ISO), handled below.
      updates.push({ id: row.id, from: before, to: validated });
      if (validated == null) rawTextParsedToNull++;
      else rawTextParsedToDate++;
      continue;
    }

    if (before === "" || before == null) {
      if (before === null) {
        unchangedNull++;
        continue;
      }
      // '' → null. Distinct category from raw-text parsing since there's
      // nothing to parse — this is purely the type fix.
      emptyOrNullToNull++;
      updates.push({ id: row.id, from: before, to: null });
      continue;
    }

    // Raw scraped text (e.g. "available now", "available may 1").
    const parsed = parseAvailabilityDate(before, row.list_date);
    if (parsed == null) {
      rawTextParsedToNull++;
    } else {
      rawTextParsedToDate++;
    }
    updates.push({ id: row.id, from: before, to: parsed });
  }

  console.log("── Before/after breakdown ──────────────────────────────────");
  console.log(`Already valid ISO (untouched):        ${alreadyValidIso}`);
  console.log(`Already null (untouched):             ${unchangedNull}`);
  console.log(`'' → null:                            ${emptyOrNullToNull}`);
  console.log(`raw text → parsed ISO date:            ${rawTextParsedToDate}`);
  console.log(`raw text/garbage → null:               ${rawTextParsedToNull}`);
  console.log(`Total rows needing a write:            ${updates.length}`);
  console.log("");

  if (updates.length > 0) {
    console.log("Sample of planned changes (first 15):");
    for (const u of updates.slice(0, 15)) {
      console.log(`  id=${u.id} "${u.from}" → ${u.to === null ? "null" : `"${u.to}"`}`);
    }
    console.log("");
  }

  if (!APPLY) {
    console.log("DRY-RUN — no changes made. Re-run with --apply to write.");
    return;
  }

  if (updates.length === 0) {
    console.log("Nothing to update.");
    return;
  }

  console.log(`--apply: writing ${updates.length} row(s)...`);
  let written = 0;
  for (const u of updates) {
    const { error } = await sb
      .from("listings")
      .update({ availability_date: u.to })
      .eq("id", u.id)
      .eq("source", "craigslist");
    if (error) throw new Error(`update listing ${u.id}: ${error.message}`);
    written++;
  }
  console.log(`Done. Updated ${written} row(s).`);
}

main().catch((e) => {
  console.error("backfill-cl-availability-date FAILED:", e.message);
  process.exit(1);
});
