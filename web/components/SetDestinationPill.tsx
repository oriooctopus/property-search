'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CommuteRuleEditor, createDefaultRule, type CommuteRule } from '@/components/Filters';
import { ButtonBase, PrimaryButton, TextButton } from '@/components/ui';
import {
  destinationCoords,
  destinationShortName,
  useSavedDestination,
} from '@/lib/hooks/useSavedDestination';

/**
 * "Set destination" pill — sits in the filter bar near the Filters button.
 * Tapping it opens a small modal that reuses CommuteRuleEditor (same UI used
 * for commute filter rules) so the user gets address autocomplete, station
 * picker, park picker, and subway-line picker for free.
 *
 * When a destination is already saved, the pill shows the short name and an
 * inline ✕ to clear it.
 */
export default function SetDestinationPill() {
  const { destination, setDestination, clearDestination } = useSavedDestination();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CommuteRule>(() => destination ?? createDefaultRule());

  // Re-seed draft whenever the modal opens with the latest saved destination
  useEffect(() => {
    if (open) {
      setDraft(destination ?? createDefaultRule());
    }
  }, [open, destination]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  const isResolvable = destinationCoords(draft) !== null;

  const handleSave = () => {
    if (!isResolvable) return;
    setDestination(draft);
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    clearDestination();
  };

  const shortName = destination ? destinationShortName(destination) : null;

  return (
    <>
      {destination ? (
        <ButtonBase
          onClick={() => setOpen(true)}
          aria-label={`Edit destination: ${shortName}`}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border h-7 whitespace-nowrap"
          style={{
            backgroundColor: 'rgba(126,231,135,0.08)',
            borderColor: 'rgba(126,231,135,0.35)',
            color: '#7ee787',
          }}
        >
          <span aria-hidden style={{ fontSize: 11, lineHeight: 1 }}>📍</span>
          <span>{shortName}</span>
          <span
            role="button"
            tabIndex={0}
            onClick={handleClear}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') handleClear(e as unknown as React.MouseEvent);
            }}
            aria-label="Clear destination"
            className="inline-flex items-center justify-center rounded-full w-4 h-4 ml-0.5 transition-colors hover:bg-white/15 cursor-pointer"
          >
            <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M2 2L8 8M8 2L2 8" />
            </svg>
          </span>
        </ButtonBase>
      ) : (
        <ButtonBase
          onClick={() => setOpen(true)}
          aria-label="Set a preferred destination"
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border h-7 whitespace-nowrap"
          style={{
            backgroundColor: 'transparent',
            borderColor: '#3a3f4a',
            borderStyle: 'dashed',
            color: '#8b949e',
          }}
        >
          <span aria-hidden style={{ fontSize: 11, lineHeight: 1, color: '#58a6ff' }}>📍</span>
          <span>Set destination</span>
        </ButtonBase>
      )}

      {open && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[2000] flex items-end sm:items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto relative"
            style={{ backgroundColor: '#1c2028', border: '1px solid #2d333b' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer text-[#8b949e] hover:text-white hover:bg-white/10 z-10"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            <div className="px-4 pt-4 pb-2">
              <div className="text-base font-semibold" style={{ color: '#e1e4e8' }}>
                Preferred destination
              </div>
              <div className="text-xs mt-0.5" style={{ color: '#8b949e' }}>
                Show commute time on every listing card. Doesn’t filter results.
              </div>
            </div>
            <div className="px-4 pb-2">
              <CommuteRuleEditor
                rule={draft}
                onChange={setDraft}
                onDelete={() => setDraft(createDefaultRule())}
              />
            </div>
            <div
              className="flex items-center justify-between gap-2 px-4 py-3 sticky bottom-0"
              style={{ backgroundColor: '#1c2028', borderTop: '1px solid #2d333b' }}
            >
              {destination ? (
                <TextButton
                  onClick={() => {
                    clearDestination();
                    setOpen(false);
                  }}
                  className="text-xs"
                >
                  Remove
                </TextButton>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2 ml-auto">
                <TextButton onClick={() => setOpen(false)} className="text-xs">
                  Cancel
                </TextButton>
                <PrimaryButton
                  onClick={handleSave}
                  disabled={!isResolvable}
                  className="h-8 px-4 text-xs font-bold"
                >
                  Save
                </PrimaryButton>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
