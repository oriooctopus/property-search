'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PrimaryButton, IconButton } from '@/components/ui';
import SwipeOnboarding from './SwipeOnboarding';

interface SwipeListing {
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
  [key: string]: unknown; // allow extra fields from Listing type
}

interface SwipeViewProps {
  listings: SwipeListing[];
  userId: string | null;
  favoritesSet: Set<number>;
  wouldLiveSet: Set<number>;
  onToggleFavorite: (id: number) => void;
  onToggleWouldLive: (id: number) => void;
  onHideListing: (id: number) => void;
  onExpandDetail: (listing: SwipeListing) => void;
  onSwitchView?: () => void;
}

interface UndoEntry {
  index: number;
  listingId: number;
  action: 'left' | 'right' | 'up';
}

const SWIPED_IDS_KEY = 'dwelligence_swiped_ids';
const ONBOARDED_KEY = 'dwelligence_swipe_onboarded';

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
  favoritesSet,
  wouldLiveSet,
  onToggleFavorite,
  onToggleWouldLive,
  onHideListing,
  onExpandDetail,
  onSwitchView,
}: SwipeViewProps) {
  const [swipedIds, setSwipedIds] = useState<Set<number>>(() => loadSwipedIds());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [authToast, setAuthToast] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [exitDirection, setExitDirection] = useState<'left' | 'right' | 'up' | null>(null);

  useEffect(() => {
    setShowOnboarding(!localStorage.getItem(ONBOARDED_KEY));
  }, []);

  // Filtered deck: exclude already-swiped IDs
  const deck = useMemo(
    () => listings.filter((l) => !swipedIds.has(l.id)),
    [listings, swipedIds],
  );

  const currentListing = deck[currentIndex] ?? null;
  const totalRemaining = deck.length - currentIndex;

  // ---------------------------------------------------------------------------
  // Swipe handler
  // ---------------------------------------------------------------------------
  const handleSwipe = useCallback(
    (direction: 'left' | 'right' | 'up') => {
      const listing = deck[currentIndex];
      if (!listing) return;

      // Auth check for right/up
      if ((direction === 'right' || direction === 'up') && !userId) {
        setAuthToast(true);
        setTimeout(() => setAuthToast(false), 3000);
        return;
      }

      // Execute the action
      if (direction === 'left') onHideListing(listing.id);
      if (direction === 'right') onToggleFavorite(listing.id);
      if (direction === 'up') onToggleWouldLive(listing.id);

      // Animate exit
      setExitDirection(direction);
      setTimeout(() => {
        setExitDirection(null);

        // Track as swiped
        setSwipedIds((prev) => {
          const next = new Set(prev);
          next.add(listing.id);
          localStorage.setItem(SWIPED_IDS_KEY, JSON.stringify([...next]));
          return next;
        });

        // Push to undo stack (max 10)
        setUndoStack((prev) => [
          ...prev.slice(-9),
          { index: currentIndex, listingId: listing.id, action: direction },
        ]);

        // Advance
        setCurrentIndex((prev) => prev + 1);
      }, 250);
    },
    [currentIndex, deck, userId, onHideListing, onToggleFavorite, onToggleWouldLive],
  );

  // ---------------------------------------------------------------------------
  // Undo
  // ---------------------------------------------------------------------------
  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];

    // Reverse the action
    if (last.action === 'left') onHideListing(last.listingId); // toggle unhide
    if (last.action === 'right') onToggleFavorite(last.listingId);
    if (last.action === 'up') onToggleWouldLive(last.listingId);

    // Remove from swiped
    setSwipedIds((prev) => {
      const next = new Set(prev);
      next.delete(last.listingId);
      localStorage.setItem(SWIPED_IDS_KEY, JSON.stringify([...next]));
      return next;
    });

    setUndoStack((prev) => prev.slice(0, -1));
    setCurrentIndex((prev) => Math.max(0, prev - 1));
  }, [undoStack, onHideListing, onToggleFavorite, onToggleWouldLive]);

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
  // Card exit animation styles
  // ---------------------------------------------------------------------------
  const getExitTransform = () => {
    if (!exitDirection) return undefined;
    if (exitDirection === 'left') return 'translateX(-120%) rotate(-15deg)';
    if (exitDirection === 'right') return 'translateX(120%) rotate(15deg)';
    if (exitDirection === 'up') return 'translateY(-120%)';
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const renderCard = (index: number, stackPosition: number) => {
    const listing = deck[index];
    if (!listing) return null;

    const isTop = stackPosition === 0;
    const scale = stackPosition === 0 ? 1 : stackPosition === 1 ? 0.95 : 0.9;
    const translateY = stackPosition === 0 ? 0 : stackPosition === 1 ? 8 : 16;
    const zIndex = 10 - stackPosition;

    const topStyle: React.CSSProperties =
      isTop && exitDirection
        ? { transform: getExitTransform(), opacity: 0, transition: 'transform 250ms ease-out, opacity 250ms ease-out' }
        : {};

    return (
      <div
        key={listing.id}
        className="absolute inset-0 rounded-2xl overflow-hidden bg-[#1a1d27] border border-white/10 shadow-xl"
        style={{
          zIndex,
          transform: `scale(${scale}) translateY(${translateY}px)`,
          transition: 'transform 250ms ease-out, opacity 250ms ease-out',
          ...topStyle,
        }}
      >
        {/* Photo */}
        <div
          className="w-full h-[55%] bg-cover bg-center bg-[#22252f] cursor-pointer"
          style={{
            backgroundImage:
              listing.photo_urls.length > 0
                ? `url(${listing.photo_urls[0]})`
                : undefined,
          }}
          onClick={() => isTop && onExpandDetail(listing)}
        >
          {listing.photo_urls.length === 0 && (
            <div className="flex items-center justify-center h-full text-white/30 text-sm">
              No photo
            </div>
          )}
          {/* Source badge */}
          <div className="absolute top-3 left-3 bg-black/60 text-white text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wide">
            {listing.source}
          </div>
        </div>

        {/* Info */}
        <div className="p-4 flex flex-col gap-1.5" onClick={() => isTop && onExpandDetail(listing)}>
          <div className="text-white font-semibold text-base leading-tight truncate">
            {listing.address}
          </div>
          <div className="text-white/50 text-sm">{listing.area}</div>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[#58a6ff] font-bold text-lg">
              ${listing.price.toLocaleString()}/mo
            </span>
          </div>
          <div className="flex items-center gap-3 text-white/60 text-sm">
            <span>{listing.beds} bed</span>
            <span className="text-white/20">|</span>
            <span>{listing.baths} bath</span>
            {listing.sqft && (
              <>
                <span className="text-white/20">|</span>
                <span>{listing.sqft.toLocaleString()} sqft</span>
              </>
            )}
          </div>
          {listing.list_date && (
            <div className="text-white/30 text-xs mt-1">
              Listed {new Date(listing.list_date).toLocaleDateString()}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full relative">
      {/* Onboarding overlay */}
      {showOnboarding && (
        <SwipeOnboarding onDismiss={() => setShowOnboarding(false)} />
      )}

      {/* Card area */}
      <div className="flex-1 relative flex items-center justify-center px-4 pb-2 overflow-hidden">
        {currentListing ? (
          <div className="relative w-full max-w-sm" style={{ height: '70vh', maxHeight: 520 }}>
            {/* Render up to 3 cards: back to front */}
            {[2, 1, 0].map((stackPos) => {
              const idx = currentIndex + stackPos;
              if (idx >= deck.length) return null;
              return renderCard(idx, stackPos);
            })}
          </div>
        ) : (
          /* Empty state */
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="text-4xl">🎉</div>
            <div className="text-white text-lg font-semibold">
              You&apos;ve seen all listings!
            </div>
            <div className="text-white/50 text-sm">
              Come back later for new ones, or reset to start over.
            </div>
            <div className="flex gap-3 mt-2">
              <PrimaryButton onClick={handleReset}>Reset</PrimaryButton>
              <PrimaryButton variant="green" onClick={onSwitchView}>
                Switch to list view
              </PrimaryButton>
            </div>
          </div>
        )}
      </div>

      {/* Bottom action bar */}
      {currentListing && (
        <div className="flex items-center justify-between px-4 py-3" style={{ height: 80 }}>
          {/* Undo */}
          <button
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            className="w-9 h-9 rounded-full flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Undo"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7v6h6" />
              <path d="M3 13a9 9 0 0 1 15.36-6.36L21 9" />
            </svg>
          </button>

          {/* Action buttons: Hide (left) | Would Live (middle, bigger) | Favorite (right) */}
          <div className="flex items-center gap-5">
            {/* Hide / Skip — red #f85149 */}
            <button
              onClick={() => handleSwipe('left')}
              className="w-14 h-14 rounded-full flex items-center justify-center border-2 transition-colors active:scale-95"
              style={{ borderColor: '#f85149', color: '#f85149' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(248,81,73,0.15)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              title="Skip"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>

            {/* Would Live Here — orange #f97316, bigger center button */}
            <button
              onClick={() => handleSwipe('up')}
              className="w-16 h-16 rounded-full flex items-center justify-center border-2 transition-colors active:scale-95"
              style={{ borderColor: '#f97316', color: '#f97316' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(249,115,22,0.15)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              title="Would live here"
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12l9-9 9 9" />
                <path d="M5 10v10a1 1 0 001 1h3v-5h6v5h3a1 1 0 001-1V10" />
              </svg>
            </button>

            {/* Favorite / Star — gold #fbbf24 */}
            <button
              onClick={() => handleSwipe('right')}
              className="w-14 h-14 rounded-full flex items-center justify-center border-2 transition-colors active:scale-95"
              style={{ borderColor: '#fbbf24', color: '#fbbf24' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(251,191,36,0.15)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              title="Favorite"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </button>
          </div>

          {/* Counter */}
          <span className="text-white/30 text-xs tabular-nums whitespace-nowrap">
            {currentIndex + 1} of {deck.length}
          </span>
        </div>
      )}

      {/* Auth toast */}
      {authToast && (
        <div
          className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-[#2a2d3a] text-white text-sm px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-bottom-4"
          style={{ zIndex: 1400 }}
        >
          Sign in to save favorites
          <a
            href="/login"
            className="text-[#58a6ff] font-medium hover:underline ml-1"
          >
            Log in
          </a>
        </div>
      )}
    </div>
  );
}
