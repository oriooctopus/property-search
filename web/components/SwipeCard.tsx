'use client';

import { useState, useCallback, useRef } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { useDrag } from '@use-gesture/react';

const SOURCE_LABELS: Record<string, string> = {
  craigslist: 'Craigslist',
  streeteasy: 'StreetEasy',
  'facebook-marketplace': 'FB Marketplace',
  facebook: 'FB Marketplace',
  realtor: 'Realtor.com',
  renthop: 'RentHop',
  apartments: 'Apartments.com',
};

interface SwipeCardProps {
  listing: {
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
    year_built?: number | null;
    [key: string]: unknown;
  };
  onSwipe: (direction: 'left' | 'right' | 'up' | 'down') => void;
  onExpandDetail: () => void;
  isTop: boolean;
  scale?: number;
  yOffset?: number;
}

const SWIPE_X_THRESHOLD = 100;
const SWIPE_Y_THRESHOLD = 80;
const STAMP_FADE_RATIO = 0.5; // stamps start appearing at 50% of threshold

export default function SwipeCard({
  listing,
  onSwipe,
  onExpandDetail,
  isTop,
  scale = 1,
  yOffset = 0,
}: SwipeCardProps) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const [exiting, setExiting] = useState<'left' | 'right' | 'up' | 'down' | null>(null);

  const photos = listing.photo_urls ?? [];
  const totalPhotos = photos.length;

  // Motion values for drag
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // Rotation: tilt proportional to x, origin at bottom center
  const rotate = useTransform(x, [-300, 0, 300], [-15, 0, 15]);

  // Stamp opacities
  const nopeOpacity = useTransform(x, [-(SWIPE_X_THRESHOLD * STAMP_FADE_RATIO), -SWIPE_X_THRESHOLD], [0, 1]);
  const faveOpacity = useTransform(x, [SWIPE_X_THRESHOLD * STAMP_FADE_RATIO, SWIPE_X_THRESHOLD], [0, 1]);
  const liveOpacity = useTransform(y, [-(SWIPE_Y_THRESHOLD * STAMP_FADE_RATIO), -SWIPE_Y_THRESHOLD], [0, 1]);
  const laterOpacity = useTransform(y, [SWIPE_Y_THRESHOLD * STAMP_FADE_RATIO, SWIPE_Y_THRESHOLD], [0, 1]);

  // Background tint opacities
  const leftTint = useTransform(x, [0, -SWIPE_X_THRESHOLD], [0, 0.3]);
  const rightTint = useTransform(x, [0, SWIPE_X_THRESHOLD], [0, 0.3]);
  const topTint = useTransform(y, [0, -SWIPE_Y_THRESHOLD], [0, 0.3]);
  const bottomTint = useTransform(y, [0, SWIPE_Y_THRESHOLD], [0, 0.3]);

  const isDragging = useRef(false);

  const commitSwipe = useCallback((direction: 'left' | 'right' | 'up' | 'down') => {
    setExiting(direction);

    const targets = {
      left: { x: -window.innerWidth * 1.5, y: 0, rotate: -30, scale: 0.9, opacity: 1 },
      right: { x: window.innerWidth * 1.5, y: 0, rotate: 30, scale: 0.9, opacity: 1 },
      up: { x: 0, y: -window.innerHeight * 1.5, rotate: 0, scale: 0.8, opacity: 0.5 },
      down: { x: 0, y: window.innerHeight * 1.5, rotate: 0, scale: 0.8, opacity: 0.5 },
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
    ({ movement: [mx, my], down, velocity: [vx, vy], event }) => {
      if (!isTop) return;

      if (down) {
        isDragging.current = Math.abs(mx) > 5 || Math.abs(my) > 5;
        x.set(mx);
        y.set(my);
      } else {
        // Check if swipe commits
        const absX = Math.abs(mx);
        const absY = Math.abs(my);

        if (absX > SWIPE_X_THRESHOLD && absX > absY) {
          commitSwipe(mx < 0 ? 'left' : 'right');
        } else if (my < -SWIPE_Y_THRESHOLD && absY > absX) {
          commitSwipe('up');
        } else if (my > SWIPE_Y_THRESHOLD && absY > absX) {
          commitSwipe('down');
        } else {
          // Spring back
          const springBack = { type: 'spring' as const, stiffness: 500, damping: 30 };
          animate(x, 0, springBack);
          animate(y, 0, springBack);
        }

        // Reset dragging flag after a tick
        setTimeout(() => { isDragging.current = false; }, 50);
      }
    },
    {
      filterTaps: true,
      pointer: { touch: true },
    }
  );

  // Photo carousel handlers
  const handlePhotoTap = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (isDragging.current || totalPhotos <= 1) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const tapX = e.clientX - rect.left;
    if (tapX < rect.width / 2) {
      setPhotoIndex((i) => (i - 1 + totalPhotos) % totalPhotos);
    } else {
      setPhotoIndex((i) => (i + 1) % totalPhotos);
    }
  }, [totalPhotos]);

  if (exiting) {
    // Still animating out, render the card but non-interactive
  }

  const gestureBindings = isTop ? bind() : {};

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
        scale,
        translateY: yOffset,
        transformOrigin: 'bottom center',
      }}
      className="w-full h-full rounded-2xl shadow-2xl overflow-hidden flex flex-col select-none"
      initial={false}
      animate={!isTop ? { scale, y: yOffset } : undefined}
    >
      {/* Card background */}
      <div
        className="absolute inset-0 rounded-2xl"
        style={{ backgroundColor: '#161b22' }}
      />

      {/* Background color tints */}
      <motion.div
        className="absolute inset-0 rounded-2xl pointer-events-none z-[1]"
        style={{
          opacity: leftTint,
          background: 'linear-gradient(to right, rgba(139, 148, 158, 0.4), transparent 60%)',
        }}
      />
      <motion.div
        className="absolute inset-0 rounded-2xl pointer-events-none z-[1]"
        style={{
          opacity: rightTint,
          background: 'linear-gradient(to left, rgba(88, 166, 255, 0.4), transparent 60%)',
        }}
      />
      <motion.div
        className="absolute inset-0 rounded-2xl pointer-events-none z-[1]"
        style={{
          opacity: topTint,
          background: 'linear-gradient(to bottom, rgba(225, 228, 232, 0.4), transparent 60%)',
        }}
      />
      <motion.div
        className="absolute inset-0 rounded-2xl pointer-events-none z-[1]"
        style={{
          opacity: bottomTint,
          background: 'linear-gradient(to top, rgba(88, 166, 255, 0.4), transparent 60%)',
        }}
      />

      {/* Stamp overlays */}
      {/* SKIP - top right, muted grey, rotated -12° */}
      <motion.div
        className="absolute top-8 right-6 z-[5] pointer-events-none"
        style={{ opacity: nopeOpacity, rotate: -12 }}
      >
        <div
          className="px-4 py-2 text-3xl font-black uppercase tracking-wider"
          style={{
            color: '#8b949e',
            border: '4px solid #8b949e',
            borderRadius: 8,
          }}
        >
          SKIP
        </div>
      </motion.div>

      {/* LIKE - top left, blue #58a6ff, rotated 12° */}
      <motion.div
        className="absolute top-8 left-6 z-[5] pointer-events-none"
        style={{ opacity: faveOpacity, rotate: 12 }}
      >
        <div
          className="px-4 py-2 text-3xl font-black uppercase tracking-wider"
          style={{
            color: '#58a6ff',
            border: '4px solid #58a6ff',
            borderRadius: 8,
          }}
        >
          LIKE
        </div>
      </motion.div>

      {/* LIVE HERE - top center, white #e1e4e8 */}
      <motion.div
        className="absolute top-8 left-1/2 -translate-x-1/2 z-[5] pointer-events-none"
        style={{ opacity: liveOpacity }}
      >
        <div
          className="px-4 py-2 text-2xl font-black uppercase tracking-wider whitespace-nowrap"
          style={{
            color: '#e1e4e8',
            border: '4px solid #e1e4e8',
            borderRadius: 8,
          }}
        >
          LIVE HERE
        </div>
      </motion.div>

      {/* LATER - bottom center, blue #58a6ff */}
      <motion.div
        className="absolute bottom-8 left-1/2 -translate-x-1/2 z-[5] pointer-events-none"
        style={{ opacity: laterOpacity }}
      >
        <div
          className="px-4 py-2 text-2xl font-black uppercase tracking-wider whitespace-nowrap"
          style={{
            color: '#58a6ff',
            border: '4px solid #58a6ff',
            borderRadius: 8,
          }}
        >
          LATER
        </div>
      </motion.div>

      {/* Photo area: top 57% */}
      <div
        className="relative w-full overflow-hidden flex-shrink-0 z-[2]"
        style={{ height: '57%' }}
        onClick={handlePhotoTap}
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

            {/* Dot indicators */}
            {totalPhotos > 1 && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-[3]">
                {photos.map((_, idx) => (
                  <div
                    key={idx}
                    className="rounded-full transition-all duration-200"
                    style={{
                      width: idx === photoIndex ? 8 : 6,
                      height: idx === photoIndex ? 8 : 6,
                      backgroundColor: idx === photoIndex ? '#fff' : 'rgba(255,255,255,0.5)',
                    }}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          /* No photo fallback */
          <div
            className="w-full h-full flex flex-col items-center justify-center"
            style={{ backgroundColor: '#0d1117' }}
          >
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#8b949e"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <span className="text-sm mt-2" style={{ color: '#8b949e' }}>No photos</span>
          </div>
        )}
      </div>

      {/* Info area: bottom ~43% */}
      <div className="flex-1 px-5 py-4 z-[2] overflow-y-auto" style={{ backgroundColor: '#161b22' }}>
        {/* Price */}
        <div className="text-2xl font-bold" style={{ color: '#7ee787' }}>
          ${listing.price.toLocaleString()}/mo
        </div>

        {/* Address + area */}
        <div className="mt-1">
          <div className="text-base font-medium truncate" style={{ color: '#e1e4e8' }}>
            {listing.address}
          </div>
          <div className="text-sm" style={{ color: '#8b949e' }}>
            {listing.area}
          </div>
        </div>

        {/* Beds / Baths / Sqft */}
        <div
          className="flex items-center gap-3 mt-3 text-sm"
          style={{ color: '#e1e4e8' }}
        >
          <span>{listing.beds === 0 ? 'Studio' : `${listing.beds} bd`}</span>
          <span style={{ color: '#30363d' }}>|</span>
          <span>{listing.baths != null ? listing.baths : '--'} ba</span>
          {listing.sqft != null && (
            <>
              <span style={{ color: '#30363d' }}>|</span>
              <span>{listing.sqft.toLocaleString()} sqft</span>
            </>
          )}
          {listing.year_built != null && (
            <>
              <span style={{ color: '#30363d' }}>|</span>
              <span>Built {listing.year_built}</span>
            </>
          )}
        </div>

        {/* Source badge */}
        {listing.source && (
          <div className="mt-3">
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
          </div>
        )}

        {/* View details button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onExpandDetail();
          }}
          className="mt-3 text-sm font-medium cursor-pointer transition-colors duration-150 hover:underline"
          style={{ color: '#58a6ff', background: 'none', border: 'none', padding: 0 }}
        >
          View details &rarr;
        </button>
      </div>
    </motion.div>
    </div>
  );
}
