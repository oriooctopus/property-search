'use client';

import dynamic from 'next/dynamic';
import type { Database } from '@/lib/types';

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
}

export default function Map({ listings, selectedId, onMarkerClick, onSelectDetail, favoritedIds, wouldLiveIds, onToggleFavorite, onToggleWouldLive, onHideListing }: MapProps) {
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
    />
  );
}
