'use client';

/**
 * GoToNearestMatch — empty-state CTA shown when the current viewport (or
 * filtered results) returns zero listings. Lets the user opt in to leaving
 * the current map area and jumping to the geographically closest listing
 * that matches all active filters.
 *
 * The button's setView() call is the **only** legal map-pan code path
 * outside of explicit user marker taps. Per the no-autoscroll rule, the
 * map must never move on its own — the user must initiate it. This button
 * is that initiation.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Database } from '@/lib/types';
import type { CommuteRule } from '@/components/Filters';
import { useLeafletMap } from '@/lib/viewport/LeafletMapContext';

type Listing = Database['public']['Tables']['listings']['Row'];

export interface NearestSearchFilters {
  selectedBeds?: number[] | null;
  minBaths?: number | null;
  includeNaBaths?: boolean;
  minRent?: number | null;
  maxRent?: number | null;
  priceMode?: 'total' | 'perRoom';
  maxListingAge?:
    | '1h' | '3h' | '6h' | '12h' | '1d' | '2d' | '3d' | '1w' | '2w' | '1m'
    | null;
  selectedSources?: string[] | null;
  minYearBuilt?: number | null;
  maxYearBuilt?: number | null;
  minSqft?: number | null;
  maxSqft?: number | null;
  excludeNoSqft?: boolean;
  minAvailableDate?: string | null;
  maxAvailableDate?: string | null;
  includeNaAvailableDate?: boolean;
}

interface GoToNearestMatchProps {
  /** Returns the current filter payload to send to /api/listings/search. */
  getFiltersPayload: () => {
    filters: NearestSearchFilters;
    commuteRules: CommuteRule[] | null;
    wishlistIds: string[] | null;
  };
  /** Called with the matched listing so the host can mark it active. */
  onMatchSelected?: (listing: Listing) => void;
  /** Optional callback fired before the map pans (e.g. switch to map view). */
  onBeforePan?: () => void;
  /**
   * Compact mode — renders as a single inline button with no surrounding
   * card, suitable for embedding inside an existing empty-state panel.
   */
  compact?: boolean;
  className?: string;
  /** Override the default "Go to nearest match" label. */
  label?: string;
  /**
   * Visual variant. `default` keeps the existing translucent-blue look used
   * by the desktop sidebar empty state. `primary` renders a solid accent
   * button matching <PrimaryButton variant="accent" /> — used by the mobile
   * swipe-view empty state where this is the only foreground CTA.
   */
  variant?: 'default' | 'primary';
}

function formatDistance(meters: number): string {
  // miles — Imperial-first because the user is US-based and the rest of the
  // app's commute/transit copy uses miles.
  const miles = meters / 1609.344;
  if (miles < 0.1) return '<0.1 mi';
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

export default function GoToNearestMatch({
  getFiltersPayload,
  onMatchSelected,
  onBeforePan,
  compact = false,
  className = '',
  label,
  variant = 'default',
}: GoToNearestMatchProps) {
  const map = useLeafletMap();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noMatchAnywhere, setNoMatchAnywhere] = useState(false);
  const [lastDistanceMeters, setLastDistanceMeters] = useState<number | null>(null);

  // Reset the "no match anywhere" sticky state whenever the filters change
  // (we re-derive it on the next click). Filters change very rarely while
  // the empty state is visible, but if a user widens the price range we
  // want the button to come back as enabled.
  useEffect(() => {
    setNoMatchAnywhere(false);
    setError(null);
  }, [getFiltersPayload]);

  const onClick = useCallback(async () => {
    if (loading || !map) return;
    setLoading(true);
    setError(null);
    try {
      const center = map.getCenter();
      const payload = getFiltersPayload();
      const res = await fetch('/api/listings/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nearestTo: { lat: center.lat, lon: center.lng },
          filters: payload.filters,
          commuteRules: payload.commuteRules,
          wishlistIds: payload.wishlistIds,
        }),
      });
      if (!res.ok) {
        setError('Search failed');
        return;
      }
      const data = (await res.json()) as {
        listing: Listing | null;
        distanceMeters: number | null;
      };
      if (!data.listing || data.listing.lat == null || data.listing.lon == null) {
        // No match anywhere in the DB for the current filter set.
        setNoMatchAnywhere(true);
        return;
      }
      const target = data.listing;
      if (data.distanceMeters != null) setLastDistanceMeters(data.distanceMeters);
      onBeforePan?.();
      // User-initiated map pan — explicitly allowed under the no-autoscroll
      // rule. We bump the zoom up to at least 14 so the listing isn't lost
      // in a sea of other dots, but never zoom further OUT than the user's
      // current position (Math.max).
      const currentZoom = map.getZoom();
      const targetZoom = Math.max(currentZoom, 14);
      map.setView(
        [Number(target.lat), Number(target.lon)],
        targetZoom,
        { animate: true },
      );
      onMatchSelected?.(target);
    } catch (err) {
      console.error('[GoToNearestMatch] error:', err);
      setError('Search failed');
    } finally {
      setLoading(false);
    }
  }, [loading, map, getFiltersPayload, onBeforePan, onMatchSelected]);

  const disabled = loading || !map || noMatchAnywhere;

  const idleLabel = label ?? 'Go to nearest match';
  const labelMain = noMatchAnywhere
    ? 'No matches anywhere'
    : loading
      ? 'Finding nearest…'
      : idleLabel;

  // Variant styling. `default` matches the original translucent-blue chip;
  // `primary` mirrors PrimaryButton (solid accent) so the mobile swipe empty
  // state can render this as the primary CTA without rebuilding it from
  // scratch.
  const variantStyle =
    variant === 'primary'
      ? {
          className: disabled
            ? 'cursor-not-allowed opacity-60'
            : 'cursor-pointer hover:bg-[#4c8fdf]',
          style: {
            backgroundColor: '#58a6ff',
            color: '#0f1117',
            border: '1px solid transparent',
          } as React.CSSProperties,
        }
      : {
          className: disabled
            ? 'cursor-not-allowed opacity-60'
            : 'cursor-pointer hover:bg-[rgba(88,166,255,0.18)]',
          style: {
            backgroundColor: disabled ? 'rgba(88,166,255,0.08)' : 'rgba(88,166,255,0.12)',
            color: '#58a6ff',
            border: '1px solid rgba(88,166,255,0.35)',
          } as React.CSSProperties,
        };

  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid="go-to-nearest-match"
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${variantStyle.className}`}
      style={variantStyle.style}
    >
      {/* compass-target glyph */}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
      </svg>
      <span>{labelMain}</span>
    </button>
  );

  const distanceLabel =
    !loading && !noMatchAnywhere && lastDistanceMeters != null
      ? `Last match: ${formatDistance(lastDistanceMeters)} away`
      : null;

  if (compact) return <span className={className}>{button}</span>;

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      {button}
      {distanceLabel && (
        <span className="text-xs" style={{ color: '#8b949e' }}>
          {distanceLabel}
        </span>
      )}
      {error && (
        <span className="text-xs" style={{ color: '#f0883e' }}>
          {error}
        </span>
      )}
    </div>
  );
}
