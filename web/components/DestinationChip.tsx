'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import CommuteItinerary from '@/components/CommuteItinerary';
import { ButtonBase } from '@/components/ui';
import {
  destinationCoords,
  destinationOtpMode,
  destinationShortName,
  type SavedDestination,
} from '@/lib/hooks/useSavedDestination';
import type { DestinationCommute } from '@/lib/hooks/useDestinationCommutes';

interface DestinationChipProps {
  listing: { id: number; lat?: number | null; lon?: number | null };
  /**
   * One or more saved destinations. Length 1 → renders as it always has
   * (single chip with mode label). Length 2 → renders both commute times
   * compactly inside the same chip.
   */
  destinations: SavedDestination[];
  /**
   * One commute entry per destination, in the same order. Pass `undefined`
   * for any entry that's still resolving / hasn't been requested yet.
   */
  commutes: Array<DestinationCommute | undefined>;
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

/** Single-destination chip text: "12 min walk" / "… walk" / "— walk". */
function singleChipText(commute: DestinationCommute | undefined, fallbackMode: 'walk' | 'transit' | 'bike'): string {
  if (!commute) return `… ${modeLabel(fallbackMode)}`;
  if (commute.loading) return `… ${modeLabel(commute.mode)}`;
  if (commute.errored || commute.minutes == null) return `— ${modeLabel(commute.mode)}`;
  return `${commute.minutes} min ${modeLabel(commute.mode)}`;
}

/** Two-destination chip text: just the minutes ("12m") — no mode label, since
 * each destination may have its own mode and we'd run out of width. The mode
 * is communicated via the per-segment icon. */
function dualMinutesText(commute: DestinationCommute | undefined): string {
  if (!commute) return '…';
  if (commute.loading) return '…';
  if (commute.errored || commute.minutes == null) return '—';
  return `${commute.minutes}m`;
}

interface PopupProps {
  listing: { id: number; lat?: number | null; lon?: number | null };
  destinations: SavedDestination[];
  onClose: () => void;
}

function CommutePopup({ listing, destinations, onClose }: PopupProps) {
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

  // Resolve every destination up-front so we can render an itinerary per
  // destination (or a single "unavailable" message if NONE of them resolve).
  const resolved = destinations.map((d) => ({
    destination: d,
    coords: destinationCoords(d),
    otpMode: destinationOtpMode(d),
  }));
  const anyResolvable =
    listing.lat != null && listing.lon != null && resolved.some((r) => r.coords);

  if (!anyResolvable) {
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
          className="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer text-[#8b949e] hover:text-white hover:bg-white/10 z-10"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <div className="px-4 pt-4 pb-2 flex flex-col gap-4">
          {resolved.map((r, idx) => {
            if (!r.coords || listing.lat == null || listing.lon == null) {
              return (
                <div key={idx}>
                  <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: '#8b949e' }}>
                    Commute to
                  </div>
                  <div className="text-base font-semibold mt-0.5" style={{ color: '#e1e4e8' }}>
                    {destinationShortName(r.destination, 64)}
                  </div>
                  <div className="text-xs mt-1" style={{ color: '#8b949e' }}>
                    Commute details unavailable for this destination.
                  </div>
                </div>
              );
            }
            return (
              <div key={idx}>
                <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: '#8b949e' }}>
                  Commute to
                </div>
                <div className="text-base font-semibold mt-0.5 mb-1" style={{ color: '#e1e4e8' }}>
                  {r.coords.label}
                </div>
                <CommuteItinerary
                  listingLat={listing.lat as number}
                  listingLon={listing.lon as number}
                  destinationLat={r.coords.lat}
                  destinationLon={r.coords.lon}
                  destinationName={r.coords.label}
                  mode={r.otpMode}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Two-destination color palette (matches mockup Option A exactly).
 * Index aligns with the destination index — destination 0 is green,
 * destination 1 is amber.
 */
const DUAL_PALETTE = [
  {
    bg: 'rgba(126,231,135,0.08)',
    border: 'rgba(126,231,135,0.3)',
    text: '#7ee787',
  },
  {
    bg: 'rgba(240,184,120,0.08)',
    border: 'rgba(240,184,120,0.3)',
    text: '#f0b878',
  },
] as const;

export default function DestinationChip({
  listing,
  destinations,
  commutes,
  className,
}: DestinationChipProps) {
  // `popupIndex` tracks which destination's popup is open, or null when closed.
  // For single-destination it's always 0 when open. For two-destinations it
  // mirrors the pill the user tapped so the popup focuses on that destination.
  const [popupIndex, setPopupIndex] = useState<number | null>(null);

  if (destinations.length === 0) return null;

  const openPopup = (index: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setPopupIndex(index);
  };

  // Single-destination layout — preserved exactly as the previous version
  // ("12 min walk").
  if (destinations.length === 1) {
    const dest = destinations[0];
    const commute = commutes[0];
    const mode = (commute?.mode ?? dest.mode) as 'walk' | 'transit' | 'bike';
    const label = singleChipText(commute, mode);
    return (
      <>
        <div
          className={`flex items-center gap-1.5 ${className ?? ''}`}
          style={{ marginTop: 1 }}
          onClick={(e) => e.stopPropagation()}
        >
          <ButtonBase
            onClick={openPopup(0)}
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
        {popupIndex !== null && (
          <CommutePopup listing={listing} destinations={destinations} onClose={() => setPopupIndex(null)} />
        )}
      </>
    );
  }

  // Two-destination layout — Option A: two stacked color-coded pills, each
  // showing destination name + mode icon + time. Tapping a pill opens the
  // commute popup focused on that destination.
  const popupDestinations =
    popupIndex !== null && popupIndex >= 0 && popupIndex < destinations.length
      ? [destinations[popupIndex]]
      : destinations;

  return (
    <>
      <div
        className={`flex flex-col items-start gap-1 ${className ?? ''}`}
        style={{ marginTop: 1 }}
        onClick={(e) => e.stopPropagation()}
      >
        {destinations.map((d, i) => {
          const c = commutes[i];
          const mode = (c?.mode ?? d.mode) as 'walk' | 'transit' | 'bike';
          const minutes = dualMinutesText(c);
          const palette = DUAL_PALETTE[i] ?? DUAL_PALETTE[0];
          const destName = destinationShortName(d, 12);
          const ariaText = `Commute to ${destinationShortName(d, 32)}: ${singleChipText(c, mode)}`;
          return (
            <ButtonBase
              key={i}
              onClick={openPopup(i)}
              className="inline-flex items-center gap-1.5 rounded-full border whitespace-nowrap"
              style={{
                backgroundColor: palette.bg,
                borderColor: palette.border,
                color: palette.text,
                paddingLeft: 8,
                paddingRight: 8,
                paddingTop: 1,
                paddingBottom: 1,
                fontSize: 11,
                fontWeight: 500,
                lineHeight: 1.2,
              }}
              aria-label={`${ariaText}. Tap for details.`}
            >
              <span className="inline-flex items-center justify-center" style={{ opacity: 0.85 }}>
                {modeIcon(mode)}
              </span>
              <span style={{ fontWeight: 600 }}>{destName}</span>
              <span style={{ opacity: 0.9 }}>{minutes}</span>
            </ButtonBase>
          );
        })}
      </div>
      {popupIndex !== null && (
        <CommutePopup
          listing={listing}
          destinations={popupDestinations}
          onClose={() => setPopupIndex(null)}
        />
      )}
    </>
  );
}
