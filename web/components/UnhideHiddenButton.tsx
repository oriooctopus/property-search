'use client';

/**
 * UnhideHiddenButton — empty-state CTA shown when the user has hidden
 * listings AND the current result set is empty. Clicking opens a small
 * dropdown with two options:
 *
 *   - "Unhide matching this filter" — only the hidden listings whose rows
 *      satisfy the active filter set come back. Helps the user notice they
 *      may have hidden a listing they'd actually want to see now.
 *   - "Unhide all hidden listings"  — wipes every row in `hidden_listings`
 *      for this user. Confirmed via a lightweight modal because it's
 *      destructive in scope.
 *
 * Hidden when the user has zero hidden listings (no dead UI). Counts are
 * fetched lazily — the component fires a single POST to
 * /api/listings/hidden/count whenever the filter payload changes, so the
 * "matching this filter" label always shows an accurate number.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CommuteRule } from '@/components/Filters';

export interface UnhideFiltersPayload {
  filters: {
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
  };
  commuteRules: CommuteRule[] | null;
}

interface UnhideHiddenButtonProps {
  userId: string | null;
  /** Returns the active filter/commute payload for the "matching" scope. */
  getFiltersPayload: () => UnhideFiltersPayload;
  /**
   * Visual variant. `default` = translucent-blue (matches GoToNearestMatch
   * default). `primary` = solid accent (matches GoToNearestMatch primary,
   * used in mobile swipe empty state).
   */
  variant?: 'default' | 'primary';
  /** Optional className for the wrapping element. */
  className?: string;
}

interface CountResponse {
  total: number;
  matching: number | null;
}

export default function UnhideHiddenButton({
  userId,
  getFiltersPayload,
  variant = 'default',
  className = '',
}: UnhideHiddenButtonProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState<'all' | 'matching' | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Snapshot the filter payload once per dropdown-open so the count and
  // subsequent unhide call see the exact same filter set (avoids races where
  // the user changes filters mid-fetch). When the dropdown is closed we
  // refresh the snapshot on next open.
  const [snapshotKey, setSnapshotKey] = useState(0);
  const payloadSnapshotRef = useRef<UnhideFiltersPayload | null>(null);

  const refreshSnapshot = useCallback(() => {
    payloadSnapshotRef.current = getFiltersPayload();
    setSnapshotKey((k) => k + 1);
  }, [getFiltersPayload]);

  // Fetch counts. Always fetch the bare total (so we can decide whether to
  // render the button at all). When the dropdown is open, also POST the
  // current filter snapshot to get the "matching" count.
  const { data: countData } = useQuery<CountResponse>({
    queryKey: ['hidden-listings-count', userId, snapshotKey, open],
    queryFn: async () => {
      if (!userId) return { total: 0, matching: null };
      if (!open) {
        // Total only — cheap, no body.
        const res = await fetch('/api/listings/hidden/count');
        if (!res.ok) return { total: 0, matching: null };
        return (await res.json()) as CountResponse;
      }
      const payload = payloadSnapshotRef.current ?? getFiltersPayload();
      const res = await fetch('/api/listings/hidden/count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return { total: 0, matching: null };
      return (await res.json()) as CountResponse;
    },
    staleTime: 15_000,
    enabled: !!userId,
  });

  const total = countData?.total ?? 0;
  const matching = countData?.matching ?? null;

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open && !confirmAll) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (wrapperRef.current && wrapperRef.current.contains(target)) return;
      // Confirm modal handles its own dismissal.
      if (confirmAll) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open, confirmAll]);

  const invalidateAfterUnhide = useCallback(() => {
    // Refresh hidden-listings cache and the count itself.
    queryClient.invalidateQueries({ queryKey: ['hidden-listings', userId] });
    queryClient.invalidateQueries({ queryKey: ['hidden-listings-count', userId] });
  }, [queryClient, userId]);

  const handleUnhideMatching = useCallback(async () => {
    if (busy) return;
    setBusy('matching');
    try {
      const payload = payloadSnapshotRef.current ?? getFiltersPayload();
      const res = await fetch('/api/listings/hidden/unhide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'matching', ...payload }),
      });
      if (!res.ok) {
        console.error('[UnhideHiddenButton] matching unhide failed', await res.text());
      }
    } catch (err) {
      console.error('[UnhideHiddenButton] matching unhide error:', err);
    } finally {
      setBusy(null);
      setOpen(false);
      invalidateAfterUnhide();
    }
  }, [busy, getFiltersPayload, invalidateAfterUnhide]);

  const handleUnhideAll = useCallback(async () => {
    if (busy) return;
    setBusy('all');
    try {
      const res = await fetch('/api/listings/hidden/unhide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'all' }),
      });
      if (!res.ok) {
        console.error('[UnhideHiddenButton] unhide-all failed', await res.text());
      }
    } catch (err) {
      console.error('[UnhideHiddenButton] unhide-all error:', err);
    } finally {
      setBusy(null);
      setConfirmAll(false);
      setOpen(false);
      invalidateAfterUnhide();
    }
  }, [busy, invalidateAfterUnhide]);

  // Don't render anything when the user has no hidden listings or is logged
  // out (the count endpoint returns 401 for anon, and the local-storage
  // hide path is rare enough we don't surface a CTA for it).
  if (!userId || total === 0) return null;

  const buttonStyle =
    variant === 'primary'
      ? {
          backgroundColor: '#58a6ff',
          color: '#0f1117',
          border: '1px solid transparent',
        }
      : {
          backgroundColor: 'rgba(88,166,255,0.12)',
          color: '#58a6ff',
          border: '1px solid rgba(88,166,255,0.35)',
        };

  const buttonHover =
    variant === 'primary'
      ? 'hover:bg-[#4c8fdf]'
      : 'hover:bg-[rgba(88,166,255,0.18)]';

  // Counts to render in the menu. When `matching` is null (no filters set
  // OR API returned null), we hide the matching option since "Unhide all"
  // would have the same effect.
  const matchingCount = matching;
  const showMatching = matchingCount != null && matchingCount > 0 && matchingCount < total;

  return (
    <div ref={wrapperRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => {
          if (!open) refreshSnapshot();
          setOpen((v) => !v);
        }}
        data-testid="unhide-hidden-button"
        className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer ${buttonHover}`}
        style={buttonStyle}
      >
        {/* eye-off icon */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
          <line x1="2" y1="2" x2="22" y2="22" />
        </svg>
        <span>Unhide listings ({total})</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          data-testid="unhide-hidden-menu"
          className="absolute left-1/2 -translate-x-1/2 mt-2 z-[1000] rounded-lg shadow-lg overflow-hidden"
          style={{
            minWidth: 260,
            backgroundColor: '#1c2028',
            border: '1px solid #2d333b',
          }}
        >
          {showMatching && (
            <button
              type="button"
              onClick={handleUnhideMatching}
              disabled={busy != null}
              data-testid="unhide-matching-option"
              className="w-full text-left px-4 py-3 text-sm cursor-pointer transition-colors hover:bg-[rgba(88,166,255,0.12)] disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ color: '#e1e4e8' }}
            >
              <div className="font-medium">Unhide matching this filter</div>
              <div className="text-xs mt-0.5" style={{ color: '#8b949e' }}>
                {matchingCount} of {total} hidden listing{total === 1 ? '' : 's'}
              </div>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setConfirmAll(true);
            }}
            disabled={busy != null}
            data-testid="unhide-all-option"
            className="w-full text-left px-4 py-3 text-sm cursor-pointer transition-colors hover:bg-[rgba(88,166,255,0.12)] disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              color: '#e1e4e8',
              borderTop: showMatching ? '1px solid #2d333b' : 'none',
            }}
          >
            <div className="font-medium">Unhide all hidden listings</div>
            <div className="text-xs mt-0.5" style={{ color: '#8b949e' }}>
              {total} hidden listing{total === 1 ? '' : 's'}
            </div>
          </button>
        </div>
      )}

      {confirmAll && (
        <ConfirmDialog
          message={`Unhide all ${total} hidden listing${total === 1 ? '' : 's'}? They will reappear in your search results.`}
          confirmLabel={busy === 'all' ? 'Unhiding…' : 'Unhide all'}
          cancelLabel="Cancel"
          confirmDisabled={busy != null}
          onConfirm={handleUnhideAll}
          onCancel={() => {
            if (busy === 'all') return;
            setConfirmAll(false);
          }}
        />
      )}
    </div>
  );
}

function ConfirmDialog({
  message,
  confirmLabel,
  cancelLabel,
  confirmDisabled,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      data-testid="unhide-confirm-dialog"
      className="fixed inset-0 z-[2000] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onCancel}
    >
      <div
        className="rounded-lg p-5 mx-4 max-w-sm w-full"
        style={{
          backgroundColor: '#1c2028',
          border: '1px solid #2d333b',
          boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm mb-4" style={{ color: '#e1e4e8' }}>
          {message}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={confirmDisabled}
            className="px-3 py-1.5 rounded-md text-sm font-medium cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              color: '#8b949e',
              backgroundColor: 'transparent',
              border: '1px solid #2d333b',
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            data-testid="unhide-confirm-button"
            className="px-3 py-1.5 rounded-md text-sm font-medium cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              color: '#0f1117',
              backgroundColor: '#58a6ff',
              border: '1px solid transparent',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
