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
  /** Long-form listing description / "About" copy. See AdapterOutput.description. */
  description?: string | null;
  /** FACE / GROSS monthly rent. See AdapterOutput.gross_price. */
  gross_price?: number | null;
  /** Concession-adjusted monthly rent. See AdapterOutput.net_effective_price. */
  net_effective_price?: number | null;
  /** Months free in the promotion. See AdapterOutput.concession_months_free. */
  concession_months_free?: number | null;
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
  /**
   * Long-form listing description / "About" copy. Currently captured from
   * Craigslist post body and (future) StreetEasy detail page HTML. May be
   * null for sources where the search response doesn't include it.
   */
  description?: string | null;
  /**
   * FACE / GROSS monthly rent — the headline number a landlord advertises.
   * Equal to `price` for sources without concessions. Kept distinct so
   * `price` can later be re-defined as "what to filter on" if we choose.
   */
  gross_price?: number | null;
  /**
   * Concession-adjusted monthly rent, e.g. $4,000 face → $3,667 with 1 mo
   * free on a 12-mo lease. Null when there's no promotion.
   */
  net_effective_price?: number | null;
  /**
   * Number of months free included in the promotion (can be fractional, e.g.
   * 0.5 for "two weeks free"). Null when there's no promotion.
   */
  concession_months_free?: number | null;
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
  // "craigslist", // disabled 2026-05-02 to cut Apify residential-proxy spend; re-enable when budget allows
  // "facebook-marketplace", // disabled to save Apify costs — re-enable when needed
] as const;

/** Sources that extract data from text rather than structured API fields. */
export const SCRAPER_SOURCES: ReadonlySet<ListingSource> = new Set([
  // "craigslist", // disabled 2026-05-02 (see above)
  // "facebook-marketplace", // disabled to save Apify costs — re-enable when needed
]);
