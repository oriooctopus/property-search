'use client';

import { memo, useState, useRef, useCallback, useMemo } from 'react';
import Image from 'next/image';
import type { Database } from '@/lib/types';
import { formatListedDate, formatAvailabilityDate } from '@/lib/format-date';
import { ActionButton, IconButton, CompactStats } from '@/components/ui';
import ListingCardPeekMap from '@/components/ListingCardPeekMap';
import DestinationChip from '@/components/DestinationChip';
import { useSavedDestination } from '@/lib/hooks/useSavedDestination';
import { useListingDestinationCommutes } from '@/lib/hooks/useDestinationCommutes';

type Listing = Database['public']['Tables']['listings']['Row'];

// Active sources: streeteasy, craigslist, facebook-marketplace.
// Legacy keys (realtor, zillow, apartments, renthop, facebook) are kept so
// historical rows written before the April 2026 cleanup still render labels.
const SOURCE_LABELS: Record<string, string> = {
  craigslist: 'Craigslist',
  streeteasy: 'StreetEasy',
  'facebook-marketplace': 'Facebook Marketplace',
  facebook: 'Facebook',
  realtor: 'Realtor.com',
  renthop: 'RentHop',
  apartments: 'Apartments.com',
  zillow: 'Zillow',
};

// Outlined chip styling per source (from mockup-card-footer-c.html, Treatment B).
// `label` is the short badge text; `color` is the border + text color.
const SOURCE_STYLE: Record<string, { label: string; color: string }> = {
  streeteasy: { label: 'SE', color: '#818cf8' }, // indigo
  craigslist: { label: 'CL', color: '#2dd4bf' }, // teal
  'facebook-marketplace': { label: 'FB', color: '#60a5fa' }, // blue
  realtor: { label: 'R', color: '#fb7185' }, // coral
};

const SOURCE_CHIP_FONT_STACK =
  "'SF Mono', Menlo, Monaco, Consolas, monospace";


interface Person {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface CommuteInfo {
  minutes: number;
  route?: string;
  routeColor?: string;
  destination?: string;
}

interface ListingCardProps {
  listing: Listing;
  isSelected: boolean;
  isFavorited: boolean;
  isHiding?: boolean;
  /** True when this card represents a delisted listing being shown in the
   *  wishlist's "Removed" section — fades the card and shows a small badge
   *  so users can still see what they had saved without thinking it's live. */
  isRemoved?: boolean;
  commuteInfo?: CommuteInfo;
  /** True for cards in the first visible grid row — hints the browser to
   *  prioritize their hero photos (LCP candidates). */
  priority?: boolean;
  /** Sibling listings used to render dimmed context pins inside the card's
   *  tap-to-peek mini-map. Optional — when omitted the peek map shows only
   *  the primary pin + nearest subway. */
  allListings?: Listing[];
  onClick: (id: number) => void;
  onStarClick: (listingId: number, anchorRect: DOMRect) => void;
  onExpand: (listing: Listing) => void;
  onHide: (id: number) => void;
  /** Opens the full map view centered on this listing (uses the existing
   *  `?view=map&listing=<id>` query-param contract). Optional. */
  onOpenFullMap?: (listing: Listing) => void;
}

function ListingCard({
  listing,
  isSelected,
  isFavorited,
  isHiding,
  isRemoved = false,
  commuteInfo,
  priority = false,
  allListings,
  onClick,
  onStarClick,
  onExpand,
  onHide,
  onOpenFullMap,
}: ListingCardProps) {
  const pricePerBed = listing.beds > 0 ? Math.round(listing.price / listing.beds) : null;
  const photos = listing.photo_urls ?? [];
  const hasMorePhotosSlide = photos.length === 1;
  const totalPhotos = photos.length + (hasMorePhotosSlide ? 1 : 0);

  const [photoIndex, setPhotoIndex] = useState(0);
  // Per-card transient peek state — NOT persisted across re-mounts. When the
  // virtualized list scrolls a card out of view it unmounts; coming back
  // mounts a fresh instance so peek correctly resets to false.
  const [peeked, setPeeked] = useState(false);
  const starButtonRef = useRef<HTMLButtonElement>(null);

  const handleTogglePeek = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setPeeked((p) => !p);
  }, []);

  const handleClosePeek = useCallback(() => {
    setPeeked(false);
  }, []);

  const handleOpenFullMap = useCallback(() => {
    setPeeked(false);
    onOpenFullMap?.(listing);
  }, [onOpenFullMap, listing]);

  // Touch/swipe handling
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const handlePrev = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setPhotoIndex((i) => (i - 1 + totalPhotos) % totalPhotos);
  }, [totalPhotos]);

  const handleNext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setPhotoIndex((i) => (i + 1) % totalPhotos);
  }, [totalPhotos]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    // Only count horizontal swipes (ignore vertical scroll)
    if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx)) return;
    if (dx < 0) {
      setPhotoIndex((i) => (i + 1) % totalPhotos);
    } else {
      setPhotoIndex((i) => (i - 1 + totalPhotos) % totalPhotos);
    }
  }, [totalPhotos]);

  const handleCardClick = useCallback((e: React.MouseEvent) => {
    // If the click originated from (or inside) an anchor tag, don't open the detail modal
    const target = e.target as HTMLElement;
    if (target.closest('a')) return;
    onClick(listing.id);
    onExpand(listing);
  }, [onClick, onExpand, listing]);

  const handleHideClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onHide(listing.id);
  }, [onHide, listing.id]);

  const handleStarBtnClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (starButtonRef.current) {
      onStarClick(listing.id, starButtonRef.current.getBoundingClientRect());
    }
  }, [onStarClick, listing.id]);

  // Cache listed-date formatting — avoids rebuilding the Date/locale string
  // on every parent re-render. Recomputes only when list_date changes.
  const listedDateLabel = useMemo(
    () => formatListedDate(listing.list_date ?? listing.created_at),
    [listing.list_date, listing.created_at],
  );

  // Preferred-destination chip (informational; does not filter results).
  const { destinations } = useSavedDestination();
  const destinationCommutes = useListingDestinationCommutes(
    { id: listing.id, lat: listing.lat ?? null, lon: listing.lon ?? null },
    destinations,
  );
  const hasDestination = destinations.length > 0;
  const commutesArr = destinationCommutes ?? [];

  return (
    <div
      data-listing-id={listing.id}
      data-removed={isRemoved ? 'true' : undefined}
      className={`rounded-xl cursor-pointer transition-all group ${isHiding ? 'pointer-events-none' : ''}`}
      style={{
        backgroundColor: '#1c2028',
        border: `1px solid ${isSelected || peeked ? '#58a6ff' : '#2d333b'}`,
        boxShadow:
          isSelected || peeked
            ? '0 0 0 1px rgba(88, 166, 255, 0.35), 0 8px 24px rgba(0,0,0,0.5)'
            : '0 2px 8px rgba(0,0,0,0.2)',
        // Removed cards stay clickable (users may want to inspect why it
        // came down) but are clearly de-emphasized via reduced opacity.
        opacity: isHiding ? 0 : isRemoved ? 0.6 : 1,
        transform: isHiding ? 'scale(0.95)' : 'scale(1)',
        transition: 'opacity 300ms ease, transform 300ms ease, border-color 150ms ease, box-shadow 150ms ease',
      }}
      onClick={handleCardClick}
    >
      {/* Photo area — always takes same height via aspect-ratio */}
      {totalPhotos > 0 ? (
        <div
          className="relative w-full overflow-hidden select-none rounded-t-xl"
          style={{ aspectRatio: '4 / 3' }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Sliding track: all photos in a horizontal strip */}
          <div
            style={{
              display: 'flex',
              width: `${totalPhotos * 100}%`,
              height: '100%',
              transform: `translateX(-${(photoIndex * 100) / totalPhotos}%)`,
              transition: 'transform 300ms ease',
            }}
          >
            {photos.map((url, idx) => {
              // Only the visible slide + its neighbor are worth fetching.
              // Everything else stays lazy/low so off-screen slides don't
              // steal bandwidth from the LCP.
              const isVisible = idx === photoIndex;
              const isNeighbor = Math.abs(idx - photoIndex) === 1;
              const isHero = priority && idx === 0;
              return (
                <div
                  key={idx}
                  style={{
                    position: 'relative',
                    width: `${100 / totalPhotos}%`,
                    height: '100%',
                    flexShrink: 0,
                  }}
                >
                  <Image
                    src={url}
                    alt={`${listing.address} photo ${idx + 1}`}
                    fill
                    // Card is ~1 col on mobile, 2 on tablet, 3 on desktop.
                    // Tell the optimizer the largest rendered width per breakpoint.
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    quality={70}
                    priority={isHero}
                    loading={isHero ? undefined : 'lazy'}
                    fetchPriority={isHero ? 'high' : isVisible || isNeighbor ? 'auto' : 'low'}
                    style={{ objectFit: 'cover' }}
                    draggable={false}
                  />
                </div>
              );
            })}
            {hasMorePhotosSlide && (
              <a
                href={listing.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: `${100 / totalPhotos}%`,
                  height: '100%',
                  flexShrink: 0,
                  backgroundColor: '#161b22',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  textDecoration: 'none',
                }}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                <span style={{ color: '#58a6ff', fontSize: 13, fontWeight: 500 }}>
                  See more photos
                </span>
                <span style={{ color: '#8b949e', fontSize: 11 }}>
                  View on {SOURCE_LABELS[listing.source] ?? 'listing'}
                </span>
              </a>
            )}
          </div>
          {/* Vignette overlay */}
          <div className="absolute inset-0 pointer-events-none z-[1]" style={{ background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.3) 100%)' }} />
          {/* Glass price chip */}
          <div
            className="absolute bottom-2 left-2 z-[3] px-2 py-1 rounded-md text-sm font-bold"
            style={{
              color: '#7ee787',
              background: 'rgba(15, 17, 23, 0.75)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
          >
            ${listing.price.toLocaleString()}<span className="text-xs font-normal" style={{ color: '#8b949e' }}>/mo</span>
          </div>
          {isRemoved && (
            <div
              data-testid="removed-badge"
              className="absolute top-2 left-2 z-[3] px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider"
              style={{
                color: '#fda4af',
                background: 'rgba(15, 17, 23, 0.85)',
                border: '1px solid rgba(244, 63, 94, 0.35)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                letterSpacing: '0.06em',
              }}
            >
              Removed
            </div>
          )}
          {totalPhotos > 1 && (
            <>
              <IconButton
                variant="overlay"
                size="sm"
                onClick={handlePrev}
                className="absolute top-1/2 left-1 -translate-y-1/2 z-[2]"
                aria-label="Previous photo"
              >
                &#8249;
              </IconButton>
              <IconButton
                variant="overlay"
                size="sm"
                onClick={handleNext}
                className="absolute top-1/2 right-1 -translate-y-1/2 z-[2]"
                aria-label="Next photo"
              >
                &#8250;
              </IconButton>
              <div
                className="absolute bottom-1 right-1"
                style={{
                  background: 'rgba(0,0,0,0.6)',
                  color: '#fff',
                  fontSize: 10,
                  padding: '1px 5px',
                  borderRadius: 4,
                  zIndex: 2,
                }}
              >
                {photoIndex + 1}/{totalPhotos}
              </div>
            </>
          )}

          {/* Tap-to-peek mini-map button — top-right of photo area. Only
              renders when we have coordinates to show. */}
          {listing.lat != null && listing.lon != null && (
            <button
              type="button"
              onClick={handleTogglePeek}
              aria-label={peeked ? 'Close map preview' : 'Open map preview'}
              aria-pressed={peeked}
              className="absolute top-2 right-2 z-[4] flex items-center justify-center cursor-pointer"
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: peeked
                  ? 'rgba(88, 166, 255, 0.2)'
                  : 'rgba(13, 17, 23, 0.75)',
                border: `1px solid ${peeked ? '#58a6ff' : 'rgba(88, 166, 255, 0.35)'}`,
                backdropFilter: 'blur(6px)',
                WebkitBackdropFilter: 'blur(6px)',
                transition: 'background 150ms ease, border-color 150ms ease',
                padding: 0,
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M8 1C5.2 1 3 3.2 3 6c0 3.8 5 9 5 9s5-5.2 5-9c0-2.8-2.2-5-5-5zm0 7a2 2 0 110-4 2 2 0 010 4z"
                  fill="#58a6ff"
                />
              </svg>
            </button>
          )}

          {/* Peek overlay — leaflet inner is dynamically loaded, so the
              bundle stays out of non-peeked cards. */}
          {peeked && listing.lat != null && listing.lon != null && (
            <ListingCardPeekMap
              listing={listing}
              nearbyListings={allListings ?? []}
              onClose={handleClosePeek}
              onOpenFullMap={handleOpenFullMap}
            />
          )}
        </div>
      ) : (
        <div
          className="relative w-full rounded-t-xl flex items-center justify-center"
          style={{ aspectRatio: '4 / 3', backgroundColor: '#161b22' }}
        >
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>

          {listing.lat != null && listing.lon != null && (
            <button
              type="button"
              onClick={handleTogglePeek}
              aria-label={peeked ? 'Close map preview' : 'Open map preview'}
              aria-pressed={peeked}
              className="absolute top-2 right-2 z-[4] flex items-center justify-center cursor-pointer"
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: peeked
                  ? 'rgba(88, 166, 255, 0.2)'
                  : 'rgba(13, 17, 23, 0.75)',
                border: `1px solid ${peeked ? '#58a6ff' : 'rgba(88, 166, 255, 0.35)'}`,
                backdropFilter: 'blur(6px)',
                WebkitBackdropFilter: 'blur(6px)',
                transition: 'background 150ms ease, border-color 150ms ease',
                padding: 0,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M8 1C5.2 1 3 3.2 3 6c0 3.8 5 9 5 9s5-5.2 5-9c0-2.8-2.2-5-5-5zm0 7a2 2 0 110-4 2 2 0 010 4z"
                  fill="#58a6ff"
                />
              </svg>
            </button>
          )}

          {peeked && listing.lat != null && listing.lon != null && (
            <ListingCardPeekMap
              listing={listing}
              nearbyListings={allListings ?? []}
              onClose={handleClosePeek}
              onOpenFullMap={handleOpenFullMap}
            />
          )}
        </div>
      )}

      <div className="p-4">
      {/* Header row: address */}
      <div className="mb-1">
        <div className="font-semibold text-sm truncate" style={{ color: '#e1e4e8' }}>
          {listing.address}
        </div>
        <div className="text-xs" style={{ color: '#8b949e' }}>
          {listing.area}
        </div>
      </div>

      {/* Preferred-destination chip — only renders when user has saved one. */}
      {hasDestination && (
        <div className="mt-2">
          <DestinationChip
            listing={{ id: listing.id, lat: listing.lat ?? null, lon: listing.lon ?? null }}
            destinations={destinations}
            commutes={commutesArr}
          />
        </div>
      )}

      {/* Details row with micro-icons */}
      <CompactStats
        beds={listing.beds}
        baths={listing.baths}
        sqft={listing.sqft}
        className="mt-2 mb-2"
      />

      {/* Transit */}
      {listing.transit_summary && (
        <div className="text-xs mb-2" style={{ color: '#8b949e' }}>
          {listing.transit_summary}
        </div>
      )}

      {/* Footer: listed date + actions + source chip, all on one row */}
      <div className="flex items-center justify-between mt-2">
        <span className="text-[11px]" style={{ color: '#8b949e' }}>
          {listedDateLabel}
        </span>
        <div className="flex items-center gap-1">
          {/* Hide */}
          <ActionButton
            variant="hide"
            active={false}
            compact
            onClick={handleHideClick}
          />

          {/* Save / star toggle */}
          <ActionButton
            ref={starButtonRef}
            variant="save"
            active={isFavorited}
            compact
            onClick={handleStarBtnClick}
          />

          {/* Outlined source chip (links to listing.url) — wrapped in a 44x44
              shell so its outer footprint matches the sibling ActionButtons,
              giving even horizontal spacing between all three footer icons. */}
          {(() => {
            const style = SOURCE_STYLE[listing.source] ?? {
              label: listing.source.slice(0, 2).toUpperCase(),
              color: '#8b949e',
            };
            const sourceName = SOURCE_LABELS[listing.source] ?? 'listing';
            return (
              <span className="p-1.5 rounded-md min-w-[44px] min-h-[44px] flex items-center justify-center cursor-pointer">
                <a
                  href={listing.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`View on ${sourceName}`}
                  className="source-chip"
                  style={{
                    ['--src-color' as string]: style.color,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 20,
                    minWidth: 20,
                    padding: '0 5px',
                    borderRadius: 4,
                    backgroundColor: 'transparent',
                    borderWidth: 1,
                    borderStyle: 'solid',
                    borderColor: style.color,
                    color: style.color,
                    fontFamily: SOURCE_CHIP_FONT_STACK,
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.5px',
                    textTransform: 'uppercase',
                    textDecoration: 'none',
                    flexShrink: 0,
                    lineHeight: 1,
                    transition:
                      'background-color 150ms ease, color 150ms ease, border-color 150ms ease',
                    cursor: 'pointer',
                  }}
                >
                  {style.label}
                </a>
              </span>
            );
          })()}
        </div>
      </div>
      </div>
    </div>
  );
}

export default memo(ListingCard);
