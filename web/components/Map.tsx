'use client';

import dynamic from 'next/dynamic';
import { memo } from 'react';
import type React from 'react';
import type { Database } from '@/lib/types';
import type { ViewportBounds } from './MapInner';
import type { CommuteInfo } from './ListingCard';
import type { HoveredStation } from './SwipeCard';

type Listing = Database['public']['Tables']['listings']['Row'];

const MapInner = dynamic(() => import('./MapInner'), {
  ssr: false,
  loading: () => (
    <div
      className="flex items-center justify-center h-full w-full"
      style={{ backgroundColor: '#0f1117', color: '#8b949e' }}
    >
      Loading map...
    </div>
  ),
});

interface MapProps {
  listings: Listing[];
  selectedId: number | null;
  onMarkerClick: (id: number) => void;
  onSelectDetail: (listing: Listing) => void;
  favoritedIds: Set<number>;
  wouldLiveIds?: Set<number>;
  onToggleFavorite?: (id: number) => void;
  onToggleWouldLive?: (id: number) => void;
  onHideListing: (id: number) => void;
  onBoundsChange?: (bounds: ViewportBounds) => void;
  onMapMove?: (center: { lat: number; lng: number }, zoom: number) => void;
  suppressBoundsRef?: React.MutableRefObject<boolean>;
  isPanningRef?: React.MutableRefObject<boolean>;
  initialCenter?: [number, number];
  initialZoom?: number;
  visible?: boolean;
  commuteInfoMap?: Map<number, CommuteInfo>;
  hoveredStation?: HoveredStation | null;
  autoShiftActivePinMobile?: boolean;
  getMobileCardBounds?: () => DOMRect | null;
}

// Memoized so parent re-renders (e.g. view-switches on mobile) don't force
// the Leaflet tree to re-run its own render cycle. Stable callback references
// from the parent are required for the memo to be effective.
function Map({ listings, selectedId, onMarkerClick, onSelectDetail, favoritedIds, wouldLiveIds, onToggleFavorite, onToggleWouldLive, onHideListing, onBoundsChange, onMapMove, suppressBoundsRef, isPanningRef, initialCenter, initialZoom, visible, commuteInfoMap, hoveredStation, autoShiftActivePinMobile, getMobileCardBounds }: MapProps) {
  return (
    <MapInner
      listings={listings}
      selectedId={selectedId}
      onMarkerClick={onMarkerClick}
      onSelectDetail={onSelectDetail}
      favoritedIds={favoritedIds}
      wouldLiveIds={wouldLiveIds ?? EMPTY_SET}
      onToggleFavorite={onToggleFavorite ?? NOOP}
      onToggleWouldLive={onToggleWouldLive ?? NOOP}
      onHideListing={onHideListing}
      onBoundsChange={onBoundsChange}
      onMapMove={onMapMove}
      suppressBoundsRef={suppressBoundsRef}
      isPanningRef={isPanningRef}
      initialCenter={initialCenter}
      initialZoom={initialZoom}
      visible={visible}
      commuteInfoMap={commuteInfoMap}
      hoveredStation={hoveredStation ?? null}
      autoShiftActivePinMobile={autoShiftActivePinMobile}
      getMobileCardBounds={getMobileCardBounds}
    />
  );
}

// Stable sentinels for optional props — using `new Set()` / `() => {}` inline
// would break React.memo's shallow equality on MapInner by creating a new
// reference on every render, forcing a cascade of expensive re-renders in
// Leaflet's children (which render markers for ~2000 listings).
const EMPTY_SET: Set<number> = new Set();
const NOOP = () => {};

export default memo(Map);
