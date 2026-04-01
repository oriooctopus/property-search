/** Shared tag metadata used by both Filters and ListingCard */

export const TAG_COLORS: Record<string, string> = {
  manhattan: '#38bdf8',
  brooklyn: '#4ade80',
};

export const TAG_LABELS: Record<string, string> = {
  manhattan: 'Manhattan',
  brooklyn: 'Brooklyn',
};

export const TAG_DESCRIPTIONS: Record<string, string> = {
  manhattan: 'Manhattan rentals below 140th Street',
  brooklyn: 'Brooklyn rentals',
};

// ---------------------------------------------------------------------------
// Geographic bounds for each search tag
// ---------------------------------------------------------------------------

interface GeoBounds {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

/**
 * Single wide geo-fence: everything below 140th St in Manhattan + Brooklyn.
 * No micro-buckets — all filtering is client-side.
 * 140th St ≈ lat 40.816
 */
const TAG_GEO_BOUNDS: { tag: string; bounds: GeoBounds }[] = [
  {
    // Manhattan: everything below 140th St
    tag: 'manhattan',
    bounds: { latMin: 40.700, latMax: 40.816, lonMin: -74.02, lonMax: -73.900 },
  },
  {
    // Brooklyn: broad coverage
    tag: 'brooklyn',
    bounds: { latMin: 40.570, latMax: 40.700, lonMin: -74.05, lonMax: -73.850 },
  },
];

/** Neighborhood keywords → tag mapping for listings without geo coordinates. */
const NEIGHBORHOOD_TAGS: Record<string, string> = {
  // Manhattan neighborhoods
  'west village': 'manhattan',
  'east village': 'manhattan',
  'greenwich': 'manhattan',
  'soho': 'manhattan',
  'noho': 'manhattan',
  'nolita': 'manhattan',
  'tribeca': 'manhattan',
  'chelsea': 'manhattan',
  'flatiron': 'manhattan',
  'gramercy': 'manhattan',
  'financial district': 'manhattan',
  'fidi': 'manhattan',
  'lower east side': 'manhattan',
  'chinatown': 'manhattan',
  'upper west side': 'manhattan',
  'uws': 'manhattan',
  "hell's kitchen": 'manhattan',
  'hells kitchen': 'manhattan',
  'lincoln square': 'manhattan',
  'midtown': 'manhattan',
  'murray hill': 'manhattan',
  'kips bay': 'manhattan',
  'harlem': 'manhattan',
  'morningside heights': 'manhattan',
  'manhattan valley': 'manhattan',
  'new york, new york': 'manhattan',
  // Brooklyn neighborhoods
  'williamsburg': 'brooklyn',
  'greenpoint': 'brooklyn',
  'bushwick': 'brooklyn',
  'bed stuy': 'brooklyn',
  'bed-stuy': 'brooklyn',
  'bedford stuyvesant': 'brooklyn',
  'crown heights': 'brooklyn',
  'clinton hill': 'brooklyn',
  'fort greene': 'brooklyn',
  'prospect heights': 'brooklyn',
  'park slope': 'brooklyn',
  'ridgewood': 'brooklyn',
  'stuyvesant heights': 'brooklyn',
  'cobble hill': 'brooklyn',
  'boerum hill': 'brooklyn',
  'carroll gardens': 'brooklyn',
  'dumbo': 'brooklyn',
  'downtown brooklyn': 'brooklyn',
  'brooklyn heights': 'brooklyn',
  'brooklyn, new york': 'brooklyn',
};

/**
 * Assign a search tag based on geographic coordinates or neighborhood name.
 * Returns null if the listing doesn't fit any filter area.
 */
export function assignSearchTag(
  lat: number,
  lon: number,
  area: string,
): string | null {
  // Try geo bounds first (most reliable)
  if (lat !== 0 && lon !== 0 && !isNaN(lat) && !isNaN(lon)) {
    for (const { tag, bounds } of TAG_GEO_BOUNDS) {
      if (
        lat >= bounds.latMin &&
        lat <= bounds.latMax &&
        lon >= bounds.lonMin &&
        lon <= bounds.lonMax
      ) {
        return tag;
      }
    }
    // Has geo but outside all bounds — doesn't fit any tab
    return null;
  }

  // No geo — try neighborhood keyword matching
  const areaLower = area.toLowerCase();
  for (const [keyword, tag] of Object.entries(NEIGHBORHOOD_TAGS)) {
    if (areaLower.includes(keyword)) return tag;
  }

  return null;
}
