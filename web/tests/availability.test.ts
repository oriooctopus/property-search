/**
 * Unit tests for parseAvailabilityDate (lib/sources/availability.ts).
 *
 * Guards the fix for: new CL rows all landing with availability_date = ''
 * (parsed from a stale selector, then never normalized), plus a pre-existing
 * bug where availability was stored as raw, un-normalized text ("available
 * may 1") which silently fails the saved-search availability-date range
 * filter (route.ts). See also scripts/backfill-cl-availability-date.ts,
 * which shares this exact implementation for the one-off DB backfill.
 *
 * Run with: npx vitest run tests/availability.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  parseAvailabilityDate,
  extractAvailabilityFromDescription,
} from "../lib/sources/availability";

describe("parseAvailabilityDate", () => {
  it("'available now' resolves to the reference (posted) date", () => {
    expect(parseAvailabilityDate("available now", "2026-07-16")).toBe("2026-07-16");
  });

  it("'available immediately' / 'available today' / 'available asap' all resolve to the reference date", () => {
    expect(parseAvailabilityDate("available immediately", "2026-07-16")).toBe("2026-07-16");
    expect(parseAvailabilityDate("available today", "2026-07-16")).toBe("2026-07-16");
    expect(parseAvailabilityDate("2BR / 1Ba available ASAP", "2026-07-16")).toBe("2026-07-16");
  });

  it("with no reference date, 'available now' falls back to today", () => {
    const today = new Date();
    const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(parseAvailabilityDate("available now")).toBe(expected);
  });

  it("'available may 1' resolves to the next May 1st on/after the reference date", () => {
    // Reference is before May 1 in the same year → same year.
    expect(parseAvailabilityDate("available may 1", "2026-03-01")).toBe("2026-05-01");
    // Reference is after May 1 in the same year → rolls to next year.
    expect(parseAvailabilityDate("available may 1", "2026-07-16")).toBe("2027-05-01");
  });

  it("bare 'jun 15' (no 'available' prefix) parses the same way", () => {
    expect(parseAvailabilityDate("jun 15", "2026-01-01")).toBe("2026-06-15");
  });

  it("full month name 'available september 3' parses correctly", () => {
    expect(parseAvailabilityDate("available september 3", "2026-01-01")).toBe("2026-09-03");
  });

  it("month/day exactly on the reference date counts as 'not yet passed' (same year)", () => {
    expect(parseAvailabilityDate("available jul 16", "2026-07-16")).toBe("2026-07-16");
  });

  it("ISO input passes through unchanged", () => {
    expect(parseAvailabilityDate("2026-08-01", "2026-01-01")).toBe("2026-08-01");
  });

  it("an invalid ISO calendar date (e.g. Feb 30) returns null", () => {
    expect(parseAvailabilityDate("2026-02-30", "2026-01-01")).toBeNull();
  });

  it("an invalid month/day (e.g. Feb 30 spelled out) returns null", () => {
    expect(parseAvailabilityDate("available feb 30", "2026-01-01")).toBeNull();
  });

  it("garbage text returns null, not empty string", () => {
    expect(parseAvailabilityDate("call for details")).toBeNull();
    expect(parseAvailabilityDate("contact today before it's gone!")).toBeNull();
  });

  it("null, undefined, and empty string all return null", () => {
    expect(parseAvailabilityDate(null)).toBeNull();
    expect(parseAvailabilityDate(undefined)).toBeNull();
    expect(parseAvailabilityDate("")).toBeNull();
    expect(parseAvailabilityDate("   ")).toBeNull();
  });

  it("an invalid reference date falls back to today rather than throwing", () => {
    expect(() => parseAvailabilityDate("available now", "not-a-date")).not.toThrow();
  });
});

describe("extractAvailabilityFromDescription", () => {
  // Real phrasings sampled live from 10 craigslist listing descriptions
  // whose availability_date was NULL in the DB (Apify diagnostic runs
  // NKiDtjqyAN2B0gA8a et al.) — see the file header for how this mines a
  // fallback signal the structured .attrgroup field doesn't carry.

  it("'*Available 8/1' (m/d numeric) resolves against the reference year, not misled by an earlier unrelated 'ASAP'", () => {
    const text = "*Inquire for video ASAP\n*Available 8/1\n\n*FIRST COME FIRST SERVE";
    expect(extractAvailabilityFromDescription(text, "2026-07-01")).toBe("2026-08-01");
  });

  it("'August 1st MOVE-IN' (month + ordinal day, date BEFORE the anchor word)", () => {
    const text = "August 1st MOVE-IN\n\nBrand new 4 bed 2 bath in PRIME Williamsburg!";
    expect(extractAvailabilityFromDescription(text, "2026-07-01")).toBe("2026-08-01");
  });

  it("'available September 1st' (month + ordinal day, date AFTER the anchor word)", () => {
    expect(
      extractAvailabilityFromDescription("Apartment available September 1st, great location", "2026-07-01"),
    ).toBe("2026-09-01");
  });

  it("'avail 9/1' (abbreviated anchor + numeric m/d)", () => {
    expect(extractAvailabilityFromDescription("avail 9/1, contact for details", "2026-07-01")).toBe(
      "2026-09-01",
    );
  });

  it("'move in Aug 15' (move-in anchor, abbreviated month + day)", () => {
    expect(extractAvailabilityFromDescription("move in Aug 15, guarantors welcome", "2026-07-01")).toBe(
      "2026-08-15",
    );
  });

  it("'September 1 move-in' (date before a hyphenated move-in anchor)", () => {
    expect(extractAvailabilityFromDescription("September 1 move-in, hurry!", "2026-07-01")).toBe(
      "2026-09-01",
    );
  });

  it("month with NO day ('available in September') defaults to the 1st, not null", () => {
    expect(
      extractAvailabilityFromDescription("Available in September for the right tenant", "2026-07-01"),
    ).toBe("2026-09-01");
  });

  it("a bare 'avail' with no nearby date returns null, not a guess ('available in PRIME Ridgewood')", () => {
    const text = "Gorgeous 2 Bed in Luxury Amenity rich building, available in PRIME Ridgewood!";
    expect(extractAvailabilityFromDescription(text, "2026-07-01")).toBeNull();
  });

  it("prose with no availability-context anchor at all returns null", () => {
    const text = "This apartment is located in the very desirable neighborhood of WILLIAMSBURG";
    expect(extractAvailabilityFromDescription(text, "2026-07-01")).toBeNull();
  });

  it("bare 'today' with no 'avail'/'move-in' anchor is NOT misread as availability ('Contact me today before it's gone!')", () => {
    const text = "Contact me today before it's gone!\nMike B. 831-585-0112";
    expect(extractAvailabilityFromDescription(text, "2026-07-01")).toBeNull();
  });

  it("an unrelated number near 'avail' is not misread as a date ('avail parking spots' near a build year)", () => {
    const text = "Built in 1990, this classic building has avail parking spots";
    expect(extractAvailabilityFromDescription(text, "2026-07-01")).toBeNull();
  });

  it("'moving sale' (moving-adjacent but not a move-in date) with no date returns null", () => {
    expect(extractAvailabilityFromDescription("moving sale everything must go", "2026-07-01")).toBeNull();
  });

  it("null/undefined/empty text all return null", () => {
    expect(extractAvailabilityFromDescription(null)).toBeNull();
    expect(extractAvailabilityFromDescription(undefined)).toBeNull();
    expect(extractAvailabilityFromDescription("")).toBeNull();
  });
});
