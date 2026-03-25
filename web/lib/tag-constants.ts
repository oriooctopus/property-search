/** Shared tag metadata used by both Filters and ListingCard */

export const TAG_COLORS: Record<string, string> = {
  fulton: '#f97316',
  ltrain: '#a78bfa',
  manhattan: '#38bdf8',
  brooklyn: '#4ade80',
};

export const TAG_LABELS: Record<string, string> = {
  fulton: 'Fulton St',
  ltrain: 'L Train',
  manhattan: 'Manhattan',
  brooklyn: 'Brooklyn',
};

export const TAG_DESCRIPTIONS: Record<string, string> = {
  fulton: 'Listings within a 25-minute subway/bus ride of Fulton St station in Lower Manhattan',
  ltrain: 'Listings within a 10-minute walk of L train stops from Bedford Ave through DeKalb Ave',
  manhattan: 'Manhattan listings between Park Place (Tribeca) and 38th St (Midtown), covering Downtown, SoHo, the Village, Chelsea, and the Flatiron area',
  brooklyn: 'Brooklyn listings within a 35-minute subway ride of 14th St (any stop between 8th Ave and 1st Ave)',
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
 * Bounding boxes for each search area.
 * Used by assignSearchTag() to geo-fence listings into the correct tab.
 * Order matters — first match wins (fulton/ltrain are subsets of manhattan).
 */
const TAG_GEO_BOUNDS: { tag: string; bounds: GeoBounds }[] = [
  {
    // Fulton St: Lower Manhattan — FiDi, Tribeca, Chinatown, LES
    tag: 'fulton',
    bounds: { latMin: 40.700, latMax: 40.725, lonMin: -74.02, lonMax: -73.975 },
  },
  {
    // L Train corridor: Bedford Ave through DeKalb Ave
    tag: 'ltrain',
    bounds: { latMin: 40.685, latMax: 40.730, lonMin: -73.99, lonMax: -73.940 },
  },
  {
    // Manhattan: Park Place (Tribeca) to 38th St (Midtown)
    tag: 'manhattan',
    bounds: { latMin: 40.700, latMax: 40.760, lonMin: -74.02, lonMax: -73.960 },
  },
  {
    // Brooklyn: within 35-min subway of 14th St
    tag: 'brooklyn',
    bounds: { latMin: 40.630, latMax: 40.700, lonMin: -74.01, lonMax: -73.900 },
  },
];

/** Neighborhood keywords → tag mapping for listings without geo. */
const NEIGHBORHOOD_TAGS: Record<string, string> = {
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
  'fidi': 'fulton',
  'financial district': 'fulton',
  'lower east side': 'fulton',
  'chinatown': 'fulton',
  'bushwick': 'brooklyn',
  'bed stuy': 'brooklyn',
  'bed-stuy': 'brooklyn',
  'bedford stuyvesant': 'brooklyn',
  'crown heights': 'brooklyn',
  'clinton hill': 'brooklyn',
  'fort greene': 'brooklyn',
  'prospect heights': 'brooklyn',
  'park slope': 'brooklyn',
  'williamsburg': 'ltrain',
  'greenpoint': 'ltrain',
  'ridgewood': 'brooklyn',
  'stuyvesant heights': 'brooklyn',
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
