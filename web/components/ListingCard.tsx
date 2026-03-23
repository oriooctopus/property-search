'use client';

import { useState, useRef, useCallback } from 'react';
import type { Database } from '@/lib/types';
import { TAG_COLORS, TAG_LABELS, TAG_DESCRIPTIONS } from '@/lib/tag-constants';
import { ActionButton, IconButton } from '@/components/ui';
import PeopleAvatars from './PeopleAvatars';

type Listing = Database['public']['Tables']['listings']['Row'];

interface Person {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface ListingCardProps {
  listing: Listing;
  isSelected: boolean;
  isFavorited: boolean;
  wouldLiveThere: boolean;
  wouldLivePeople: Person[];
  onClick: () => void;
  onToggleWouldLive: () => void;
  onToggleFavorite: () => void;
  onExpand: () => void;
}

export default function ListingCard({
  listing,
  isSelected,
  isFavorited,
  wouldLiveThere,
  wouldLivePeople,
  onClick,
  onToggleWouldLive,
  onToggleFavorite,
  onExpand,
}: ListingCardProps) {
  const pricePerBed = Math.round(listing.price / listing.beds);
  const tagColor = TAG_COLORS[listing.search_tag] ?? '#8b949e';
  const photos = listing.photo_urls ?? [];
  const totalPhotos = photos.length;

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

  const handleCardClick = useCallback(() => {
    onClick();
    onExpand();
  }, [onClick, onExpand]);

  return (
    <div
      className="rounded-lg cursor-pointer transition-all"
      style={{
        backgroundColor: '#1c2028',
        border: `1px solid ${isSelected ? '#58a6ff' : '#2d333b'}`,
        boxShadow: isSelected ? '0 0 0 1px #58a6ff' : 'none',
      }}
      onClick={handleCardClick}
    >
      {/* Photo carousel with slide animation */}
      {totalPhotos > 0 && (
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
          <div className="text-xs" style={{ color: '#8b949e' }}>
            ${pricePerBed.toLocaleString()}/bed
          </div>
        </div>
      </div>

      {/* Details row */}
      <div className="flex items-center gap-3 text-xs mt-2 mb-2" style={{ color: '#8b949e' }}>
        <span>{listing.beds} bd</span>
        <span>{listing.baths} ba</span>
        {listing.sqft && <span>{listing.sqft.toLocaleString()} sqft</span>}
      </div>

      {/* Transit */}
      {listing.transit_summary && (
        <div className="text-xs mb-2" style={{ color: '#8b949e' }}>
          {listing.transit_summary}
        </div>
      )}

      {/* Tag pill + actions */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-2">
          <div className="relative group">
            <span
              className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold cursor-default"
              style={{
                backgroundColor: `${tagColor}20`,
                color: tagColor,
                border: `1px solid ${tagColor}40`,
              }}
            >
              {TAG_LABELS[listing.search_tag] ?? listing.search_tag}
            </span>
            {TAG_DESCRIPTIONS[listing.search_tag] && (
              <div
                className="pointer-events-none absolute left-0 bottom-full mb-2 opacity-0 group-hover:opacity-100 transition-opacity duration-75 z-50"
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
        </div>

        <div className="flex items-center gap-1">
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

          {/* Favorite toggle */}
          <ActionButton
            variant="favorite"
            active={isFavorited}
            compact
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite();
            }}
          />
        </div>
      </div>

      {/* View listing link */}
      <div className="mt-2 flex items-center justify-end">
        <a
          href={listing.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-xs font-medium hover:underline"
          style={{ color: '#58a6ff' }}
        >
          View listing &rarr;
        </a>
      </div>

      {/* Who would live here */}
      {wouldLivePeople.length > 0 && (
        <div className="mt-2 pt-2" style={{ borderTop: '1px solid #2d333b' }}>
          <PeopleAvatars people={wouldLivePeople} max={4} size={24} />
        </div>
      )}
      </div>
    </div>
  );
}
