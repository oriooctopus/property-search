'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { useDrag } from '@use-gesture/react';
import SUBWAY_STATIONS from '@/lib/isochrone/subway-stations';

// NYC lat/lon degree-to-miles conversion factors
const MI_PER_DEG_LAT = 69;
const MI_PER_DEG_LON = 52;

function getClosestStations(lat: number, lon: number, count: number) {
  return SUBWAY_STATIONS
    .map((s) => {
      const dLat = (s.lat - lat) * MI_PER_DEG_LAT;
      const dLon = (s.lon - lon) * MI_PER_DEG_LON;
      const distMi = Math.sqrt(dLat * dLat + dLon * dLon);
      return { station: s, distMi };
    })
    .sort((a, b) => a.distMi - b.distMi)
    .slice(0, count);
}

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

function LineBadge({ line }: { line: string }) {
  const bg = LINE_COLORS[line] ?? '#555';
  // Yellow lines need dark text
  const color = (line === 'N' || line === 'Q' || line === 'R' || line === 'W') ? '#000' : '#fff';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 18,
        borderRadius: '50%',
        backgroundColor: bg,
        color,
        fontSize: 10,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {line}
    </span>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  craigslist: 'Craigslist',
  streeteasy: 'StreetEasy',
  'facebook-marketplace': 'FB Marketplace',
  facebook: 'FB Marketplace',
  realtor: 'Realtor.com',
  renthop: 'RentHop',
  apartments: 'Apartments.com',
};

interface SwipeCardListing {
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
  lat?: number | null;
  lon?: number | null;
  list_date?: string | null;
  year_built?: number | null;
  transit_summary?: string | null;
  [key: string]: unknown;
}

export interface HoveredStation {
  lat: number;
  lon: number;
  name: string;
  lines: string[];
}

interface SwipeCardProps {
  listing: SwipeCardListing;
  onSwipe: (direction: 'left' | 'right' | 'down') => void;
  onExpandDetail: () => void;
  isTop: boolean;
  /** Render in normal flow (not absolute) to establish parent height */
  layoutOnly?: boolean;
  /** Called when photo-browsing mode enters or exits */
  onPhotoFocusChange?: (focused: boolean) => void;
  /** Ref callback so parent can imperatively enter photo focus */
  enterPhotoFocusRef?: React.MutableRefObject<(() => void) | null>;
  /** Ref callback so parent can imperatively exit photo focus */
  exitPhotoFocusRef?: React.MutableRefObject<(() => void) | null>;
  /** Called when hovering over a subway station row */
  onSubwayHover?: (station: HoveredStation | null) => void;
}

const SWIPE_X_THRESHOLD = 100;
const SWIPE_Y_THRESHOLD = 100; // down only
const STAMP_FADE_RATIO = 0.5;

export default function SwipeCard({
  listing,
  onSwipe,
  onExpandDetail,
  isTop,
  layoutOnly = false,
  onPhotoFocusChange,
  enterPhotoFocusRef,
  exitPhotoFocusRef,
  onSubwayHover,
}: SwipeCardProps) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const [photoFocused, setPhotoFocused] = useState(false);
  const photoAreaRef = useRef<HTMLDivElement>(null);

  const photos = listing.photo_urls ?? [];
  const totalPhotos = photos.length;

  // Motion values for drag
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // Rotation: tilt proportional to x, origin at bottom center
  const rotate = useTransform(x, [-300, 0, 300], [-12, 0, 12]);

  // Stamp opacities
  const hideOpacity = useTransform(x, [-(SWIPE_X_THRESHOLD * STAMP_FADE_RATIO), -SWIPE_X_THRESHOLD], [0, 1]);
  const saveOpacity = useTransform(x, [SWIPE_X_THRESHOLD * STAMP_FADE_RATIO, SWIPE_X_THRESHOLD], [0, 1]);
  const passOpacity = useTransform(y, [SWIPE_Y_THRESHOLD * STAMP_FADE_RATIO, SWIPE_Y_THRESHOLD], [0, 1]);

  // Background tint opacities
  const leftTint = useTransform(x, [0, -SWIPE_X_THRESHOLD], [0, 0.3]);
  const rightTint = useTransform(x, [0, SWIPE_X_THRESHOLD], [0, 0.3]);
  const bottomTint = useTransform(y, [0, SWIPE_Y_THRESHOLD], [0, 0.25]);

  const isDragging = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Photo-focus mode: arrow keys cycle photos instead of triggering swipe actions
  const enterPhotoFocus = useCallback(() => {
    if (!isTop || totalPhotos < 1) return;
    setPhotoFocused(true);
    onPhotoFocusChange?.(true);
  }, [isTop, totalPhotos, onPhotoFocusChange]);

  const exitPhotoFocus = useCallback(() => {
    setPhotoFocused(false);
    onPhotoFocusChange?.(false);
  }, [onPhotoFocusChange]);

  // Expose enter/exit to parent via refs — assign synchronously so they're
  // available immediately (useEffect runs after paint, causing timing issues)
  if (enterPhotoFocusRef) enterPhotoFocusRef.current = enterPhotoFocus;
  if (exitPhotoFocusRef) exitPhotoFocusRef.current = exitPhotoFocus;

  // Keyboard handler for photo-focus mode
  useEffect(() => {
    if (!photoFocused) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopImmediatePropagation();
        setPhotoIndex((i) => (i - 1 + totalPhotos) % totalPhotos);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopImmediatePropagation();
        setPhotoIndex((i) => (i + 1) % totalPhotos);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        exitPhotoFocus();
      }
    };
    // Use capture so this fires before SwipeView's handler
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [photoFocused, totalPhotos, exitPhotoFocus]);

  // Click-outside to exit photo focus
  useEffect(() => {
    if (!photoFocused) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (photoAreaRef.current && !photoAreaRef.current.contains(e.target as Node)) {
        exitPhotoFocus();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [photoFocused, exitPhotoFocus]);

  const commitSwipe = useCallback((direction: 'left' | 'right' | 'down') => {
    const targets = {
      left: { x: -window.innerWidth * 1.5, y: 0, rotate: -25 },
      right: { x: window.innerWidth * 1.5, y: 0, rotate: 25 },
      down: { x: 0, y: window.innerHeight * 1.5, rotate: 0 },
    };

    const t = targets[direction];
    const springConfig = { stiffness: 300, damping: 20 };

    animate(x, t.x, { type: 'spring', ...springConfig });
    animate(y, t.y, {
      type: 'spring',
      ...springConfig,
      onComplete: () => onSwipe(direction),
    });
  }, [onSwipe, x, y]);

  const bind = useDrag(
    ({ movement: [mx, my], down, velocity: [vx, vy] }) => {
      if (!isTop) return;

      if (down) {
        // Only allow dragging down (positive y) for pass gesture
        // For left/right, track x movement
        const allowedY = my > 0 ? my : 0;
        isDragging.current = Math.abs(mx) > 5 || allowedY > 5;
        x.set(mx);
        y.set(allowedY);
      } else {
        const absX = Math.abs(mx);
        const curY = y.get();

        if (absX > SWIPE_X_THRESHOLD && absX > curY) {
          commitSwipe(mx < 0 ? 'left' : 'right');
        } else if (curY > SWIPE_Y_THRESHOLD && curY > absX) {
          commitSwipe('down');
        } else {
          // Spring back
          const springBack = { type: 'spring' as const, stiffness: 500, damping: 30 };
          animate(x, 0, springBack);
          animate(y, 0, springBack);
        }

        setTimeout(() => { isDragging.current = false; }, 50);
      }
    },
    {
      filterTaps: true,
      pointer: { touch: true },
    }
  );

  // Photo carousel: left/right arrows
  const prevPhoto = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setPhotoIndex((i) => (i - 1 + totalPhotos) % totalPhotos);
  }, [totalPhotos]);

  const nextPhoto = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setPhotoIndex((i) => (i + 1) % totalPhotos);
  }, [totalPhotos]);

  const gestureBindings = isTop ? bind() : {};
  const perBedPrice = listing.beds > 0 ? Math.round(listing.price / listing.beds) : null;

  const nearbyStations = useMemo(() => {
    if (listing.lat == null || listing.lon == null) return [];
    return getClosestStations(listing.lat as number, listing.lon as number, 2);
  }, [listing.lat, listing.lon]);

  const listDateFormatted = listing.list_date
    ? new Date(listing.list_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  // Layout-only mode: render content in normal flow to establish natural height
  if (layoutOnly) {
    return (
      <div className="rounded-xl overflow-hidden flex flex-col" style={{ backgroundColor: 'rgba(28, 32, 40, 0.97)', border: '1px solid #2d333b' }}>
        <div className="w-full flex-shrink-0" style={{ height: 220, backgroundColor: '#0d1117' }} />
        <div className="px-5 py-4 flex flex-col gap-3">
          <div>
            <div className="text-base font-bold leading-snug" style={{ color: '#e1e4e8' }}>{listing.address}</div>
            <div className="text-sm mt-0.5" style={{ color: '#8b949e' }}>{listing.area}</div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold" style={{ color: '#7ee787' }}>${listing.price.toLocaleString()}/mo</span>
          </div>
          {listDateFormatted && <div className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>Listed {listDateFormatted}</div>}
          <div className="grid grid-cols-3 gap-px rounded-lg overflow-hidden" style={{ border: '1px solid #2d333b' }}>
            {[{ label: 'Beds', value: listing.beds === 0 ? 'Studio' : `${listing.beds}` }, { label: 'Baths', value: listing.baths != null ? `${listing.baths}` : 'N/A' }, { label: 'Sqft', value: listing.sqft ? listing.sqft.toLocaleString() : 'N/A' }].map(({ label, value }) => (
              <div key={label} className="flex flex-col items-center py-3 gap-0.5" style={{ backgroundColor: '#161b22' }}>
                <span className="text-sm font-semibold" style={{ color: '#e1e4e8' }}>{value}</span>
                <span className="text-[10px] uppercase tracking-wider" style={{ color: '#8b949e' }}>{label}</span>
              </div>
            ))}
          </div>
          {listing.year_built != null && (
            <div className="text-sm" style={{ color: '#8b949e' }}>Built {listing.year_built}</div>
          )}
          {listing.transit_summary && (
            <div className="flex items-start gap-2 text-sm rounded-lg px-3 py-2.5" style={{ backgroundColor: '#161b22', border: '1px solid #2d333b', color: '#8b949e' }}>
              <span>{listing.transit_summary}</span>
            </div>
          )}
          {listing.lat != null && listing.lon != null && (() => {
            const stations = getClosestStations(listing.lat as number, listing.lon as number, 2);
            if (stations.length === 0) return null;
            return (
              <div className="rounded-lg px-3 py-2.5 flex flex-col gap-2" style={{ backgroundColor: '#161b22', border: '1px solid #2d333b' }}>
                <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: '#8b949e' }}>Nearest Subway</div>
                {stations.map(({ station, distMi }) => (
                  <div key={station.stopId} className="flex items-center gap-2">
                    <div className="flex gap-0.5 flex-wrap">
                      {station.lines.map((l) => <LineBadge key={l} line={l} />)}
                    </div>
                    <span className="text-xs truncate" style={{ color: '#e1e4e8' }}>{station.name}</span>
                    <span className="text-xs ml-auto flex-shrink-0" style={{ color: '#8b949e' }}>{distMi < 0.1 ? '<0.1' : distMi.toFixed(1)} mi</span>
                  </div>
                ))}
              </div>
            );
          })()}
          {totalPhotos > 0 && (
            <div className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>{totalPhotos} photo{totalPhotos !== 1 ? 's' : ''}</div>
          )}
          <div className="flex items-center justify-between pt-1 pb-2">
            <span className="inline-block rounded-full px-2.5 py-0.5 text-xs" style={{ backgroundColor: '#21262d', color: '#8b949e', border: '1px solid #30363d' }}>via {listing.source}</span>
            <span className="text-sm font-medium" style={{ color: '#58a6ff' }}>View details &rarr;</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      {...gestureBindings}
      className="absolute inset-0"
      style={{ touchAction: 'none' }}
    >
      <motion.div
        style={{
          x: isTop ? x : 0,
          y: isTop ? y : 0,
          rotate: isTop ? rotate : 0,
          transformOrigin: 'bottom center',
        }}
        className="w-full h-full shadow-2xl overflow-hidden flex flex-col select-none"
        initial={false}
      >
        {/* Panel background — transparent; outer container owns bg/border */}
        <div className="absolute inset-0" />

        {/* Background tints */}
        <motion.div
          className="absolute inset-0 rounded-xl pointer-events-none z-[1]"
          style={{
            opacity: leftTint,
            background: 'linear-gradient(to right, rgba(139,148,158,0.35), transparent 70%)',
          }}
        />
        <motion.div
          className="absolute inset-0 rounded-xl pointer-events-none z-[1]"
          style={{
            opacity: rightTint,
            background: 'linear-gradient(to left, rgba(88,166,255,0.35), transparent 70%)',
          }}
        />
        <motion.div
          className="absolute inset-0 rounded-xl pointer-events-none z-[1]"
          style={{
            opacity: bottomTint,
            background: 'linear-gradient(to top, rgba(139,148,158,0.3), transparent 60%)',
          }}
        />

        {/* HIDE stamp — top right, grey, rotated -12° */}
        <motion.div
          className="absolute top-6 right-5 z-[5] pointer-events-none"
          style={{ opacity: hideOpacity, rotate: -12 }}
        >
          <div
            className="px-3 py-1.5 text-2xl font-black uppercase tracking-widest"
            style={{ color: '#8b949e', border: '3px solid #8b949e', borderRadius: 6 }}
          >
            HIDE
          </div>
        </motion.div>

        {/* SAVE stamp — top left, blue, rotated 12° */}
        <motion.div
          className="absolute top-6 left-5 z-[5] pointer-events-none"
          style={{ opacity: saveOpacity, rotate: 12 }}
        >
          <div
            className="px-3 py-1.5 text-2xl font-black uppercase tracking-widest"
            style={{ color: '#58a6ff', border: '3px solid #58a6ff', borderRadius: 6 }}
          >
            SAVE
          </div>
        </motion.div>

        {/* PASS stamp — bottom center, muted */}
        <motion.div
          className="absolute bottom-8 left-1/2 -translate-x-1/2 z-[5] pointer-events-none"
          style={{ opacity: passOpacity }}
        >
          <div
            className="px-3 py-1.5 text-2xl font-black uppercase tracking-widest whitespace-nowrap"
            style={{ color: '#8b949e', border: '3px solid #8b949e', borderRadius: 6 }}
          >
            PASS
          </div>
        </motion.div>

        {/* Scrollable content — z-[2] so it's above tints/stamps visually but below stamps */}
        <div
          ref={panelRef}
          className="relative z-[2] flex-1 overflow-y-auto dark-scrollbar"
        >
          {/* Photo carousel */}
          <div
            ref={photoAreaRef}
            className="relative w-full overflow-hidden flex-shrink-0"
            style={{
              height: 220,
              outline: photoFocused ? '2px solid rgba(88,166,255,0.7)' : 'none',
              outlineOffset: '-2px',
              cursor: totalPhotos > 1 && !photoFocused ? 'zoom-in' : 'default',
            }}
            onClick={!photoFocused ? enterPhotoFocus : undefined}
            title={totalPhotos > 1 && !photoFocused ? 'Click to browse photos with arrow keys' : undefined}
          >
            {totalPhotos > 0 ? (
              <>
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

                {/* Arrow buttons */}
                {totalPhotos > 1 && (
                  <>
                    <button
                      onClick={prevPhoto}
                      className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer"
                      style={{ backgroundColor: 'rgba(0,0,0,0.5)', color: '#fff' }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                    <button
                      onClick={nextPhoto}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer"
                      style={{ backgroundColor: 'rgba(0,0,0,0.5)', color: '#fff' }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  </>
                )}

                {/* Photo counter badge */}
                <div
                  className="absolute bottom-2.5 right-3 text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff' }}
                >
                  {photoIndex + 1} / {totalPhotos}
                </div>

                {/* Photo-focus mode indicator */}
                {photoFocused && (
                  <div
                    className="absolute bottom-2.5 left-3 text-xs font-medium px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: 'rgba(88,166,255,0.85)', color: '#fff' }}
                  >
                    ← → to browse · Esc to exit
                  </div>
                )}

                {/* Share link button */}
                <a
                  href={listing.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="absolute top-2.5 right-3 w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer"
                  style={{ backgroundColor: 'rgba(0,0,0,0.5)', color: '#fff' }}
                  title="Open listing"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
              </>
            ) : (
              <div
                className="w-full h-full flex flex-col items-center justify-center"
                style={{ backgroundColor: '#0d1117' }}
              >
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <span className="text-sm mt-2" style={{ color: '#8b949e' }}>No photos</span>
              </div>
            )}
          </div>

          {/* Detail content */}
          <div className="px-5 py-4 flex flex-col gap-3">
            {/* Address + area */}
            <div>
              <div className="text-base font-bold leading-snug" style={{ color: '#e1e4e8' }}>
                {listing.address}
              </div>
              <div className="text-sm mt-0.5" style={{ color: '#8b949e' }}>
                {listing.area}
              </div>
            </div>

            {/* Price */}
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold" style={{ color: '#7ee787' }}>
                ${listing.price.toLocaleString()}/mo
              </span>
              {perBedPrice && (
                <span className="text-sm" style={{ color: '#8b949e' }}>
                  · ${perBedPrice.toLocaleString()}/bed
                </span>
              )}
            </div>

            {/* Listed date */}
            {listDateFormatted && (
              <div className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                Listed {listDateFormatted}
              </div>
            )}

            {/* Stats grid */}
            <div
              className="grid grid-cols-3 gap-px rounded-lg overflow-hidden"
              style={{ border: '1px solid #2d333b' }}
            >
              {[
                {
                  label: 'Beds',
                  value: listing.beds === 0 ? 'Studio' : `${listing.beds}`,
                },
                {
                  label: 'Baths',
                  value: listing.baths != null ? `${listing.baths}` : 'N/A',
                },
                {
                  label: 'Sqft',
                  value: listing.sqft ? listing.sqft.toLocaleString() : 'N/A',
                },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="flex flex-col items-center py-3 gap-0.5"
                  style={{ backgroundColor: '#161b22' }}
                >
                  <span className="text-sm font-semibold" style={{ color: '#e1e4e8' }}>
                    {value}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider" style={{ color: '#8b949e' }}>
                    {label}
                  </span>
                </div>
              ))}
            </div>

            {/* Year built */}
            {listing.year_built != null && (
              <div className="text-sm" style={{ color: '#8b949e' }}>
                Built {listing.year_built}
              </div>
            )}

            {/* Transit summary */}
            {listing.transit_summary && (
              <div
                className="flex items-start gap-2 text-sm rounded-lg px-3 py-2.5"
                style={{ backgroundColor: '#161b22', border: '1px solid #2d333b', color: '#8b949e' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
                  <rect x="2" y="7" width="20" height="14" rx="2" />
                  <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                </svg>
                <span>{listing.transit_summary}</span>
              </div>
            )}

            {/* Nearest subway stations */}
            {nearbyStations.length > 0 && (
              <div
                className="rounded-lg px-3 py-2.5 flex flex-col gap-2"
                style={{ backgroundColor: '#161b22', border: '1px solid #2d333b' }}
                onMouseLeave={() => onSubwayHover?.(null)}
              >
                <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: '#8b949e' }}>
                  Nearest Subway
                </div>
                {nearbyStations.map(({ station, distMi }) => (
                  <div
                    key={station.stopId}
                    className="flex items-center gap-2 rounded-md px-1.5 py-1 -mx-1.5 transition-colors duration-150"
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLDivElement).style.backgroundColor = 'rgba(88,166,255,0.1)';
                      onSubwayHover?.({ lat: station.lat, lon: station.lon, name: station.name, lines: station.lines });
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLDivElement).style.backgroundColor = '';
                      onSubwayHover?.(null);
                    }}
                  >
                    <div className="flex gap-0.5 flex-wrap">
                      {station.lines.map((l) => <LineBadge key={l} line={l} />)}
                    </div>
                    <span className="text-xs truncate" style={{ color: '#e1e4e8' }}>{station.name}</span>
                    <span className="text-xs ml-auto flex-shrink-0" style={{ color: '#8b949e' }}>
                      {distMi < 0.1 ? '<0.1' : distMi.toFixed(1)} mi
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Photo count */}
            {totalPhotos > 0 && (
              <div className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
                {totalPhotos} photo{totalPhotos !== 1 ? 's' : ''}
              </div>
            )}

            {/* Source + external link */}
            <div className="flex items-center justify-between pt-1 pb-2">
              <span
                className="inline-block rounded-full px-2.5 py-0.5 text-xs"
                style={{
                  backgroundColor: '#21262d',
                  color: '#8b949e',
                  border: '1px solid #30363d',
                }}
              >
                via {SOURCE_LABELS[listing.source] ?? listing.source}
              </span>
              <a
                href={listing.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-sm font-medium hover:underline cursor-pointer"
                style={{ color: '#58a6ff' }}
              >
                View on {SOURCE_LABELS[listing.source] ?? listing.source} →
              </a>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
