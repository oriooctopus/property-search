import type { Database } from "@/lib/types";

type Listing = Database["public"]["Tables"]["listings"]["Row"];
type Filters = Record<string, unknown>;

/**
 * Check whether a listing matches the saved search filters.
 *
 * Supported filter keys:
 *  - selectedBeds: listing.beds must be in the array (7 means 7+)
 *  - maxPerBed:    price/beds  <= maxPerBed
 *  - maxRent:      listing.price <= maxRent
 *  - searchTags:   listing.search_tag must be in the array
 */
export function listingMatchesFilters(
  listing: Listing,
  filters: Filters,
): boolean {
  if (typeof filters !== "object" || filters === null) return true;

  const { selectedBeds, maxPerBed, maxRent, searchTags } = filters as {
    selectedBeds?: number[];
    maxPerBed?: number;
    maxRent?: number;
    searchTags?: string[];
  };

  if (selectedBeds !== undefined && Array.isArray(selectedBeds) && selectedBeds.length > 0) {
    const match = selectedBeds.includes(7) && listing.beds >= 7
      ? true
      : selectedBeds.includes(listing.beds);
    if (!match) return false;
  }

  if (maxPerBed !== undefined && listing.beds > 0) {
    if (listing.price / listing.beds > maxPerBed) return false;
  }

  if (maxRent !== undefined && listing.price > maxRent) return false;

  if (searchTags !== undefined && Array.isArray(searchTags) && searchTags.length > 0) {
    if (!searchTags.includes(listing.search_tag)) return false;
  }

  return true;
}
