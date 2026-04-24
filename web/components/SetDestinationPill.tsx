'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CommuteRuleEditor, createDefaultRule, type CommuteRule } from '@/components/Filters';
import { ButtonBase, PrimaryButton, TextButton } from '@/components/ui';
import {
  destinationCoords,
  destinationShortName,
  MAX_DESTINATIONS,
  useSavedDestination,
  type SavedDestination,
} from '@/lib/hooks/useSavedDestination';

/**
 * "Set destination" pill — sits in the filter bar near the Filters button.
 * Tapping it opens a small modal that reuses CommuteRuleEditor (same UI used
 * for commute filter rules) so the user gets address autocomplete, station
 * picker, park picker, and subway-line picker for free.
 *
 * Supports up to MAX_DESTINATIONS (currently 2). When 0 destinations are
 * saved the pill reads "Set destination". When ≥1 is saved the pill shows
 * the first short name plus a "+N" badge for any additional destinations.
 */
export default function SetDestinationPill() {
  const { destinations, setDestinations, clearDestination } = useSavedDestination();
  const [open, setOpen] = useState(false);
  // Tracks whether the next/current modal-open should pre-append an empty
  // draft so the user lands directly in the "add a second destination" flow
  // (driven by the "+" discoverability chip rendered next to the saved
  // destination chip). Stored in a ref so toggling it doesn't retrigger the
  // re-seed effect mid-open and clobber the extra draft.
  const openWithExtraDraftRef = useRef(false);
  const [drafts, setDrafts] = useState<CommuteRule[]>(() =>
    destinations.length > 0 ? destinations : [createDefaultRule()],
  );

  // Re-seed drafts whenever the modal opens with the latest saved destinations
  useEffect(() => {
    if (open) {
      const base = destinations.length > 0 ? destinations : [createDefaultRule()];
      if (openWithExtraDraftRef.current && base.length < MAX_DESTINATIONS) {
        setDrafts([...base, createDefaultRule()]);
      } else {
        setDrafts(base);
      }
      // Consume the flag so a subsequent open (e.g. tapping the destination
      // chip itself) doesn't also auto-add a draft.
      openWithExtraDraftRef.current = false;
    }
  }, [open, destinations]);

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

  // A draft is saveable if it resolves to coordinates (so the chip's commute
  // lookup will actually work). Save button is enabled as long as EVERY draft
  // resolves — no partially-resolvable destination sets.
  const allResolvable = drafts.length > 0 && drafts.every((d) => destinationCoords(d) !== null);

  const handleSave = () => {
    if (!allResolvable) return;
    setDestinations(drafts);
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    clearDestination();
  };

  const handleAddAnother = () => {
    if (drafts.length >= MAX_DESTINATIONS) return;
    setDrafts((prev) => [...prev, createDefaultRule()]);
  };

  const handleUpdateDraft = (id: string, updated: CommuteRule) => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? updated : d)));
  };

  const handleRemoveDraft = (id: string) => {
    setDrafts((prev) => {
      const filtered = prev.filter((d) => d.id !== id);
      // Always keep at least one draft visible so the user has something to edit
      return filtered.length === 0 ? [createDefaultRule()] : filtered;
    });
  };

  // Pill display: short name of FIRST destination, with "+1" badge if a
  // second is saved. Keeps the pill narrow on mobile.
  const firstName = destinations[0] ? destinationShortName(destinations[0]) : null;
  const extraCount = Math.max(0, destinations.length - 1);
  const ariaLabel = destinations.length > 0
    ? `Edit destinations: ${destinations.map((d) => destinationShortName(d, 32)).join(' and ')}`
    : 'Set a preferred destination';

  const canAddSecond = destinations.length === 1;
  const handleOpenAddSecond = (e: React.MouseEvent) => {
    e.stopPropagation();
    openWithExtraDraftRef.current = true;
    setOpen(true);
  };

  return (
    <>
      {destinations.length > 0 ? (
        <span className="inline-flex items-center gap-1">
        <ButtonBase
          onClick={() => setOpen(true)}
          aria-label={ariaLabel}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border h-7 whitespace-nowrap"
          style={{
            backgroundColor: 'rgba(126,231,135,0.08)',
            borderColor: 'rgba(126,231,135,0.35)',
            color: '#7ee787',
          }}
        >
          <span aria-hidden style={{ fontSize: 11, lineHeight: 1 }}>📍</span>
          <span>{firstName}</span>
          {extraCount > 0 && (
            <span
              aria-hidden
              className="inline-flex items-center justify-center rounded-full px-1.5 text-[10px] font-semibold"
              style={{
                backgroundColor: 'rgba(126,231,135,0.18)',
                color: '#7ee787',
                minWidth: 18,
                height: 16,
                lineHeight: 1,
              }}
            >
              +{extraCount}
            </span>
          )}
          <span
            role="button"
            tabIndex={0}
            onClick={handleClear}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') handleClear(e as unknown as React.MouseEvent);
            }}
            aria-label="Clear all destinations"
            className="inline-flex items-center justify-center rounded-full w-4 h-4 ml-0.5 transition-colors hover:bg-white/15 cursor-pointer"
          >
            <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M2 2L8 8M8 2L2 8" />
            </svg>
          </span>
        </ButtonBase>
        {canAddSecond && (
          <ButtonBase
            onClick={handleOpenAddSecond}
            aria-label="Add a second destination"
            data-testid="add-second-destination-chip"
            className="inline-flex items-center justify-center rounded-full border h-7 w-7 whitespace-nowrap"
            style={{
              backgroundColor: 'transparent',
              borderColor: '#3a3f4a',
              borderStyle: 'dashed',
              color: '#8b949e',
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </ButtonBase>
        )}
        </span>
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
                Preferred destinations
              </div>
              <div className="text-xs mt-0.5" style={{ color: '#8b949e' }}>
                Show commute time on every listing card. Doesn’t filter results.
                Save up to {MAX_DESTINATIONS} destinations.
              </div>
            </div>

            <div className="px-4 pb-2 flex flex-col gap-3" data-testid="destination-drafts">
              {drafts.map((draft, idx) => (
                <div
                  key={draft.id}
                  className="rounded-lg"
                  style={{ border: '1px solid #2d333b', backgroundColor: 'rgba(255,255,255,0.015)' }}
                  data-testid={`destination-draft-${idx}`}
                >
                  <div
                    className="flex items-center justify-between px-3 pt-2"
                    style={{ color: '#8b949e' }}
                  >
                    <div className="text-[11px] uppercase tracking-wider font-semibold">
                      Destination {idx + 1}
                    </div>
                    {drafts.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveDraft(draft.id)}
                        aria-label={`Remove destination ${idx + 1}`}
                        data-testid={`remove-destination-${idx}`}
                        className="inline-flex items-center justify-center w-6 h-6 rounded-full transition-colors cursor-pointer hover:bg-white/10 hover:text-white"
                      >
                        <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                          <path d="M2 2L8 8M8 2L2 8" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <div className="px-1 pb-1">
                    <CommuteRuleEditor
                      rule={draft}
                      onChange={(updated) => handleUpdateDraft(draft.id, updated as SavedDestination)}
                      onDelete={() => handleRemoveDraft(draft.id)}
                      hideMaxMinutes
                    />
                  </div>
                </div>
              ))}

              {drafts.length < MAX_DESTINATIONS && (
                <ButtonBase
                  onClick={handleAddAnother}
                  data-testid="add-another-destination"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium border w-full"
                  style={{
                    borderStyle: 'dashed',
                    borderColor: '#3a3f4a',
                    color: '#8b949e',
                    backgroundColor: 'transparent',
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  <span>Add another destination</span>
                </ButtonBase>
              )}
            </div>

            <div
              className="flex items-center justify-between gap-2 px-4 py-3 sticky bottom-0"
              style={{ backgroundColor: '#1c2028', borderTop: '1px solid #2d333b' }}
            >
              {destinations.length > 0 ? (
                <TextButton
                  onClick={() => {
                    clearDestination();
                    setOpen(false);
                  }}
                  className="text-xs"
                >
                  Remove all
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
                  disabled={!allResolvable}
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
