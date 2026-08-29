// CARTO's raster basemap tiles now require an API key (free non-commercial tier);
// without one the tiles render a diagonal "API KEY REQUIRED" watermark.
//
// This key is a CLIENT-SIDE key by design — it appears in every tile URL the
// browser requests, so it is public regardless of where it's stored. It is
// registered against the domains dwelligence.vercel.app and localhost only.
// The canonical copy is CARTO_BASEMAPS_API_KEY in ~/.claude/tokens.env.
//
// Intentionally a literal, not process.env.NEXT_PUBLIC_*: these are client
// components and there is currently no way to set a NEXT_PUBLIC_ var on the
// Vercel project (its API token is expired), so an env lookup would silently
// resolve to undefined in production and reinstate the watermark.
const CARTO_BASEMAPS_API_KEY = 'cb1_2jjq_1_5d51d098395b4a84ff5f7580';

export const BASEMAP_TILE_URL = `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${CARTO_BASEMAPS_API_KEY}`;

// CARTO's free-tier condition: keep both CARTO and OpenStreetMap attribution
// visible on any map using these tiles.
export const BASEMAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>';
