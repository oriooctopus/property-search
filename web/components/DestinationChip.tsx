'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import CommuteItinerary from '@/components/CommuteItinerary';
import { ButtonBase } from '@/components/ui';
import {
  destinationCoords,
  destinationOtpMode,
  type SavedDestination,
} from '@/lib/hooks/useSavedDestination';
import type { DestinationCommute } from '@/lib/hooks/useDestinationCommutes';

interface DestinationChipProps {
  listing: { id: number; lat?: number | null; lon?: number | null };
  destination: SavedDestination;
  commute: DestinationCommute | undefined;
  /** Optional className appended to the wrapper row (e.g. for layout tweaks). */
  className?: string;
}

function modeIcon(mode: 'walk' | 'transit' | 'bike') {
  if (mode === 'walk') {
    return (
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="12" cy="5" r="2" />
        <path d="M10 22l2-7 3 3v6" />
        <path d="M10 13l-1 6" />
        <path d="M15 10l-3 3-2-2-3 4" />
      </svg>
    );
  }
  if (mode === 'bike') {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="6" cy="17" r="3.5" />
        <circle cx="18" cy="17" r="3.5" />
        <path d="M6 17l5-7h4l-2-3h-2" />
        <path d="M18 17l-3-7" />
      </svg>
    );
  }
  // transit — small subway icon
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="3" width="16" height="14" rx="3" />
      <path d="M4 11h16" />
      <path d="M9 21l-2-3h10l-2 3" />
      <circle cx="9" cy="14.5" r="0.6" fill="currentColor" />
      <circle cx="15" cy="14.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

function modeLabel(mode: 'walk' | 'transit' | 'bike'): string {
  if (mode === 'walk') return 'walk';
  if (mode === 'bike') return 'bike';
  return 'transit';
}

function chipText(commute: DestinationCommute | undefined, fallbackMode: 'walk' | 'transit' | 'bike'): string {
  if (!commute) return `… ${modeLabel(fallbackMode)}`;
  if (commute.loading) return `… ${modeLabel(commute.mode)}`;
  if (commute.errored || commute.minutes == null) return `— ${modeLabel(commute.mode)}`;
  return `${commute.minutes} min ${modeLabel(commute.mode)}`;
}

interface PopupProps {
  listing: { id: number; lat?: number | null; lon?: number | null };
  destination: SavedDestination;
  onClose: () => void;
}

function CommutePopup({ listing, destination, onClose }: PopupProps) {
  const coords = destinationCoords(destination);
  const otpMode = destinationOtpMode(destination);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  if (!mounted) return null;
  if (!coords || listing.lat == null || listing.lon == null) {
    return createPortal(
      <div
        className="fixed inset-0 z-[2000] flex items-center justify-center p-4"
        style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      >
        <div
          className="rounded-xl p-4 max-w-sm w-full"
          style={{ backgroundColor: '#1c2028', border: '1px solid #2d333b', color: '#e1e4e8' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-sm">Commute details unavailable for this destination.</div>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[2000] flex items-end sm:items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto relative"
        style={{ backgroundColor: '#1c2028', border: '1px solid #2d333b' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer text-[#8b949e] hover:text-white hover:bg-white/10"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <div className="px-4 pt-4 pb-1">
          <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: '#8b949e' }}>
            Commute to
          </div>
          <div className="text-base font-semibold mt-0.5" style={{ color: '#e1e4e8' }}>
            {coords.label}
          </div>
        </div>
        <div className="px-4 pb-2">
          <CommuteItinerary
            listingLat={listing.lat as number}
            listingLon={listing.lon as number}
            destinationLat={coords.lat}
            destinationLon={coords.lon}
            destinationName={coords.label}
            mode={otpMode}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function DestinationChip({
  listing,
  destination,
  commute,
  className,
}: DestinationChipProps) {
  const [popupOpen, setPopupOpen] = useState(false);
  const mode = (commute?.mode ?? destination.mode) as 'walk' | 'transit' | 'bike';
  const label = chipText(commute, mode);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setPopupOpen(true);
  };

  return (
    <>
      <div
        className={`flex items-center gap-1.5 ${className ?? ''}`}
        style={{ marginTop: 1 }}
        onClick={(e) => e.stopPropagation()}
      >
        <ButtonBase
          onClick={handleClick}
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border whitespace-nowrap"
          style={{
            backgroundColor: 'rgba(255,255,255,0.04)',
            borderColor: '#2d333b',
            color: '#c9d1d9',
            lineHeight: 1.2,
          }}
          aria-label={`Commute to destination: ${label}. Tap for details.`}
        >
          <span className="inline-flex items-center justify-center" style={{ color: '#8b949e' }}>
            {modeIcon(mode)}
          </span>
          <span>{label}</span>
        </ButtonBase>
      </div>
      {popupOpen && (
        <CommutePopup listing={listing} destination={destination} onClose={() => setPopupOpen(false)} />
      )}
    </>
  );
}
