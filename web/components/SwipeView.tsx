'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import { PrimaryButton } from '@/components/ui';
import { X, RotateCcw, Heart } from 'lucide-react';
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
  /** Called when the user taps the map icon in the mobile unified bottom pill */
  onSwitchToMap?: () => void;
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
  /** Reserved space at the top (in px) for the filter bar that sits above
      the SwipeView on mobile. Used to shift the card downward so it doesn't
      render underneath the absolute filter bar. */
  topInset?: number;
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
  onSwitchToMap,
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
  topInset = 0,
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
  // Defer mounting the Map component until the user actually needs it.
  // On desktop (viewport >= 600px) the map is the full-screen backdrop, so
  // we set this true once we detect a desktop viewport. On mobile, it only
  // flips to true when the user opens the expanded map overlay, saving
  // ~4MB of Leaflet+react-leaflet JS and subway GeoJSON on initial load.
  // Once true it stays true so toggling back doesn't re-init the map.
  const [hasOpenedMap, setHasOpenedMap] = useState(false);
  const [swipeOverlay, setSwipeOverlay] = useState<'left' | 'right' | 'down' | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Track whether we're on a mobile viewport (<600px) so we can conditionally
  // mount the mini-map on mobile vs the full-screen backdrop map on desktop
  // (avoids mounting both Leaflet instances at once). Starts null on first
  // render so SSR output matches either branch until hydration resolves it.
  const [isMobileViewport, setIsMobileViewport] = useState<boolean | null>(null);
  const saveAnchorRef = useRef<HTMLDivElement>(null);
  const mobileSaveAnchorRef = useRef<HTMLButtonElement>(null);
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
  const resetCardRef = useRef<(() => void) | null>(null);
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

  // Mark map as "opened" — the mobile mini-map (Option B2 layout) means the
  // Leaflet map is always visible on mobile too, so we flip this true as soon
  // as the component mounts client-side. We keep it mounted after that so
  // toggling views doesn't re-init Leaflet.
  useEffect(() => {
    if (hasOpenedMap) return;
    if (typeof window !== 'undefined') setHasOpenedMap(true);
  }, [hasOpenedMap]);

  // Track viewport size for mobile vs desktop map mounting. Debounced so
  // drag-resize doesn't hammer state.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setIsMobileViewport(window.innerWidth < 600);
    update();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      timeoutId = setTimeout(update, 150);
    };
    window.addEventListener('resize', onResize, { passive: true });
    return () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      window.removeEventListener('resize', onResize);
    };
  }, []);


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

  // Re-set nearest subway station when mobile map overlay opens
  useEffect(() => {
    if (!showMobileMap || typeof window === 'undefined' || window.innerWidth >= 600) return;
    if (!currentListing?.lat || !currentListing?.lon) return;
    const nearest = getClosestStations(currentListing.lat, currentListing.lon, 1);
    if (nearest.length > 0) {
      const { station } = nearest[0];
      setHoveredStation({ lat: station.lat, lon: station.lon, name: station.name, lines: station.lines });
    }
  }, [showMobileMap, currentListing?.id, currentListing?.lat, currentListing?.lon]);

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
        // Card animated off-screen by commitSwipe — spring it back
        setTimeout(() => resetCardRef.current?.(), 100);
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

  // Mini-map (mobile) should show ONLY the currently-active listing plus
  // subway stations — no saved-listing pins, no other listings. We build a
  // dedicated single-listing array for it so the Leaflet map only renders one
  // CircleMarker. Desktop continues to use the full `mapListings` array.
  const mobileMapListings = useMemo(() => {
    if (!currentListing) return [] as typeof mapListings;
    const found = mapListings.find((l) => l.id === currentListing.id);
    return found ? [found] : ([] as typeof mapListings);
  }, [mapListings, currentListing]);
  const EMPTY_FAVORITES = useMemo(() => new Set<number>(), []);

  return (
    <div className="relative flex-1 min-h-0 flex overflow-hidden" style={{ height: '100%' }}>
      {/* Full-screen map backdrop (desktop only — on mobile the mini-map handles it).
          Only mounted once hasOpenedMap flips true. On desktop that happens
          immediately via the viewport effect; on mobile it waits until the user
          taps the map tab (which opens the mobile map overlay below). */}
      {hasOpenedMap && isMobileViewport === false && (
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
      )}

      {/* Mobile mini-map — Option B2 persistent 45vh map above the swipe card.
          Shows the current listing's pin and nearby subway markers. Tapping the
          map opens the full-screen expanded overlay below. Only mounts on
          mobile viewports to avoid running two Leaflet instances side-by-side
          on desktop. */}
      {isMobileViewport === true && (
        <div
          className="absolute left-0 right-0 z-0 min-[600px]:hidden"
          style={{
            top: `var(--swipe-top-inset, 0px)`,
            height: '45vh',
            borderBottom: '1px solid #2d333b',
            overflow: 'hidden',
          }}
        >
          {hasOpenedMap && (
            <MapComponent
              // Mini-map renders only the active listing + subway stations —
              // no saved/other pins (those remain on the desktop backdrop and
              // the full-screen expanded mobile overlay below).
              listings={mobileMapListings as unknown as Database['public']['Tables']['listings']['Row'][]}
              selectedId={currentListing?.id ?? null}
              onMarkerClick={handleMarkerClick}
              onSelectDetail={() => {}}
              favoritedIds={EMPTY_FAVORITES}
              onHideListing={() => {}}
              // Wire bounds/move callbacks so user-initiated pan/zoom on the
              // mini-map re-queries listings for the new viewport. Programmatic
              // recenters triggered by swiping to a new card are suppressed by
              // `suppressBoundsRef` inside MapInner's FlyToSelected.
              onBoundsChange={onBoundsChange}
              onMapMove={(center, zoom) => { mapCenterRef.current = center; onMapMove?.(center, zoom); }}
              suppressBoundsRef={suppressBoundsRef}
              // Instant (no flyTo animation) re-center when the active listing
              // changes — prevents the pin from briefly appearing far from the
              // map's visible area during the ~800ms flyTo animation.
              instantRecenter
              visible={true}
              commuteInfoMap={commuteInfoMap}
              initialCenter={currentListing?.lat && currentListing?.lon ? [currentListing.lat, currentListing.lon] : initialCenter}
              initialZoom={15}
              hoveredStation={hoveredStation}
            />
          )}
          <button
            onClick={() => setShowMobileMap(true)}
            aria-label="Expand map"
            className="absolute top-2 right-2 rounded-full flex items-center justify-center cursor-pointer"
            style={{
              width: 36,
              height: 36,
              backgroundColor: 'rgba(28,32,40,0.9)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#e1e4e8',
              zIndex: 5,
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
            }}
            title="Expand map"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
        </div>
      )}

      {/* Expanded mobile map overlay — portal to escape parent stacking context.
          Mounted on first open (hasOpenedMap) and kept mounted afterward; we
          toggle visibility via display:none so re-opening doesn't re-init
          Leaflet / re-fetch subway GeoJSON. */}
      {hasOpenedMap && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 min-[600px]:hidden"
          style={{ zIndex: 1400, display: showMobileMap ? 'block' : 'none' }}
        >
          <MapComponent
            listings={mapListings as unknown as Database['public']['Tables']['listings']['Row'][]}
            selectedId={currentListing?.id ?? null}
            onMarkerClick={handleMarkerClick}
            onSelectDetail={() => {}}
            favoritedIds={mapFavoritedIds}
            onHideListing={() => {}}
            // Wire bounds/move callbacks so user-initiated pan/zoom on the
            // expanded mobile map also re-queries listings for the new
            // viewport (matching desktop behavior). Programmatic recenters
            // from swipes are suppressed by `suppressBoundsRef`.
            onBoundsChange={onBoundsChange}
            onMapMove={(center, zoom) => { mapCenterRef.current = center; onMapMove?.(center, zoom); }}
            suppressBoundsRef={suppressBoundsRef}
            visible={showMobileMap}
            commuteInfoMap={commuteInfoMap}
            initialCenter={currentListing?.lat && currentListing?.lon ? [currentListing.lat, currentListing.lon] : initialCenter}
            initialZoom={15}
            hoveredStation={hoveredStation}
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

      {/* Floating detail panel on the right.
          On mobile the card is pushed down by `topInset` (the height of the
          overlaying filter bar in page.tsx). On desktop the 76px offset is
          the existing reserved space for the top chrome. */}
      <div
        className="swipe-detail-panel absolute right-0 bottom-0 z-10 flex flex-col w-full min-[600px]:w-[440px]"
        style={{ ['--swipe-top-inset' as string]: `${topInset}px` }}
      >
        {currentListing ? (
          <>
            {/* Card + action bar — fills available space, content scrolls if needed.
                On mobile the card is vertically centered in the area between the top
                navbar and the unified bottom pill (rendered via portal below). The
                ~80px bottom padding reserves space for the pill (52px) + safe area +
                a bit of breathing room. On desktop the card + attached 96px action
                bar keeps its original behavior. */}
            <div className="flex-1 min-h-0 overflow-hidden p-2 min-[600px]:p-0 min-[600px]:pr-3 flex flex-col items-center justify-center min-[600px]:items-stretch pb-[calc(env(safe-area-inset-bottom)+80px)] min-[600px]:pb-0">
            <div className="relative w-full my-auto max-h-full min-[600px]:max-h-[calc(100%-40px)]">
              {/* Invisible layout card to establish natural height (card + action bar on desktop) */}
              <div className="invisible">
                <SwipeCard
                  listing={currentListing}
                  onSwipe={() => {}}
                  onExpandDetail={() => {}}
                  isTop={false}
                  layoutOnly
                  compactMobile
                />
                {/* Reserve action-bar height on desktop only — mobile dock floats outside the card */}
                <div className="h-0 min-[600px]:h-24" />
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
                      backgroundColor: 'rgba(0, 0, 0, 0.12)',
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
                    <div className="absolute top-0 left-0 right-0 bottom-0 min-[600px]:bottom-24">
                      <SwipeCard
                        listing={deck[currentIndex + 1]}
                        onSwipe={() => {}}
                        onExpandDetail={() => {}}
                        isTop={false}
                        compactMobile
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Top card + attached action bar — unified container */}
              <div
                data-tour="swipe-card"
                className="absolute inset-0 rounded-xl"
                style={{
                  zIndex: 2,
                  overflow: isDragging ? 'visible' : 'hidden',
                  backgroundColor: isDragging ? 'transparent' : 'rgba(28, 32, 40, 0.97)',
                  border: swipeOverlay === 'left'
                    ? '2px solid rgba(220, 38, 38, 0.8)'
                    : swipeOverlay === 'right'
                      ? '2px solid rgba(34, 197, 94, 0.8)'
                      : swipeOverlay === 'down'
                        ? '2px solid rgba(107, 114, 128, 0.7)'
                        : isDragging ? '1px solid transparent' : '1px solid #2d333b',
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

                {/* Card portion — full height on mobile (no attached bar), leaves 96px for action bar on desktop */}
                <div className="absolute top-0 left-0 right-0 bottom-0 min-[600px]:bottom-24">
                  <SwipeCard
                    key={currentListing.id}
                    listing={currentListing}
                    onSwipe={handleSwipe}
                    onExpandDetail={() => onExpandDetail?.(currentListing)}
                    isTop={true}
                    compactMobile
                    onPhotoFocusChange={(focused) => { photoFocusedRef.current = focused; }}
                    enterPhotoFocusRef={enterPhotoFocusRef}
                    exitPhotoFocusRef={exitPhotoFocusRef}
                    onSubwayHover={setHoveredStation}
                    onDragStateChange={setIsDragging}
                    resetRef={resetCardRef}
                    footerLeadingSlot={(
                      // Mobile-only "Save to: <wishlist> ▾" inline in card footer.
                      // Hidden on desktop (≥600px) where the same control lives
                      // in the attached action bar.
                      <button
                        ref={mobileSaveAnchorRef}
                        onClick={(e) => { e.stopPropagation(); setWishlistDropdownOpen((prev) => !prev); }}
                        className="min-[600px]:hidden text-[12px] flex items-center gap-1 cursor-pointer transition-colors"
                        style={{
                          color: '#8b949e',
                          background: 'none',
                          border: 'none',
                          padding: '2px 0',
                          lineHeight: 1.4,
                          maxWidth: '100%',
                        }}
                        title="Choose wishlist"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                        </svg>
                        <span style={{ whiteSpace: 'nowrap' }}>Save to:</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120, color: '#c9d1d9' }}>
                          {selectedWishlist ? selectedWishlist.name : 'Wishlist'}
                        </span>
                        <span style={{ flexShrink: 0 }}>▾</span>
                      </button>
                    )}
                  />
                </div>
                {/* Action bar attached to bottom of card — desktop only. Mobile uses
                    the floating glassmorphic dock rendered below the card area. */}
                <div
                  className="absolute bottom-0 left-0 right-0 hidden min-[600px]:flex items-center justify-center px-5 rounded-b-xl"
                  style={{
                    height: 96,
                    borderTop: '1px solid #2d333b',
                    backgroundColor: 'rgba(28, 32, 40, 0.97)',
                  }}
                >
              {/* Undo · Z — absolutely positioned on the left, vertically
                  aligned with the center of the 4-arrow button row (not the
                  whole right cluster, which also includes the "Save to" row
                  below). The button row is ~38px tall and sits at the top of
                  the center cluster, so we offset upward from the bar's
                  vertical center by half the "Save to" row height + gap (~10px)
                  so Undo's center Y matches the arrow-button row's center Y. */}
              <button
                onClick={handleUndo}
                disabled={undoStack.length === 0}
                className="absolute left-5 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
                style={{
                  color: '#8b949e',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  top: 'calc(50% - 10px)',
                  transform: 'translateY(-50%)',
                }}
                title="Undo (Z)"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7v6h6" />
                  <path d="M3 13a9 9 0 0 1 15.36-6.36L21 9" />
                </svg>
                <span className="text-[12px]" style={{ color: '#6e7681' }}>Undo · <span style={{ color: '#8b949e' }}>Z</span></span>
              </button>

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
              </div>

                </div>{/* action bar */}
              </div>{/* absolute card+bar */}
            </div>{/* relative w-full */}
            </div>{/* flex-1 centering */}

            {/* Mobile-only unified bottom pill — replaces the old floating dock
                AND the standalone nav pill from page.tsx. Contains:
                [list-edge] | [X] | [undo] | [heart] | [map-edge]
                The list/map icons switch view mode; the 3 center buttons perform
                swipe actions. Rendered as a portal so it sits above the rest of
                the app chrome regardless of parent stacking context. */}
            {typeof document !== 'undefined' && createPortal(
              <div
                className="fixed left-1/2 -translate-x-1/2 min-[600px]:hidden"
                style={{
                  bottom: 'calc(env(safe-area-inset-bottom) + 12px)',
                  zIndex: 1300,
                }}
              >
                <div
                  className="flex items-center rounded-full overflow-hidden"
                  style={{
                    height: 52,
                    background: 'rgba(28, 32, 40, 0.85)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
                  }}
                >
                  {/* List icon (edge, left) — switch to list view */}
                  <button
                    onClick={() => onSwitchView?.()}
                    aria-label="List view"
                    className="flex items-center justify-center cursor-pointer transition-colors"
                    style={{
                      width: 60,
                      height: 52,
                      background: 'none',
                      border: 'none',
                      color: '#8b949e',
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="8" y1="6" x2="21" y2="6" />
                      <line x1="8" y1="12" x2="21" y2="12" />
                      <line x1="8" y1="18" x2="21" y2="18" />
                      <line x1="3" y1="6" x2="3.01" y2="6" />
                      <line x1="3" y1="12" x2="3.01" y2="12" />
                      <line x1="3" y1="18" x2="3.01" y2="18" />
                    </svg>
                  </button>

                  <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />

                  {/* Reject (X) */}
                  <button
                    onClick={() => handleSwipe('left')}
                    aria-label="Reject"
                    className="flex items-center justify-center cursor-pointer transition-colors active:scale-95"
                    style={{
                      width: 62,
                      height: 52,
                      background: 'none',
                      border: 'none',
                    }}
                  >
                    <X size={22} strokeWidth={2.5} color="#ef4444" />
                  </button>

                  <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />

                  {/* Undo */}
                  <button
                    onClick={handleUndo}
                    disabled={undoStack.length === 0}
                    aria-label="Undo"
                    className="flex items-center justify-center cursor-pointer transition-colors active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{
                      width: 62,
                      height: 52,
                      background: 'none',
                      border: 'none',
                    }}
                  >
                    <RotateCcw size={20} strokeWidth={2} color="#8b949e" />
                  </button>

                  <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />

                  {/* Heart (save) */}
                  <button
                    onClick={() => handleSwipe('right')}
                    aria-label="Save"
                    className="flex items-center justify-center cursor-pointer transition-colors active:scale-95"
                    style={{
                      width: 62,
                      height: 52,
                      background: 'none',
                      border: 'none',
                    }}
                  >
                    <Heart size={21} strokeWidth={2.2} color="#ec4899" />
                  </button>

                  <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />

                  {/* Map icon (edge, right) — switch to map view */}
                  <button
                    onClick={() => onSwitchToMap?.()}
                    aria-label="Map view"
                    className="flex items-center justify-center cursor-pointer transition-colors"
                    style={{
                      width: 60,
                      height: 52,
                      background: 'none',
                      border: 'none',
                      color: '#8b949e',
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
                      <line x1="8" y1="2" x2="8" y2="18" />
                      <line x1="16" y1="6" x2="16" y2="22" />
                    </svg>
                  </button>
                </div>
              </div>,
              document.body,
            )}

            {/* Wishlist picker — anchors to whichever save-to button is visible
                (mobile dock label on mobile, in-card action bar on desktop). */}
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
                anchorRect={(() => {
                  // Prefer the visible anchor. Measure offsetParent to check visibility.
                  const mobileEl = mobileSaveAnchorRef.current;
                  const desktopEl = saveAnchorRef.current;
                  if (mobileEl && mobileEl.offsetParent !== null) return mobileEl.getBoundingClientRect();
                  if (desktopEl && desktopEl.offsetParent !== null) return desktopEl.getBoundingClientRect();
                  return null;
                })()}
              />
            )}
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
