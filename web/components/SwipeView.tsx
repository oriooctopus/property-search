'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import { PrimaryButton } from '@/components/ui';
import SwipeCard, { type HoveredStation, getClosestStations } from './SwipeCard';
import type { ViewportBounds } from './MapInner';
import type { CommuteInfo } from './ListingCard';
import type { Database } from '@/lib/types';
import { useWishlists, useWishlistMutations } from '@/lib/hooks/useWishlists';
import { getLastUsedWishlistId, setLastUsedWishlistId } from '@/lib/wishlist-storage';
import { geoSort } from '@/lib/geo-sort';
import WishlistPicker from './WishlistPicker';

// Dynamically import MapComponent to avoid SSR issues (uses Leaflet)
const MapComponent = dynamic(() => import('./Map'), { ssr: false });
const MiniMap = dynamic(() => import('./MiniMapInner'), { ssr: false });

export interface SwipeListing {
  id: number;
  address: string;
  area: string;
  price: number;
  beds: number;
  baths: number | null;
  sqft: number | null;
  photo_urls: string[];
  source: string;
  url: string;
  list_date: string | null;
  lat?: number | null;
  lon?: number | null;
  transit_summary?: string | null;
  year_built?: number | null;
  [key: string]: unknown;
}

export interface SwipeViewProps {
  listings: SwipeListing[];
  userId: string | null;
  onHideListing: (id: number) => void;
  onUnhideListing?: (id: number) => void;
  onExpandDetail?: (listing: SwipeListing) => void;
  onSwitchView?: () => void;
  // Map props passthrough
  onBoundsChange?: (bounds: ViewportBounds) => void;
  onMapMove?: (center: { lat: number; lng: number }, zoom: number) => void;
  suppressBoundsRef?: React.MutableRefObject<boolean>;
  initialCenter?: [number, number];
  initialZoom?: number;
  commuteInfoMap?: Map<number, CommuteInfo>;
  onLoginRequired?: () => void;
  showHidden?: boolean;
  isLoading?: boolean;
  wishlistedIds?: Set<number>;
}

interface UndoEntry {
  index: number;
  listingId: number;
  action: 'left' | 'right' | 'down';
  wishlistId?: string;  // which wishlist was used for right-swipe
}

function SwipeActionButton({ buttonRef, onClick, tooltip, children }: {
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  onClick: () => void;
  tooltip: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative group">
      <button
        ref={buttonRef}
        onClick={onClick}
        className="flex items-center justify-center rounded-full border transition-all active:scale-95 active:bg-white/15 cursor-pointer"
        style={{ width: 38, height: 38, borderColor: '#3d444d', color: '#8b949e', background: 'transparent' }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(88,166,255,0.12)'; e.currentTarget.style.borderColor = '#58a6ff'; e.currentTarget.style.color = '#58a6ff'; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderColor = '#3d444d'; e.currentTarget.style.color = '#8b949e'; }}
      >
        {children}
      </button>
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" style={{ zIndex: 100 }}>
        <div style={{ backgroundColor: '#1c2028', border: '1px solid #2d333b', color: '#e1e4e8', fontSize: 12, padding: '3px 8px', borderRadius: 6, whiteSpace: 'nowrap' }}>
          {tooltip}
        </div>
      </div>
    </div>
  );
}

export default function SwipeView({
  listings,
  userId,
  onHideListing,
  onUnhideListing,
  onExpandDetail,
  onSwitchView,
  onBoundsChange,
  onMapMove,
  suppressBoundsRef,
  initialCenter,
  initialZoom,
  commuteInfoMap,
  onLoginRequired,
  showHidden,
  isLoading,
  wishlistedIds,
}: SwipeViewProps) {
  // Don't persist swipedIds across refreshes — start fresh each session.
  // The localStorage was causing "You've seen all listings" on every refresh.
  const [swipedIds, setSwipedIds] = useState<Set<number>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [wishlistDropdownOpen, setWishlistDropdownOpen] = useState(false);
  const [hoveredStation, setHoveredStation] = useState<HoveredStation | null>(null);
  const [showMobileMap, setShowMobileMap] = useState(false);
  const [swipeOverlay, setSwipeOverlay] = useState<'left' | 'right' | 'down' | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const saveAnchorRef = useRef<HTMLDivElement>(null);
  const hideBtnRef = useRef<HTMLButtonElement>(null);
  const laterBtnRef = useRef<HTMLButtonElement>(null);
  const saveBtnRef = useRef<HTMLButtonElement>(null);
  const photoBtnRef = useRef<HTMLButtonElement>(null);

  // Flash a button for 500ms to show keyboard activation
  const flashButton = useCallback((ref: React.RefObject<HTMLButtonElement | null>) => {
    const el = ref.current;
    if (!el) return;
    el.style.backgroundColor = 'rgba(88,166,255,0.2)';
    el.style.transform = 'scale(0.95)';
    setTimeout(() => {
      el.style.backgroundColor = '';
      el.style.transform = '';
    }, 500);
  }, []);

  // Track whether the card's photo carousel has keyboard focus
  const photoFocusedRef = useRef(false);
  const enterPhotoFocusRef = useRef<(() => void) | null>(null);
  const exitPhotoFocusRef = useRef<(() => void) | null>(null);
  const mapCenterRef = useRef<{ lat: number; lng: number } | null>(
    initialCenter ? { lat: initialCenter[0], lng: initialCenter[1] } : null
  );

  // After undo, track which listing id needs its index restored once deck recomputes
  const pendingUndoId = useRef<number | null>(null);

  // Wishlist hooks
  const { data: wishlists = [] } = useWishlists(userId);
  const { addToWishlist, removeFromWishlist, createWishlist } = useWishlistMutations(userId);

  // Selected wishlist — default to last used, then first available
  const [selectedWishlistId, setSelectedWishlistId] = useState<string | null>(() => getLastUsedWishlistId());

  // Sync selected wishlist when wishlists load (pick first if stored id no longer valid)
  const firstWishlistId = wishlists[0]?.id ?? null;
  const resolvedWishlistId: string | null = useMemo(() => {
    if (!wishlists.length) return selectedWishlistId;
    if (selectedWishlistId && wishlists.some((w) => w.id === selectedWishlistId)) return selectedWishlistId;
    return firstWishlistId;
  }, [wishlists, selectedWishlistId, firstWishlistId]);

  const selectedWishlist = wishlists.find((w) => w.id === resolvedWishlistId) ?? wishlists[0] ?? null;

  function handleSelectWishlist(id: string) {
    setSelectedWishlistId(id);
    setLastUsedWishlistId(id);
  }

  function handleCreateWishlist(name: string) {
    createWishlist.mutate(name, {
      onSuccess: () => {
        // After creation, wishlists will re-fetch; the new list will become selected if it's the only one
      },
    });
  }

  // When "Show hidden" toggles on, clear swipedIds so previously-hidden
  // listings re-enter the deck (they're already in filteredListings).
  // When toggled off, reset index since the deck shrinks due to filter change.
  const prevShowHidden = useRef(showHidden);
  useEffect(() => {
    if (prevShowHidden.current && !showHidden) {
      // Toggled off — reset since deck is shrinking due to filter, not swipe
      setCurrentIndex(0);
    }
    if (showHidden) {
      setSwipedIds(new Set());
      setCurrentIndex(0);
    }
    prevShowHidden.current = showHidden;
  }, [showHidden]);

  // Track current listing by ID so we can restore position after re-sorts
  const currentListingIdRef = useRef<number | null>(null);

  // Geo-sort when listings change
  const geoSorted = useMemo(() => {
    const c = mapCenterRef.current;
    return geoSort(listings, c?.lat, c?.lng);
  }, [listings]);
  const deck = useMemo(
    () => geoSorted.filter((l) => !swipedIds.has(l.id)),
    [geoSorted, swipedIds],
  );

  // After deck recomputes, restore position to the listing the user was viewing.
  // If that listing is gone (swiped/hidden), stay at the same index (next in line).
  useEffect(() => {
    const trackedId = currentListingIdRef.current;
    if (trackedId === null) return;
    const newIdx = deck.findIndex((l) => l.id === trackedId);
    if (newIdx >= 0 && newIdx !== currentIndex) {
      setCurrentIndex(newIdx);
    } else if (newIdx === -1) {
      // Listing was removed — clamp index to deck bounds
      if (currentIndex >= deck.length && deck.length > 0) {
        setCurrentIndex(deck.length - 1);
      }
    }
  }, [deck]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentListing = deck[currentIndex] ?? null;
  const totalRemaining = deck.length - currentIndex;

  // Keep tracked ID in sync with what's currently displayed
  useEffect(() => {
    currentListingIdRef.current = currentListing?.id ?? null;
  }, [currentListing?.id]);

  // On mobile, auto-show the nearest subway station on the map (no hover needed)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.innerWidth >= 600) return; // desktop keeps hover behavior
    if (!currentListing?.lat || !currentListing?.lon) {
      setHoveredStation(null);
      return;
    }
    const nearest = getClosestStations(currentListing.lat, currentListing.lon, 1);
    if (nearest.length > 0) {
      const { station } = nearest[0];
      setHoveredStation({ lat: station.lat, lon: station.lon, name: station.name, lines: station.lines });
    } else {
      setHoveredStation(null);
    }
  }, [currentListing?.id, currentListing?.lat, currentListing?.lon]);

  // After undo-left/right, deck recomputes with the re-inserted item.
  // Find its new position and restore currentIndex to it.
  useEffect(() => {
    if (pendingUndoId.current !== null) {
      const idx = deck.findIndex((l) => l.id === pendingUndoId.current);
      if (idx >= 0) setCurrentIndex(idx);
      pendingUndoId.current = null;
    }
  }, [deck]);

  // ---------------------------------------------------------------------------
  // Swipe handler
  // ---------------------------------------------------------------------------
  const handleSwipe = useCallback(
    (direction: 'left' | 'right' | 'down') => {
      const listing = deck[currentIndex];
      if (!listing) return;

      // Auth check — all swipe actions require login (before overlay flash)
      if (!userId) {
        onLoginRequired?.();
        return;
      }

      // Flash the swipe overlay
      setSwipeOverlay(direction);
      setTimeout(() => setSwipeOverlay(null), 200);

      // Execute the action
      // For left swipes: persist hide immediately. The currentListingIdRef
      // approach handles any deck recomputation from filteredListings changing.
      if (direction === 'left') {
        onHideListing(listing.id);
      }
      if (direction === 'right') {
        const wlId = resolvedWishlistId;
        if (wlId) {
          addToWishlist.mutate({ wishlistId: wlId, listingId: listing.id });
          setLastUsedWishlistId(wlId);
        }
        setSavedIds((prev) => { const next = new Set(prev); next.add(listing.id); return next; });
      }
      // 'down' = pass — move to back of queue, no persistent action

      if (direction === 'down') {
        // Just advance index, listing stays in deck (will appear at end via looping)
        setUndoStack((prev) => [
          ...prev.slice(-9),
          { index: currentIndex, listingId: listing.id, action: direction },
        ]);
        setCurrentIndex((prev) => prev + 1);
      } else {
        // Track as swiped — don't increment currentIndex because removing
        // the item from swipedIds causes the deck to recompute, shifting the
        // next item into the current index position automatically.
        setSwipedIds((prev) => {
          const next = new Set(prev);
          next.add(listing.id);
          return next;
        });

        setUndoStack((prev) => [
          ...prev.slice(-9),
          { index: currentIndex, listingId: listing.id, action: direction, wishlistId: direction === 'right' ? (resolvedWishlistId ?? undefined) : undefined },
        ]);
      }
    },
    [currentIndex, deck, userId, onHideListing, resolvedWishlistId, addToWishlist, onLoginRequired],
  );

  // ---------------------------------------------------------------------------
  // Undo
  // ---------------------------------------------------------------------------
  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];

    // Reverse: remove from swiped set if it was hidden/saved
    if (last.action !== 'down') {
      setSwipedIds((prev) => {
        const next = new Set(prev);
        next.delete(last.listingId);
        return next;
      });

      if (last.action === 'left') {
        onUnhideListing?.(last.listingId);
      }

      if (last.action === 'right') {
        setSavedIds((prev) => { const next = new Set(prev); next.delete(last.listingId); return next; });
        // Remove from the wishlist that was used at save time
        const wlId = last.wishlistId ?? resolvedWishlistId;
        if (wlId) {
          removeFromWishlist.mutate({ wishlistId: wlId, listingId: last.listingId });
        }
      }
      // After removing from swipedIds the deck recomputes; find the re-inserted
      // item's new index and restore currentIndex to it.
      pendingUndoId.current = last.listingId;
    }

    setUndoStack((prev) => prev.slice(0, -1));
    // Only decrement index for 'down' (pass) — for left/right the deck
    // recomputes to re-insert the item at the same position.
    if (last.action === 'down') {
      setCurrentIndex((prev) => Math.max(0, prev - 1));
    }
  }, [undoStack, onUnhideListing, resolvedWishlistId, removeFromWishlist]);

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------
  const handleReset = () => {
    setSwipedIds(new Set());
    setCurrentIndex(0);
    setUndoStack([]);
  };

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if ((document.activeElement as HTMLElement)?.isContentEditable) return;

      switch (e.key) {
        case 'ArrowLeft':
          if (photoFocusedRef.current) return;
          e.preventDefault();
          flashButton(hideBtnRef);
          handleSwipe('left');
          break;
        case 'ArrowRight':
          if (photoFocusedRef.current) return;
          e.preventDefault();
          flashButton(saveBtnRef);
          handleSwipe('right');
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (photoFocusedRef.current) {
            exitPhotoFocusRef.current?.();
            return;
          }
          flashButton(laterBtnRef);
          handleSwipe('down');
          break;
        case 'ArrowUp':
          e.preventDefault();
          flashButton(photoBtnRef);
          enterPhotoFocusRef.current?.();
          break;
        case 'z':
        case 'Z':
          e.preventDefault();
          handleUndo();
          break;
        // Space: don't prevent default — let detail panel scroll naturally
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [handleSwipe, handleUndo]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Clicking a pin on the map should select that listing as the current swipe card.
  // Find the clicked listing in the current deck and move currentIndex to it.
  // If the listing isn't in the deck (already swiped/hidden), ignore silently.
  const handleMarkerClick = useCallback((id: number) => {
    const idx = deck.findIndex((l) => l.id === id);
    if (idx >= 0) {
      setCurrentIndex(idx);
      // Update tracked ID immediately so the deck-change effect doesn't snap it back
      currentListingIdRef.current = id;
    }
  }, [deck]);

  // Convert SwipeListing[] to Listing-compatible shape for Map.
  // Exclude hidden (left-swiped) listings but keep saved (right-swiped) ones.
  const hiddenIds = useMemo(() => {
    const hidden = new Set(swipedIds);
    for (const id of savedIds) hidden.delete(id);
    return hidden;
  }, [swipedIds, savedIds]);

  const mapListings = useMemo(() => listings
    .filter((l) => !hiddenIds.has(l.id) || savedIds.has(l.id))
    .map((l) => ({
      ...l,
      lat: l.lat ?? 0,
      lon: l.lon ?? 0,
      transit_summary: l.transit_summary ?? null,
      year_built: l.year_built ?? null,
      photos: l.photo_urls.length,
      last_update_date: null,
      availability_date: null,
      created_at: '',
      external_id: null,
      last_seen_at: null,
      delisted_at: null,
    })), [listings, hiddenIds, savedIds]);

  // Merge local in-session saves with the persisted wishlist so pins render
  // green for listings saved in prior sessions, not just this one.
  const mapFavoritedIds = useMemo(() => {
    if (!wishlistedIds || wishlistedIds.size === 0) return savedIds;
    const merged = new Set<number>(wishlistedIds);
    for (const id of savedIds) merged.add(id);
    return merged;
  }, [savedIds, wishlistedIds]);

  return (
    <div className="relative flex-1 min-h-0 flex overflow-hidden" style={{ height: '100%' }}>
      {/* Full-screen map backdrop (desktop only — on mobile the mini-map handles it) */}
      <div className="absolute inset-0 z-0 hidden min-[600px]:block">
        <MapComponent
          listings={mapListings as unknown as Database['public']['Tables']['listings']['Row'][]}
          selectedId={currentListing?.id ?? null}
          onMarkerClick={handleMarkerClick}
          onSelectDetail={() => {}}
          favoritedIds={mapFavoritedIds}
          onHideListing={() => {}}
          onBoundsChange={onBoundsChange}
          onMapMove={(center, zoom) => { mapCenterRef.current = center; onMapMove?.(center, zoom); }}
          suppressBoundsRef={suppressBoundsRef}
          initialCenter={initialCenter}
          initialZoom={initialZoom}
          visible={true}
          commuteInfoMap={commuteInfoMap}
          panOffset={{ x: 210, y: 0 }}
          hoveredStation={hoveredStation}
        />
      </div>

      {/* Expanded mobile map overlay — portal to escape parent stacking context */}
      {showMobileMap && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 min-[600px]:hidden" style={{ zIndex: 1400 }}>
          <MapComponent
            listings={mapListings as unknown as Database['public']['Tables']['listings']['Row'][]}
            selectedId={currentListing?.id ?? null}
            onMarkerClick={handleMarkerClick}
            onSelectDetail={() => {}}
            favoritedIds={mapFavoritedIds}
            onHideListing={() => {}}
            visible={true}
            commuteInfoMap={commuteInfoMap}
            initialCenter={currentListing?.lat && currentListing?.lon ? [currentListing.lat, currentListing.lon] : initialCenter}
            initialZoom={15}
          />
          <button
            onClick={() => setShowMobileMap(false)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer transition-colors"
            style={{ backgroundColor: 'rgba(28,32,40,0.9)', border: '1px solid rgba(255,255,255,0.15)', zIndex: 1401 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e1e4e8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>,
        document.body,
      )}

      {/* Floating detail panel on the right */}
      <div
        className="absolute right-0 bottom-0 z-10 flex flex-col w-full min-[600px]:w-[440px]"
        style={{ top: 76 }}
      >
        {currentListing ? (
          <>
            {/* Card + action bar — fills available space, content scrolls if needed */}
            <div className="flex-1 min-h-0 overflow-hidden min-[600px]:pr-3 flex flex-col">
            <div className="relative w-full my-auto" style={{ maxHeight: 'calc(100% - 40px)' }}>
              {/* Invisible layout card to establish natural height (card + action bar) */}
              <div className="invisible">
                <SwipeCard
                  listing={currentListing}
                  onSwipe={() => {}}
                  onExpandDetail={() => {}}
                  isTop={false}
                  layoutOnly
                />
                <div style={{ height: 96 }} />
              </div>

              {/* Next card underneath — visible while dragging */}
              {currentIndex + 1 < deck.length && (
                <div
                  className="absolute inset-0 rounded-xl overflow-hidden"
                  style={{
                    zIndex: 1,
                    transform: 'scale(0.97)',
                    opacity: isDragging ? 1 : 0,
                    transition: 'opacity 150ms ease-out',
                    pointerEvents: 'none',
                  }}
                >
                  {/* Dark overlay to show depth */}
                  <div
                    className="absolute inset-0 rounded-xl"
                    style={{
                      zIndex: 3,
                      backgroundColor: 'rgba(0, 0, 0, 0.25)',
                      pointerEvents: 'none',
                    }}
                  />
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundColor: 'rgba(28, 32, 40, 0.97)',
                      border: '1px solid #2d333b',
                      borderRadius: 12,
                    }}
                  >
                    <div className="absolute top-0 left-0 right-0" style={{ bottom: 96 }}>
                      <SwipeCard
                        listing={deck[currentIndex + 1]}
                        onSwipe={() => {}}
                        onExpandDetail={() => {}}
                        isTop={false}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Top card + attached action bar — unified container */}
              <div
                data-tour="swipe-card"
                className="absolute inset-0 rounded-xl overflow-hidden"
                style={{
                  zIndex: 2,
                  backgroundColor: 'rgba(28, 32, 40, 0.97)',
                  border: swipeOverlay === 'left'
                    ? '2px solid rgba(220, 38, 38, 0.8)'
                    : swipeOverlay === 'right'
                      ? '2px solid rgba(34, 197, 94, 0.8)'
                      : swipeOverlay === 'down'
                        ? '2px solid rgba(107, 114, 128, 0.7)'
                        : '1px solid #2d333b',
                  boxShadow: swipeOverlay === 'left'
                    ? '0 0 20px rgba(220, 38, 38, 0.4), inset 0 0 20px rgba(220, 38, 38, 0.1)'
                    : swipeOverlay === 'right'
                      ? '0 0 20px rgba(34, 197, 94, 0.4), inset 0 0 20px rgba(34, 197, 94, 0.1)'
                      : swipeOverlay === 'down'
                        ? '0 0 20px rgba(107, 114, 128, 0.3), inset 0 0 20px rgba(107, 114, 128, 0.1)'
                        : 'none',
                  transition: 'border 150ms ease, box-shadow 150ms ease',
                }}
              >

                {/* Mini-map inset — mobile only, overlaid on photo area */}
                {currentListing.lat != null && currentListing.lon != null && (
                  <div
                    onClick={() => setShowMobileMap(true)}
                    className="absolute top-3 right-3 min-[600px]:hidden rounded-xl overflow-hidden cursor-pointer"
                    style={{
                      zIndex: 6,
                      width: 140,
                      height: 110,
                      border: '2px solid rgba(255,255,255,0.15)',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                    }}
                  >
                    <div style={{ pointerEvents: 'none', width: '100%', height: '100%' }}>
                      <MiniMap lat={currentListing.lat!} lon={currentListing.lon!} hoveredStation={hoveredStation} />
                    </div>
                  </div>
                )}

                {/* Card portion */}
                <div className="absolute top-0 left-0 right-0" style={{ bottom: 96 }}>
                  <SwipeCard
                    key={currentListing.id}
                    listing={currentListing}
                    onSwipe={handleSwipe}
                    onExpandDetail={() => onExpandDetail?.(currentListing)}
                    isTop={true}
                    onPhotoFocusChange={(focused) => { photoFocusedRef.current = focused; }}
                    enterPhotoFocusRef={enterPhotoFocusRef}
                    exitPhotoFocusRef={exitPhotoFocusRef}
                    onSubwayHover={setHoveredStation}
                    onDragStateChange={setIsDragging}
                  />
                </div>
                {/* Action bar attached to bottom of card */}
                <div
                  className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-5"
                  style={{
                    height: 96,
                    borderTop: '1px solid #2d333b',
                  }}
                >
              {/* Undo · Z */}
              <div className="flex flex-col items-center gap-0.5">
                <button
                  onClick={handleUndo}
                  disabled={undoStack.length === 0}
                  className="flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
                  style={{ color: '#8b949e', background: 'none', border: 'none', padding: 0 }}
                  title="Undo (Z)"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7v6h6" />
                    <path d="M3 13a9 9 0 0 1 15.36-6.36L21 9" />
                  </svg>
                </button>
                <span className="text-[12px]" style={{ color: '#6e7681' }}>Undo · <span style={{ color: '#8b949e' }}>Z</span></span>
              </div>

              {/* Center: 4-circle arrow cluster with tooltips */}
              <div ref={saveAnchorRef} className="flex flex-col items-center gap-1.5">
                <div className="flex items-center gap-1.5">
                  <SwipeActionButton buttonRef={hideBtnRef} onClick={() => { flashButton(hideBtnRef); handleSwipe('left'); }} tooltip="Hide">
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="19" y1="12" x2="5" y2="12" />
                      <polyline points="12 19 5 12 12 5" />
                    </svg>
                  </SwipeActionButton>
                  <SwipeActionButton buttonRef={photoBtnRef} onClick={() => { flashButton(photoBtnRef); enterPhotoFocusRef.current?.(); }} tooltip="Photo view">
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="19" x2="12" y2="5" />
                      <polyline points="5 12 12 5 19 12" />
                    </svg>
                  </SwipeActionButton>
                  <SwipeActionButton buttonRef={laterBtnRef} onClick={() => { flashButton(laterBtnRef); handleSwipe('down'); }} tooltip="Later">
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <polyline points="19 12 12 19 5 12" />
                    </svg>
                  </SwipeActionButton>
                  <SwipeActionButton buttonRef={saveBtnRef} onClick={() => { flashButton(saveBtnRef); handleSwipe('right'); }} tooltip="Save">
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </SwipeActionButton>
                </div>

                {/* Save to: wishlist selector — centered below the 4 circles */}
                <button
                  onClick={() => setWishlistDropdownOpen((prev) => !prev)}
                  className="text-[12px] flex items-center gap-1 cursor-pointer transition-colors"
                  style={{
                    color: '#8b949e',
                    background: 'none',
                    border: 'none',
                    padding: '2px 4px',
                    borderRadius: 4,
                    lineHeight: 1,
                    maxWidth: 160,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#58a6ff'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#8b949e'; }}
                  title="Choose wishlist"
                >
                  <span style={{ whiteSpace: 'nowrap' }}>Save to:</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>
                    {selectedWishlist ? selectedWishlist.name : 'Wishlist'}
                  </span>
                  <span style={{ flexShrink: 0 }}>▾</span>
                </button>
                {wishlistDropdownOpen && userId && currentListing && (
                  <WishlistPicker
                    listingId={currentListing.id}
                    wishlists={wishlists}
                    onToggle={(wishlistId, checked) => {
                      if (checked) {
                        handleSelectWishlist(wishlistId);
                      }
                      setWishlistDropdownOpen(false);
                    }}
                    onCreateNew={handleCreateWishlist}
                    onClose={() => setWishlistDropdownOpen(false)}
                    anchorRect={saveAnchorRef.current?.getBoundingClientRect() ?? null}
                  />
                )}
              </div>

                </div>{/* action bar */}
              </div>{/* absolute card+bar */}
            </div>{/* relative w-full */}
            </div>{/* flex-1 centering */}
          </>
        ) : listings.length === 0 && isLoading ? (
          /* Loading state — listings haven't loaded yet */
          <div
            className="flex-1 flex flex-col items-center justify-center gap-3 text-center m-3 rounded-xl"
            style={{
              backgroundColor: 'rgba(28, 32, 40, 0.97)',
              border: '1px solid #2d333b',
            }}
          >
            <div
              className="w-8 h-8 rounded-full border-2 animate-spin"
              style={{ borderColor: '#3d444d', borderTopColor: '#58a6ff' }}
            />
            <div className="text-sm" style={{ color: '#8b949e' }}>
              Loading listings...
            </div>
          </div>
        ) : listings.length === 0 ? (
          /* No results for current filters */
          <div
            className="flex-1 flex flex-col items-center justify-center gap-4 text-center m-3 rounded-xl"
            style={{
              backgroundColor: 'rgba(28, 32, 40, 0.97)',
              border: '1px solid #2d333b',
            }}
          >
            <div className="text-white text-lg font-semibold">
              No listings found
            </div>
            <div className="text-sm" style={{ color: '#8b949e' }}>
              Try adjusting your filters or moving the map.
            </div>
            {onSwitchView && (
              <PrimaryButton onClick={onSwitchView}>
                Switch to list view
              </PrimaryButton>
            )}
          </div>
        ) : (
          /* Empty state — user has swiped through everything */
          <div
            className="flex-1 flex flex-col items-center justify-center gap-4 text-center m-3 rounded-xl"
            style={{
              backgroundColor: 'rgba(28, 32, 40, 0.97)',
              border: '1px solid #2d333b',
            }}
          >
            <div className="text-4xl select-none">🎉</div>
            <div className="text-white text-lg font-semibold">
              You&apos;ve seen all listings!
            </div>
            <div className="text-sm" style={{ color: '#8b949e' }}>
              Come back later for new ones, or reset to start over.
            </div>
            <div className="flex gap-3 mt-2">
              <PrimaryButton onClick={handleReset}>Reset</PrimaryButton>
              {onSwitchView && (
                <PrimaryButton onClick={onSwitchView}>
                  Switch to list view
                </PrimaryButton>
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
