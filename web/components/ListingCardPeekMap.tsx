'use client';

/**
 * Per-card peek mini-map overlay (Option C).
 *
 * Replaces the photo area inside a ListingCard with an inline map showing:
 *   - The listing's primary pin (blue) with a price callout
 *   - Dimmed surrounding listing pins for context
 *   - The nearest subway station dot
 *   - A "Full map" shortcut, a close button, and an address tag
 *
 * Leaflet itself is dynamically imported (only when peeked) so non-peeked
 * cards never pull the leaflet bundle.
 */

import { memo, useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { Database } from '@/lib/types';
import SUBWAY_STATIONS from '@/lib/isochrone/subway-stations';
import type { SubwayStation } from '@/lib/isochrone/types';

type Listing = Database['public']['Tables']['listings']['Row'];

const PeekMapInner = dynamic(() => import('./ListingCardPeekMapInner'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#111820',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#3d4450',
        fontSize: 11,
      }}
    >
      Loading map…
    </div>
  ),
});

interface ListingCardPeekMapProps {
  listing: Listing;
  /**
   * Sibling listings (typically the same array the parent uses to render the
   * list). The component slices this internally to a small radius so we never
   * render the entire result set inside a 260px card.
   */
  nearbyListings: Listing[];
  onClose: () => void;
  onOpenFullMap: () => void;
}

// ~111km per degree of latitude; longitude shrinks by cos(lat). For a tiny
// peek map we don't need real haversine — squared euclidean in meters is
// plenty accurate at single-block scale.
function approxMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = (lat2 - lat1) * 111_000;
  const dLon = (lon2 - lon1) * 111_000 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

const NEARBY_RADIUS_M = 500;
const NEARBY_MAX_PINS = 20;

function ListingCardPeekMap({
  listing,
  nearbyListings,
  onClose,
  onOpenFullMap,
}: ListingCardPeekMapProps) {
  const lat = listing.lat;
  const lon = listing.lon;

  // Filter nearby listings to a tight radius + cap count so the map doesn't
  // turn into pin soup at this small size. O(N) once on peek-open — acceptable.
  const nearby = useMemo(() => {
    if (lat == null || lon == null) return [];
    const out: Array<{ id: number; lat: number; lon: number; d: number }> = [];
    for (const l of nearbyListings) {
      if (l.id === listing.id) continue;
      if (l.lat == null || l.lon == null) continue;
      const d = approxMeters(lat, lon, l.lat, l.lon);
      if (d <= NEARBY_RADIUS_M) {
        out.push({ id: l.id, lat: l.lat, lon: l.lon, d });
      }
    }
    out.sort((a, b) => a.d - b.d);
    return out.slice(0, NEARBY_MAX_PINS).map(({ id, lat: la, lon: lo }) => ({
      id,
      lat: la,
      lon: lo,
    }));
  }, [lat, lon, listing.id, nearbyListings]);

  // Nearest subway station (single closest stop in NYC). Same approxMeters
  // since it's only used for ordering.
  const nearestStation: SubwayStation | null = useMemo(() => {
    if (lat == null || lon == null) return null;
    let best: SubwayStation | null = null;
    let bestD = Infinity;
    for (const s of SUBWAY_STATIONS) {
      const d = approxMeters(lat, lon, s.lat, s.lon);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }, [lat, lon]);

  // If we don't have coords, fall back to a quiet placeholder so peek state
  // can still be exited cleanly via the close button.
  if (lat == null || lon == null) {
    return (
      <div
        data-testid="card-peek-map"
        style={{
          position: 'absolute',
          inset: 0,
          background: '#111820',
          borderRadius: '12px 12px 0 0',
          zIndex: 10,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#8b949e',
          fontSize: 12,
        }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label="Close map preview"
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'rgba(13, 17, 23, 0.75)',
            border: '1px solid #2d333b',
            cursor: 'pointer',
            color: '#8b949e',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ×
        </button>
        Location unavailable
      </div>
    );
  }

  const priceLabel = `$${listing.price.toLocaleString()}/mo`;

  return (
    <div
      data-testid="card-peek-map"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        inset: 0,
        background: '#111820',
        borderRadius: '12px 12px 0 0',
        zIndex: 10,
        overflow: 'hidden',
        animation: 'cardPeekIn 180ms ease-out both',
      }}
    >
      {/* Isolate the Leaflet map's internal z-index stacking (panes use
          z-index up to 700) so our overlay chrome below — full-map button,
          close button, address tag — renders on top as expected. Without
          isolate, Leaflet's panes would bleed into the peek overlay's
          stacking context and visually cover the chrome. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          isolation: 'isolate',
        }}
      >
        <PeekMapInner
          lat={lat}
          lon={lon}
          price={listing.price}
          nearby={nearby}
          station={nearestStation}
        />
      </div>

      {/* Full map shortcut — top-left */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenFullMap();
        }}
        aria-label="Open full map centered on this listing"
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          background: 'rgba(88, 166, 255, 0.15)',
          border: '1px solid rgba(88, 166, 255, 0.4)',
          borderRadius: 8,
          padding: '5px 10px',
          fontSize: 10,
          color: '#58a6ff',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          cursor: 'pointer',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          zIndex: 11,
          letterSpacing: '0.2px',
        }}
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path
            d="M6 1C3.2 1 1 3.2 1 6c0 3.8 5 9 5 9s5-5.2 5-9c0-2.8-2.2-5-5-5zm0 7a2 2 0 110-4 2 2 0 010 4z"
            fill="#58a6ff"
          />
        </svg>
        Full map
      </button>

      {/* Close button — top-right */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close map preview"
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: 'rgba(13, 17, 23, 0.75)',
          border: '1px solid #2d333b',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          cursor: 'pointer',
          zIndex: 11,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M1 1l10 10M11 1L1 11"
            stroke="#8b949e"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {/* Address tag — bottom center */}
      <div
        style={{
          position: 'absolute',
          bottom: 10,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(13, 17, 23, 0.85)',
          border: '1px solid #2d333b',
          borderRadius: 8,
          padding: '5px 12px',
          fontSize: 11,
          color: '#e1e4e8',
          fontWeight: 500,
          whiteSpace: 'nowrap',
          maxWidth: 'calc(100% - 24px)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          zIndex: 11,
        }}
      >
        <span
          style={{
            color: '#7ee787',
            fontWeight: 700,
            fontSize: 12,
            marginRight: 6,
          }}
        >
          {priceLabel}
        </span>
        {listing.address}
      </div>
    </div>
  );
}

export default memo(ListingCardPeekMap);
