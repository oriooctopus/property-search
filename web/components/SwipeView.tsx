'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import { PrimaryButton } from '@/components/ui';
import SwipeCard from './SwipeCard';
import type { ViewportBounds } from './MapInner';
import type { CommuteInfo } from './ListingCard';
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
  const [swipedIds, setSwipedIds] = useState<Set<number>>(() => loadSwipedIds());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [authToast, setAuthToast] = useState(false);
  const [wishlistDropdownOpen, setWishlistDropdownOpen] = useState(false);
  const saveAnchorRef = useRef<HTMLDivElement>(null);

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

  // Filtered deck: exclude already-swiped IDs
  // Geo-sort once when listings change, then filter out swiped IDs
  const geoSorted = useMemo(() => geoSort(listings), [listings]);
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
      if (direction === 'left') onHideListing(listing.id);
      if (direction === 'right') {
        const wlId = resolvedWishlistId;
        if (wlId) {
          addToWishlist.mutate({ wishlistId: wlId, listingId: listing.id });
          setLastUsedWishlistId(wlId);
        }
        onSaveListing(listing.id, wlId ?? 'default');
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
        // Track as swiped
        setSwipedIds((prev) => {
          const next = new Set(prev);
          next.add(listing.id);
          localStorage.setItem(SWIPED_IDS_KEY, JSON.stringify([...next]));
          return next;
        });

        setUndoStack((prev) => [
          ...prev.slice(-9),
          { index: currentIndex, listingId: listing.id, action: direction },
        ]);

        setCurrentIndex((prev) => prev + 1);
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
    }

    setUndoStack((prev) => prev.slice(0, -1));
    setCurrentIndex((prev) => Math.max(0, prev - 1));
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
          e.preventDefault();
          handleSwipe('left');
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleSwipe('right');
          break;
        case 'ArrowDown':
          e.preventDefault();
          handleSwipe('down');
          break;
        case 'z':
        case 'Z':
          e.preventDefault();
          handleUndo();
          break;
        // Space: don't prevent default — let detail panel scroll naturally
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSwipe, handleUndo]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Convert SwipeListing[] to Listing-compatible shape for Map
  const mapListings = useMemo(() => listings.map((l) => ({
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
  })), [listings]);

  return (
    <div className="relative flex-1 min-h-0 flex overflow-hidden" style={{ height: '100%' }}>
      {/* Full-screen map backdrop */}
      <div className="absolute inset-0 z-0">
        <MapComponent
          listings={mapListings as any}
          selectedId={currentListing?.id ?? null}
          onMarkerClick={() => {}}
          onSelectDetail={() => {}}
          favoritedIds={new Set()}
          onHideListing={() => {}}
          onBoundsChange={onBoundsChange}
          onMapMove={onMapMove}
          suppressBoundsRef={suppressBoundsRef}
          initialCenter={initialCenter}
          initialZoom={initialZoom}
          visible={true}
          commuteInfoMap={commuteInfoMap}
        />
      </div>

      {/* Floating detail panel on the right */}
      <div
        className="absolute right-0 bottom-0 z-10 flex flex-col"
        style={{ width: 420, top: 0 }}
      >
        {currentListing ? (
          <>
            {/* Card centering area — pt accounts for filter bar overlay */}
            <div className="flex-1 min-h-0 flex items-center pr-3 pt-20">
            <div className="relative w-full" style={{ maxHeight: '100%' }}>
              {/* Invisible layout card to establish natural height */}
              <div className="invisible pr-3">
                <SwipeCard
                  listing={currentListing}
                  onSwipe={() => {}}
                  onExpandDetail={() => {}}
                  isTop={false}
                  layoutOnly
                />
              </div>

              {/* Stack visual: background card */}
              {currentIndex + 1 < deck.length && (
                <div
                  className="absolute inset-0 mr-3 rounded-xl border"
                  style={{
                    backgroundColor: 'rgba(28, 32, 40, 0.93)',
                    borderColor: '#2d333b',
                    transform: 'scale(0.95) translateY(10px)',
                    zIndex: 1,
                  }}
                />
              )}

              {/* Top card — the SwipeCard detail panel */}
              <div className="absolute inset-0 mr-3" style={{ zIndex: 2 }}>
                <SwipeCard
                  key={currentListing.id}
                  listing={currentListing}
                  onSwipe={handleSwipe}
                  onExpandDetail={() => onExpandDetail?.(currentListing)}
                  isTop={true}
                />
              </div>
            </div>
            </div>

            {/* Bottom action bar */}
            <div
              className="flex-shrink-0 flex items-center justify-between px-5"
              style={{
                height: 80,
                backgroundColor: 'rgba(13, 17, 23, 0.85)',
                backdropFilter: 'blur(12px)',
                borderTop: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              {/* Undo */}
              <button
                onClick={handleUndo}
                disabled={undoStack.length === 0}
                className="w-10 h-10 rounded-full flex items-center justify-center border transition-colors cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
                style={{ borderColor: '#3d444d', color: '#8b949e' }}
                onMouseEnter={(e) => {
                  if (!e.currentTarget.disabled) {
                    e.currentTarget.style.backgroundColor = 'rgba(139,148,158,0.1)';
                    e.currentTarget.style.borderColor = '#8b949e';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.borderColor = '#3d444d';
                }}
                title="Undo (Z)"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7v6h6" />
                  <path d="M3 13a9 9 0 0 1 15.36-6.36L21 9" />
                </svg>
              </button>

              {/* Center 3 buttons — fixed-width wrappers for even spacing */}
              <div className="flex items-center gap-5">
                {/* Hide */}
                <div className="flex flex-col items-center gap-1" style={{ width: 56 }}>
                  <button
                    onClick={() => handleSwipe('left')}
                    className="w-12 h-12 rounded-full flex items-center justify-center border transition-all active:scale-95 cursor-pointer"
                    style={{ borderColor: '#3d444d', color: '#8b949e' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(139,148,158,0.12)'; e.currentTarget.style.borderColor = '#8b949e'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderColor = '#3d444d'; }}
                    title="Hide (←)"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                  <span className="text-[10px]" style={{ color: '#8b949e' }}>Hide</span>
                </div>

                {/* Later (clock/snooze icon) */}
                <div className="flex flex-col items-center gap-1" style={{ width: 56 }}>
                  <button
                    onClick={() => handleSwipe('down')}
                    className="w-12 h-12 rounded-full flex items-center justify-center border transition-all active:scale-95 cursor-pointer"
                    style={{ borderColor: '#3d444d', color: '#8b949e' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(139,148,158,0.12)'; e.currentTarget.style.borderColor = '#8b949e'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderColor = '#3d444d'; }}
                    title="Pass (↓)"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                  </button>
                  <span className="text-[10px]" style={{ color: '#8b949e' }}>Later</span>
                </div>

                {/* Save — blue accent */}
                <div ref={saveAnchorRef} className="flex flex-col items-center gap-1" style={{ width: 56 }}>
                  <button
                    onClick={() => handleSwipe('right')}
                    className="w-12 h-12 rounded-full flex items-center justify-center border transition-all active:scale-95 cursor-pointer"
                    style={{ borderColor: '#58a6ff', backgroundColor: 'rgba(88,166,255,0.1)', color: '#58a6ff' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(88,166,255,0.2)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(88,166,255,0.1)'; }}
                    title="Save (→)"
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setWishlistDropdownOpen((prev) => !prev)}
                    className="text-[10px] flex items-center gap-0.5 cursor-pointer"
                    style={{
                      color: '#58a6ff',
                      background: 'none',
                      border: 'none',
                      padding: '2px 4px',
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
            </div>
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
