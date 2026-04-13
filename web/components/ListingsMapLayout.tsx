'use client';

import { useState } from 'react';
import type React from 'react';
import Map from '@/components/Map';
import { SegmentedControl } from '@/components/ui';
import type { Database } from '@/lib/types';
import type { ViewportBounds } from '@/components/MapInner';
import type { CommuteInfo } from '@/components/ListingCard';

type Listing = Database['public']['Tables']['listings']['Row'];

export interface ListingsMapLayoutProps {
  listings: Listing[];
  selectedId: number | null;
  onSelectId: (id: number | null) => void;
  /** Render function for custom header above the cards (filter pills, wishlist header, etc.) */
  header?: React.ReactNode;
  /** Additional content after listing cards */
  footer?: React.ReactNode;
  /** Map props passthrough */
  mapProps?: {
    onBoundsChange?: (bounds: ViewportBounds) => void;
    onMapMove?: (center: { lat: number; lng: number }, zoom: number) => void;
    suppressBoundsRef?: React.MutableRefObject<boolean>;
    initialCenter?: [number, number];
    initialZoom?: number;
    commuteInfoMap?: Map<number, CommuteInfo>;
    onToggleFavorite?: (id: number) => void;
  };
  /** Render function for each listing card — allows customization */
  renderCard: (listing: Listing, isSelected: boolean) => React.ReactNode;
  /** Overlay to render above everything (map overlay buttons, etc.) */
  mapOverlay?: React.ReactNode;
  /** Set of favorited/wishlisted listing IDs for map markers */
  favoritedIds: Set<number>;
  /** Handler for hide on map popup */
  onHideListing: (id: number) => void;
  /** Callback when detail is selected from map popup */
  onSelectDetail?: (listing: Listing) => void;
}

export default function ListingsMapLayout({
  listings,
  selectedId,
  onSelectId,
  header,
  footer,
  mapProps,
  renderCard,
  mapOverlay,
  favoritedIds,
  onHideListing,
  onSelectDetail,
}: ListingsMapLayoutProps) {
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list');

  const viewToggle = (
    <SegmentedControl
      value={mobileView}
      onChange={(v) => setMobileView(v as 'list' | 'map')}
      options={[
        {
          value: 'list',
          label: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
            </svg>
          ),
        },
        {
          value: 'map',
          label: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          ),
        },
      ]}
    />
  );

  return (
    <div
      className="flex flex-col lg:flex-row"
      style={{ height: 'calc(100dvh - 60px - env(safe-area-inset-top))' }}
    >
      {/* Cards panel */}
      <div
        className={`w-full lg:w-[420px] xl:w-[480px] shrink-0 flex flex-col overflow-hidden ${mobileView === 'map' ? 'max-lg:hidden' : ''}`}
        style={{ borderRight: '1px solid #2d333b' }}
      >
        {header}

        {/* Mobile view toggle — visible only below lg breakpoint */}
        <div
          className="flex items-center justify-end px-3 py-1 lg:hidden"
          style={{ borderBottom: '1px solid #2d333b', flexShrink: 0 }}
        >
          {viewToggle}
        </div>

        {/* Scrollable card list */}
        <div className="flex-1 overflow-y-auto dark-scrollbar min-h-0 px-3 py-3 flex flex-col gap-3">
          {listings.map((listing) => renderCard(listing, selectedId === listing.id))}
        </div>

        {footer}
      </div>

      {/* Map panel */}
      <div
        className={`flex-1 relative ${mobileView === 'list' ? 'hidden lg:block' : 'block'}`}
      >
        <Map
          listings={listings}
          selectedId={selectedId}
          onMarkerClick={(id) => onSelectId(id === selectedId ? null : id)}
          onSelectDetail={onSelectDetail ?? (() => {})}
          favoritedIds={favoritedIds}
          wouldLiveIds={new Set()}
          onToggleFavorite={mapProps?.onToggleFavorite ?? (() => {})}
          onToggleWouldLive={() => {}}
          onHideListing={onHideListing}
          onBoundsChange={mapProps?.onBoundsChange}
          onMapMove={mapProps?.onMapMove}
          suppressBoundsRef={mapProps?.suppressBoundsRef}
          initialCenter={mapProps?.initialCenter}
          initialZoom={mapProps?.initialZoom}
          commuteInfoMap={mapProps?.commuteInfoMap}
          visible={true}
        />
        {mapOverlay}
      </div>
    </div>
  );
}
