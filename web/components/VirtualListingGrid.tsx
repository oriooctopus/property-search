'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Database } from '@/lib/types';
import ListingCard, { type CommuteInfo } from '@/components/ListingCard';

type Listing = Database['public']['Tables']['listings']['Row'];

export interface VirtualListingGridHandle {
  scrollToListing: (id: number) => void;
  getScrollElement: () => HTMLDivElement | null;
}

interface VirtualListingGridProps {
  listings: Listing[];
  selectedId: number | null;
  wishlistedIds: Set<number>;
  hidingId: number | null;
  commuteInfoMap?: globalThis.Map<number, CommuteInfo> | null;
  onCardSelect: (id: number) => void;
  onStarClick: (listingId: number, anchorRect: DOMRect) => void;
  onExpand: (listing: Listing) => void;
  onHide: (id: number) => void;
  // Footer messages — rendered below the virtualized list
  commuteMessage?: string | null;
  commuteLoading?: boolean;
  // Visual loading state for the grid (opacity dim during filter changes)
  isDimmed?: boolean;
  // Hide grid (e.g. map view on mobile) — still needs to render for ref availability
  hiddenOnMobile?: boolean;
  // Suppress the "No listings" empty-state (when an outer loader is showing)
  suppressEmptyState?: boolean;
}

const BREAKPOINT_TWO_COL = 640; // Tailwind `sm:`
const BREAKPOINT_ONE_COL_LG = 1024; // Tailwind `lg:` — back to single column
const ESTIMATED_ROW_HEIGHT = 580;
const OVERSCAN = 6;

function getColumnCount(width: number): number {
  // Matches Tailwind classes: grid-cols-1 sm:grid-cols-2 lg:grid-cols-1
  if (width >= BREAKPOINT_ONE_COL_LG) return 1;
  if (width >= BREAKPOINT_TWO_COL) return 2;
  return 1;
}

const VirtualListingGrid = forwardRef<VirtualListingGridHandle, VirtualListingGridProps>(
  function VirtualListingGrid(
    {
      listings,
      selectedId,
      wishlistedIds,
      hidingId,
      commuteInfoMap,
      onCardSelect,
      onStarClick,
      onExpand,
      onHide,
      commuteMessage,
      commuteLoading,
      isDimmed,
      hiddenOnMobile,
      suppressEmptyState,
    },
    ref,
  ) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [cols, setCols] = useState<number>(1);

    // Track container width → column count (preserves the sm: 2-col breakpoint).
    useLayoutEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      const measure = () => {
        const width = el.getBoundingClientRect().width;
        const next = getColumnCount(width);
        setCols((prev) => (prev === next ? prev : next));
      };
      measure();
      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    // Split listings into virtual "rows" of `cols` cards each.
    const rowCount = Math.ceil(listings.length / cols);

    const virtualizer = useVirtualizer({
      count: rowCount,
      getScrollElement: () => scrollRef.current,
      estimateSize: () => ESTIMATED_ROW_HEIGHT,
      overscan: OVERSCAN,
      // Re-key when cols changes so cache gets reset at the breakpoint
      getItemKey: (index) => `${cols}-${index}`,
    });

    // When listing set or column count changes, invalidate measurements so
    // height cache isn't stale for a different slice of listings.
    useEffect(() => {
      virtualizer.measure();
    }, [listings, cols, virtualizer]);

    const scrollToListing = useCallback(
      (id: number) => {
        const idx = listings.findIndex((l) => l.id === id);
        if (idx < 0) return;
        const rowIndex = Math.floor(idx / cols);
        virtualizer.scrollToIndex(rowIndex, { align: 'center', behavior: 'smooth' });
      },
      [listings, cols, virtualizer],
    );

    useImperativeHandle(
      ref,
      () => ({
        scrollToListing,
        getScrollElement: () => scrollRef.current,
      }),
      [scrollToListing],
    );

    const virtualItems = virtualizer.getVirtualItems();
    const totalSize = virtualizer.getTotalSize();

    // Grid layout inside each virtual row
    const rowGridStyle = useMemo<React.CSSProperties>(
      () => ({
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gap: 12,
        paddingBottom: 12,
      }),
      [cols],
    );

    return (
      <div
        ref={scrollRef}
        className={`flex-1 overflow-y-auto dark-scrollbar min-h-0 relative z-0 ${hiddenOnMobile ? 'hidden lg:block' : 'block'}`}
        style={{
          opacity: isDimmed ? 0.35 : 1,
          transition: 'opacity 150ms',
        }}
      >
        {/* Horizontal padding wrapper — matches the previous px-3 py-3 */}
        <div style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 12 }}>
          {listings.length === 0 ? null : (
            <div
              style={{
                height: totalSize,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualItems.map((virtualRow) => {
                const rowIndex = virtualRow.index;
                const startIdx = rowIndex * cols;
                const rowListings = listings.slice(startIdx, startIdx + cols);
                return (
                  <div
                    key={virtualRow.key}
                    data-index={rowIndex}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                      ...rowGridStyle,
                    }}
                  >
                    {rowListings.map((listing) => (
                      <ListingCard
                        key={listing.id}
                        listing={listing}
                        isSelected={listing.id === selectedId}
                        isFavorited={wishlistedIds.has(listing.id)}
                        isHiding={hidingId === listing.id}
                        commuteInfo={commuteInfoMap?.get(listing.id)}
                        onClick={onCardSelect}
                        onStarClick={onStarClick}
                        onExpand={onExpand}
                        onHide={onHide}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* Footers / empty states — match previous behavior */}
          {commuteMessage && !commuteLoading && (
            <div className="text-center py-4 text-xs" style={{ color: '#f0883e' }}>
              {commuteMessage}
            </div>
          )}
          {listings.length === 0 && !suppressEmptyState && (
            <div
              className="flex items-center justify-center min-h-[200px] text-center text-sm"
              style={{ color: '#8b949e' }}
            >
              No listings match your filters.
            </div>
          )}
        </div>
      </div>
    );
  },
);

export default VirtualListingGrid;
