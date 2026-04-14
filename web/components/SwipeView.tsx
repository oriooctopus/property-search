'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import { PrimaryButton } from '@/components/ui';
import SwipeCard, { type HoveredStation } from './SwipeCard';
import type { ViewportBounds } from './MapInner';
import type { CommuteInfo } from './ListingCard';
import type { Database } from '@/lib/types';
import { useWishlists, useWishlistMutations } from '@/lib/hooks/useWishlists';
import { getLastUsedWishlistId, setLastUsedWishlistId } from '@/lib/wishlist-storage';
import { geoSort } from '@/lib/geo-sort';

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
  onSaveListing: (id: number, wishlistId: string) => void;
  onExpandDetail?: (listing: SwipeListing) => void;
  onSwitchView?: () => void;
  // Map props passthrough
  onBoundsChange?: (bounds: ViewportBounds) => void;
  onMapMove?: (center: { lat: number; lng: number }, zoom: number) => void;
  suppressBoundsRef?: React.MutableRefObject<boolean>;
  initialCenter?: [number, number];
  initialZoom?: number;
  commuteInfoMap?: Map<number, CommuteInfo>;
}

interface UndoEntry {
  index: number;
  listingId: number;
  action: 'left' | 'right' | 'down';
}

const SWIPED_IDS_KEY = 'dwelligence_swiped_ids';

// ---------------------------------------------------------------------------
// WishlistDropdown — anchored above the Save label, portal-rendered
// ---------------------------------------------------------------------------
interface WishlistDropdownProps {
  wishlists: Array<{ id: string; name: string; wishlist_items: Array<{ listing_id: number }> }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
}

function WishlistDropdown({ wishlists, selectedId, onSelect, onCreate, onClose, anchorRef }: WishlistDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [showInput, setShowInput] = useState(false);
  const [newName, setNewName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ bottom: number; left: number } | null>(null);

  // Compute position above anchor
  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const DROPDOWN_HEIGHT = 260;
    const DROPDOWN_WIDTH = 260;
    const bottom = window.innerHeight - rect.top + 8;
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - DROPDOWN_WIDTH / 2, window.innerWidth - DROPDOWN_WIDTH - 8));
    setPos({ bottom, left });
    // Suppress unused variable warning
    void DROPDOWN_HEIGHT;
  }, [anchorRef]);

  // Click-outside to close
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        // Don't close if click was on the anchor itself (parent handles toggle)
        if (anchorRef.current && anchorRef.current.contains(target)) return;
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, anchorRef]);

  useEffect(() => {
    if (showInput && inputRef.current) inputRef.current.focus();
  }, [showInput]);

  if (!pos || typeof document === 'undefined') return null;

  const content = (
    <div
      ref={dropdownRef}
      style={{
        position: 'fixed',
        bottom: pos.bottom,
        left: pos.left,
        width: 260,
        backgroundColor: '#1c2028',
        border: '1px solid #2d333b',
        borderRadius: '12px',
        boxShadow: '0 16px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)',
        zIndex: 1500,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 14px 10px',
        borderBottom: '1px solid #2d333b',
      }}>
        <span style={{ color: '#e1e4e8', fontSize: '13px', fontWeight: 600 }}>Save to list</span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', padding: '2px', lineHeight: 1, fontSize: 16 }}
        >
          ✕
        </button>
      </div>

      {/* Wishlist rows */}
      <div style={{ padding: '6px 0', maxHeight: 180, overflowY: 'auto' }}>
        {wishlists.length === 0 ? (
          <div style={{ color: '#8b949e', fontSize: '13px', padding: '8px 14px' }}>No wishlists yet</div>
        ) : (
          wishlists.map((wl) => {
            const isSelected = wl.id === selectedId;
            return (
              <button
                key={wl.id}
                onClick={() => { onSelect(wl.id); onClose(); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '8px 14px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background-color 100ms',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                {/* Radio dot */}
                <div style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  border: isSelected ? 'none' : '1.5px solid #3d444d',
                  backgroundColor: isSelected ? '#58a6ff' : 'transparent',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 100ms',
                }}>
                  {isSelected && (
                    <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#0d1117' }} />
                  )}
                </div>
                <span style={{ color: '#e1e4e8', fontSize: '13px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {wl.name}
                </span>
                <span style={{ color: '#8b949e', fontSize: '11px', flexShrink: 0 }}>
                  {wl.wishlist_items.length}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Divider */}
      <div style={{ height: 1, backgroundColor: '#2d333b', margin: '0' }} />

      {/* Create new */}
      <div style={{ padding: '6px 10px 8px' }}>
        {showInput ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              ref={inputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim()) {
                  onCreate(newName.trim());
                  setNewName('');
                  setShowInput(false);
                  onClose();
                } else if (e.key === 'Escape') {
                  setShowInput(false);
                  setNewName('');
                }
              }}
              placeholder="List name"
              style={{
                flex: 1,
                backgroundColor: '#0d1117',
                border: '1px solid #3d444d',
                borderRadius: 6,
                color: '#e1e4e8',
                fontSize: '13px',
                padding: '5px 8px',
                outline: 'none',
                minWidth: 0,
              }}
            />
            <button
              onClick={() => {
                if (newName.trim()) {
                  onCreate(newName.trim());
                  setNewName('');
                  setShowInput(false);
                  onClose();
                }
              }}
              style={{
                backgroundColor: '#58a6ff',
                color: '#0d1117',
                border: 'none',
                borderRadius: 6,
                fontSize: '12px',
                fontWeight: 600,
                padding: '5px 10px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Add
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowInput(true)}
            style={{
              color: '#58a6ff',
              fontSize: '13px',
              background: 'none',
              border: 'none',
              padding: '4px 4px',
              cursor: 'pointer',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(88,166,255,0.08)'; e.currentTarget.style.width = '100%'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            + Create new list
          </button>
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

function loadSwipedIds(): Set<number> {
  try {
    const raw = localStorage.getItem(SWIPED_IDS_KEY);
    if (raw) return new Set(JSON.parse(raw) as number[]);
  } catch { /* ignore */ }
  return new Set();
}

export default function SwipeView({
  listings,
  userId,
  onHideListing,
  onSaveListing,
  onExpandDetail,
  onSwitchView,
  onBoundsChange,
  onMapMove,
  suppressBoundsRef,
  initialCenter,
  initialZoom,
  commuteInfoMap,
}: SwipeViewProps) {
  // Don't persist swipedIds across refreshes — start fresh each session.
  // The localStorage was causing "You've seen all listings" on every refresh.
  const [swipedIds, setSwipedIds] = useState<Set<number>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [authToast, setAuthToast] = useState(false);
  const [wishlistDropdownOpen, setWishlistDropdownOpen] = useState(false);
  const [hoveredStation, setHoveredStation] = useState<HoveredStation | null>(null);
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

  // Wishlist hooks
  const { data: wishlists = [] } = useWishlists(userId);
  const { addToWishlist, createWishlist } = useWishlistMutations(userId);

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

  // Reset index when listings change (new viewport / filters)
  const listingIds = useMemo(() => new Set(listings.map((l) => l.id)), [listings]);
  useEffect(() => {
    setCurrentIndex(0);
  }, [listingIds]);

  // Geo-sort once when listings change, seeded from the current map center
  // so the first listing is nearest to what the user is looking at.
  const geoSorted = useMemo(() => {
    const c = mapCenterRef.current;
    return geoSort(listings, c?.lat, c?.lng);
  }, [listings]);
  const deck = useMemo(
    () => geoSorted.filter((l) => !swipedIds.has(l.id)),
    [geoSorted, swipedIds],
  );

  const currentListing = deck[currentIndex] ?? null;
  const totalRemaining = deck.length - currentIndex;

  // ---------------------------------------------------------------------------
  // Swipe handler
  // ---------------------------------------------------------------------------
  const handleSwipe = useCallback(
    (direction: 'left' | 'right' | 'down') => {
      const listing = deck[currentIndex];
      if (!listing) return;

      // Auth check for save (right)
      if (direction === 'right' && !userId) {
        setAuthToast(true);
        setTimeout(() => setAuthToast(false), 3000);
        return;
      }

      // Execute the action
      // Note: don't call onHideListing for left swipes — SwipeView tracks
      // its own swipedIds. Calling the parent would cause filteredListings
      // to recompute 300ms later, reshuffling the geo-sorted deck mid-flyTo.
      if (direction === 'right') {
        const wlId = resolvedWishlistId;
        if (wlId) {
          addToWishlist.mutate({ wishlistId: wlId, listingId: listing.id });
          setLastUsedWishlistId(wlId);
        }
        onSaveListing(listing.id, wlId ?? 'default');
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
          { index: currentIndex, listingId: listing.id, action: direction },
        ]);
      }
    },
    [currentIndex, deck, userId, onHideListing, onSaveListing, resolvedWishlistId, addToWishlist],
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
        localStorage.setItem(SWIPED_IDS_KEY, JSON.stringify([...next]));
        return next;
      });
      if (last.action === 'right') {
        setSavedIds((prev) => { const next = new Set(prev); next.delete(last.listingId); return next; });
      }
    }

    setUndoStack((prev) => prev.slice(0, -1));
    // Only decrement index for 'down' (pass) — for left/right the deck
    // recomputes to re-insert the item at the same position.
    if (last.action === 'down') {
      setCurrentIndex((prev) => Math.max(0, prev - 1));
    }
  }, [undoStack]);

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------
  const handleReset = () => {
    setSwipedIds(new Set());
    localStorage.removeItem(SWIPED_IDS_KEY);
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

  return (
    <div className="relative flex-1 min-h-0 flex overflow-hidden" style={{ height: '100%' }}>
      {/* Full-screen map backdrop */}
      <div className="absolute inset-0 z-0">
        <MapComponent
          listings={mapListings as unknown as Database['public']['Tables']['listings']['Row'][]}
          selectedId={currentListing?.id ?? null}
          onMarkerClick={() => {}}
          onSelectDetail={() => {}}
          favoritedIds={savedIds}
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

      {/* Floating detail panel on the right */}
      <div
        className="absolute right-0 bottom-0 z-10 flex flex-col"
        style={{ width: 440, top: 0 }}
      >
        {currentListing ? (
          <>
            {/* Card + action bar — fills available space, content scrolls if needed */}
            <div className="flex-1 min-h-0 overflow-hidden pr-3 flex flex-col">
            <div className="relative w-full my-auto">
              {/* Invisible layout card to establish natural height (card + action bar) */}
              <div className="invisible">
                <SwipeCard
                  listing={currentListing}
                  onSwipe={() => {}}
                  onExpandDetail={() => {}}
                  isTop={false}
                  layoutOnly
                />
                <div style={{ height: 120 }} />
              </div>

              {/* Stack visual: background card */}
              {currentIndex + 1 < deck.length && (
                <div
                  className="absolute inset-0 rounded-xl border"
                  style={{
                    backgroundColor: 'rgba(28, 32, 40, 0.93)',
                    borderColor: '#2d333b',
                    transform: 'scale(0.95) translateY(10px)',
                    zIndex: 1,
                  }}
                />
              )}

              {/* Top card + attached action bar — unified container */}
              <div
                className="absolute inset-0 rounded-xl overflow-hidden"
                style={{
                  zIndex: 2,
                  backgroundColor: 'rgba(28, 32, 40, 0.97)',
                  border: '1px solid #2d333b',
                }}
              >
                {/* Card portion */}
                <div className="absolute top-0 left-0 right-0" style={{ bottom: 120 }}>
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
                  />
                </div>
                {/* Action bar attached to bottom of card */}
                <div
                  className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-5 py-4"
                  style={{
                    height: 120,
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
                <span className="text-[11px]" style={{ color: '#6e7681' }}>Undo · <span style={{ color: '#8b949e' }}>Z</span></span>
              </div>

              {/* Center: ← Hide, [↑/↓ pill], → Save */}
              <div className="flex items-center gap-5">
                {/* Hide ← */}
                <div className="flex flex-col items-center gap-1">
                  <button
                    ref={hideBtnRef}
                    onClick={() => { flashButton(hideBtnRef); handleSwipe('left'); }}
                    className="w-12 h-12 rounded-full flex items-center justify-center border transition-all active:scale-95 active:bg-white/15 cursor-pointer"
                    style={{ borderColor: '#3d444d', color: '#8b949e' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(88,166,255,0.12)'; e.currentTarget.style.borderColor = '#58a6ff'; e.currentTarget.style.color = '#58a6ff'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderColor = '#3d444d'; e.currentTarget.style.color = '#8b949e'; }}
                    title="Hide (←)"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="19" y1="12" x2="5" y2="12" />
                      <polyline points="12 19 5 12 12 5" />
                    </svg>
                  </button>
                  <span className="text-[11px]" style={{ color: '#8b949e' }}>Hide</span>
                </div>

                {/* ↑/↓ vertical pill */}
                <div className="flex flex-col items-center gap-1">
                  <div
                    className="flex flex-col items-center overflow-hidden border transition-all"
                    style={{ borderColor: '#3d444d', borderRadius: 22, width: 40 }}
                  >
                    {/* Photos ↑ */}
                    <button
                      ref={photoBtnRef}
                      onClick={() => { flashButton(photoBtnRef); enterPhotoFocusRef.current?.(); }}
                      className="w-full flex items-center justify-center transition-all active:scale-95 active:bg-white/15 cursor-pointer"
                      style={{ height: 32, color: '#8b949e', background: 'transparent' }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(88,166,255,0.12)'; e.currentTarget.style.color = '#58a6ff'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#8b949e'; }}
                      title="Photos (↑)"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="19" x2="12" y2="5" />
                        <polyline points="5 12 12 5 19 12" />
                      </svg>
                    </button>
                    {/* Divider */}
                    <div style={{ width: '100%', height: 1, backgroundColor: '#3d444d' }} />
                    {/* Later ↓ */}
                    <button
                      ref={laterBtnRef}
                      onClick={() => { flashButton(laterBtnRef); handleSwipe('down'); }}
                      className="w-full flex items-center justify-center transition-all active:scale-95 active:bg-white/15 cursor-pointer"
                      style={{ height: 32, color: '#8b949e', background: 'transparent' }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(88,166,255,0.12)'; e.currentTarget.style.color = '#58a6ff'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#8b949e'; }}
                      title="Later (↓)"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <polyline points="19 12 12 19 5 12" />
                      </svg>
                    </button>
                  </div>
                  <span className="text-[11px]" style={{ color: '#8b949e' }}>Photos / Later</span>
                </div>

                {/* Save → same grey, blue on hover */}
                <div ref={saveAnchorRef} className="flex flex-col items-center gap-0.5">
                  <button
                    ref={saveBtnRef}
                    onClick={() => { flashButton(saveBtnRef); handleSwipe('right'); }}
                    className="w-12 h-12 rounded-full flex items-center justify-center border transition-all active:scale-95 active:bg-white/15 cursor-pointer"
                    style={{ borderColor: '#3d444d', color: '#8b949e' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(88,166,255,0.12)'; e.currentTarget.style.borderColor = '#58a6ff'; e.currentTarget.style.color = '#58a6ff'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderColor = '#3d444d'; e.currentTarget.style.color = '#8b949e'; }}
                    title="Save (→)"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </button>
                  <span className="text-[11px]" style={{ color: '#8b949e' }}>Save</span>
                  <button
                    onClick={() => setWishlistDropdownOpen((prev) => !prev)}
                    className="text-[10px] flex items-center gap-0.5 cursor-pointer"
                    style={{
                      color: '#6e7681',
                      background: 'none',
                      border: 'none',
                      padding: '1px 4px',
                      borderRadius: 4,
                      lineHeight: 1,
                      maxWidth: 90,
                      overflow: 'hidden',
                    }}
                    title="Choose wishlist"
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 70 }}>
                      {selectedWishlist ? selectedWishlist.name : 'Save'}
                    </span>
                    <span style={{ flexShrink: 0 }}> ▾</span>
                  </button>
                  {wishlistDropdownOpen && userId && (
                    <WishlistDropdown
                      wishlists={wishlists}
                      selectedId={resolvedWishlistId}
                      onSelect={handleSelectWishlist}
                      onCreate={handleCreateWishlist}
                      onClose={() => setWishlistDropdownOpen(false)}
                      anchorRef={saveAnchorRef}
                    />
                  )}
                </div>
              </div>

              {/* Counter */}
              <span className="text-xs tabular-nums whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.3)' }}>
                {currentIndex + 1} of {deck.length}
              </span>
                </div>{/* action bar */}
              </div>{/* absolute card+bar */}
            </div>{/* relative w-full */}
            </div>{/* flex-1 centering */}
          </>
        ) : (
          /* Empty state */
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

      {/* Auth toast */}
      {authToast && (
        <div
          className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-[#2a2d3a] text-white text-sm px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2"
          style={{ zIndex: 1400 }}
        >
          Sign in to save listings
          <a href="/auth/login" className="font-medium hover:underline ml-1" style={{ color: '#58a6ff' }}>
            Log in
          </a>
        </div>
      )}
    </div>
  );
}
