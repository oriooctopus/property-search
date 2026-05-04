'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ButtonBase, PrimaryButton, TextButton } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { Wishlist } from '@/lib/hooks/useWishlists';

// ---------------------------------------------------------------------------
// Dual-purpose "Save" panel — tabs between Save-search and Filter-by-wishlist.
// Visual design: see web/public/mockup-wishlist-sections-a.html
// ---------------------------------------------------------------------------

export type WishlistFilterSelection = string | 'all-saved' | null;

// Minimal shape needed to render the saved-search list. Mirrors
// SavedSearchEntry from Filters.tsx without importing it (avoids a cycle).
export interface SavedSearchRow {
  id: number;
  name: string;
}

export interface SaveWishlistPanelProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  initialTab: 'save-search' | 'wishlist';
  onClose: () => void;

  // Saved-search list — rendered as the default view of the "Saved searches"
  // tab. Clicking a row loads that search; the optional pencil enters
  // rename/edit mode. When the list is empty, the user is nudged to use the
  // sticky-footer "+ Save current search as…" affordance.
  savedSearches?: SavedSearchRow[];
  activeSearchId?: number | null;
  onLoadSearch?: (id: number) => void;
  onClearActiveSearch?: () => void;

  // Wishlist filter section data
  myWishlists: Wishlist[];
  sharedWishlists: Wishlist[];
  selected: WishlistFilterSelection;
  onSelect: (selection: WishlistFilterSelection) => void;
  onCreateWishlist: (name: string) => Promise<string | null>;
  onOpenManager: () => void;

  // Optional sticky footer rendered at the very bottom of the panel,
  // visible regardless of which tab is active.
  stickyFooter?: React.ReactNode;
}

const AVATAR_COLORS = ['#f97583', '#a78bfa', '#7ee787', '#f0883e', '#58a6ff', '#fcc419'];

function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initialFor(seed: string): string {
  return (seed.trim()[0] ?? '?').toUpperCase();
}

export default function SaveWishlistPanel({
  anchorRef,
  initialTab,
  onClose,
  savedSearches = [],
  activeSearchId = null,
  onLoadSearch,
  onClearActiveSearch,
  myWishlists,
  sharedWishlists,
  selected,
  onSelect,
  onCreateWishlist,
  onOpenManager,
  stickyFooter,
}: SaveWishlistPanelProps) {
  const [tab, setTab] = useState<'save-search' | 'wishlist'>(initialTab);
  const [showNewInput, setShowNewInput] = useState(false);
  const [newName, setNewName] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const newInputRef = useRef<HTMLInputElement>(null);

  // Close on outside click / Escape
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current && panelRef.current.contains(target)) return;
      if (anchorRef.current && anchorRef.current.contains(target)) return;
      onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [anchorRef, onClose]);

  useEffect(() => {
    if (showNewInput) setTimeout(() => newInputRef.current?.focus(), 40);
  }, [showNewInput]);

  // Position panel anchored to the dual-chip. Mirrors FilterChip's flip-above
  // logic so the panel stays fully on-screen inside the mobile filters bottom
  // sheet (where the chip sits near the viewport's bottom edge). Without this
  // the panel rendered at anchor.bottom+8 which was well past window.innerHeight
  // and the Save form was completely unreachable on mobile.
  const anchorRect = anchorRef.current?.getBoundingClientRect() ?? null;
  const PANEL_WIDTH = 340;
  const GAP = 8;
  const MIN_EDGE_PADDING = 16;
  const MIN_PANEL_HEIGHT = 240;

  let top = 96;
  let left: number | undefined;
  let right: number | undefined = 20;
  let maxHeight: number | undefined;

  if (anchorRect && typeof window !== 'undefined') {
    // Horizontal placement: prefer right-align (panel's right edge = chip's
    // right edge) so the panel hangs off the right side of the dual-chip. If
    // right-aligning pushes the panel off the left side of the viewport (as
    // happens when the chip sits near the left edge, e.g. the desktop filter
    // sidebar), fall back to left-align (panel.left = chip.left) and clamp
    // so the panel stays fully in-viewport with 8px padding.
    const vw = window.innerWidth;
    const effectiveWidth = Math.min(PANEL_WIDTH, vw - 16);
    const rightAlignedLeft = anchorRect.right - effectiveWidth;
    if (rightAlignedLeft >= 8) {
      right = Math.max(8, vw - anchorRect.right);
      left = undefined;
    } else {
      right = undefined;
      left = Math.max(
        8,
        Math.min(anchorRect.left, vw - effectiveWidth - 8),
      );
    }

    const spaceBelow = window.innerHeight - anchorRect.bottom - GAP - MIN_EDGE_PADDING;
    const spaceAbove = anchorRect.top - GAP - MIN_EDGE_PADDING;
    const openAbove = spaceBelow < MIN_PANEL_HEIGHT && spaceAbove > spaceBelow;
    if (openAbove) {
      maxHeight = Math.max(MIN_PANEL_HEIGHT, spaceAbove);
      top = Math.max(MIN_EDGE_PADDING, anchorRect.top - GAP - maxHeight);
      maxHeight = anchorRect.top - GAP - top;
    } else {
      top = anchorRect.bottom + GAP;
      maxHeight = Math.max(MIN_PANEL_HEIGHT, spaceBelow);
    }
  }

  const totalSaved = new Set<number>();
  for (const w of [...myWishlists, ...sharedWishlists]) {
    for (const it of w.wishlist_items) totalSaved.add(it.listing_id);
  }

  async function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const id = await onCreateWishlist(trimmed);
    setNewName('');
    setShowNewInput(false);
    if (id) onSelect(id);
  }

  if (typeof document === 'undefined') return null;

  const panel = (
    <div
      ref={panelRef}
      data-save-wishlist-panel
      className="fixed z-[2000] rounded-xl shadow-2xl flex flex-col"
      style={{
        top,
        left,
        right,
        width: PANEL_WIDTH,
        maxWidth: 'calc(100vw - 16px)',
        maxHeight,
        backgroundColor: '#1c2028',
        border: '1px solid #2d333b',
        boxShadow: '0 12px 40px rgba(0,0,0,0.65)',
        overflow: 'hidden',
      }}
    >
      {/* Tabs — fixed at top of panel */}
      <div className="flex shrink-0" style={{ borderBottom: '1px solid #2d333b' }}>
        <TabButton
          active={tab === 'save-search'}
          onClick={() => setTab('save-search')}
          borderRight
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
          Saved searches
        </TabButton>
        <TabButton
          active={tab === 'wishlist'}
          onClick={() => setTab('wishlist')}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          Filter by wishlist
        </TabButton>
      </div>

      {tab === 'save-search' && (
        <div
          className="overflow-y-auto overscroll-contain flex flex-col"
          style={{ WebkitOverflowScrolling: 'touch', minHeight: 0 }}
        >
          <div className="px-4 pt-3 pb-2">
            {/* "All" row — clears the active saved-search selection so the
                live filters revert to whatever the user has set manually. */}
            <SavedSearchRowButton
              checked={activeSearchId == null}
              onClick={() => {
                onClearActiveSearch?.();
                onClose();
              }}
              name="All searches"
              nameColor="#7ee787"
            />

            {savedSearches.length > 0 && (
              <div
                className="flex items-center gap-1.5 pt-3 pb-1.5 text-[10.5px] font-bold uppercase"
                style={{ color: '#6e7681', letterSpacing: '0.08em' }}
              >
                Saved searches
                <span
                  className="font-semibold"
                  style={{
                    color: '#484f58',
                    fontSize: '10.5px',
                    background: 'rgba(139,148,158,0.08)',
                    padding: '1px 6px',
                    borderRadius: 8,
                  }}
                >
                  {savedSearches.length}
                </span>
              </div>
            )}

            {savedSearches.length === 0 ? (
              <div className="text-[12px] py-3" style={{ color: '#8b949e', lineHeight: 1.5 }}>
                No saved searches yet.
                <div className="text-[11px] mt-1" style={{ color: '#6e7681' }}>
                  Use <span style={{ color: '#58a6ff' }}>Save current search as…</span> below to save your current filters for one-click access later.
                </div>
              </div>
            ) : (
              savedSearches.map((s) => (
                <SavedSearchRowButton
                  key={s.id}
                  checked={activeSearchId === s.id}
                  onClick={() => {
                    onLoadSearch?.(s.id);
                    onClose();
                  }}
                  name={s.name}
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* (sticky footer rendered after both tab bodies — see end of panel) */}

      {tab === 'wishlist' && (
        <div
          className="overflow-y-auto overscroll-contain flex flex-col"
          style={{ WebkitOverflowScrolling: 'touch', minHeight: 0 }}
        >
          <div className="px-4 pt-3 pb-2">
            {/* All saved */}
            <WishlistRow
              checked={selected === 'all-saved'}
              onClick={() => onSelect('all-saved')}
              name="All saved"
              nameColor="#7ee787"
              count={totalSaved.size}
            />

            {/* Created by you */}
            <div
              className="flex items-center gap-1.5 pt-3 pb-1.5 text-[10.5px] font-bold uppercase"
              style={{ color: '#6e7681', letterSpacing: '0.08em' }}
            >
              Created by you
              <span
                className="font-semibold"
                style={{
                  color: '#484f58',
                  fontSize: '10.5px',
                  background: 'rgba(139,148,158,0.08)',
                  padding: '1px 6px',
                  borderRadius: 8,
                }}
              >
                {myWishlists.length}
              </span>
            </div>

            {myWishlists.length === 0 ? (
              <div className="text-[12px] py-2" style={{ color: '#6e7681' }}>
                No wishlists yet.
              </div>
            ) : (
              myWishlists.map((w) => {
                const sharedCount = w.wishlist_shares.length;
                return (
                  <WishlistRow
                    key={w.id}
                    checked={selected === w.id}
                    onClick={() => onSelect(w.id)}
                    name={w.name}
                    count={w.wishlist_items.length}
                    sub={sharedCount > 0 ? (
                      <div className="flex items-center gap-1.5 text-[10.5px]" style={{ color: '#6e7681' }}>
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#6e7681" strokeWidth="2">
                          <circle cx="9" cy="7" r="4" />
                          <path d="M17 11l2 2 4-4M23 21v-2a4 4 0 0 0-3-3.87" />
                        </svg>
                        Shared with {sharedCount}
                      </div>
                    ) : undefined}
                  />
                );
              })
            )}

            {/* Shared with you */}
            {sharedWishlists.length > 0 && (
              <>
                <div
                  className="flex items-center gap-1.5 pt-3 pb-1.5 text-[10.5px] font-bold uppercase"
                  style={{ color: '#6e7681', letterSpacing: '0.08em' }}
                >
                  Shared with you
                  <span
                    className="font-semibold"
                    style={{
                      color: '#484f58',
                      fontSize: '10.5px',
                      background: 'rgba(139,148,158,0.08)',
                      padding: '1px 6px',
                      borderRadius: 8,
                    }}
                  >
                    {sharedWishlists.length}
                  </span>
                </div>

                {sharedWishlists.map((w) => {
                  const ownerLabel = w.owner_email ?? 'owner';
                  const initial = initialFor(ownerLabel);
                  const bg = avatarColor(w.user_id);
                  // Determine this user's permission on the share, if we can find it —
                  // panel lives inside a component that renders shared wishlists fetched
                  // for the current user's email, so any share row on this wishlist
                  // with a non-null permission is theirs.
                  const myShare = w.wishlist_shares[0];
                  const perm = myShare?.permission === 'editor' ? 'editor' : 'viewer';
                  return (
                    <WishlistRow
                      key={w.id}
                      checked={selected === w.id}
                      onClick={() => onSelect(w.id)}
                      name={w.name}
                      count={w.wishlist_items.length}
                      sub={
                        <div className="flex items-center gap-1.5 text-[10.5px]" style={{ color: '#6e7681' }}>
                          <div
                            className="flex items-center justify-center rounded-full text-[8px] font-bold text-white"
                            style={{ width: 14, height: 14, background: bg, flexShrink: 0 }}
                          >
                            {initial}
                          </div>
                          from {ownerLabel} ·{' '}
                          <span
                            className="font-semibold uppercase"
                            style={{
                              fontSize: '9.5px',
                              letterSpacing: '0.04em',
                              padding: '1px 5px',
                              borderRadius: 3,
                              color: perm === 'editor' ? '#d2a8ff' : '#8b949e',
                              background: perm === 'editor' ? 'rgba(210,168,255,0.12)' : 'rgba(139,148,158,0.12)',
                            }}
                          >
                            {perm === 'editor' ? 'Editor' : 'Viewer'}
                          </span>
                        </div>
                      }
                    />
                  );
                })}
              </>
            )}
          </div>

          {/* + New wishlist */}
          <div
            className="px-4 py-2.5"
            style={{ borderTop: '1px solid #2d333b' }}
          >
            {showNewInput ? (
              <div className="flex items-center gap-2">
                <input
                  ref={newInputRef}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate();
                    if (e.key === 'Escape') {
                      setShowNewInput(false);
                      setNewName('');
                    }
                  }}
                  placeholder="Wishlist name"
                  className="flex-1 rounded-md px-2 py-1 text-xs outline-none"
                  style={{
                    backgroundColor: '#0f1117',
                    border: '1px solid #2d333b',
                    color: '#e1e4e8',
                  }}
                />
                <PrimaryButton
                  onClick={handleCreate}
                  disabled={!newName.trim()}
                  className="text-[11px] px-2.5 py-1"
                >
                  Add
                </PrimaryButton>
                <TextButton
                  variant="muted"
                  onClick={() => {
                    setShowNewInput(false);
                    setNewName('');
                  }}
                  className="text-[11px]"
                >
                  Cancel
                </TextButton>
              </div>
            ) : (
              <ButtonBase
                onClick={() => setShowNewInput(true)}
                className="flex items-center gap-1.5 text-[12px] font-medium"
                style={{ color: '#58a6ff', background: 'transparent', border: 'none', padding: 0 }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New wishlist
              </ButtonBase>
            )}
          </div>

          {/* Footer */}
          <div
            className="px-4 py-2.5 text-[11px] flex items-center gap-1.5"
            style={{ color: '#6e7681', borderTop: '1px solid #2d333b' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6e7681" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19 12h2M3 12h2M12 19v2M12 3v2" />
            </svg>
            <span>
              Rename, share, or delete —{' '}
              <ButtonBase
                onClick={onOpenManager}
                className="underline"
                style={{
                  color: '#58a6ff',
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  font: 'inherit',
                }}
              >
                open manager
              </ButtonBase>
            </span>
          </div>
        </div>
      )}

      {/* Sticky footer — always visible regardless of active tab. Used to
          anchor the "+ Save current search as…" inline action so the user
          never has to switch tabs to save. */}
      {stickyFooter && (
        <div className="shrink-0" style={{ borderTop: '1px solid #2d333b' }}>
          {stickyFooter}
        </div>
      )}
    </div>
  );

  // Portal to document.body so the fixed-position panel escapes any ancestor
  // with a `transform` (notably the mobile filters sheet, which uses
  // `transform: translateY(...)` for drag-to-dismiss). A non-none transform
  // makes the element the containing block for `position: fixed` children,
  // which otherwise renders the panel relative to the sheet instead of the
  // viewport — effectively hiding it offscreen on mobile.
  return createPortal(panel, document.body);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function TabButton({
  active,
  onClick,
  children,
  borderRight,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  borderRight?: boolean;
}) {
  return (
    <ButtonBase
      onClick={onClick}
      className={cn(
        'flex-1 flex items-center justify-center gap-1.5 text-[12px] font-medium',
      )}
      style={{
        padding: '10px 14px',
        marginBottom: -1,
        color: active ? '#e1e4e8' : '#8b949e',
        borderBottom: active ? '2px solid #58a6ff' : '2px solid transparent',
        borderRight: borderRight ? '1px solid #2d333b' : undefined,
        background: 'transparent',
      }}
    >
      {children}
    </ButtonBase>
  );
}

function SavedSearchRowButton({
  checked,
  onClick,
  name,
  nameColor,
}: {
  checked: boolean;
  onClick: () => void;
  name: string;
  nameColor?: string;
}) {
  return (
    <ButtonBase
      onClick={onClick}
      className="w-full flex items-center gap-2.5 text-left"
      style={{ padding: '6px 0', background: 'transparent', border: 'none' }}
    >
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: '50%',
          border: `1.5px solid ${checked ? '#58a6ff' : '#444c56'}`,
          background: checked ? 'rgba(88,166,255,0.15)' : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {checked && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#58a6ff',
            }}
          />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="truncate"
          style={{ fontSize: 13, color: nameColor ?? '#e1e4e8', lineHeight: 1.2 }}
        >
          {name}
        </div>
      </div>
    </ButtonBase>
  );
}

function WishlistRow({
  checked,
  onClick,
  name,
  nameColor,
  count,
  sub,
}: {
  checked: boolean;
  onClick: () => void;
  name: string;
  nameColor?: string;
  count: number;
  sub?: React.ReactNode;
}) {
  return (
    <ButtonBase
      onClick={onClick}
      className="w-full flex items-center gap-2.5 text-left"
      style={{ padding: '6px 0', background: 'transparent', border: 'none' }}
    >
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: '50%',
          border: `1.5px solid ${checked ? '#7ee787' : '#444c56'}`,
          background: checked ? 'rgba(126,231,135,0.15)' : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {checked && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#7ee787',
            }}
          />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="truncate"
          style={{
            fontSize: 13,
            color: nameColor ?? '#e1e4e8',
            lineHeight: 1.2,
          }}
        >
          {name}
        </div>
        {sub && <div style={{ marginTop: 2 }}>{sub}</div>}
      </div>
      <span style={{ fontSize: 11, color: '#8b949e', flexShrink: 0 }}>{count}</span>
    </ButtonBase>
  );
}
