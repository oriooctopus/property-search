/**
 * Apartment-identity key for INGEST-LEVEL de-duplication.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The ingest upserts listings with `onConflict: "url"`. But the SAME physical
 * apartment gets a NEW url over time — Craigslist reposts get a fresh post id
 * (often daily), StreetEasy re-lists get a new rental id — so each scrape
 * INSERTS a new row instead of updating the existing one, producing duplicate
 * active listings that grow every day.
 *
 * `external_id` is set by the scrapers but is NULL for 100% of current active
 * rows, so it can't be the dedup key. Instead we compute a conservative
 * "apartment identity" key from the address / beds / price the scrape already
 * has.
 *
 * ── Design bias: precision over recall ─────────────────────────────────────
 * Under-merging (leaving two rows for one apartment) is a tolerable cosmetic
 * duplicate. OVER-merging hides a real, distinct listing from the user and is
 * NOT acceptable. So every rule below errs toward NOT merging when unsure.
 *
 * ── The key ────────────────────────────────────────────────────────────────
 * Normalize the address: lowercase, collapse whitespace, strip `. , #`.
 *
 *  1. Street number (`/^\d+\s/`) AND a unit token present
 *     (apt | unit | ste | `#<digit>` | a trailing "<digits><letter>" like
 *     "2b"/"3b"):
 *        key = `normAddr|beds`  — merge regardless of price.
 *     The unit token means the address string itself names the unit, so two
 *     DIFFERENT units in one building have DIFFERENT normalized addresses and
 *     never collide. Ignoring price here is what lets a re-list whose rent
 *     changed ("141 meserole st 2b" at $4995 vs $5000) still collapse.
 *
 *  2. Street number but NO unit token:
 *        key = `normAddr|beds|price`  — require EXACT price.
 *     Two distinct units in one building may both be listed at the bare street
 *     address (no unit). Requiring an exact price match makes an accidental
 *     merge of two genuinely-different units vanishingly unlikely, while still
 *     collapsing a straight repost of the same unit at the same price
 *     ("18 monitor st brooklyn ny" beds=4, both $6995).
 *
 *  3. No street number (vague / junk address — "google map", or a bare street
 *     name like "himrod brooklyn ny" / "lexington brooklyn ny"):
 *        key = `url`  — NEVER merge. These are DISTINCT apartments that merely
 *     share a vague address; the url is their only reliable identity.
 *
 * The key is prefixed with `source` so de-duplication is source-scoped: we only
 * ever collapse rows that came from the SAME source (avoids cross-source
 * surprises — that reconciliation is handled separately by lib/sources/dedup).
 *
 * NOTE: `/^\d+\s/` deliberately does NOT match hyphenated Queens-style numbers
 * ("86-79 …"): those fall to rule 3 (url, never merge). That's a safe
 * under-merge, consistent with the precision-over-recall bias.
 */

export interface IdentityInput {
  address: string | null;
  beds: number;
  price: number;
  url: string;
  source: string;
}

/** Detects a unit token on the lowercased, whitespace-collapsed address. */
function hasUnitToken(lower: string): boolean {
  // explicit unit words
  if (/\b(apt|unit|ste)\b/.test(lower)) return true;
  // "#5" / "# 5"
  if (/#\s*\d/.test(lower)) return true;
  // trailing unit line like "3b" / "2b" (digits immediately followed by a
  // single letter at the very end of the address).
  if (/\d+[a-z]\s*$/.test(lower)) return true;
  return false;
}

/**
 * Compute the conservative apartment-identity key for a listing. Two listings
 * that return the same key are treated as the same physical apartment.
 */
export function apartmentIdentityKey(l: IdentityInput): string {
  // Lowercase + collapse whitespace. Kept WITH punctuation so `#5` can be
  // detected as a unit token before we strip it for the key string.
  const lower = (l.address ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  // normAddr for the key: strip `. , #`, then re-collapse whitespace.
  const normAddr = lower.replace(/[.,#]/g, " ").replace(/\s+/g, " ").trim();

  const hasStreetNumber = /^\d+\s/.test(normAddr);
  if (!hasStreetNumber) {
    // Rule 3 — vague/junk address: unique by url, never merged.
    return `${l.source}|url|${l.url}`;
  }

  if (hasUnitToken(lower)) {
    // Rule 1 — the address names the unit: merge on address+beds, any price.
    return `${l.source}|unit|${normAddr}|${l.beds}`;
  }

  // Rule 2 — bare street address: require exact price so distinct units in one
  // building are never merged.
  return `${l.source}|addr|${normAddr}|${l.beds}|${l.price}`;
}
