/**
 * Shared types for all listing data sources.
 */

export type ListingSource = "realtor" | "apartments" | "craigslist" | "renthop";

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
  search_tag: string;
  list_date: string | null;
  last_update_date: string | null;
  availability_date: string | null;
  source: ListingSource;
}

export interface SearchParams {
  city: string;
  stateCode: string;
  bedsMin?: number;
  bathsMin?: number;
  priceMax?: number;
  priceMin?: number;
}
