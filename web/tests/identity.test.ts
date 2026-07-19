/**
 * Unit tests for apartmentIdentityKey's craigslist title+coords fallback
 * (lib/sources/identity.ts, rule 3).
 *
 * Root cause: CL reposts an apartment under a brand new, address-less URL
 * (title only, no street address), so the pre-existing rules (which all key
 * on a real street address) fell through to "unique by url, never merge" —
 * every repost became a permanent duplicate. User-reported case: the same
 * "⚡🔥WILLIAMSBURG 3 Bed/2 Bath DUPLEX🔥⚡ GREAT DEAL!!!" listing appeared 3x
 * in the app and in the user's wishlist.
 *
 * Fixtures below are REAL row shapes pulled live from the DB (Supabase CLI
 * against the linked project) while diagnosing this bug — not synthesized.
 *
 * Run with: npx vitest run tests/identity.test.ts
 */

import { describe, it, expect } from "vitest";
import { apartmentIdentityKey, type IdentityInput } from "../lib/sources/identity";

describe("apartmentIdentityKey — craigslist title+coords fallback", () => {
  it("the confirmed 3-row WILLIAMSBURG DUPLEX cluster all collapse to ONE key, despite differing price and url", () => {
    // Real rows: ids 347348 ($5600), 347383 ($5700), 347233 ($5700) — all
    // address="⚡🔥WILLIAMSBURG 3 Bed/2 Bath DUPLEX🔥⚡ GREAT DEAL!!!",
    // beds=3, lat=40.7075, lon=-73.9498, identical list_date (same batch).
    const base: Omit<IdentityInput, "url" | "price"> = {
      address: "⚡🔥WILLIAMSBURG 3 Bed/2 Bath DUPLEX🔥⚡ GREAT DEAL!!!",
      beds: 3,
      source: "craigslist",
      lat: 40.7075,
      lon: -73.9498,
    };
    const rows: IdentityInput[] = [
      { ...base, price: 5600, url: "https://www.craigslist.org/view/d/brooklyn-sun-drenched-loft-d-in-unit/ciBLbPVwFgoYFDeJ1tHHei" },
      { ...base, price: 5700, url: "https://www.craigslist.org/view/d/brooklyn-williamsburg-bed-bath-duplex/kaGQgNWVbwrfmbfXQ1UmXQ" },
      { ...base, price: 5700, url: "https://www.craigslist.org/view/d/brooklyn-williamsburg-bed-bath-duplex/tvUZyXBkHJ5yma6bfLEuTg" },
    ];
    const keys = rows.map(apartmentIdentityKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe("craigslist|cltitle|williamsburg 3 bed 2 bath duplex great deal|3|40.708|-73.950");
  });

  it("a cluster with coordinates that DRIFT slightly between reposts (rounds to the same ~110m bucket) still merges", () => {
    // Real rows: ids 347103 (lat 40.68...), 351651 — the "Monroe Street"
    // cluster, prices $7100 vs $7200 across reposts.
    const a = apartmentIdentityKey({
      address: "Monroe Street, Brooklyn, NY",
      beds: 4,
      price: 7200,
      url: "https://newyork.craigslist.org/brk/apa/7947117365.html",
      source: "craigslist",
      lat: 40.6842,
      lon: -73.9589,
    });
    const b = apartmentIdentityKey({
      address: "Monroe Street, Brooklyn, NY",
      beds: 4,
      price: 7100,
      url: "https://www.craigslist.org/view/d/brooklyn-immaculate-bed-bath-in-unit-d/5j4hc6bAYyypYMGPyjYVeT",
      source: "craigslist",
      lat: 40.6838,
      lon: -73.9591,
    });
    expect(a).toBe(b);
  });

  it("does NOT merge two genuinely different listings that happen to share a beds count and rough neighborhood", () => {
    const a = apartmentIdentityKey({
      address: "Starr, Brooklyn, NY",
      beds: 3,
      price: 3650,
      url: "https://www.craigslist.org/view/d/a/1",
      source: "craigslist",
      lat: 40.702,
      lon: -73.926,
    });
    const b = apartmentIdentityKey({
      address: "starr, Brooklyn, NY", // different real listing, same street name, different block
      beds: 3,
      price: 4150,
      url: "https://www.craigslist.org/view/d/b/2",
      source: "craigslist",
      lat: 40.707,
      lon: -73.92,
    });
    expect(a).not.toBe(b);
  });

  it("does NOT apply to other sources, even with an identical vague address+coords shape (precision-over-recall preserved)", () => {
    const key = apartmentIdentityKey({
      address: "☀️🔥WILLIAMSBURG LOFTED DUPLEX🔥☀️ 3 bed/2 bath! A STEAL!!!",
      beds: 3,
      price: 5500,
      url: "https://streeteasy.com/rental/12345",
      source: "streeteasy",
      lat: 40.7074,
      lon: -73.9499,
    });
    // Falls through to rule 4 (url-only) for non-craigslist sources.
    expect(key).toBe("streeteasy|url|https://streeteasy.com/rental/12345");
  });

  it("falls back to url-only when lat/lon are missing, even for craigslist", () => {
    const key = apartmentIdentityKey({
      address: "⚡🔥WILLIAMSBURG 3 Bed/2 Bath DUPLEX🔥⚡ GREAT DEAL!!!",
      beds: 3,
      price: 5600,
      url: "https://www.craigslist.org/view/d/x/1",
      source: "craigslist",
      lat: null,
      lon: null,
    });
    expect(key).toBe("craigslist|url|https://www.craigslist.org/view/d/x/1");
  });

  it("title normalization ignores emoji/punctuation variance between reposts", () => {
    const a = apartmentIdentityKey({
      address: "⚡️🔥WILLIAMSBURG 3 Bed/2 Bath DUPLEX🔥⚡️ GREAT DEAL!!!",
      beds: 3,
      price: 5700,
      url: "https://www.craigslist.org/view/d/x/1",
      source: "craigslist",
      lat: 40.7075,
      lon: -73.9498,
    });
    const b = apartmentIdentityKey({
      address: "WILLIAMSBURG 3 BED/2 BATH DUPLEX - GREAT DEAL",
      beds: 3,
      price: 5700,
      url: "https://www.craigslist.org/view/d/x/2",
      source: "craigslist",
      lat: 40.7076,
      lon: -73.9497,
    });
    expect(a).toBe(b);
  });

  it("a normal street-address craigslist listing still uses the existing address-based rules (rule 3 never fires)", () => {
    const key = apartmentIdentityKey({
      address: "64 Stagg St #4F, Brooklyn, NY",
      beds: 3,
      price: 5500,
      url: "https://www.craigslist.org/view/d/x/1",
      source: "craigslist",
      lat: 40.709092,
      lon: -73.947746,
    });
    expect(key).toBe("craigslist|unit|64 stagg st 4f brooklyn ny|3");
  });
});
