/**
 * Centralized row-shape construction for the `listings` table.
 *
 * Phase B of INGEST-PROPOSAL.md: every upsert path (refresh-sources,
 * refresh-se-daily, future ingest.ts) builds rows through THIS function so
 * schema additions become a compile error in one place instead of silent
 * drift across three scripts.
 */

import type { ValidatedListing } from "./types";
import type { Database } from "../types";

/**
 * Hand-maintained `listings` Insert type.
 *
 * NOTE: the project's `lib/types.ts` does not yet declare the `sources`
 * (jsonb array) and `source_urls` (jsonb object) columns even though both
 * existing scripts write to them. We extend the Insert type with those two
 * optional jsonb columns so callers stay type-safe AND we keep current
 * behavior (composite dedup populates them, scalar `source` stays as the
 * primary).
 */
export type ListingRow = Database["public"]["Tables"]["listings"]["Insert"] & {
  sources?: string[];
  source_urls?: Record<string, string>;
  external_id?: string | null;
  last_seen_at?: string | null;
  delisted_at?: string | null;
};

export function toListingRow(v: ValidatedListing): ListingRow {
  return {
    address: v.address,
    area: v.area,
    price: v.price,
    beds: v.beds,
    baths: v.baths,
    sqft: v.sqft ?? null,
    lat: v.lat,
    lon: v.lon,
    // Unify on photo_urls.length — refresh-sources.ts already did this;
    // refresh-se-daily.ts was writing v.photos which always equals
    // photo_urls.length for SE so this is a no-op for that script.
    photos: v.photo_urls.length,
    photo_urls: v.photo_urls,
    url: v.url,
    list_date: v.list_date ?? null,
    last_update_date: v.last_update_date ?? null,
    availability_date: v.availability_date ?? null,
    source: v.source,
    year_built: v.year_built ?? null,
    sources: v.sources ?? [v.source],
    source_urls: v.source_urls ?? { [v.source]: v.url },
    external_id: v.external_id ?? null,
    // Every successful upsert bumps last_seen_at automatically. The upsert
    // phase uses a column-explicit UPDATE SET list that preserves delisted_at
    // (and created_at) so resurrecting a verified-delisted row via upsert is
    // impossible.
    last_seen_at: new Date().toISOString(),
    // Intentionally NOT setting delisted_at here — upsertListings excludes
    // it from the UPDATE SET list so existing delisted rows stay delisted.
  } satisfies ListingRow;
}
