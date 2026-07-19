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
 *  3. No street number, source = craigslist, AND lat/lon present:
 *        key = `normTitle|beds|round(lat,3)|round(lon,3)`  — merge on
 *     normalized title text + beds + coordinates rounded to 3 decimals
 *     (~110m at NYC latitude — an intentionally loose >50m-scale bucket,
 *     since CL's own coordinates for the SAME posting can drift a little
 *     between reposts). PRICE IS DELIBERATELY EXCLUDED: a real confirmed
 *     cluster (3 active rows, identical address/title/lat/lon, same
 *     ingest batch — "⚡🔥WILLIAMSBURG 3 Bed/2 Bath DUPLEX🔥⚡ GREAT DEAL!!!")
 *     had prices $5600/$5700/$5700 across what was unambiguously one
 *     apartment reposted 3x by the same lister — requiring exact price
 *     would have left 2 of 3 duplicates unmerged. This exists because CL
 *     specifically and heavily reposts the SAME listing with no address at
 *     all (unlike StreetEasy, which always has one) — title text is the
 *     only remaining signal, and it's a strong one when combined with tight
 *     coordinates: two DIFFERENT apartments coincidentally sharing both an
 *     identical (post-normalization) title AND coordinates within ~110m is
 *     vanishingly unlikely. Gated to craigslist only — the
 *     precision-over-recall bias stays in force for every other source.
 *
 *  4. No street number, and EITHER source != craigslist OR lat/lon missing
 *     (vague / junk address — "google map", or a bare street name like
 *     "himrod brooklyn ny" / "lexington brooklyn ny", or a CL row that
 *     somehow has no coordinates):
 *        key = `url`  — NEVER merge. These are DISTINCT apartments that
 *     merely share a vague address; the url is their only reliable
 *     identity, and rule 3's coordinate signal isn't available to do better.
 *
 * The key is prefixed with `source` so de-duplication is source-scoped: we only
 * ever collapse rows that came from the SAME source (avoids cross-source
 * surprises — that reconciliation is handled separately by lib/sources/dedup).
 *
 * NOTE: `/^\d+\s/` deliberately does NOT match hyphenated Queens-style numbers
 * ("86-79 …"): those fall to rule 4 (url, never merge) unless rule 3 applies.
 * That's a safe under-merge, consistent with the precision-over-recall bias.
 */

export interface IdentityInput {
  address: string | null;
  beds: number;
  price: number;
  url: string;
  source: string;
  lat?: number | null;
  lon?: number | null;
}

/**
 * Strips a Craigslist title down to comparable text: lowercase, emoji/
 * punctuation removed entirely (not just collapsed — reposts commonly vary
 * emoji choice/count and "!!!" vs "!!!!" around otherwise-identical text),
 * whitespace collapsed.
 */
function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
    // Rule 3 — craigslist-only title+coords fallback (see file header).
    if (
      l.source === "craigslist" &&
      l.lat != null &&
      l.lon != null &&
      !isNaN(l.lat) &&
      !isNaN(l.lon)
    ) {
      const normTitle = normalizeTitle(l.address ?? "");
      if (normTitle !== "") {
        const rlat = l.lat.toFixed(3);
        const rlon = l.lon.toFixed(3);
        return `${l.source}|cltitle|${normTitle}|${l.beds}|${rlat}|${rlon}`;
      }
    }
    // Rule 4 — vague/junk address, no usable title+coords fallback:
    // unique by url, never merged.
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
