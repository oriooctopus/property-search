export interface GeoSortable {
  id: number;
  lat?: number | null;
  lon?: number | null;
}

/**
 * Reorders listings using a nearest-neighbor chain so that consecutive
 * entries are geographically close to each other. Listings with null
 * coordinates are appended at the end in their original relative order.
 *
 * Time complexity: O(n²) — acceptable for up to ~2 000 listings.
 * Distance metric: squared Euclidean on raw lat/lon (no Haversine needed
 * at city scale, and skipping sqrt saves cycles since we only compare).
 */
/**
 * @param seedLat Optional latitude to start the chain from (e.g. map center).
 *               If provided, the nearest listing to this point is the seed.
 * @param seedLon Optional longitude to start the chain from.
 */
export function geoSort<T extends GeoSortable>(listings: T[], seedLat?: number, seedLon?: number): T[] {
  if (listings.length <= 1) return listings;

  // Partition into geo-valid and null-coord listings.
  const valid: T[] = [];
  const nullCoord: T[] = [];
  for (const listing of listings) {
    if (listing.lat != null && listing.lon != null) {
      valid.push(listing);
    } else {
      nullCoord.push(listing);
    }
  }

  if (valid.length === 0) return listings;

  const visited = new Uint8Array(valid.length); // 0 = unvisited, 1 = visited
  const ordered: T[] = [];

  // Seed: if a seed point is provided, start from the nearest listing to it.
  // Otherwise start from the first valid listing.
  let currentIdx = 0;
  if (seedLat != null && seedLon != null) {
    let minDist = Infinity;
    for (let i = 0; i < valid.length; i++) {
      const dLat = (valid[i].lat as number) - seedLat;
      const dLon = (valid[i].lon as number) - seedLon;
      const d = dLat * dLat + dLon * dLon;
      if (d < minDist) { minDist = d; currentIdx = i; }
    }
  }
  visited[currentIdx] = 1;
  ordered.push(valid[currentIdx]);

  for (let step = 1; step < valid.length; step++) {
    const cur = valid[currentIdx];
    const curLat = cur.lat as number;
    const curLon = cur.lon as number;

    let nearestIdx = -1;
    let nearestDistSq = Infinity;

    for (let i = 0; i < valid.length; i++) {
      if (visited[i]) continue;
      const dLat = (valid[i].lat as number) - curLat;
      const dLon = (valid[i].lon as number) - curLon;
      const distSq = dLat * dLat + dLon * dLon;
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearestIdx = i;
      }
    }

    visited[nearestIdx] = 1;
    ordered.push(valid[nearestIdx]);
    currentIdx = nearestIdx;
  }

  // Append null-coord listings at the end, preserving their original order.
  return nullCoord.length > 0 ? ordered.concat(nullCoord) : ordered;
}
