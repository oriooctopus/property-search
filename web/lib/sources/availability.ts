/**
 * Parses Craigslist's raw availability text into an ISO YYYY-MM-DD date, or
 * null when genuinely unparseable/absent.
 *
 * Two entry points:
 *   - parseAvailabilityDate: the structured `.attrgroup` field's text
 *     ("available now", "available aug 1").
 *   - extractAvailabilityFromDescription: a fallback that mines the same
 *     signal out of free-form listing prose, for posts where the structured
 *     field is absent but the date is stated in the description.
 *
 * Shared by the craigslist adapter (lib/sources/craigslist.ts) and the
 * one-off backfill script (scripts/backfill-cl-availability-date.ts) so
 * there is exactly one implementation of this parsing logic.
 *
 * Post-redesign, CL's detail page carries this in a `.attrgroup .attr` span,
 * e.g. "available now" or "available aug 1" (confirmed via a live diagnostic
 * dump against 3 real /view/d/ URLs — see the comment in
 * DETAIL_PAGE_FUNCTION). Pre-redesign rows in the DB may still carry older
 * raw text in the same shape.
 *
 * IMPORTANT: returns null for "no date info", NEVER ''. The saved-search
 * availability-date range filter (route.ts) drops both '' and null when
 * includeNaAvailableDate is false, but '' silently looks like "we checked
 * and there's no date" when it actually means "we never parsed this field" —
 * null is the honest signal for the latter, and is what every caller must
 * write going forward.
 */

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const MONTH_NAME_PATTERN =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun[e]?|jul[y]?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const MONTH_DAY_RE = new RegExp(`\\b(${MONTH_NAME_PATTERN})\\.?\\s+(\\d{1,2})\\b`, "i");
const NOW_RE = /\b(now|immediately|today|asap)\b/i;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Strip time-of-day for clean date-only comparisons. */
function dateOnly(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Parses a reference-date string as a LOCAL calendar date, not UTC. Plain
 * `new Date("2026-07-16")` parses that as UTC midnight, which — in any
 * timezone behind UTC — becomes the previous day once read back via local
 * getters (dateOnly() above uses local getters). Listing timestamps
 * (list_date) are typically full ISO datetimes with a timezone offset, for
 * which plain `new Date(...)` is correct and unambiguous — only the bare
 * YYYY-MM-DD form needs this special-cased local-date construction.
 */
function parseReferenceDateString(s: string): Date {
  const dateOnlyMatch = s.match(ISO_RE);
  if (dateOnlyMatch) {
    const [, y, m, d] = dateOnlyMatch;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  return new Date(s);
}

/** Resolves a caller-supplied reference date (or today) to a date-only Date. */
function resolveRefDay(referenceDate?: string | Date | null): Date {
  const refCandidate = referenceDate
    ? referenceDate instanceof Date
      ? referenceDate
      : parseReferenceDateString(referenceDate)
    : null;
  const ref = refCandidate && !isNaN(refCandidate.getTime()) ? refCandidate : new Date();
  return dateOnly(ref);
}

/**
 * Resolves a (monthIdx, day) pair to the "next occurrence" ISO date at or
 * after refDay — the shared year-inference rule used by both
 * parseAvailabilityDate and extractAvailabilityFromDescription. Returns null
 * for a non-real calendar day (e.g. Feb 30).
 */
function resolveMonthDayToIso(monthIdx: number, day: number, refDay: Date): string | null {
  if (day < 1 || day > 31) return null;
  let year = refDay.getFullYear();
  let candidate = new Date(year, monthIdx, day);
  if (candidate.getMonth() !== monthIdx || candidate.getDate() !== day) {
    return null; // not a real calendar day
  }
  if (candidate < refDay) {
    year += 1;
    candidate = new Date(year, monthIdx, day);
  }
  return toIsoDate(candidate);
}

/**
 * @param raw Raw availability text scraped from CL (e.g. "available now",
 *   "available aug 1"), an already-ISO string, or null/undefined/empty.
 * @param referenceDate The listing's posted date (list_date), used as the
 *   anchor for "now" and for resolving the year of month-day text ("next
 *   occurrence of that date"). Defaults to today when absent/invalid.
 */
export function parseAvailabilityDate(
  raw: string | null | undefined,
  referenceDate?: string | Date | null,
): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  // Already ISO — validate it's a real calendar date, pass through
  // unchanged. (Guards against e.g. a stray "2026-02-30".)
  const isoMatch = trimmed.match(ISO_RE);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const parsed = new Date(Number(y), Number(m) - 1, Number(d));
    const isReal =
      parsed.getFullYear() === Number(y) &&
      parsed.getMonth() === Number(m) - 1 &&
      parsed.getDate() === Number(d);
    return isReal ? trimmed : null;
  }

  const refDay = resolveRefDay(referenceDate);
  const lower = trimmed.toLowerCase();

  // "available now" / "available immediately" / "available today" /
  // "available asap" → the listing's posted date (or today if absent).
  // Require "avail" in the text so unrelated marketing copy containing bare
  // "today"/"now" (e.g. "Contact today before it's gone!") isn't
  // misread as an availability date.
  if (/avail/i.test(lower) && NOW_RE.test(lower)) {
    return toIsoDate(refDay);
  }

  // "available <month> <day>" (also matches bare "<month> <day>" with no
  // "available" prefix, e.g. "jun 15").
  const monthDayMatch = lower.match(MONTH_DAY_RE);
  if (monthDayMatch) {
    const monthKey = monthDayMatch[1].replace(/\.$/, "");
    const day = Number(monthDayMatch[2]);
    const monthIdx = MONTHS[monthKey];
    if (monthIdx != null) {
      const iso = resolveMonthDayToIso(monthIdx, day, refDay);
      if (iso) return iso;
    }
  }

  // Anything else (garbage, unrecognized phrasing) — genuinely unparseable.
  return null;
}

// ---------------------------------------------------------------------------
// extractAvailabilityFromDescription — mines free-form listing prose
// ---------------------------------------------------------------------------
//
// Many CL posts state availability ONLY in the prose, not the structured
// .attrgroup field (confirmed via a live diagnostic dump of 10 real
// /view/d/ listing descriptions with null availability_date: e.g.
// "*Available 8/1", "August 1st MOVE-IN" — patterns parseAvailabilityDate
// alone never sees, because it's only fed the structured field's text).
//
// Used as a FALLBACK when the structured field is absent — never as a
// replacement, since the structured field (when present) is unambiguous and
// this is regex-over-prose, inherently riskier.

const AVAIL_CONTEXT_RE = /avail(?:able)?|move[- ]?in|moving/gi;
// A window (chars) searched around each context anchor for a date pattern —
// wide enough to catch "*Available 8/1" and "August 1st MOVE-IN" (date
// before OR after the anchor word), narrow enough to avoid picking up an
// unrelated date elsewhere in a long description (lease terms, building age,
// a phone number, etc).
const AVAIL_WINDOW = 40;
const NUMERIC_MD_RE = /\b(\d{1,2})\/(\d{1,2})\b/;
// Day is OPTIONAL here (unlike MONTH_DAY_RE above) — "available in
// September" with no day is a deliberately supported case, see below.
const MONTH_OPTIONAL_DAY_RE = new RegExp(
  `\\b(${MONTH_NAME_PATTERN})\\.?\\s*(?:(\\d{1,2})(?:st|nd|rd|th)?)?\\b`,
  "i",
);

/**
 * @param text Free-form listing description/post body.
 * @param referenceDate The listing's posted date, same role as in
 *   parseAvailabilityDate.
 */
export function extractAvailabilityFromDescription(
  text: string | null | undefined,
  referenceDate?: string | Date | null,
): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  const refDay = resolveRefDay(referenceDate);

  AVAIL_CONTEXT_RE.lastIndex = 0;
  let anchor: RegExpExecArray | null;
  while ((anchor = AVAIL_CONTEXT_RE.exec(lower)) !== null) {
    const start = Math.max(0, anchor.index - AVAIL_WINDOW);
    const end = Math.min(lower.length, anchor.index + anchor[0].length + AVAIL_WINDOW);
    const windowText = lower.slice(start, end);

    // Check the SPECIFIC date patterns before the vague "now" family — a
    // wide-ish window can accidentally straddle an unrelated "ASAP"/"today"
    // from a different sentence (e.g. "Inquire for video ASAP\n*Available
    // 8/1"), which would otherwise win over the actual, more informative
    // "8/1" sitting right next to the anchor.
    const numMatch = windowText.match(NUMERIC_MD_RE);
    if (numMatch) {
      const month = Number(numMatch[1]);
      const day = Number(numMatch[2]);
      if (month >= 1 && month <= 12) {
        const iso = resolveMonthDayToIso(month - 1, day, refDay);
        if (iso) return iso;
      }
    }

    const monthMatch = windowText.match(MONTH_OPTIONAL_DAY_RE);
    if (monthMatch) {
      const monthKey = monthMatch[1].replace(/\.$/, "");
      const monthIdx = MONTHS[monthKey];
      // No day captured ("available in September") → deliberately default
      // to the 1st, rather than returning null on an otherwise-clear month
      // signal.
      const day = monthMatch[2] ? Number(monthMatch[2]) : 1;
      if (monthIdx != null) {
        const iso = resolveMonthDayToIso(monthIdx, day, refDay);
        if (iso) return iso;
      }
    }

    if (NOW_RE.test(windowText)) {
      return toIsoDate(refDay);
    }
  }

  // No date-like pattern found near any availability-context anchor (or no
  // anchor at all) — genuinely absent, not a guess.
  return null;
}
