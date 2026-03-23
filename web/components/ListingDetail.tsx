'use client';

import { useEffect, useRef, useState } from 'react';
import type { Database } from '@/lib/types';
import { ActionButton, IconButton } from '@/components/ui';
import DetailMap from './DetailMap';

type Listing = Database['public']['Tables']['listings']['Row'];

const TAG_COLORS: Record<string, string> = {
  fulton: '#f97316',
  ltrain: '#a78bfa',
  manhattan: '#38bdf8',
  brooklyn: '#4ade80',
};

const TAG_LABELS: Record<string, string> = {
  fulton: 'Fulton St',
  ltrain: 'L Train',
  manhattan: 'Manhattan',
  brooklyn: 'Brooklyn',
};

interface Person {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
}

interface ListingDetailProps {
  listing: Listing;
  wouldLiveThere: boolean;
  isFavorited: boolean;
  wouldLivePeople: Person[];
  onToggleWouldLive: () => void;
  onToggleFavorite: () => void;
  onClose: () => void;
}

export default function ListingDetail({
  listing,
  wouldLiveThere,
  isFavorited,
  wouldLivePeople,
  onToggleWouldLive,
  onToggleFavorite,
  onClose,
}: ListingDetailProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const photos = listing.photo_urls ?? [];
  const pricePerBed = Math.round(listing.price / listing.beds);
  const tagColor = TAG_COLORS[listing.search_tag] ?? '#8b949e';

  const scrollToPhoto = (index: number) => {
    const clamped = Math.max(0, Math.min(index, photos.length - 1));
    setPhotoIndex(clamped);
    if (scrollRef.current) {
      const child = scrollRef.current.children[clamped] as HTMLElement | undefined;
      child?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    }
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[1000] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        className="relative rounded-xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto"
        style={{ backgroundColor: '#1c2028', border: '1px solid #2d333b' }}
      >
        {/* Photo carousel */}
        {photos.length > 0 ? (
          <div className="relative">
            <div
              ref={scrollRef}
              className="flex overflow-x-auto snap-x snap-mandatory"
              style={{ scrollbarWidth: 'none' }}
              onScroll={(e) => {
                const el = e.currentTarget;
                const idx = Math.round(el.scrollLeft / el.clientWidth);
                setPhotoIndex(idx);
              }}
            >
              {photos.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={`Photo ${i + 1}`}
                  className="snap-start shrink-0 w-full object-cover rounded-t-xl"
                  style={{ height: 300 }}
                />
              ))}
            </div>
            {/* Left arrow */}
            {photoIndex > 0 && (
              <IconButton
                variant="overlay"
                size="md"
                onClick={() => scrollToPhoto(photoIndex - 1)}
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full p-1.5"
                aria-label="Previous photo"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </IconButton>
            )}
            {/* Right arrow */}
            {photoIndex < photos.length - 1 && (
              <IconButton
                variant="overlay"
                size="md"
                onClick={() => scrollToPhoto(photoIndex + 1)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5"
                aria-label="Next photo"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </IconButton>
            )}
            {/* Counter */}
            <div
              className="absolute bottom-2 right-2 rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: '#e1e4e8' }}
            >
              {photoIndex + 1} / {photos.length}
            </div>
          </div>
        ) : (
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-t-xl text-sm"
            style={{ height: 200, backgroundColor: '#0f1117', color: '#8b949e' }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            No photos available
          </div>
        )}

        {/* Close button */}
        <IconButton
          variant="overlay"
          size="md"
          onClick={onClose}
          className="absolute top-3 right-3 rounded-md p-1.5"
          aria-label="Close detail"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </IconButton>

        <div className="p-6 pb-10">
          {/* Header */}
          <div className="mb-4">
            <h2 className="text-lg font-bold" style={{ color: '#e1e4e8' }}>
              {listing.address}
            </h2>
            <div className="text-sm" style={{ color: '#8b949e' }}>
              {listing.area}
            </div>
          </div>

          {/* Price block */}
          <div className="flex items-baseline gap-3 mb-4">
            <span className="text-2xl font-bold" style={{ color: '#7ee787' }}>
              ${listing.price.toLocaleString()}
            </span>
            <span className="text-sm" style={{ color: '#8b949e' }}>
              /mo
            </span>
            <span className="text-sm" style={{ color: '#8b949e' }}>
              &middot; ${pricePerBed.toLocaleString()}/bed
            </span>
          </div>

          {/* Details grid */}
          <div
            className="grid grid-cols-3 gap-3 rounded-lg p-3 mb-4"
            style={{ backgroundColor: '#0f1117', border: '1px solid #2d333b' }}
          >
            <div className="text-center">
              <div className="text-lg font-bold" style={{ color: '#e1e4e8' }}>
                {listing.beds}
              </div>
              <div className="text-xs" style={{ color: '#8b949e' }}>
                Beds
              </div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold" style={{ color: '#e1e4e8' }}>
                {listing.baths}
              </div>
              <div className="text-xs" style={{ color: '#8b949e' }}>
                Baths
              </div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold" style={{ color: '#e1e4e8' }}>
                {listing.sqft ? listing.sqft.toLocaleString() : '--'}
              </div>
              <div className="text-xs" style={{ color: '#8b949e' }}>
                Sqft
              </div>
            </div>
          </div>

          {/* Transit */}
          {listing.transit_summary && (
            <div className="mb-4">
              <div className="text-xs font-medium mb-1" style={{ color: '#8b949e' }}>
                Transit
              </div>
              <div className="text-sm" style={{ color: '#e1e4e8' }}>
                {listing.transit_summary}
              </div>
            </div>
          )}

          {/* Photos + tag */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs" style={{ color: '#8b949e' }}>
              {listing.photos} photos
            </span>
            <span
              className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
              style={{
                backgroundColor: `${tagColor}20`,
                color: tagColor,
                border: `1px solid ${tagColor}40`,
              }}
            >
              {TAG_LABELS[listing.search_tag] ?? listing.search_tag}
            </span>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 mb-6">
            <ActionButton
              variant="wouldLive"
              active={wouldLiveThere}
              onClick={onToggleWouldLive}
              label={wouldLiveThere ? 'I Would Live There!' : 'I Would Live There'}
            />
            <ActionButton
              variant="favorite"
              active={isFavorited}
              onClick={onToggleFavorite}
              label={isFavorited ? 'Favorited' : 'Favorite'}
            />
          </div>

          {/* Realtor link */}
          <a
            href={listing.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium hover:underline mb-6"
            style={{ color: '#58a6ff' }}
          >
            View on Realtor.com &rarr;
          </a>

          {/* Location map */}
          {listing.lat != null && listing.lon != null && !isNaN(Number(listing.lat)) && !isNaN(Number(listing.lon)) && (
            <div className="mb-6">
              <div className="text-xs font-medium mb-2" style={{ color: '#8b949e' }}>
                Location
              </div>
              <DetailMap lat={listing.lat} lon={listing.lon} />
            </div>
          )}

          {/* Would Live There People */}
          {wouldLivePeople.length > 0 && (
            <div className="mt-2">
              <div className="text-xs font-semibold mb-3" style={{ color: '#8b949e' }}>
                People who would live here
              </div>
              <div className="grid grid-cols-2 gap-2">
                {wouldLivePeople.map((person) => {
                  const letter = (person.display_name ?? person.id).charAt(0).toUpperCase();
                  return (
                    <div
                      key={person.id}
                      className="flex items-center gap-3 rounded-lg p-3"
                      style={{ backgroundColor: '#0f1117', border: '1px solid #2d333b' }}
                    >
                      <div
                        className="flex items-center justify-center rounded-full shrink-0 text-sm font-bold"
                        style={{
                          width: 48,
                          height: 48,
                          backgroundColor: person.avatar_url ? 'transparent' : '#58a6ff',
                          color: '#0f1117',
                          backgroundImage: person.avatar_url ? `url(${person.avatar_url})` : undefined,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                        }}
                      >
                        {!person.avatar_url && letter}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate" style={{ color: '#e1e4e8' }}>
                          {person.display_name ?? 'User'}
                        </div>
                        {person.bio && (
                          <div
                            className="text-xs truncate"
                            style={{ color: '#8b949e' }}
                          >
                            {person.bio}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
