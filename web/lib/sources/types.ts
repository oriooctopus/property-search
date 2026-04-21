/**
 * Shared types for all listing data sources.
 */

export type ListingSource = "streeteasy" | "craigslist" | "facebook-marketplace";

/** The shape every source adapter must produce. */
export interface RawListing {
  address: string;
  area: string;
  price: number;
  beds: number;
  baths: number;
  sqft: number | null;
  lat: number;
  lon: number;
  photos: number;
  photo_urls: string[];
  url: string;
  list_date: string | null;
  last_update_date: string | null;
  availability_date: string | null;
  source: ListingSource;
  year_built?: number | null;
  /** Stable per-source identifier, e.g. StreetEasy numeric id, CL post id, FB ad id. */
  external_id?: string | null;
  /** All sources this listing was found on (populated after composite dedup). */
  sources?: ListingSource[];
  /** URL per source (populated after composite dedup). */
  source_urls?: Record<string, string>;
}

export interface SearchParams {
  city: string;
  stateCode: string;
  bedsMin?: number;
  bathsMin?: number;
  priceMax?: number;
  priceMin?: number;
}

// ---------------------------------------------------------------------------
// Adapter pipeline types
// ---------------------------------------------------------------------------

/**
 * What each source adapter returns. Nullable fields mean "I don't know".
 * The pipeline converts these into ValidatedListing (with backwards-compat defaults).
 */
export interface AdapterOutput {
  address: string | null;
  area: string | null;
  price: number | null;
  beds: number | null; // null = unknown, 0 = studio
  baths: number | null; // null = unknown
  sqft: number | null;
  lat: number | null;
  lon: number | null;
  photo_urls: string[];
  url: string;
  list_date: string | null;
  last_update_date: string | null;
  availability_date: string | null;
  source: ListingSource;
  year_built?: number | null;
  /** Stable per-source identifier; null if the source has no stable ID. */
  external_id?: string | null;
}

/** How confident we are in a field's value. */
export type FieldConfidence = "api" | "parsed" | "missing";

/** Per-field confidence tracking attached to each validated listing. */
export interface DataQuality {
  beds: FieldConfidence;
  baths: FieldConfidence;
  price: FieldConfidence;
  geo: FieldConfidence;
  photos: FieldConfidence;
}

/** A validated listing with quality metadata. Extends RawListing for backwards compat. */
export interface ValidatedListing extends RawListing {
  quality: DataQuality;
}

/** All known sources currently ingested by the pipeline. */
export const ALL_SOURCES: readonly ListingSource[] = [
  "streeteasy",
  "craigslist",
  // "facebook-marketplace", // disabled to save Apify costs — re-enable when needed
] as const;

/** Sources that extract data from text rather than structured API fields. */
export const SCRAPER_SOURCES: ReadonlySet<ListingSource> = new Set([
  "craigslist",
  // "facebook-marketplace", // disabled to save Apify costs — re-enable when needed
]);
