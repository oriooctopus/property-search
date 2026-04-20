'use client';

import { memo, useState, useRef, useCallback, useMemo } from 'react';
import type { Database } from '@/lib/types';
import { formatListedDate, formatAvailabilityDate } from '@/lib/format-date';
import { ActionButton, IconButton } from '@/components/ui';

type Listing = Database['public']['Tables']['listings']['Row'];

// Active sources: streeteasy, craigslist, facebook-marketplace.
// Legacy keys (realtor, zillow, apartments, renthop, facebook) are kept so
// historical rows written before the April 2026 cleanup still render labels.
const SOURCE_LABELS: Record<string, string> = {
  craigslist: 'Craigslist',
  streeteasy: 'StreetEasy',
  'facebook-marketplace': 'Facebook',
  facebook: 'Facebook',
  realtor: 'Realtor.com',
  renthop: 'RentHop',
  apartments: 'Apartments.com',
  zillow: 'Zillow',
};


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
  commuteInfo?: CommuteInfo;
  onClick: (id: number) => void;
  onStarClick: (listingId: number, anchorRect: DOMRect) => void;
  onExpand: (listing: Listing) => void;
  onHide: (id: number) => void;
}

function ListingCard({
  listing,
  isSelected,
  isFavorited,
  isHiding,
  commuteInfo,
  onClick,
  onStarClick,
  onExpand,
  onHide,
}: ListingCardProps) {
  const pricePerBed = listing.beds > 0 ? Math.round(listing.price / listing.beds) : null;
  const photos = listing.photo_urls ?? [];
  const hasMorePhotosSlide = photos.length === 1;
  const totalPhotos = photos.length + (hasMorePhotosSlide ? 1 : 0);

  const [photoIndex, setPhotoIndex] = useState(0);
  const starButtonRef = useRef<HTMLButtonElement>(null);

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

  return (
    <div
      data-listing-id={listing.id}
      className={`rounded-xl cursor-pointer transition-all group ${isHiding ? 'pointer-events-none' : ''}`}
      style={{
        backgroundColor: '#1c2028',
        border: `1px solid ${isSelected ? '#58a6ff' : '#2d333b'}`,
        boxShadow: isSelected ? '0 0 0 1px #58a6ff' : '0 2px 8px rgba(0,0,0,0.2)',
        opacity: isHiding ? 0 : 1,
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
            {photos.map((url, idx) => (
              <img
                key={idx}
                src={url}
                alt={`${listing.address} photo ${idx + 1}`}
                width={400}
                height={300}
                loading={idx === 0 ? 'eager' : 'lazy'}
                decoding="async"
                style={{
                  width: `${100 / totalPhotos}%`,
                  height: '100%',
                  objectFit: 'cover',
                  flexShrink: 0,
                }}
                draggable={false}
              />
            ))}
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

      {/* Details row with micro-icons */}
      <div className="flex items-center gap-3 text-xs mt-2 mb-2" style={{ color: '#8b949e' }}>
        <span className="flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v-2a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          {listing.beds === 0 ? 'Studio' : listing.beds}
        </span>
        {listing.baths != null && Number(listing.baths) > 0 && (
          <span className="flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h16a1 1 0 0 1 1 1v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-3a1 1 0 0 1 1-1z"/><path d="M6 12V5a2 2 0 0 1 2-2h1"/><circle cx="12" cy="8" r="2"/></svg>
            {listing.baths}
          </span>
        )}
        {listing.sqft != null && Number(listing.sqft) > 0 && (
          <span className="flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 3v18"/></svg>
            {listing.sqft.toLocaleString()}
          </span>
        )}
      </div>

      {/* Transit */}
      {listing.transit_summary && (
        <div className="text-xs mb-2" style={{ color: '#8b949e' }}>
          {listing.transit_summary}
        </div>
      )}

      {/* Date info */}
      <div className="text-[11px] mb-2" style={{ color: '#8b949e' }}>
        {listedDateLabel}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end mt-2">
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
        </div>
      </div>

      {/* View listing link */}
      <div className="mt-2 flex items-center justify-end">
        <a
          href={listing.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            e.stopPropagation();
          }}
          className="text-xs font-medium hover:underline shrink-0 cursor-pointer"
          style={{ color: '#58a6ff' }}
        >
          View on {SOURCE_LABELS[listing.source] ?? 'listing'} &rarr;
        </a>
      </div>
      </div>
    </div>
  );
}

export default memo(ListingCard);
