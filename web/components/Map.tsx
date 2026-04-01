'use client';

'use client';

import dynamic from 'next/dynamic';
import type React from 'react';
import type { Database } from '@/lib/types';
import type { ViewportBounds } from './MapInner';
import type { CommuteInfo } from './ListingCard';

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
  wouldLiveIds: Set<number>;
  onToggleFavorite: (id: number) => void;
  onToggleWouldLive: (id: number) => void;
  onHideListing: (id: number) => void;
  onBoundsChange?: (bounds: ViewportBounds) => void;
  onMapMove?: (center: { lat: number; lng: number }, zoom: number) => void;
  suppressBoundsRef?: React.MutableRefObject<boolean>;
  initialCenter?: [number, number];
  initialZoom?: number;
  visible?: boolean;
  commuteInfoMap?: Map<number, CommuteInfo>;
}

export default function Map({ listings, selectedId, onMarkerClick, onSelectDetail, favoritedIds, wouldLiveIds, onToggleFavorite, onToggleWouldLive, onHideListing, onBoundsChange, onMapMove, suppressBoundsRef, initialCenter, initialZoom, visible, commuteInfoMap }: MapProps) {
  return (
    <MapInner
      listings={listings}
      selectedId={selectedId}
      onMarkerClick={onMarkerClick}
      onSelectDetail={onSelectDetail}
      favoritedIds={favoritedIds}
      wouldLiveIds={wouldLiveIds}
      onToggleFavorite={onToggleFavorite}
      onToggleWouldLive={onToggleWouldLive}
      onHideListing={onHideListing}
      onBoundsChange={onBoundsChange}
      onMapMove={onMapMove}
      suppressBoundsRef={suppressBoundsRef}
      initialCenter={initialCenter}
      initialZoom={initialZoom}
      visible={visible}
      commuteInfoMap={commuteInfoMap}
    />
  );
}
