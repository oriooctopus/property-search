/**
 * Shared parsing utilities for source adapters.
 *
 * Consolidates duplicated bed/bath/price extraction logic that was
 * previously scattered across craigslist.ts, renthop.ts, and
 * facebook-marketplace.ts.
 */

// ---------------------------------------------------------------------------
// Beds extraction
// ---------------------------------------------------------------------------

const WORD_NUMS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  studio: 0,
};

/**
 * Extract bedroom count from free text (title, description, housing span).
 *
 * Matches patterns like: "3BR", "3 br", "3 bed", "3 bedrooms", "three bedroom",
 * "studio", and the slash pattern "5BR/2BA".
 *
 * Returns `null` if no pattern matches (unknown), `0` for studios.
 */
export function extractBeds(text: string): number | null {
  if (!text) return null;
  const t = text.toLowerCase();

  // Numeric: "3br", "3 br", "3bed", "3 bed", "3 bedroom(s)", "3 beds"
  const numMatch = t.match(/(\d+)\s*(?:br|bed(?:room)?s?)\b/);
  if (numMatch) return parseInt(numMatch[1], 10);

  // Slash pattern: "5BR/2BA" — extract the beds portion
  const slashMatch = t.match(/(\d+)\s*br\s*\/\s*\d+\s*ba/i);
  if (slashMatch) return parseInt(slashMatch[1], 10);

  // Word-number: "three bedroom", "one br"
  for (const [word, num] of Object.entries(WORD_NUMS)) {
    if (t.includes(`${word} bed`) || t.includes(`${word} br`)) return num;
  }

  // "studio" standalone
  if (/\bstudio\b/.test(t)) return 0;

  return null;
}

// ---------------------------------------------------------------------------
// Baths extraction
// ---------------------------------------------------------------------------

/**
 * Extract bathroom count from free text.
 *
 * Matches patterns like: "2ba", "2 bath", "2 bathroom(s)", "2.5 bath",
 * "1 bth", and the slash pattern "5BR/2BA".
 *
 * Returns `null` if no pattern matches (unknown).
 */
export function extractBaths(text: string): number | null {
  if (!text) return null;
  const t = text.toLowerCase();

  // Slash pattern: "5BR/2BA" — extract the baths portion
  const slashMatch = t.match(/\d+\s*br\s*\/\s*(\d+(?:\.\d+)?)\s*ba/i);
  if (slashMatch) return parseFloat(slashMatch[1]);

  // General: "2ba", "2 bath", "2 bathroom(s)", "2.5 bath", "1 bth"
  const numMatch = t.match(/(\d+(?:\.\d+)?)\s*(?:ba(?:th(?:room)?s?)?|bth)\b/);
  if (numMatch) return parseFloat(numMatch[1]);

  return null;
}

// ---------------------------------------------------------------------------
// Price parsing
// ---------------------------------------------------------------------------

/**
 * Parse a price value from various formats into a number.
 *
 * Handles: number, "$3,500/mo", "3500", null, undefined.
 * Returns `null` for unparseable or zero/negative values.
 */
export function parsePrice(
  value: string | number | null | undefined,
): number | null {
  if (value == null) return null;
  if (typeof value === "number") return value > 0 ? Math.round(value) : null;
  const cleaned = value.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const num = parseFloat(cleaned);
  return num > 0 ? Math.round(num) : null;
}

// ---------------------------------------------------------------------------
// Photo URL extraction
// ---------------------------------------------------------------------------

/**
 * Extract photo URLs from a heterogeneous array (strings, objects with
 * url/href fields). Filters empty strings and duplicates.
 */
export function extractPhotoUrls(
  raw: unknown[],
  limit: number = 10,
): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const item of raw) {
    let url: string | undefined;
    if (typeof item === "string") {
      url = item;
    } else if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      url =
        (typeof obj.url === "string" ? obj.url : undefined) ??
        (typeof obj.href === "string" ? obj.href : undefined) ??
        (typeof obj.src === "string" ? obj.src : undefined);
    }
    if (url && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
      if (urls.length >= limit) break;
    }
  }

  return urls;
}

