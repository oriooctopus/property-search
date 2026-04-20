'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { Database } from '@/lib/types';
import { ActionButton, IconButton } from '@/components/ui';
import { formatShortDate } from '@/lib/format-date';
import DetailMap from './DetailMap';
import CommuteItinerary from './CommuteItinerary';
import type { CommuteRule } from '@/components/Filters';
import SUBWAY_STATIONS from '@/lib/isochrone/subway-stations';
import { PARK_COORDS } from '@/lib/park-coords';

type Listing = Database['public']['Tables']['listings']['Row'];

const SOURCE_LABELS: Record<string, string> = {
  craigslist: 'Craigslist',
  streeteasy: 'StreetEasy',
  'facebook-marketplace': 'Facebook',
  facebook: 'Facebook',
  realtor: 'Realtor.com',
  renthop: 'RentHop',
  apartments: 'Apartments.com',
};

/** Map user-facing mode to OTP mode string. */
function commuteOtpMode(mode: 'walk' | 'transit' | 'bike'): string {
  switch (mode) {
    case 'walk': return 'WALK';
    case 'bike': return 'BICYCLE';
    case 'transit': return 'TRANSIT,WALK';
  }
}

/** Resolve the first commute destination from active rules. */
function getCommuteDestination(
  rules: CommuteRule[],
  listingLat?: number | null,
  listingLon?: number | null,
): {
  lat: number;
  lon: number;
  name: string;
  mode: 'walk' | 'transit' | 'bike';
  stationLines?: string[];
} | null {
  for (const rule of rules) {
    // Address rules have explicit lat/lon
    if (rule.type === 'address' && rule.addressLat && rule.addressLon) {
      const shortName = rule.address ? rule.address.split(',')[0].trim() : 'Destination';
      return { lat: rule.addressLat, lon: rule.addressLon, name: shortName, mode: rule.mode };
    }
    // Station rules — check stationName first (set by UI), then stops
    if (rule.type === 'station') {
      const name = rule.stationName || (rule.stops && rule.stops[0]);
      if (name) {
        const station = SUBWAY_STATIONS.find((s) => s.name === name);
        if (station) {
          return { lat: station.lat, lon: station.lon, name: station.name, mode: rule.mode, stationLines: station.lines };
        }
      }
    }
    // Subway-line rules — destination is a station, so use walk/bike mode directly
    if (rule.type === 'subway-line') {
      // If specific stops selected, use the first one
      if (rule.stops && rule.stops.length > 0) {
        const station = SUBWAY_STATIONS.find((s) => s.name === rule.stops![0]);
        if (station) {
          return { lat: station.lat, lon: station.lon, name: station.name, mode: rule.mode, stationLines: station.lines };
        }
      }
      // Otherwise pick nearest station on the selected lines to the listing
      if (rule.lines && rule.lines.length > 0) {
        if (listingLat != null && listingLon != null) {
          const lineSet = new Set(rule.lines);
          const lineStations = SUBWAY_STATIONS.filter(s => s.lines.some(l => lineSet.has(l)));
          if (lineStations.length > 0) {
            let nearest = lineStations[0];
            let minDist = (nearest.lat - listingLat) ** 2 + (nearest.lon - listingLon) ** 2;
            for (const s of lineStations) {
              const d = (s.lat - listingLat) ** 2 + (s.lon - listingLon) ** 2;
              if (d < minDist) { nearest = s; minDist = d; }
            }
            return { lat: nearest.lat, lon: nearest.lon, name: nearest.name, mode: rule.mode, stationLines: nearest.lines };
          }
        }
        // Fallback if no listing coords: pick first station on first line
        const station = SUBWAY_STATIONS.find((s) => s.lines.includes(rule.lines![0]));
        if (station) {
          return { lat: station.lat, lon: station.lon, name: station.name, mode: rule.mode, stationLines: station.lines };
        }
      }
    }
    // Park rules — look up park centroid coordinates
    if (rule.type === 'park' && rule.parkName) {
      const coords = PARK_COORDS[rule.parkName];
      if (coords) {
        return { lat: coords.lat, lon: coords.lon, name: rule.parkName, mode: rule.mode };
      }
    }
  }
  return null;
}

interface ListingDetailProps {
  listing: Listing;
  isFavorited: boolean;
  commuteRules?: CommuteRule[];
  onStarClick: (listingId: number, anchorRect: DOMRect) => void;
  onHide: () => void;
  onClose: () => void;
}

export default function ListingDetail({
  listing,
  isFavorited,
  commuteRules = [],
  onStarClick,
  onHide,
  onClose,
}: ListingDetailProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const starButtonRef = useRef<HTMLButtonElement>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [linkCopied, setLinkCopied] = useState(false);
  const photos = listing.photo_urls ?? [];
  const pricePerBed = listing.beds > 0 ? Math.round(listing.price / listing.beds) : null;
  const commuteDest = getCommuteDestination(commuteRules, listing.lat, listing.lon);

  // Nearest subway station (same data source used for "Nearest Subway" card below).
  // Memoized so we don't iterate all ~467 stations on every render.
  const nearestStations = useMemo(() => {
    const MI_PER_DEG_LAT = 69;
    const MI_PER_DEG_LON = 52;
    if (listing.lat == null || listing.lon == null) return [];
    const lat = listing.lat as number;
    const lon = listing.lon as number;
    return SUBWAY_STATIONS
      .map((s) => {
        const dLat = (s.lat - lat) * MI_PER_DEG_LAT;
        const dLon = (s.lon - lon) * MI_PER_DEG_LON;
        return { station: s, distMi: Math.sqrt(dLat * dLat + dLon * dLon) };
      })
      .sort((a, b) => a.distMi - b.distMi)
      .slice(0, 2);
  }, [listing.lat, listing.lon]);
  const nearestSubwayForMap = useMemo(() => {
    if (nearestStations.length === 0) return null;
    return {
      lat: nearestStations[0].station.lat,
      lon: nearestStations[0].station.lon,
      name: nearestStations[0].station.name,
      lines: nearestStations[0].station.lines,
    };
  }, [nearestStations]);

  const handleStarClick = useCallback(() => {
    if (starButtonRef.current) {
      onStarClick(listing.id, starButtonRef.current.getBoundingClientRect());
    }
  }, [listing.id, onStarClick]);

  const scrollToPhoto = (index: number) => {
    const clamped = Math.max(0, Math.min(index, photos.length - 1));
    setPhotoIndex(clamped);
    if (scrollRef.current) {
      const child = scrollRef.current.children[clamped] as HTMLElement | undefined;
      child?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    }
  };

  const handleShareLink = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('listing', String(listing.id));
    navigator.clipboard.writeText(url.toString()).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
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
      className="fixed inset-0 z-[1300] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        className="relative rounded-xl w-full max-w-lg mx-4 max-h-[85dvh] overflow-y-auto"
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

        {/* Share + Close buttons */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          <div className="relative">
            <IconButton
              variant="overlay"
              size="md"
              onClick={handleShareLink}
              className="rounded-md p-1.5"
              aria-label="Copy share link"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </IconButton>
            {linkCopied && (
              <div
                className="absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium"
                style={{
                  backgroundColor: '#1c2028',
                  color: '#7ee787',
                  border: '1px solid #2d333b',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                  animation: 'toast-in 150ms ease-out',
                }}
              >
                Link copied!
              </div>
            )}
          </div>
          <IconButton
            variant="overlay"
            size="md"
            onClick={onClose}
            className="rounded-md p-1.5"
            aria-label="Close detail"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </IconButton>
        </div>

        <div className="p-4 pb-8 sm:p-6 sm:pb-10">
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
            {pricePerBed != null && (
              <span className="text-sm" style={{ color: '#8b949e' }}>
                &middot; ${pricePerBed.toLocaleString()}/bed
              </span>
            )}
          </div>

          {/* Dates info */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mb-4 text-xs" style={{ color: '#8b949e' }}>
            <span>Listed: {formatShortDate(listing.list_date ?? listing.created_at)}</span>
          </div>

          {/* Details grid */}
          <div
            className="grid grid-cols-3 gap-3 rounded-lg p-3 mb-4"
            style={{ backgroundColor: '#0f1117', border: '1px solid #2d333b' }}
          >
            <div className="text-center flex flex-col items-center justify-center">
              {listing.beds === 0 ? (
                <div className="text-lg font-bold" style={{ color: '#e1e4e8' }}>
                  Studio
                </div>
              ) : (
                <>
                  <div className="text-lg font-bold" style={{ color: '#e1e4e8' }}>
                    {listing.beds}
                  </div>
                  <div className="text-xs" style={{ color: '#8b949e' }}>
                    Beds
                  </div>
                </>
              )}
            </div>
            <div className="text-center">
              <div className="text-lg font-bold" style={{ color: '#e1e4e8' }}>
                {listing.baths != null ? listing.baths : '--'}
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

          {/* Year Built */}
          {(listing as Record<string, unknown>).year_built != null && (
            <div className="text-sm mb-4" style={{ color: '#8b949e' }}>
              Built in {String((listing as Record<string, unknown>).year_built)}
            </div>
          )}

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

          {/* Nearest subway stations */}
          {nearestStations.length > 0 && (() => {
            const LINE_COLORS: Record<string, string> = {
              '1': '#EE352E', '2': '#EE352E', '3': '#EE352E',
              '4': '#00933C', '5': '#00933C', '6': '#00933C',
              '7': '#B933AD',
              'A': '#0039A6', 'C': '#0039A6', 'E': '#0039A6',
              'B': '#FF6319', 'D': '#FF6319', 'F': '#FF6319', 'M': '#FF6319',
              'G': '#6CBE45',
              'J': '#996633', 'Z': '#996633',
              'L': '#A7A9AC',
              'N': '#FCCC0A', 'Q': '#FCCC0A', 'R': '#FCCC0A', 'W': '#FCCC0A',
              'S': '#808183',
            };
            return (
              <div className="mb-4">
                <div className="text-xs font-medium mb-2" style={{ color: '#8b949e' }}>Nearest Subway</div>
                <div className="flex flex-col gap-2">
                  {nearestStations.map(({ station, distMi }) => {
                    const displayDist = distMi < 0.1 ? '<0.1' : distMi.toFixed(1);
                    return (
                      <div key={station.stopId} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: '#0f1117', border: '1px solid #2d333b' }}>
                        <div className="flex gap-0.5 flex-wrap">
                          {station.lines.map((l) => {
                            const bg = LINE_COLORS[l] ?? '#555';
                            const color = (l === 'N' || l === 'Q' || l === 'R' || l === 'W') ? '#000' : '#fff';
                            return (
                              <span
                                key={l}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: 20,
                                  height: 20,
                                  borderRadius: '50%',
                                  backgroundColor: bg,
                                  color,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  flexShrink: 0,
                                }}
                              >
                                {l}
                              </span>
                            );
                          })}
                        </div>
                        <span className="text-sm" style={{ color: '#e1e4e8' }}>{station.name}</span>
                        <span className="text-sm ml-auto flex-shrink-0" style={{ color: '#8b949e' }}>{displayDist} mi</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Photos */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs" style={{ color: '#8b949e' }}>
              {listing.photos} photos
            </span>
          </div>

          {/* Action row — hide, save, and external link all on one row */}
          <div className="flex items-center gap-1.5 sm:gap-2 mb-6">
            <ActionButton
              variant="hide"
              active={false}
              onClick={() => {
                onHide();
                onClose();
              }}
              className="px-2 py-1.5 text-xs sm:px-4 sm:py-2 sm:text-sm"
              label="Hide"
            />
            <ActionButton
              ref={starButtonRef}
              variant="save"
              active={isFavorited}
              onClick={handleStarClick}
              className="px-2 py-1.5 text-xs sm:px-4 sm:py-2 sm:text-sm"
              label={isFavorited ? 'Saved' : 'Save'}
            />
            {listing.url && (
              <IconButton
                variant="overlay"
                size="md"
                onClick={() => window.open(listing.url, '_blank', 'noopener,noreferrer')}
                className="ml-auto rounded-md p-2"
                aria-label={`View on ${SOURCE_LABELS[listing.source] ?? 'source'}`}
                title={`View on ${SOURCE_LABELS[listing.source] ?? 'source'}`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </IconButton>
            )}
          </div>

          {/* Source attribution */}
          {listing.source && (
            <div className="text-xs mb-6" style={{ color: '#6e7681' }}>
              via {SOURCE_LABELS[listing.source] ?? listing.source}
            </div>
          )}

          {/* Location map */}
          {listing.lat != null && listing.lon != null && !isNaN(Number(listing.lat)) && !isNaN(Number(listing.lon)) && (
            <div className="mb-6">
              <div className="text-xs font-medium mb-2" style={{ color: '#8b949e' }}>
                Location
              </div>
              <DetailMap lat={listing.lat} lon={listing.lon} subway={nearestSubwayForMap} />
            </div>
          )}

          {/* Commute itinerary */}
          {commuteDest && listing.lat != null && listing.lon != null && (
            <CommuteItinerary
              listingLat={listing.lat}
              listingLon={listing.lon}
              destinationLat={commuteDest.lat}
              destinationLon={commuteDest.lon}
              destinationName={commuteDest.name}
              destinationLines={commuteDest.stationLines}
              mode={commuteOtpMode(commuteDest.mode)}
            />
          )}

        </div>
      </div>
    </div>
  );
}
