'use client';

import {
  forwardRef,
  memo,
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
  /**
   * Listings to render in a separate "Removed" section below the active ones.
   * When provided (and non-empty), the grid renders:
   *   [active rows] [section header row] [removed rows]
   * Removed cards are visually deprioritized inside <ListingCard> via the
   * `isRemoved` prop. Pass an empty array (or omit) to skip the section.
   * Used by wishlist views so users can still see saved listings whose
   * `delisted_at` is set.
   */
  removedListings?: Listing[];
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
  /**
   * Extra classes to apply to the grid's root scroll container. Primarily used
   * by the parent to toggle visibility (e.g. `max-lg:hidden` when the mobile
   * view is showing the map). Kept as a free-form className rather than a
   * boolean prop so the grid's heavy inner markup stays behind React.memo —
   * a boolean prop that flips on every view switch would defeat the memo.
   */
  containerClassName?: string;
  // Suppress the "No listings" empty-state (when an outer loader is showing)
  suppressEmptyState?: boolean;
  // ---- Infinite scroll ----
  // Whether more pages are available from the server.
  hasMore?: boolean;
  // Whether a "load more" request is currently in flight (drives the
  // bottom-of-list spinner and suppresses duplicate triggers).
  isLoadingMore?: boolean;
  // Called when the user scrolls near the end of the currently-loaded list.
  // Parent handles debounce/guards; the grid may still invoke this more than
  // once per page so the parent must be re-entrant-safe.
  onLoadMore?: () => void;
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

// Row-plan describes a single virtualizer row. Mixing card rows with a
// section-header "Removed" row keeps everything inside one virtualizer so
// scrolling, height measurement, and infinite-scroll guards stay simple.
type RowDescriptor =
  | { kind: 'cards'; section: 'active' | 'removed'; listings: Listing[] }
  | { kind: 'removed-header'; count: number };

const VirtualListingGrid = forwardRef<VirtualListingGridHandle, VirtualListingGridProps>(
  function VirtualListingGrid(
    {
      listings,
      removedListings,
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
      containerClassName,
      suppressEmptyState,
      hasMore,
      isLoadingMore,
      onLoadMore,
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

    // Build the row plan: active card rows, then (if any removed listings) a
    // section header row, then removed card rows. The header row participates
    // in the virtualizer so its height is measured naturally; we just give it
    // a smaller estimate so the initial size is reasonable.
    //
    // `removed` is wrapped in useMemo so its identity only changes when the
    // caller passes a new array — keeps the row-plan and measure effects
    // stable across unrelated parent re-renders.
    const removed = useMemo<Listing[]>(() => removedListings ?? [], [removedListings]);
    const rowPlan = useMemo<RowDescriptor[]>(() => {
      const rows: RowDescriptor[] = [];
      for (let i = 0; i < listings.length; i += cols) {
        rows.push({ kind: 'cards', section: 'active', listings: listings.slice(i, i + cols) });
      }
      if (removed.length > 0) {
        rows.push({ kind: 'removed-header', count: removed.length });
        for (let i = 0; i < removed.length; i += cols) {
          rows.push({ kind: 'cards', section: 'removed', listings: removed.slice(i, i + cols) });
        }
      }
      return rows;
    }, [listings, removed, cols]);
    const rowCount = rowPlan.length;
    // Used by the infinite-scroll trigger: only the *active* tail should
    // request more pages. Once we're inside the removed section the user has
    // already paged past the active list.
    const lastActiveRowIndex = useMemo(() => {
      let idx = -1;
      for (let i = 0; i < rowPlan.length; i++) {
        if (rowPlan[i].kind === 'cards' && (rowPlan[i] as { section: 'active' | 'removed' }).section === 'active') {
          idx = i;
        }
      }
      return idx;
    }, [rowPlan]);

    const virtualizer = useVirtualizer({
      count: rowCount,
      getScrollElement: () => scrollRef.current,
      estimateSize: (index) =>
        rowPlan[index]?.kind === 'removed-header' ? 64 : ESTIMATED_ROW_HEIGHT,
      overscan: OVERSCAN,
      // Re-key when cols changes so cache gets reset at the breakpoint
      getItemKey: (index) => `${cols}-${index}`,
    });

    // When listing set or column count changes, invalidate measurements so
    // height cache isn't stale for a different slice of listings.
    useEffect(() => {
      virtualizer.measure();
    }, [listings, removed, cols, virtualizer]);

    const scrollToListing = useCallback(
      (id: number) => {
        // Search the row plan directly so we can scroll to either an active
        // or a removed listing transparently.
        for (let rowIdx = 0; rowIdx < rowPlan.length; rowIdx++) {
          const row = rowPlan[rowIdx];
          if (row.kind !== 'cards') continue;
          if (row.listings.some((l) => l.id === id)) {
            virtualizer.scrollToIndex(rowIdx, { align: 'center', behavior: 'smooth' });
            return;
          }
        }
      },
      [rowPlan, virtualizer],
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

    // ---- Infinite scroll trigger -------------------------------------------
    //
    // Fire onLoadMore when the user scrolls within LOAD_MORE_ROW_THRESHOLD
    // rows of the end of the currently-loaded data. The virtualizer re-renders
    // on every scroll tick so this effect fires often; the parent is expected
    // to guard against overlapping requests (via an in-flight ref).
    //
    // We deliberately key off the last *virtual* row index rather than a
    // sentinel element at the bottom — the latter is always mounted in
    // react-virtual's DOM but would add an extra measured row to the
    // virtualizer's row-height cache.
    //
    // The 1.5-row threshold keeps the next page in flight before the user
    // can reach the end of the current page at typical scroll speeds.
    // -------------------------------------------------------------------------
    const LOAD_MORE_ROW_THRESHOLD = 4;
    const onLoadMoreRef = useRef(onLoadMore);
    onLoadMoreRef.current = onLoadMore;
    useEffect(() => {
      if (!hasMore || isLoadingMore || !onLoadMoreRef.current) return;
      // If client-side filters (e.g. "hide listing") removed *every* row from
      // the current page, the virtualizer has nothing to key off — pull the
      // next page so the grid doesn't look empty when the server still has
      // matches upstream.
      if (rowCount === 0) {
        onLoadMoreRef.current();
        return;
      }
      const lastItem = virtualItems[virtualItems.length - 1];
      if (!lastItem) return;
      // Trigger load-more relative to the end of the *active* section. The
      // removed section comes after it in the row plan but represents already
      // saved-by-user listings, not server-paginated results.
      const triggerIndex = lastActiveRowIndex >= 0 ? lastActiveRowIndex : rowCount - 1;
      if (lastItem.index >= triggerIndex - LOAD_MORE_ROW_THRESHOLD) {
        onLoadMoreRef.current();
      }
      // virtualItems array identity changes on every scroll tick, which is
      // what drives this effect. rowCount/hasMore/isLoadingMore gate it.
    }, [virtualItems, rowCount, lastActiveRowIndex, hasMore, isLoadingMore]);

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
        className={`flex-1 overflow-y-auto dark-scrollbar min-h-0 relative z-0 block ${containerClassName ?? ''}`}
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
          {rowCount === 0 ? null : (
            <div
              style={{
                height: totalSize,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualItems.map((virtualRow) => {
                const rowIndex = virtualRow.index;
                const row = rowPlan[rowIndex];
                if (!row) return null;
                if (row.kind === 'removed-header') {
                  return (
                    <div
                      key={virtualRow.key}
                      data-index={rowIndex}
                      data-testid="removed-section-header"
                      ref={virtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                        paddingTop: 16,
                        paddingBottom: 12,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          color: '#8b949e',
                          fontSize: 12,
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                        }}
                      >
                        <span>Removed ({row.count})</span>
                        <span
                          style={{
                            flex: 1,
                            height: 1,
                            background: '#2d333b',
                          }}
                        />
                      </div>
                      <div
                        style={{
                          marginTop: 6,
                          color: '#6b7280',
                          fontSize: 11,
                          fontWeight: 400,
                          textTransform: 'none',
                          letterSpacing: 0,
                        }}
                      >
                        These listings have been taken down by the source.
                      </div>
                    </div>
                  );
                }
                const isRemovedRow = row.section === 'removed';
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
                    {row.listings.map((listing) => (
                      <ListingCard
                        key={listing.id}
                        listing={listing}
                        isSelected={listing.id === selectedId}
                        isFavorited={wishlistedIds.has(listing.id)}
                        isHiding={hidingId === listing.id}
                        isRemoved={isRemovedRow}
                        commuteInfo={commuteInfoMap?.get(listing.id)}
                        priority={rowIndex === 0}
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
          {/* Infinite-scroll bottom indicator. Sits below the virtualized
              list so it doesn't pollute the virtualizer's row height cache. */}
          {rowCount > 0 && (hasMore || isLoadingMore) && (
            <div
              className="text-center py-4 text-xs"
              style={{ color: '#6b7280' }}
              aria-live="polite"
              data-testid="infinite-scroll-sentinel"
            >
              {isLoadingMore ? 'Loading more listings…' : ''}
            </div>
          )}
          {commuteMessage && !commuteLoading && (
            <div className="text-center py-4 text-xs" style={{ color: '#f0883e' }}>
              {commuteMessage}
            </div>
          )}
          {rowCount === 0 && !suppressEmptyState && (
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

// Wrap in React.memo so that unrelated parent re-renders (e.g. toggling
// between list/map views on mobile, opening a modal, etc.) don't force the
// virtualized grid to re-evaluate its heavy JSX tree. Default memo's shallow
// prop equality is sufficient here — every prop is a primitive, a stable
// useCallback, or an identity-stable state reference on the parent.
export default memo(VirtualListingGrid);
