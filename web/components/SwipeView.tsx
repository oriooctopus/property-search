'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import { animate } from 'framer-motion';
import { useDrag } from '@use-gesture/react';
import { TextButton } from '@/components/ui';
import { X, RotateCcw, Heart } from 'lucide-react';
import SwipeCard, { type HoveredStation, getClosestStations, walkMinFromMiles } from './SwipeCard';
import SwipeOnboarding from './SwipeOnboarding';
import type { ViewportBounds } from './MapInner';
import type { CommuteInfo } from './ListingCard';
import type { Database } from '@/lib/types';
import { useWishlists, useWishlistMutations } from '@/lib/hooks/useWishlists';
import { getLastUsedWishlistId, setLastUsedWishlistId } from '@/lib/wishlist-storage';
import { geoSort } from '@/lib/geo-sort';
import { triggerHaptic } from '@/lib/native';
import WishlistPicker from './WishlistPicker';
import { useRegisterOccluder, useOccluders } from '@/lib/viewport/OccluderRegistry';
import { useLeafletMap } from '@/lib/viewport/LeafletMapContext';
import { isPinVisible, projectPinToViewport } from '@/lib/viewport/occlusion';

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
  // Map props passthrough
  onBoundsChange?: (bounds: ViewportBounds) => void;
  onMapMove?: (center: { lat: number; lng: number }, zoom: number) => void;
  suppressBoundsRef?: React.MutableRefObject<boolean>;
  /** Exposed ref mirroring whether the user is actively panning the map.
   *  Used by mobile card-swipe logic (and MapInner's auto-shift) to defer
   *  side effects mid-gesture. */
  isPanningRef?: React.MutableRefObject<boolean>;
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
  /** @deprecated The mobile filter pill moved to the page-level
   *  MobileMenuPill (Option C merged "Filters | Avatar" pill). This prop
   *  is unused; remove once the call-site in page.tsx is dropped. */
  onOpenFilters?: () => void;
  /** Optional content rendered inside the "No listings found" empty state
   *  (e.g. a "Go to nearest match" button). */
  emptyStateExtra?: React.ReactNode;
  /** Resets all filters to their defaults. When provided, the "no listings
   *  found" empty state shows a "Clear filters" secondary CTA. */
  onClearFilters?: () => void;
}

interface UndoEntry {
  index: number;
  listingId: number;
  action: 'left' | 'right' | 'down';
  wishlistId?: string;  // which wishlist was used for right-swipe
}

/**
 * Shared empty-state panel for the mobile SwipeView.
 *
 * Both the "no listings" and "swiped through everything" states render
 * the same shell (centered card, identical bg/border) and the same CTAs:
 *  - "Find nearest" + "Unhide hidden listings" rendered via `extra`
 *    (parent supplies the two pill buttons).
 *  - Secondary "Clear filters" link below, rendered when `onClearFilters`
 *    is given.
 *
 * The legacy "Switch to list view" CTA is GONE from both branches — on
 * mobile users fix filters / find a nearby match in place. The legacy
 * "Reset deck" link is also gone (it duplicates "Unhide listings").
 *
 * Layout is intentionally compact so it fits the smallest mobile
 * viewport (iPhone SE, 375x667) without scroll/overflow: emoji + title
 * + 1 line of subtext + a single horizontal row of CTA buttons.
 */
function MobileSwipeEmptyState({
  title,
  subtitle,
  emoji,
  extra,
  onClearFilters,
}: {
  title: string;
  subtitle: string;
  emoji?: string;
  extra?: React.ReactNode;
  onClearFilters?: () => void;
}) {
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center gap-2 text-center m-3 px-4 py-5 rounded-xl"
      style={{
        backgroundColor: 'rgba(28, 32, 40, 0.97)',
        border: '1px solid #2d333b',
      }}
    >
      {emoji && <div className="text-3xl select-none leading-none">{emoji}</div>}
      <div className="text-white text-base font-semibold">{title}</div>
      <div className="text-xs" style={{ color: '#8b949e' }}>
        {subtitle}
      </div>
      {extra}
      {onClearFilters && (
        <TextButton variant="muted" onClick={onClearFilters}>
          Clear filters
        </TextButton>
      )}
    </div>
  );
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
  isPanningRef,
  initialCenter,
  initialZoom,
  commuteInfoMap,
  onLoginRequired,
  showHidden,
  isLoading,
  wishlistedIds,
  topInset = 0,
  // onOpenFilters is no longer rendered here — the merged MobileMenuPill in
  // page.tsx now owns the filter-sheet trigger. Prop kept on the interface
  // for one release so the call-site can drop it without a build break.
  emptyStateExtra,
  onClearFilters,
}: SwipeViewProps) {
  // Don't persist swipedIds across refreshes — start fresh each session.
  // The localStorage was causing "You've seen all listings" on every refresh.
  const [swipedIds, setSwipedIds] = useState<Set<number>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [wishlistDropdownOpen, setWishlistDropdownOpen] = useState(false);
  // Array so we can glow 1 (desktop hover) or 2 (mobile auto) stations.
  const [hoveredStations, setHoveredStations] = useState<HoveredStation[] | null>(null);
  // Adapter for SwipeCard's single-station hover callback (desktop-only);
  // converts null → null, and station → [station].
  const setHoveredFromHover = useCallback((s: HoveredStation | null) => {
    setHoveredStations(s ? [s] : null);
  }, []);
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
  // SwipeOnboarding overlay: pointer-events: none visual hint shown until the
  // user's first card gesture. Default false to keep SSR output stable; flip
  // to true on mount only if the localStorage flag isn't set yet.
  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && !window.localStorage.getItem('dwelligence_swipe_onboarded')) {
        setShowOnboarding(true);
      }
    } catch { /* noop */ }
  }, []);
  const dismissOnboarding = useCallback(() => {
    setShowOnboarding((prev) => {
      if (!prev) return prev;
      try { window.localStorage.setItem('dwelligence_swipe_onboarded', '1'); } catch { /* noop */ }
      return false;
    });
  }, []);
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
  // Refs for the viewport-occlusion model. The remaining mobile pin
  // visibility check (the fresh-deck first-visible-pin scan in the
  // restore-position effect below, plus the visible-rect bounds shrink
  // in MapInner's BoundsWatcher) compares the pin's bounding circle
  // against every registered occluder. All occlusion uses are mobile-only;
  // on desktop the registrations are disabled so the model sees an empty
  // list and never trips. None of these uses move the map — they only
  // affect which deck index is selected and which bbox is queried.
  const mobileSwipeCardRef = useRef<HTMLDivElement>(null);
  const mobileActionPillRef = useRef<HTMLDivElement>(null);
  const occluderRegistry = useOccluders();
  // Blocker 3 fix: live Leaflet map via context (not `window.__leafletMap`).
  // Re-renders the consumers when the map mounts/unmounts, so we can drop
  // the legacy `setTimeout(200)` polling loop entirely.
  const leafletMap = useLeafletMap();

  // Stable getRect callbacks for the registry. We use refs to the DOM
  // nodes directly — no document.querySelector — and fall back to the
  // legacy `.swipe-detail-panel` selector so the registration still
  // resolves the right rect even before the new ref is attached. The
  // `enabled` flag passes mobile-only so the model sees no occluders on
  // desktop.
  const getSwipeCardRect = useCallback((): DOMRect | null => {
    const el = mobileSwipeCardRef.current
      ?? (typeof document !== 'undefined'
        ? (document.querySelector('.swipe-detail-panel') as HTMLElement | null)
        : null);
    return el?.getBoundingClientRect() ?? null;
  }, []);
  const getActionPillRect = useCallback((): DOMRect | null => {
    const el = mobileActionPillRef.current;
    return el?.getBoundingClientRect() ?? null;
  }, []);
  // Register both as occluders for the mobile pin-visibility model.
  // `enabled = isMobileViewport === true` so desktop never registers them.
  // Note: we register the swipe-card unconditionally on mobile (even when
  // dismissed). When dismissed it's translateY(100%) off-screen, so its
  // rect is below the viewport — the model's map-bounds clip naturally
  // ignores it without needing a separate "is-dismissed" gate here.
  useRegisterOccluder('swipe-card', getSwipeCardRect, isMobileViewport === true);
  useRegisterOccluder('action-pill', getActionPillRect, isMobileViewport === true);

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

  // ---------------------------------------------------------------------
  // Mobile: drag-down-to-dismiss for the floating swipe card.
  //
  // A 24px grabber strip above the card captures pointer-down / move / up
  // and translates the whole `.swipe-detail-panel` down. Released past a
  // threshold (100px OR velocity > 0.5 px/ms) dismisses the card — it
  // slides off-screen and a "Show listing" pill appears at the bottom.
  // Tapping that pill restores the card. Released below threshold snaps
  // back to 0 via the CSS transition.
  //
  // Horizontal swipe-to-like/reject on the photo area is unaffected: the
  // grabber sits ABOVE the card body so the two gesture surfaces never
  // overlap.
  // ---------------------------------------------------------------------
  const [mobileCardDismissed, setMobileCardDismissed] = useState(false);
  const [mobileCardDragY, setMobileCardDragY] = useState(0);
  const cardDragActiveRef = useRef(false);
  const MOBILE_CARD_DISMISS_DISTANCE_PX = 100;
  const MOBILE_CARD_DISMISS_VELOCITY_PX_PER_MS = 0.5;

  // Grabber drag-to-dismiss: handled via @use-gesture/react. No manual
  // pointer-capture, no setTimeout debounces — `tap` and `last` flags from
  // use-gesture replace the previous custom state machine.
  const grabberBind = useDrag(
    ({ movement: [, my], velocity: [, vy], down, last, tap }) => {
      if (tap) {
        cardDragActiveRef.current = false;
        setMobileCardDragY(0);
        return;
      }
      if (down) {
        cardDragActiveRef.current = true;
        setMobileCardDragY(Math.max(0, my));
        return;
      }
      if (last) {
        cardDragActiveRef.current = false;
        const dy = Math.max(0, my);
        // use-gesture's velocity is px/ms (always non-negative magnitude).
        const velocity = vy;
        const shouldDismiss =
          dy >= MOBILE_CARD_DISMISS_DISTANCE_PX ||
          (dy > 25 && velocity >= MOBILE_CARD_DISMISS_VELOCITY_PX_PER_MS);
        if (shouldDismiss) {
          setMobileCardDragY(window.innerHeight);
          window.setTimeout(() => {
            setMobileCardDismissed(true);
            setMobileCardDragY(0);
          }, 220);
        } else {
          setMobileCardDragY(0);
        }
      }
    },
    { filterTaps: true, pointer: { touch: true }, axis: 'y' }
  );

  const showCardAgain = useCallback(() => {
    setMobileCardDismissed(false);
    setMobileCardDragY(0);
  }, []);

  const bouncePlayedRef = useRef(false);
  const bounceActiveRef = useRef(false);

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

  // Track current listing by ID so we can restore position after re-sorts.
  // Listing ids are globally unique primary keys, so a tracked id appearing
  // in a freshly-rebuilt deck means it really IS the same listing — keep it
  // selected. We do NOT clear this on deck-reference changes; doing so was
  // the cause of the "selection swaps even though same listing is still in
  // viewport" bug. The find-first-visible fallback below only runs when the
  // tracked id is genuinely absent from the new deck (filter excluded it,
  // or it scrolled out of the result set entirely).
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
  // If the tracked listing is gone (or there's no tracked id yet — e.g. fresh
  // search result for a brand-new viewport), pick the first deck item whose
  // pin is currently visible per the occlusion model. This prevents Bug B:
  // "panned to a new area, deck initialized at index 0, that pin happened to
  // be hidden behind the swipe card, so the user landed on an invisible card."
  //
  // Falls back to index 0 if no candidate is visible, OR if we can't sample
  // the map yet (Leaflet not mounted on SSR / first paint). The map is NEVER
  // moved here — only `setCurrentIndex` is called. If no visible candidate
  // exists, the deck stays at the chosen index and the user must pan/swipe
  // themselves (per the no-autoscroll hard rule).
  useEffect(() => {
    // Selection-stability rule: if the previously-selected listing is still
    // in the freshly-built deck (e.g. the user panned but the same listing
    // is still in the new viewport's results), KEEP it selected. Listing
    // ids are unique primary keys so a match here is not coincidental — it
    // really is the same listing. We only fall through to the find-visible
    // fallback when the tracked listing is genuinely gone from the deck
    // (filter excluded it, or it left the queried area entirely).
    const trackedId = currentListingIdRef.current;
    const trackedIdx = trackedId === null ? -1 : deck.findIndex((l) => l.id === trackedId);

    if (trackedIdx >= 0) {
      if (trackedIdx !== currentIndex) setCurrentIndex(trackedIdx);
      return;
    }

    // Tracked listing missing (deleted from deck, OR deck just rebuilt from
    // a fresh-area pan). Find the first deck item whose pin is visible per
    // the occlusion model. Mobile-only — desktop has no occluders registered,
    // so the predicate always returns visible and we pick index 0 anyway.
    if (isMobileViewport === true && leafletMap && deck.length > 0) {
      const mapRect = leafletMap.getContainer().getBoundingClientRect();
      const occluders = occluderRegistry?.getAll() ?? [];
      const SEARCH_CAP = 40;
      const end = Math.min(deck.length, SEARCH_CAP);
      for (let i = 0; i < end; i++) {
        const cand = deck[i];
        if (!cand || cand.lat == null || cand.lon == null) continue;
        const vp = projectPinToViewport(leafletMap, cand.lat, cand.lon);
        if (!vp) continue;
        if (isPinVisible(vp, mapRect, occluders).visible) {
          if (i !== currentIndex) setCurrentIndex(i);
          currentListingIdRef.current = cand.id;
          return;
        }
      }
    }

    // No visible candidate (or map not ready / desktop). Either we're on
    // initial load (trackedId === null) or the previously-selected listing
    // is genuinely gone from the deck — in both cases reset to index 0
    // (clamping if the deck is shorter than the current index).
    if (currentIndex >= deck.length && deck.length > 0) {
      setCurrentIndex(deck.length - 1);
    } else if (currentIndex !== 0 && deck.length > 0) {
      setCurrentIndex(0);
    }
  }, [deck, leafletMap]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentListing = deck[currentIndex] ?? null;
  const totalRemaining = deck.length - currentIndex;

  // Keep tracked ID in sync with what's currently displayed
  useEffect(() => {
    currentListingIdRef.current = currentListing?.id ?? null;
  }, [currentListing?.id]);

  // One-shot pulldown-tray bounce hint. The first time a user sees a swipe
  // card on this browser, animate the floating mobile card down ~22px and
  // spring back to telegraph that the tray is draggable. Gated by a
  // localStorage flag so it only ever runs once. Respects reduce-motion.
  useEffect(() => {
    if (bouncePlayedRef.current) return;
    if (isMobileViewport !== true) return;
    if (!currentListing) return;
    if (mobileCardDismissed) return;
    if (typeof window === 'undefined') return;

    let seen = false;
    try {
      seen = window.localStorage.getItem('dwelligence_swipe_tray_hint_seen') === '1';
    } catch {
      seen = true;
    }
    if (seen) {
      bouncePlayedRef.current = true;
      return;
    }

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      bouncePlayedRef.current = true;
      try { window.localStorage.setItem('dwelligence_swipe_tray_hint_seen', '1'); } catch { /* noop */ }
      return;
    }

    bouncePlayedRef.current = true;
    bounceActiveRef.current = true;

    // Drive `mobileCardDragY` via framer-motion (already in deps). The
    // wrapper applies translateY(mobileCardDragY)px, so animating the
    // state directly produces the visible bounce. Down ~22px, then spring
    // back with a bouncy spring.
    const controls = animate(0, 22, {
      duration: 0.18,
      ease: 'easeOut',
      onUpdate: (v) => setMobileCardDragY(v),
      onComplete: () => {
        const spring = animate(22, 0, {
          type: 'spring',
          stiffness: 320,
          damping: 14,
          onUpdate: (v) => setMobileCardDragY(v),
          onComplete: () => {
            setMobileCardDragY(0);
            bounceActiveRef.current = false;
            try {
              window.localStorage.setItem('dwelligence_swipe_tray_hint_seen', '1');
            } catch { /* noop */ }
          },
        });
        cleanup = () => spring.stop();
      },
    });
    let cleanup = () => controls.stop();
    return () => {
      cleanup();
      bounceActiveRef.current = false;
    };
  }, [isMobileViewport, currentListing, mobileCardDismissed]);

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


  // On mobile, auto-show the TWO closest subway stations on the map with
  // a walking-time tooltip (no hover needed).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.innerWidth >= 600) return; // desktop keeps hover behavior
    if (!currentListing?.lat || !currentListing?.lon) {
      setHoveredStations(null);
      return;
    }
    const nearest = getClosestStations(currentListing.lat, currentListing.lon, 2)
      .filter(({ station }) => Array.isArray(station.lines) && station.lines.length > 0);
    if (nearest.length > 0) {
      setHoveredStations(nearest.map(({ station, distMi }) => ({
        lat: station.lat,
        lon: station.lon,
        name: station.name,
        lines: station.lines,
        walkMin: walkMinFromMiles(distMi),
        distMi,
      })));
    } else {
      setHoveredStations(null);
    }
  }, [currentListing?.id, currentListing?.lat, currentListing?.lon]);

  // Re-set two-nearest subway stations when mobile map overlay opens
  useEffect(() => {
    if (!showMobileMap || typeof window === 'undefined' || window.innerWidth >= 600) return;
    if (!currentListing?.lat || !currentListing?.lon) return;
    const nearest = getClosestStations(currentListing.lat, currentListing.lon, 2)
      .filter(({ station }) => Array.isArray(station.lines) && station.lines.length > 0);
    if (nearest.length > 0) {
      setHoveredStations(nearest.map(({ station, distMi }) => ({
        lat: station.lat,
        lon: station.lon,
        name: station.name,
        lines: station.lines,
        walkMin: walkMinFromMiles(distMi),
        distMi,
      })));
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

  // ---------------------------------------------------------------------
  // NOTE: Auto-advance-on-pan (the previous "if the user pans the active
  // pin under the card, swap to a visible deck card") has been removed.
  // The hard rule is: the active deck card NEVER changes without a direct
  // user gesture (a swipe or a pin tap). If the user pans so the active
  // pin is occluded, the deck stays put — they can swipe or tap a visible
  // pin to move forward. The deck-rebuild first-visible scan above (in the
  // restore-position effect) is the ONLY remaining "auto-pick" and runs
  // only on a fresh deck (e.g. brand-new fresh-area pan with no tracked
  // id), and only ever calls `setCurrentIndex` — it never moves the map.
  // ---------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Swipe handler
  // ---------------------------------------------------------------------------
  const handleSwipe = useCallback(
    (direction: 'left' | 'right' | 'down') => {
      const listing = deck[currentIndex];
      if (!listing) return;

      // Any swipe action (button or gesture) dismisses the onboarding overlay.
      dismissOnboarding();

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

      // Haptic feedback on swipe commit — medium for the actionable
      // left/right, lighter for the "later" pass. No-op on web.
      void triggerHaptic(direction === 'down' ? 'light' : 'medium');

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
      // 'down' = pass / "later" — in-session only, no persistent action.
      // Treated the same as left/right for deck purposes: the listing is
      // added to swipedIds so it won't reappear later in the session. This
      // fixes the "last card before empty state is a repeat" bug where a
      // 'down'-swiped card could resurface when the user finished the deck
      // and the restore-position effect clamped currentIndex back into the
      // (still-larger) geoSorted set. Until filters change or the page
      // reloads, a card the user has swiped on never shows up again.

      // Track as swiped — don't increment currentIndex because removing
      // the item from swipedIds causes the deck to recompute, shifting the
      // next item into the current index position automatically. When the
      // user swipes the LAST remaining card the deck shrinks to length 0,
      // currentListing becomes null, and the empty state renders.
      setSwipedIds((prev) => {
        const next = new Set(prev);
        next.add(listing.id);
        return next;
      });

      setUndoStack((prev) => [
        ...prev.slice(-9),
        {
          index: currentIndex,
          listingId: listing.id,
          action: direction,
          wishlistId: direction === 'right' ? (resolvedWishlistId ?? undefined) : undefined,
        },
      ]);
    },
    [currentIndex, deck, userId, onHideListing, resolvedWishlistId, addToWishlist, onLoginRequired, dismissOnboarding],
  );

  // ---------------------------------------------------------------------------
  // Undo
  // ---------------------------------------------------------------------------
  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];

    // Reverse: remove from swipedIds for ALL actions (left/right/down).
    // 'down' now also adds to swipedIds (see handleSwipe) so undoing it
    // must symmetrically remove the id, otherwise the card stays gone.
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
    // item's new index and restore currentIndex to it. This applies to all
    // three swipe directions now that 'down' also tracks via swipedIds.
    pendingUndoId.current = last.listingId;

    setUndoStack((prev) => prev.slice(0, -1));
  }, [undoStack, onUnhideListing, resolvedWishlistId, removeFromWishlist]);

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
      // If the mobile card was dismissed, tapping a pin brings it back.
      if (mobileCardDismissed) {
        setMobileCardDismissed(false);
        setMobileCardDragY(0);
      }
    }
  }, [deck, mobileCardDismissed]);

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

  // Mobile backdrop map renders the FULL listing set (same as desktop)
  // plus all saved-listing pins — giving the user spatial context for every
  // result. Subway pins remain as-is (controlled via the subway overlay
  // toggle inside MapInner). The active listing is visually emphasized via
  // the selectedId ring. The map NEVER auto-pans/zooms — if the active
  // pin is occluded by the floating card, the user pans themselves or
  // taps a different visible pin. Per the no-autoscroll hard rule.

  // Note: occluder registrations (swipe card, action pill) still flow into
  // the OccluderRegistry, but they're consumed only by:
  //   1. BoundsWatcher.fireBounds (to shrink the queried bbox to the
  //      visible region — does NOT move the map)
  //   2. The fresh-deck first-visible-pin scan in the deck-restore effect
  //      above (only calls setCurrentIndex — does NOT move the map)
  // No code path uses occluders to pan/zoom the map.

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
            isPanningRef={isPanningRef}
            initialCenter={initialCenter}
            initialZoom={initialZoom}
            visible={true}
            commuteInfoMap={commuteInfoMap}
            hoveredStations={hoveredStations}
          />
        </div>
      )}

      {/* Mobile full-bleed map backdrop — Option D layout.
          Fills the entire mobile viewport; the swipe card floats over it
          in the middle-lower area with rounded corners on all sides, and
          the action pill sits at the very bottom. Map shows above the card
          (top area with floating nav/filter pills) and below the card
          (between card bottom and the action pill). Only mounts on mobile
          viewports to avoid running two Leaflet instances side-by-side on
          desktop. */}
      {isMobileViewport === true && (
        <div
          className="absolute inset-0 z-0 min-[600px]:hidden"
          style={{ overflow: 'hidden' }}
        >
          {hasOpenedMap && (
            <MapComponent
              // Full-bleed mobile map renders the full listing set (same as
              // desktop) plus saved-listing pins, so the user sees every
              // result in spatial context. The active card's pin is
              // highlighted via selectedId. The map NEVER auto-pans/zooms
              // for any reason — if the active pin is occluded by the
              // floating card, the user can pan themselves or tap a
              // visible pin to swap to it.
              listings={mapListings as unknown as Database['public']['Tables']['listings']['Row'][]}
              selectedId={currentListing?.id ?? null}
              onMarkerClick={handleMarkerClick}
              onSelectDetail={() => {}}
              favoritedIds={mapFavoritedIds}
              onHideListing={() => {}}
              // Wire bounds/move callbacks so user-initiated pan/zoom on the
              // full-bleed map re-queries listings for the new viewport.
              onBoundsChange={onBoundsChange}
              onMapMove={(center, zoom) => { mapCenterRef.current = center; onMapMove?.(center, zoom); }}
              suppressBoundsRef={suppressBoundsRef}
              isPanningRef={isPanningRef}
              visible={true}
              commuteInfoMap={commuteInfoMap}
              initialCenter={currentListing?.lat && currentListing?.lon ? [currentListing.lat, currentListing.lon] : initialCenter}
              initialZoom={15}
              hoveredStations={hoveredStations}
              // Mobile swipe: pin tap selects listing as the active swipe
              // card (via handleMarkerClick) and suppresses the desktop
              // popup/tooltip. Cluster taps zoom in instead of opening
              // the cluster popup. Desktop swipe + list/map views keep
              // the popup — only this mobile-full-bleed map uses swipe
              // selection.
              swipeSelectMode={true}
            />
          )}
        </div>
      )}

      {/* Mobile floating Filters pill — moved to MobileMenuPill (Option C
          merged "Filters | Avatar" pill rendered by page.tsx top-level). The
          new pill is mounted across all mobile views (swipe + list + map)
          because the global Navbar is hidden on mobile. */}

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
            isPanningRef={isPanningRef}
            // Expanded mobile map overlay is still part of swipe mode —
            // the user tapped "Full map" from the swipe card but the
            // swipe deck is still the primary UI. Pin tap should select
            // the listing (bringing its card to the front) rather than
            // open the desktop popup.
            swipeSelectMode={true}
            visible={showMobileMap}
            commuteInfoMap={commuteInfoMap}
            initialCenter={currentListing?.lat && currentListing?.lon ? [currentListing.lat, currentListing.lon] : initialCenter}
            initialZoom={15}
            hoveredStations={hoveredStations}
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

      {/* Floating detail panel.
          Desktop (≥600px): right-anchored 440px wide column, top:76px, bottom:0
            (original behavior — unchanged).
          Mobile (<600px): floating card — horizontal gutters of 12px, top
            starts at 42vh so the map is full-bleed above, bottom stops ~88px
            above the screen edge so the action pill (bottom: 12px + safe-area,
            height: 52px) has ~24px of map visible between it and the card.
          `topInset` was the height of an overlaying filter bar — on mobile
          swipe the filter bar is now hidden (body[data-swipe-mobile]) so we
          no longer need to reserve space for it. Keep the CSS var for any
          future use but it stays 0 in practice. */}
      <div
        ref={mobileSwipeCardRef}
        className="swipe-detail-panel absolute z-10 flex flex-col"
        data-testid="swipe-detail-panel"
        data-dismissed={mobileCardDismissed ? 'true' : 'false'}
        style={{
          ['--swipe-top-inset' as string]: `${topInset}px`,
          // Mobile-only translate: follows finger during drag, slides off
          // to window-height when dismissed, snaps back to 0 otherwise.
          // Desktop (≥600px) always renders at 0 — the drag handlers are
          // only wired when `isMobileViewport === true`.
          transform: isMobileViewport === true && mobileCardDismissed
            ? 'translateY(100%)'
            : `translateY(${mobileCardDragY}px)`,
          transition: cardDragActiveRef.current || bounceActiveRef.current ? 'none' : 'transform 220ms ease-out',
          // Hide from pointer events when fully dismissed so map pins underneath
          // receive taps. The "Show listing" pill renders via a separate overlay.
          pointerEvents: isMobileViewport === true && mobileCardDismissed ? 'none' : undefined,
        }}
      >
        {/* Mobile grabber handle — sits above the photo area, drag-down to
            dismiss. Only rendered on mobile + when a listing exists + when
            the card isn't already dismissed. touchAction:none so the
            browser doesn't scroll instead. */}
        {isMobileViewport === true && currentListing && !mobileCardDismissed && (
          <div
            data-testid="swipe-card-grabber"
            {...grabberBind()}
            style={{
              position: 'absolute',
              top: -40,
              left: 0,
              right: 0,
              height: 40,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              touchAction: 'none',
              cursor: 'grab',
              zIndex: 11,
            }}
          >
            <div
              style={{
                width: 44,
                height: 5,
                borderRadius: 9999,
                backgroundColor: 'rgba(255,255,255,0.65)',
                boxShadow: '0 0 8px rgba(255,255,255,0.3), 0 1px 3px rgba(0,0,0,0.5)',
              }}
            />
            <svg
              width="14"
              height="8"
              viewBox="0 0 14 8"
              fill="none"
              stroke="rgba(255,255,255,0.65)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="2 2 7 6 12 2" />
            </svg>
          </div>
        )}
        {currentListing ? (
          <>
            {/* Card + action bar — fills available space, content scrolls if needed.
                On mobile the card is vertically centered in the area between the top
                navbar and the unified bottom pill (rendered via portal below). The
                ~80px bottom padding reserves space for the pill (52px) + safe area +
                a bit of breathing room. On desktop the card + attached 96px action
                bar keeps its original behavior. */}
            <div className="flex-1 min-h-0 overflow-hidden min-[600px]:p-0 min-[600px]:pr-3 flex flex-col items-stretch justify-center">
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

              {/* Next card underneath — visible while dragging.
                  Mobile uses 24px radius (Option D floating card look);
                  desktop keeps 12px to match the original attached-card layout. */}
              {currentIndex + 1 < deck.length && (
                <div
                  className="absolute inset-0 rounded-3xl min-[600px]:rounded-xl overflow-hidden"
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
                    className="absolute inset-0 rounded-3xl min-[600px]:rounded-xl"
                    style={{
                      zIndex: 3,
                      backgroundColor: 'rgba(0, 0, 0, 0.12)',
                      pointerEvents: 'none',
                    }}
                  />
                  <div
                    className="absolute inset-0 rounded-3xl min-[600px]:rounded-xl"
                    style={{
                      backgroundColor: 'rgba(28, 32, 40, 0.97)',
                      border: '1px solid #2d333b',
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

              {/* Top card + attached action bar — unified container.
                  Mobile: 24px radius (Option D floating card).
                  Desktop: 12px radius (original attached-bar look). */}
              <div
                data-tour="swipe-card"
                className="absolute inset-0 rounded-3xl min-[600px]:rounded-xl"
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
                    onSubwayHover={setHoveredFromHover}
                    onDragStateChange={(dragging) => {
                      setIsDragging(dragging);
                      if (dragging) dismissOnboarding();
                    }}
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
                  {showOnboarding && isMobileViewport === true ? <SwipeOnboarding /> : null}
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
                aria-disabled={undoStack.length === 0}
                className="absolute left-5 flex items-center gap-1.5 transition-colors cursor-pointer enabled:hover:opacity-100 disabled:opacity-20 disabled:cursor-not-allowed"
                style={{
                  color: undoStack.length === 0 ? '#484f58' : '#8b949e',
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
                <span
                  className="text-[12px]"
                  style={{ color: undoStack.length === 0 ? '#3a4048' : '#6e7681' }}
                >
                  Undo · <span style={{ color: undoStack.length === 0 ? '#484f58' : '#8b949e' }}>Z</span>
                </span>
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
                ref={mobileActionPillRef}
                data-testid="action-pill"
                data-tour="swipe-action-pill"
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
                    aria-disabled={undoStack.length === 0}
                    aria-label="Undo"
                    className="flex items-center justify-center cursor-pointer transition-colors active:scale-95 disabled:opacity-25 disabled:cursor-not-allowed"
                    style={{
                      width: 62,
                      height: 52,
                      background: 'none',
                      border: 'none',
                    }}
                  >
                    <RotateCcw
                      size={20}
                      strokeWidth={2}
                      color={undoStack.length === 0 ? '#484f58' : '#8b949e'}
                    />
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
              style={{ borderColor: '#3d444d', borderTopColor: '#e1e4e8' }}
            />
            <div className="text-sm" style={{ color: '#8b949e' }}>
              Loading listings...
            </div>
          </div>
        ) : listings.length === 0 ? (
          /* No results for current filters. See <MobileSwipeEmptyState>
             docstring — both this branch and the "swiped through
             everything" branch below render the SAME component so they
             can't silently diverge (which is exactly how "Switch to list"
             leaked back into the swiped-through state after commit
             fda31dc). */
          <MobileSwipeEmptyState
            title="No listings found"
            subtitle="Try adjusting your filters or moving the map."
            extra={emptyStateExtra}
            onClearFilters={onClearFilters}
          />
        ) : (
          /* Empty state — user has swiped through every card in the
             current deck. Same CTAs as the no-results branch (Find
             nearest, Unhide listings, Clear filters). */
          <MobileSwipeEmptyState
            emoji="🎉"
            title="You've seen all listings!"
            subtitle="Find another nearby or unhide listings to keep browsing."
            extra={emptyStateExtra}
            onClearFilters={onClearFilters}
          />
        )}
      </div>

      {/* "Show listing" restore pill — appears when the mobile card is
          dismissed via drag-down. Tap or click to bring the card back.
          Only rendered on mobile + when dismissed + when there's something
          to show. Positioned above the bottom dock with safe-area inset. */}
      {isMobileViewport === true && mobileCardDismissed && currentListing && (
        <button
          type="button"
          onClick={showCardAgain}
          data-testid="swipe-card-restore-pill"
          className="absolute min-[600px]:hidden cursor-pointer"
          style={{
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 30,
            height: 40,
            padding: '0 18px',
            background: 'rgba(28,32,40,0.92)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 9999,
            boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: '#e1e4e8',
            fontSize: 13,
            fontWeight: 600,
          }}
          aria-label="Show listing"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15" />
          </svg>
          Show listing
        </button>
      )}

    </div>
  );
}
