'use client';

import { useState, useCallback, useRef, useEffect, useMemo, type ReactNode } from 'react';
import Image from 'next/image';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { useDrag } from '@use-gesture/react';
import SUBWAY_STATIONS from '@/lib/isochrone/subway-stations';
import { CompactStats } from '@/components/ui';
import { formatAvailabilityDate, formatAvailabilityCompact } from '@/lib/format-date';
import DestinationChip from '@/components/DestinationChip';
import { useSavedDestination } from '@/lib/hooks/useSavedDestination';
import { useListingDestinationCommutes } from '@/lib/hooks/useDestinationCommutes';

// NYC lat/lon degree-to-miles conversion factors
const MI_PER_DEG_LAT = 69;
const MI_PER_DEG_LON = 52;

export function getClosestStations(lat: number, lon: number, count: number) {
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
  availability_date?: string | null;
  year_built?: number | null;
  transit_summary?: string | null;
  [key: string]: unknown;
}

export interface HoveredStation {
  lat: number;
  lon: number;
  name: string;
  lines: string[];
  /** Walking time in whole minutes (3 mph). Optional for back-compat; used by
   *  the map tooltip on mobile swipe to show "~N min walk". */
  walkMin?: number;
  /** Straight-line distance in miles from the listing to this station. Used by
   *  the map tooltip to display physical distance (e.g. "0.2 mi" / "500 ft"). */
  distMi?: number;
}

// Walking-speed conversion: 3 mph → 20 min per mile.
export function walkMinFromMiles(distMi: number): number {
  return Math.max(1, Math.round(distMi * 20));
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
  /** Called when drag state changes (true = actively dragging, false = released) */
  onDragStateChange?: (dragging: boolean) => void;
  /** Ref callback so parent can imperatively reset card position (spring back to 0,0) */
  resetRef?: React.MutableRefObject<(() => void) | null>;
  /** Optional leading slot in the card footer (left of "View on <source>"). Used on
   *  mobile to render the "Save to: <wishlist> ▾" control inline in the card. */
  footerLeadingSlot?: ReactNode;
  /** When true, render the mobile B2 compact layout: shorter photo (165px),
   *  no address/area header, no subway section. Only affects viewports <600px
   *  via responsive classes; desktop still shows the full card. */
  compactMobile?: boolean;
}

const SWIPE_X_THRESHOLD = 70;
const SWIPE_Y_THRESHOLD = 70; // down only
const STAMP_FADE_RATIO = 0.5;
// Photo-area horizontal swipe threshold (mobile). Below SWIPE_X_THRESHOLD we
// treat the gesture as carousel navigation; at/above it we hand off to the
// card-level swipe (save/skip). Lowered from 30 → 20 to make the photo
// carousel feel responsive to short flicks without hijacking the larger
// "swipe to save" gesture.
const PHOTO_SWIPE_THRESHOLD = 20;

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
  onDragStateChange,
  resetRef,
  footerLeadingSlot,
  compactMobile = false,
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

  // True briefly after a drag commits/snaps so a synthetic click on the
  // photo area doesn't fire as a tap. Cleared at the next `first`.
  const dragRecentlyFired = useRef(false);
  const notifiedDragging = useRef(false);
  const touchInPhoto = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const gestureAxis = useRef<null | 'x' | 'y'>(null);
  const scrollingContent = useRef(false);

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
  if (resetRef) resetRef.current = () => {
    const springBack = { type: 'spring' as const, stiffness: 500, damping: 30 };
    animate(x, 0, springBack);
    animate(y, 0, springBack);
  };

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

  // Reset scroll position and photo index when listing changes
  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.scrollTop = 0;
    }
    setPhotoIndex(0);
  }, [listing.id]);

  // Tinder-style commit: a fast flick should fly off in the flick direction
  // even if displacement was small. Slow drag past the displacement threshold
  // also commits. We pass the user's release velocity into the spring so the
  // exit (or snap-back) carries natural inertia instead of snapping instantly.
  const commitSwipe = useCallback(
    (direction: 'left' | 'right' | 'down', vxPxPerSec = 0, vyPxPerSec = 0) => {
      const targets = {
        left: { x: -window.innerWidth * 1.5, y: 0, rotate: -25 },
        right: { x: window.innerWidth * 1.5, y: 0, rotate: 25 },
        down: { x: 0, y: window.innerHeight * 1.5, rotate: 0 },
      };

      const t = targets[direction];
      const springConfig = { stiffness: 300, damping: 20 };

      if (direction === 'down') {
        animate(x, t.x, { type: 'spring', ...springConfig });
        animate(y, t.y, {
          type: 'spring',
          velocity: vyPxPerSec,
          ...springConfig,
          onComplete: () => onSwipe(direction),
        });
      } else {
        animate(x, t.x, {
          type: 'spring',
          velocity: vxPxPerSec,
          ...springConfig,
          onComplete: () => onSwipe(direction),
        });
        animate(y, t.y, { type: 'spring', ...springConfig });
      }
    },
    [onSwipe, x, y]
  );

  const AXIS_LOCK_THRESHOLD = 15;
  // Velocity threshold (px/sec) for flick-commit. A fast flick below the
  // displacement threshold still commits in the flick direction.
  const SWIPE_VELOCITY = 500;

  const bind = useDrag(
    ({ movement: [mx, my], velocity: [vx, vy], direction: [dx, dy], down, first, last, tap, event }) => {
      if (!isTop) return;

      if (first) {
        gestureAxis.current = null;
        scrollingContent.current = false;
        dragRecentlyFired.current = false;

        const target = event?.target as HTMLElement | null;
        touchInPhoto.current = !!(
          totalPhotos > 1 &&
          photoAreaRef.current &&
          target &&
          photoAreaRef.current.contains(target)
        );

        // Check if touch started inside scrollable content that has been scrolled down
        const inScrollable = !!(panelRef.current && target && panelRef.current.contains(target));
        if (inScrollable && (panelRef.current?.scrollTop ?? 0) > 0) {
          scrollingContent.current = true;
        }
      }

      // Tap (use-gesture-classified): not a drag — let the click handler run.
      if (tap) return;

      // Lock gesture axis after initial movement exceeds threshold
      if (gestureAxis.current === null) {
        const absX = Math.abs(mx);
        const absY = Math.abs(my);
        if (absX > AXIS_LOCK_THRESHOLD || absY > AXIS_LOCK_THRESHOLD) {
          gestureAxis.current = absX > absY ? 'x' : 'y';
        }
      }

      // When the inner panel has been scrolled down, vertical gestures should
      // continue to scroll the panel (browser handles them via touch-action:
      // pan-y). Horizontal gestures still commit a card swipe — that was a
      // regression in earlier impls where the entire gesture was forfeited
      // once the panel was scrolled.
      if (scrollingContent.current && gestureAxis.current !== 'x') return;

      // If axis locked to vertical AND moving upward, let browser handle native scroll
      if (gestureAxis.current === 'y' && my < 0) return;

      if (down) {
        // Apply axis lock: zero out the non-locked axis
        const effectiveMx = gestureAxis.current === 'y' ? 0 : mx;
        const effectiveMy = gestureAxis.current === 'x' ? 0 : my;
        const allowedY = effectiveMy > 0 ? effectiveMy : 0;

        const dragging = Math.abs(effectiveMx) > 5 || allowedY > 5;
        if (dragging && !notifiedDragging.current) {
          notifiedDragging.current = true;
          onDragStateChange?.(true);
        }
        x.set(effectiveMx);
        y.set(allowedY);
      } else if (last) {
        dragRecentlyFired.current = true;

        const absX = Math.abs(mx);
        const absY = Math.abs(my);
        const curY = y.get();

        // use-gesture exposes `velocity` in px/ms as a non-negative magnitude;
        // pair with `direction` (sign) to get signed px/sec.
        const vxPxPerSec = vx * 1000 * (dx || (mx < 0 ? -1 : 1));
        const vyPxPerSec = vy * 1000 * (dy || (my < 0 ? -1 : 1));
        const absVx = Math.abs(vxPxPerSec);

        // pointercancel (palm rejection, system gesture, etc.) must NEVER
        // commit a swipe — even if movement crossed threshold by then. Force
        // a clean snap-back to origin.
        const cancelled = event?.type === 'pointercancel';

        // Decide commit at touchend by which axis dominates the END state,
        // independent of which axis got locked during the drag. Earlier
        // versions required gestureAxis === 'x' for horizontalCommit, which
        // silently killed photo-area swipes when the user's finger drifted
        // slightly more vertically than horizontally in the first 15px and
        // got the lock pointed the wrong way — even if the user then made
        // a clearly horizontal flick, no commit fired.
        const horizontalDominant = absX >= absY;

        const horizontalCommit =
          !cancelled &&
          horizontalDominant &&
          (absX > SWIPE_X_THRESHOLD || absVx > SWIPE_VELOCITY);
        // Vertical (down) commit: must end up moving downward, but allow a
        // fast downward flick below the displacement threshold. Photo-area
        // vertical drags are intentionally a no-op (snap back) — the photo
        // is not the right surface for a back-of-queue gesture; users who
        // want dismiss should use the grabber strip above the card.
        const verticalCommit =
          !cancelled &&
          !touchInPhoto.current &&
          !horizontalDominant &&
          curY > 0 &&
          (curY > SWIPE_Y_THRESHOLD || vyPxPerSec > SWIPE_VELOCITY);

        if (horizontalCommit) {
          const dir: 'left' | 'right' =
            absVx > SWIPE_VELOCITY
              ? vxPxPerSec < 0
                ? 'left'
                : 'right'
              : mx < 0
                ? 'left'
                : 'right';
          commitSwipe(dir, vxPxPerSec);
        } else if (verticalCommit) {
          commitSwipe('down', 0, vyPxPerSec);
        } else {
          // Snap back with velocity so the spring decelerates naturally
          // instead of yanking instantly back to 0.
          const springBack = { type: 'spring' as const, stiffness: 500, damping: 30 };
          animate(x, 0, { ...springBack, velocity: vxPxPerSec });
          animate(y, 0, { ...springBack, velocity: vyPxPerSec });
        }

        if (notifiedDragging.current) {
          notifiedDragging.current = false;
          onDragStateChange?.(false);
        }
      }
    },
    {
      // filterTaps: true so use-gesture classifies sub-threshold motion as
      // a tap and skips the drag callbacks. Pairs with the explicit `tap`
      // short-circuit at the top of the handler — together they prevent
      // dragRecentlyFired from being set on real taps, which was eating
      // the next legitimate photo-area click.
      filterTaps: true,
      // preventScroll dropped: outer wrapper already has touch-action: none,
      // so preventScroll is redundant. With it on, iOS Safari attaches a
      // non-passive touchmove listener and stalls every gesture-start
      // while it negotiates with the inner panel's touch-action: pan-y.
      // Synthetic CDP touches bypass this — that's why Playwright passes
      // but real fingers feel a delay.
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

  // Tap-zone photo navigation for mobile: left third = prev, right third = next
  const handlePhotoAreaClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    // Don't fire taps after a drag gesture
    if (dragRecentlyFired.current) {
      dragRecentlyFired.current = false;
      return;
    }
    if (totalPhotos <= 1) return;

    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const third = rect.width / 3;

    if (clickX < third) {
      setPhotoIndex((i) => (i - 1 + totalPhotos) % totalPhotos);
    } else if (clickX > third * 2) {
      setPhotoIndex((i) => (i + 1) % totalPhotos);
    } else {
      // Center third — enter photo focus if not already focused
      if (!photoFocused) enterPhotoFocus();
    }
  }, [totalPhotos, photoFocused, enterPhotoFocus]);

  const nearbyStations = useMemo(() => {
    if (listing.lat == null || listing.lon == null) return [];
    return getClosestStations(listing.lat as number, listing.lon as number, 2);
  }, [listing.lat, listing.lon]);

  const listDateFormatted = listing.list_date
    ? new Date(listing.list_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  // Move-in / availability copy. Always renders — null → "Move-in unknown",
  // past-or-today → "Available now", future → "Available <date>".
  // See web/lib/format-date.ts for canonical formatting.
  const availabilityLabel = formatAvailabilityDate(listing.availability_date);
  const availabilityCompact = formatAvailabilityCompact(listing.availability_date);

  // Preferred-destination chip (informational; does not filter results).
  const { destinations } = useSavedDestination();
  const destinationCommutes = useListingDestinationCommutes(
    { id: listing.id, lat: listing.lat ?? null, lon: listing.lon ?? null },
    destinations,
  );
  const hasDestination = destinations.length > 0;
  const commutesArr = destinationCommutes ?? [];

  // Layout-only mode: render content in normal flow to establish natural height
  if (layoutOnly) {
    return (
      <div className={`overflow-hidden flex flex-col ${compactMobile ? 'rounded-3xl min-[600px]:rounded-2xl' : 'rounded-2xl'}`} style={{ backgroundColor: 'rgba(28, 32, 40, 0.97)', border: '1px solid #2d333b', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
        <div
          className={`w-full flex-shrink-0 ${compactMobile ? 'h-[179px] min-[600px]:h-[226px]' : 'h-[226px]'}`}
          style={{ backgroundColor: '#0d1117' }}
        />
        <div className="px-5 py-4 flex flex-col gap-3">
          <div>
            <div className="text-base font-semibold leading-snug" style={{ color: '#c9d1d9' }}>{listing.address}</div>
            <div className="text-sm mt-0.5" style={{ color: '#8b949e' }}>{listing.area}</div>
          </div>
          <div className="flex items-baseline gap-2">
            <span style={{ fontSize: 22, fontWeight: 700, color: '#7ee787' }}>${listing.price.toLocaleString()}<span style={{ fontSize: 14, fontWeight: 400, color: '#8b949e' }}>/mo</span></span>
            {compactMobile && hasDestination && (
              <span className="ml-auto min-[600px]:hidden">
                <DestinationChip
                  listing={{ id: listing.id, lat: listing.lat ?? null, lon: listing.lon ?? null }}
                  destinations={destinations}
                  commutes={commutesArr}
                />
              </span>
            )}
          </div>
          {listDateFormatted && <div className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>Listed {listDateFormatted}</div>}
          <div className="text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>{availabilityLabel}</div>
          {hasDestination && (
            <div className={compactMobile ? 'hidden min-[600px]:block' : ''}>
              <DestinationChip
                listing={{ id: listing.id, lat: listing.lat ?? null, lon: listing.lon ?? null }}
                destinations={destinations}
                commutes={commutesArr}
              />
            </div>
          )}
          <div
            className={compactMobile ? 'hidden min-[600px]:block' : ''}
            style={{ borderTop: '1px solid #2d333b', margin: '4px 0' }}
          />
          <CompactStats
            beds={listing.beds}
            baths={listing.baths}
            sqft={listing.sqft}
            className="min-[600px]:hidden"
          />
          <div className="hidden min-[600px]:grid grid-cols-3 gap-px rounded-lg overflow-hidden" style={{ border: '1px solid #2d333b' }}>
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
          {(listing.transit_summary || (listing.lat != null && listing.lon != null && getClosestStations(listing.lat as number, listing.lon as number, 2).length > 0)) && (
            <div
              className={compactMobile ? 'hidden min-[600px]:block' : ''}
              style={{ borderTop: '1px solid #2d333b', margin: '4px 0' }}
            />
          )}
          {listing.transit_summary && (
            <div
              className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2.5 ${compactMobile ? 'hidden min-[600px]:flex' : ''}`}
              style={{ backgroundColor: '#161b22', border: '1px solid #2d333b', color: '#8b949e' }}
            >
              <span>{listing.transit_summary}</span>
            </div>
          )}
          {listing.lat != null && listing.lon != null && (() => {
            const stations = getClosestStations(listing.lat as number, listing.lon as number, 2);
            if (stations.length === 0) return null;
            return (
              <div
                className={`rounded-lg px-3 py-2.5 flex flex-col gap-2 ${compactMobile ? 'hidden min-[600px]:flex' : ''}`}
                style={{ backgroundColor: '#161b22', border: '1px solid #2d333b' }}
              >
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
          {compactMobile && listing.lat != null && listing.lon != null && (() => {
            const stations = getClosestStations(listing.lat as number, listing.lon as number, 2)
              .filter(({ station }) => Array.isArray(station.lines) && station.lines.length > 0);
            if (stations.length === 0) return null;
            return (
              <div
                className="min-[600px]:hidden flex items-center gap-3 text-[12px]"
                style={{ color: '#c9d1d9' }}
                data-testid="compact-subway-row"
              >
                {stations.map(({ station, distMi }) => (
                  <div key={station.stopId} className="flex items-center gap-1">
                    <LineBadge line={station.lines[0]} />
                    <span style={{ color: '#8b949e' }}>{walkMinFromMiles(distMi)} min</span>
                  </div>
                ))}
              </div>
            );
          })()}
          <div className="flex items-center justify-end pt-1 pb-2">
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
          border: '1px solid #2d333b',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}
        className="w-full h-full overflow-hidden flex flex-col select-none rounded-2xl"
        initial={false}
      >
        {/* Panel background — moves with the card during drag */}
        <div className="absolute inset-0" style={{ backgroundColor: 'rgba(28, 32, 40, 0.97)' }} />

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
          style={{ touchAction: 'pan-y' }}
        >
          {/* Photo carousel */}
          <div
            ref={photoAreaRef}
            className={`relative w-full overflow-hidden flex-shrink-0 ${compactMobile ? 'h-[179px] min-[600px]:h-[226px]' : 'h-[226px]'}`}
            style={{
              outline: photoFocused ? '2px solid rgba(88,166,255,0.7)' : 'none',
              outlineOffset: '-2px',
              cursor: totalPhotos > 1 ? 'pointer' : 'default',
              // Inherit pan-y from the parent panel rather than declaring
              // touch-action: none here. Nesting touch-action regions makes
              // WebKit do extra boundary work which produces edge-rubber
              // feel. Photo area only uses onClick (not gestures) so the
              // override is unnecessary.
            }}
            onClick={handlePhotoAreaClick}
            title={totalPhotos > 1 && !photoFocused ? 'Tap sides to browse photos' : undefined}
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
                  {photos.map((url, idx) => {
                    const isVisible = idx === photoIndex;
                    const isNeighbor = Math.abs(idx - photoIndex) === 1;
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
                          // Swipe card is ~100vw on mobile, capped at ~600px desktop.
                          sizes="(max-width: 640px) 100vw, 600px"
                          quality={75}
                          // First photo of the top card is the LCP candidate.
                          priority={isTop && idx === 0}
                          loading={isTop && idx === 0 ? undefined : 'lazy'}
                          fetchPriority={
                            isTop && idx === 0
                              ? 'high'
                              : isVisible || isNeighbor
                              ? 'auto'
                              : 'low'
                          }
                          style={{ objectFit: 'cover' }}
                          draggable={false}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Arrow buttons.
                    The visible chip is the inner 32x32 dark circle with the
                    14px chevron — unchanged. The OUTER button is a 48x48
                    transparent tap target so the hit area is comfortable on
                    touch devices and forgiving on desktop hover. We deliberately
                    keep the hitbox to ~48px (not the full card edge) so the
                    surrounding swipe-card drag gesture still receives most of
                    the photo area and only the corners belong to the carousel
                    arrows. `cursor-pointer` lives on the wrapper since the
                    inner div is purely decorative. */}
                {totalPhotos > 1 && (
                  <>
                    {/* Tap targets are full-height columns on the photo's left
                        and right edges (~52px wide each). The visible 32×32
                        chevron stays vertically centered. The right column
                        starts below 48px so the top-right "open listing" link
                        keeps its corner. Bottom dots indicator is centered so
                        it doesn't overlap. */}
                    <button
                      onClick={prevPhoto}
                      aria-label="Previous photo"
                      data-testid="photo-prev-button"
                      className="absolute left-0 top-0 bottom-0 flex items-center justify-center cursor-pointer"
                      style={{
                        width: 52,
                        background: 'transparent',
                        border: 'none',
                        padding: 0,
                      }}
                    >
                      <span
                        className="flex items-center justify-center rounded-full transition-colors"
                        style={{
                          width: 32,
                          height: 32,
                          backgroundColor: 'rgba(0,0,0,0.5)',
                          color: '#fff',
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="15 18 9 12 15 6" />
                        </svg>
                      </span>
                    </button>
                    <button
                      onClick={nextPhoto}
                      aria-label="Next photo"
                      data-testid="photo-next-button"
                      className="absolute right-0 bottom-0 flex items-center justify-center cursor-pointer"
                      style={{
                        top: 48,
                        width: 52,
                        background: 'transparent',
                        border: 'none',
                        padding: 0,
                      }}
                    >
                      <span
                        className="flex items-center justify-center rounded-full transition-colors"
                        style={{
                          width: 32,
                          height: 32,
                          backgroundColor: 'rgba(0,0,0,0.5)',
                          color: '#fff',
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </span>
                    </button>
                  </>
                )}

                {/* Photo dots indicator */}
                <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex items-center justify-center">
                  <div
                    style={{
                      background: 'rgba(0, 0, 0, 0.4)',
                      backdropFilter: 'blur(8px)',
                      WebkitBackdropFilter: 'blur(8px)',
                      borderRadius: 12,
                      padding: '4px 8px',
                      display: 'inline-flex',
                      gap: 4,
                      alignItems: 'center',
                    }}
                  >
                    {totalPhotos <= 7 ? (
                      photos.map((_, idx) => (
                        <span
                          key={idx}
                          style={{
                            width: idx === photoIndex ? 8 : 6,
                            height: idx === photoIndex ? 8 : 6,
                            borderRadius: '50%',
                            backgroundColor: idx === photoIndex ? '#fff' : 'rgba(255,255,255,0.4)',
                            transition: 'all 200ms ease',
                            flexShrink: 0,
                          }}
                        />
                      ))
                    ) : (
                      <span style={{ color: '#fff', fontSize: 11, fontWeight: 500, lineHeight: 1 }}>
                        {photoIndex + 1} / {totalPhotos}
                      </span>
                    )}
                  </div>
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
            {/* Address + area — shown on both mobile and desktop */}
            <div>
              <div className="text-base font-semibold leading-snug" style={{ color: '#c9d1d9' }}>
                {listing.address}
              </div>
              <div className="text-sm mt-0.5" style={{ color: '#8b949e' }}>
                {listing.area}
              </div>
            </div>

            {/* Price (with inline destination chip on mobile compact layout so
                the chip is visible above the fold without scrolling) */}
            <div className="flex items-baseline gap-2">
              <span style={{ fontSize: 22, fontWeight: 700, color: '#7ee787' }}>
                ${listing.price.toLocaleString()}
                <span style={{ fontSize: 14, fontWeight: 400, color: '#8b949e' }}>/mo</span>
              </span>
              {compactMobile && hasDestination && (
                <span className="ml-auto min-[600px]:hidden">
                  <DestinationChip
                    listing={{ id: listing.id, lat: listing.lat ?? null, lon: listing.lon ?? null }}
                    destinations={destinations}
                    commutes={commutesArr}
                  />
                </span>
              )}
            </div>

            {/* Listed date */}
            {listDateFormatted && (
              <div className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                Listed {listDateFormatted}
              </div>
            )}

            {/* Move-in / availability date. Mobile compact moves this into
                the CompactStats row as a calendar+M/D tile (omitted when
                unknown). Desktop keeps the prose line. */}
            <div
              className={`text-xs ${compactMobile ? 'hidden min-[600px]:block' : ''}`}
              style={{ color: 'rgba(255,255,255,0.55)' }}
            >
              {availabilityLabel}
            </div>

            {/* Preferred-destination chip — only renders when user has saved one.
                Hidden on mobile compact layout (rendered inline next to the price
                instead, so it sits above the fold). Desktop unchanged. */}
            {hasDestination && (
              <div className={compactMobile ? 'hidden min-[600px]:block' : ''}>
                <DestinationChip
                  listing={{ id: listing.id, lat: listing.lat ?? null, lon: listing.lon ?? null }}
                  destinations={destinations}
                  commutes={commutesArr}
                />
              </div>
            )}

            {/* Divider: price/address section → stats. Hidden on mobile
                (compactMobile) to save vertical space so the stats row fits
                the floating card without truncation. */}
            <div
              className={compactMobile ? 'hidden min-[600px]:block' : ''}
              style={{ borderTop: '1px solid #2d333b', margin: '4px 0' }}
            />

            {/* Stats — compact inline on mobile, verbose 3-col grid on >=600px */}
            <CompactStats
              beds={listing.beds}
              baths={listing.baths}
              sqft={listing.sqft}
              availability={availabilityCompact}
              className="min-[600px]:hidden"
            />
            <div
              className="hidden min-[600px]:grid grid-cols-3 gap-px rounded-lg overflow-hidden"
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

            {/* Divider: stats section → transit/subway — hidden on mobile in compactMobile */}
            {(listing.transit_summary || nearbyStations.length > 0) && (
              <div
                className={compactMobile ? 'hidden min-[600px]:block' : ''}
                style={{ borderTop: '1px solid #2d333b', margin: '4px 0' }}
              />
            )}

            {/* Transit summary — hidden on mobile in compactMobile */}
            {listing.transit_summary && (
              <div
                className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2.5 ${compactMobile ? 'hidden min-[600px]:flex' : ''}`}
                style={{ backgroundColor: '#161b22', border: '1px solid #2d333b', color: '#8b949e' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
                  <rect x="2" y="7" width="20" height="14" rx="2" />
                  <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                </svg>
                <span>{listing.transit_summary}</span>
              </div>
            )}

            {/* Nearest subway stations — hidden on mobile in compactMobile */}
            {nearbyStations.length > 0 && (
              <div
                className={`rounded-lg px-3 py-2.5 flex flex-col gap-2 ${compactMobile ? 'hidden min-[600px]:flex' : ''}`}
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

            {/* Compact subway indicator — mobile compactMobile only.
                Shows the two closest lines + walking time inline so the
                information is visible on the mobile swipe card where the
                full "Nearest Subway" section is hidden. */}
            {compactMobile && nearbyStations.length > 0 && (() => {
              const rows = nearbyStations.filter(({ station }) => Array.isArray(station.lines) && station.lines.length > 0);
              if (rows.length === 0) return null;
              return (
                <div
                  className="min-[600px]:hidden flex items-center gap-3 text-[12px]"
                  style={{ color: '#c9d1d9' }}
                  data-testid="compact-subway-row"
                >
                  {rows.map(({ station, distMi }) => (
                    <div key={station.stopId} className="flex items-center gap-1" title={`${station.name} — ${walkMinFromMiles(distMi)} min walk`}>
                      <LineBadge line={station.lines[0]} />
                      <span style={{ color: '#8b949e' }}>{walkMinFromMiles(distMi)} min</span>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* External link + optional leading slot (e.g. mobile "Save to" control) */}
            <div
              className={`flex items-center ${footerLeadingSlot ? 'justify-between gap-3' : 'justify-end'} pt-1 pb-2`}
            >
              {footerLeadingSlot ? (
                <div className="min-w-0 flex-shrink" onClick={(e) => e.stopPropagation()}>
                  {footerLeadingSlot}
                </div>
              ) : null}
              <a
                href={listing.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-sm font-medium hover:underline cursor-pointer flex-shrink-0"
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
