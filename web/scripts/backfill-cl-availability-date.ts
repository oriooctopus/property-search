/**
 * One-off, idempotent backfill of `availability_date` for source='craigslist'
 * listings.
 *
 * Fixes three separate bugs:
 *   1. Newly-scraped rows (post-redesign) land with availability_date = ''
 *      or null because the pageFunction's selector went stale and — before
 *      the fix — the raw value was written straight through unparsed.
 *   2. PRE-EXISTING (pre-redesign) rows stored raw scraped text like
 *      "available may 1" / "available now" directly in availability_date —
 *      never normalized to ISO — which also silently fails the saved-search
 *      availability-date range filter (route.ts drops anything that isn't a
 *      comparable ISO date, same as it drops '' / null when
 *      includeNaAvailableDate is false).
 *   3. Many CL posts only state availability in the free-form description,
 *      not the structured field at all (e.g. "*Available 8/1", "August 1st
 *      MOVE-IN") — for rows still null after (1)/(2), this also mines
 *      `description` as a fallback via extractAvailabilityFromDescription.
 *      NOTE: description was ALSO never persisted to the DB until the same
 *      fix that added this backfill step (see the comment on `description:`
 *      in lib/sources/craigslist.ts) — so this step is a no-op for rows
 *      scraped before that fix landed (description is null for them too);
 *      it only helps rows scraped after, and future re-scrapes.
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
 *   - still null after the above, but
 *     description has a date-like phrase → extractAvailabilityFromDescription(...)
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
import { parseAvailabilityDate, extractAvailabilityFromDescription } from "../lib/sources/availability";

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
  description: string | null;
}

async function fetchCraigslistRows(): Promise<Row[]> {
  const rows: Row[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb
      .from("listings")
      .select("id, url, availability_date, list_date, description")
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
  let filledFromDescription = 0;
  let descriptionCheckedNoMatch = 0;

  const updates: Array<{ id: number; from: string | null; to: string | null }> = [];

  for (const row of rows) {
    const before = row.availability_date;
    // Tracks the post-structured-pass value so the description fallback
    // below can run uniformly regardless of which branch produced null.
    let structuredResult: string | null = null;
    let wroteFromStructuredPass = false;

    if (before != null && ISO_RE.test(before)) {
      // Already a well-formed ISO string. Still run it through the
      // normalizer to reject an impossible calendar date (e.g. stray
      // "2026-02-30"), but otherwise this is a no-op.
      const validated = parseAvailabilityDate(before, row.list_date);
      if (validated === before) {
        alreadyValidIso++;
        continue;
      }
      // Fall through — validated is null (garbage ISO).
      structuredResult = validated;
      if (validated == null) rawTextParsedToNull++;
      else rawTextParsedToDate++;
      if (validated != null) {
        updates.push({ id: row.id, from: before, to: validated });
        wroteFromStructuredPass = true;
      }
    } else if (before === "" || before == null) {
      if (before === null) {
        unchangedNull++;
      } else {
        // '' → null. Distinct category from raw-text parsing since there's
        // nothing to parse — this is purely the type fix.
        emptyOrNullToNull++;
      }
      structuredResult = null;
    } else {
      // Raw scraped text (e.g. "available now", "available may 1").
      const parsed = parseAvailabilityDate(before, row.list_date);
      structuredResult = parsed;
      if (parsed == null) {
        rawTextParsedToNull++;
      } else {
        rawTextParsedToDate++;
        updates.push({ id: row.id, from: before, to: parsed });
        wroteFromStructuredPass = true;
      }
    }

    if (wroteFromStructuredPass) continue;

    // Fallback: still null after the structured pass — try mining the
    // free-form description. (See file header: description is currently
    // null for most existing rows too, since it was never persisted before
    // the same fix — this only helps rows that have it.)
    if (structuredResult == null && row.description) {
      const fromDesc = extractAvailabilityFromDescription(row.description, row.list_date);
      if (fromDesc != null) {
        filledFromDescription++;
        updates.push({ id: row.id, from: before, to: fromDesc });
        continue;
      }
      descriptionCheckedNoMatch++;
    }

    // structuredResult is null and no description fallback fired — only
    // queue a write if the DB value isn't already null (avoid a no-op write
    // on every re-run for rows with no signal anywhere).
    if (structuredResult == null && before !== null) {
      updates.push({ id: row.id, from: before, to: null });
    }
  }

  console.log("── Before/after breakdown ──────────────────────────────────");
  console.log(`Already valid ISO (untouched):        ${alreadyValidIso}`);
  console.log(`Already null (untouched):             ${unchangedNull}`);
  console.log(`'' → null:                            ${emptyOrNullToNull}`);
  console.log(`raw text → parsed ISO date:            ${rawTextParsedToDate}`);
  console.log(`raw text/garbage → null:               ${rawTextParsedToNull}`);
  console.log(`filled from description mining:        ${filledFromDescription}`);
  console.log(`description present but no date found: ${descriptionCheckedNoMatch}`);
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
