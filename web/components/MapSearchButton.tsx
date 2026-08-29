'use client';

/**
 * MapSearchButton — the permanent top-left search icon shown on all three
 * surfaces (mobile swipe view, mobile list/map view, desktop). Idle state
 * is a plain (non-animated) magnifier; while a viewport/commute fetch is
 * in flight it swaps to the app's standard circular-arc spinner (grey ring
 * + blue arc — the same idiom used by AISearchBar's SpinnerIcon and the
 * mapPanel "Searching..." overlay), never a spinning magnifier.
 *
 * Rendered twice by HomeClient (once inside the swipe view, once inside
 * the shared desktop/list mapPanel container) — both instances open the
 * same SearchModal.
 */

import { forwardRef } from 'react';
import { IconButton } from '@/components/ui';

interface MapSearchButtonProps {
  loading: boolean;
  onClick: () => void;
  className?: string;
  style?: React.CSSProperties;
  'data-testid'?: string;
}

const MapSearchButton = forwardRef<HTMLButtonElement, MapSearchButtonProps>(function MapSearchButton(
  { loading, onClick, className = '', style, 'data-testid': testId },
  ref,
) {
  return (
    <IconButton
      ref={ref}
      type="button"
      variant="overlay"
      onClick={onClick}
      aria-label={loading ? 'Search (loading)' : 'Search for a station or address'}
      data-testid={testId ?? 'map-search-button'}
      className={className}
      style={{
        width: 36,
        height: 36,
        backgroundColor: 'rgba(28, 32, 40, 0.85)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        ...style,
      }}
    >
      {loading ? (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          strokeLinecap="round"
          style={{ animation: 'spin 0.7s linear infinite' }}
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.12)" strokeWidth="2.5" />
          <path d="M21 12a9 9 0 1 1-6.219-8.56" stroke="#38bdf8" strokeWidth="2.5" />
        </svg>
      ) : (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#c9d1d9"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      )}
    </IconButton>
  );
});

export default MapSearchButton;
