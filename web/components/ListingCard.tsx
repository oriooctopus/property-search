'use client';

import { useState, useRef, useCallback } from 'react';
import type { Database } from '@/lib/types';
import { TAG_COLORS, TAG_LABELS, TAG_DESCRIPTIONS } from '@/lib/tag-constants';
import { formatListedDate, formatAvailabilityDate } from '@/lib/format-date';
import { ActionButton, IconButton } from '@/components/ui';
import PeopleAvatars from './PeopleAvatars';

type Listing = Database['public']['Tables']['listings']['Row'];

const SOURCE_LABELS: Record<string, string> = {
  realtor: 'Realtor.com',
  craigslist: 'Craigslist',
  renthop: 'RentHop',
  apartments: 'Apartments.com',
  streeteasy: 'StreetEasy',
  zillow: 'Zillow',
  facebook: 'Facebook',
};

const SOURCE_DOT_COLORS: Record<string, string> = {
  realtor: '#3b82f6',
  craigslist: '#a855f7',
  streeteasy: '#22c55e',
  zillow: '#006aff',
  facebook: '#1877f2',
  renthop: '#f59e0b',
  apartments: '#ef4444',
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
  wouldLiveThere: boolean;
  wouldLivePeople: Person[];
  isHiding?: boolean;
  commuteInfo?: CommuteInfo;
  onClick: () => void;
  onToggleWouldLive: () => void;
  onToggleFavorite: () => void;
  onExpand: () => void;
  onHide: () => void;
}

export default function ListingCard({
  listing,
  isSelected,
  isFavorited,
  wouldLiveThere,
  wouldLivePeople,
  isHiding,
  commuteInfo,
  onClick,
  onToggleWouldLive,
  onToggleFavorite,
  onExpand,
  onHide,
}: ListingCardProps) {
  const pricePerBed = listing.beds > 0 ? Math.round(listing.price / listing.beds) : null;
  const tagColor = TAG_COLORS[listing.search_tag] ?? '#8b949e';
  const photos = listing.photo_urls ?? [];
  const hasMorePhotosSlide = photos.length === 1;
  const totalPhotos = photos.length + (hasMorePhotosSlide ? 1 : 0);

  const [photoIndex, setPhotoIndex] = useState(0);

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
    onClick();
    onExpand();
  }, [onClick, onExpand]);

  return (
    <div
      className={`rounded-lg cursor-pointer transition-all group ${isHiding ? 'pointer-events-none' : ''}`}
      style={{
        backgroundColor: '#1c2028',
        border: `1px solid ${isSelected ? '#58a6ff' : '#2d333b'}`,
        boxShadow: isSelected ? '0 0 0 1px #58a6ff' : 'none',
        opacity: isHiding ? 0 : 1,
        transform: isHiding ? 'scale(0.95)' : 'scale(1)',
        transition: 'opacity 300ms ease, transform 300ms ease, border-color 150ms ease, box-shadow 150ms ease',
      }}
      onClick={handleCardClick}
    >
      {/* Photo area — always takes same height via aspect-ratio */}
      {totalPhotos > 0 ? (
        <div
          className="relative w-full overflow-hidden select-none rounded-t-lg"
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
          className="relative w-full rounded-t-lg flex items-center justify-center"
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
      {/* Header row: address + price */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          <div className="font-semibold text-sm truncate" style={{ color: '#e1e4e8' }}>
            {listing.address}
          </div>
          <div className="text-xs" style={{ color: '#8b949e' }}>
            {listing.area}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-bold text-sm" style={{ color: '#7ee787' }}>
            ${listing.price.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Details row */}
      <div className="flex items-center gap-3 text-xs mt-2 mb-2" style={{ color: '#8b949e' }}>
        <span>{listing.beds === 0 ? 'Studio' : `${listing.beds} bd`}</span>
        <span>{listing.baths != null && Number(listing.baths) > 0 ? `${listing.baths} ba` : 'N/A ba'}</span>
        <span>{listing.sqft != null && Number(listing.sqft) > 0 ? `${listing.sqft.toLocaleString()} sqft` : 'N/A sqft'}</span>
        {(listing as Record<string, unknown>).year_built != null && (
          <span>Built {String((listing as Record<string, unknown>).year_built)}</span>
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
        {formatListedDate(listing.list_date ?? listing.created_at)}
      </div>

      {/* Tag pill + source badges + actions */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Only show tag pill for known tags with labels (hide raw search_* tags) */}
          {TAG_LABELS[listing.search_tag] && (
          <div className="relative group/tag">
            <span
              className="inline-flex items-center rounded-full px-2.5 h-[22px] text-[10px] font-semibold cursor-default"
              style={{
                backgroundColor: `${tagColor}20`,
                color: tagColor,
                border: `1px solid ${tagColor}40`,
              }}
            >
              {TAG_LABELS[listing.search_tag]}
            </span>
            {TAG_DESCRIPTIONS[listing.search_tag] && (
              <div
                className="pointer-events-none absolute left-0 bottom-full mb-2 opacity-0 group-hover/tag:opacity-100 transition-opacity duration-75 z-50"
              >
                {/* Body */}
                <div
                  className="rounded-md px-2.5 py-1.5 text-xs"
                  style={{
                    backgroundColor: '#1c2028',
                    color: '#e1e4e8',
                    border: '1px solid #2d333b',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                    maxWidth: 'min(280px, calc(100vw - 32px))',
                    width: 'max-content',
                    wordWrap: 'break-word',
                  }}
                >
                  {TAG_DESCRIPTIONS[listing.search_tag]}
                </div>
                {/* Arrow (caret pointing down) */}
                <div
                  className="absolute -bottom-1 w-2 h-2 rotate-45"
                  style={{ left: 16, backgroundColor: '#1c2028', border: '1px solid #2d333b', borderLeft: 'none', borderTop: 'none' }}
                />
              </div>
            )}
          </div>
          )}
          {/* Source badges */}
          {((listing as Record<string, unknown>).sources as string[] | undefined ?? (listing.source ? [listing.source] : [])).map((src) => (
            <span
              key={src}
              className="inline-flex items-center gap-1 rounded-full px-2.5 h-[22px] text-[10px] font-semibold cursor-default"
              style={{
                color: '#8b949e',
                border: '1px solid #2d333b',
              }}
            >
              <span
                className="inline-block rounded-full shrink-0"
                style={{
                  width: 6,
                  height: 6,
                  backgroundColor: SOURCE_DOT_COLORS[src] ?? '#8b949e',
                }}
              />
              {SOURCE_LABELS[src] ?? src}
            </span>
          ))}
          {/* Commute time badge removed — inaccurate for OTP polygon filters.
             Users see actual commute details in the listing detail panel. */}
        </div>

        <div className="flex items-center gap-1">
          {/* Dislike */}
          <ActionButton
            variant="dislike"
            active={false}
            compact
            onClick={(e) => {
              e.stopPropagation();
              onHide();
            }}
          />

          {/* Would live there toggle */}
          <ActionButton
            variant="wouldLive"
            active={wouldLiveThere}
            compact
            onClick={(e) => {
              e.stopPropagation();
              onToggleWouldLive();
            }}
          />

          {/* Like toggle */}
          <ActionButton
            variant="like"
            active={isFavorited}
            compact
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite();
            }}
          />
        </div>
      </div>

      {/* Who would live here + View listing (combined row) */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          {wouldLivePeople.length > 0 ? (
            <PeopleAvatars people={wouldLivePeople} max={4} size={20} />
          ) : (
            <span className="text-[11px]" style={{ color: '#8b949e' }}>
              Be the first to say you&apos;d live here!
            </span>
          )}
        </div>
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
