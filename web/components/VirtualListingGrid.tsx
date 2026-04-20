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

// Hysteresis (dead zone) around breakpoints to prevent scrollbar-toggle
// feedback loops. The container width can oscillate by ~15px as a vertical
// scrollbar appears/disappears; if the breakpoint sits inside that oscillation
// range, the column count flips every frame and the grid flickers at ~20Hz.
// Dead zones: 620..660 around the 640 breakpoint, 1004..1044 around 1024.
const HYSTERESIS = 20;

function getColumnCount(width: number, prevCols: number): number {
  // Matches Tailwind classes: grid-cols-1 sm:grid-cols-2 lg:grid-cols-1.
  // We use different thresholds depending on the current column count so
  // a narrow oscillation near a breakpoint doesn't flip us back and forth.
  if (prevCols === 1) {
    // To switch UP to 2-col we need to be comfortably past BREAKPOINT_TWO_COL.
    // To switch UP to 1-col (at lg) we need to be past BREAKPOINT_ONE_COL_LG.
    if (width >= BREAKPOINT_ONE_COL_LG + HYSTERESIS) return 1;
    if (width >= BREAKPOINT_TWO_COL + HYSTERESIS) return 2;
    return 1;
  }
  // prevCols === 2: to switch DOWN we need to be comfortably below the breakpoint.
  if (width >= BREAKPOINT_ONE_COL_LG - HYSTERESIS) return 1;
  if (width >= BREAKPOINT_TWO_COL - HYSTERESIS) return 2;
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
    const colsRef = useRef(1);
    useEffect(() => {
      colsRef.current = cols;
    }, [cols]);

    // Track container width → column count (preserves the sm: 2-col breakpoint).
    // rAF-coalesced + hysteresis to prevent scrollbar-toggle feedback loops.
    useLayoutEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      let rafId: number | null = null;
      const measure = () => {
        rafId = null;
        const width = el.getBoundingClientRect().width;
        const next = getColumnCount(width, colsRef.current);
        setCols((prev) => (prev === next ? prev : next));
      };
      const schedule = () => {
        if (rafId !== null) return;
        rafId = requestAnimationFrame(measure);
      };
      // Initial measure is synchronous so the first paint uses the right cols.
      const width = el.getBoundingClientRect().width;
      const initial = getColumnCount(width, colsRef.current);
      if (initial !== colsRef.current) setCols(initial);
      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(schedule);
      ro.observe(el);
      return () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        ro.disconnect();
      };
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
          // Reserve the scrollbar gutter so the container width doesn't
          // oscillate when the scrollbar appears/disappears. Without this,
          // the ResizeObserver above can feedback-loop at ~20Hz near
          // breakpoints (scrollbar on → narrower → 1 col → shorter content →
          // scrollbar off → wider → 2 col → taller content → scrollbar on …).
          scrollbarGutter: 'stable',
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
