'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface MobileFiltersDrawerProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Bottom-sheet drawer used to host the main <Filters> UI on mobile when
 * in swipe view. Rendered via createPortal so it escapes the SwipeView
 * stacking context. Content is expected to be a rendered <Filters/> (or
 * other filter surface) piped in by the host with the same props the
 * desktop sidebar uses — that way there's one source of truth for filter
 * state (page.tsx).
 *
 * Behavior:
 * - Backdrop tap closes the drawer.
 * - X button closes the drawer.
 * - "Apply" button at the bottom closes (filters apply live; the Apply
 *   button is a confirmation + close).
 * - Drawer slides up from the bottom; covers ~90% of the viewport.
 * - Stays mounted after first open (we lazy-mount on first open) so
 *   reopening is instant — visibility is toggled via transform +
 *   display.
 * - Respects safe-area-inset-bottom for the Apply button.
 */
export default function MobileFiltersDrawer({
  open,
  onClose,
  children,
}: MobileFiltersDrawerProps) {
  // Lazy-mount: don't render the portal until the first time the drawer
  // opens. After that, keep it mounted to avoid re-running any heavy
  // filter mount logic on reopen.
  const [hasOpened, setHasOpened] = useState(false);
  useEffect(() => {
    if (open) setHasOpened(true);
  }, [open]);

  // Prevent background scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!hasOpened) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 min-[600px]:hidden"
      style={{
        zIndex: 1500,
        pointerEvents: open ? 'auto' : 'none',
      }}
      aria-hidden={!open}
      role="dialog"
      aria-modal="true"
      aria-label="Filters"
      data-testid="mobile-filters-drawer"
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="absolute inset-0"
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.55)',
          opacity: open ? 1 : 0,
          transition: 'opacity 200ms ease',
        }}
      />

      {/* Sheet */}
      <div
        className="absolute left-0 right-0 bottom-0 flex flex-col"
        style={{
          height: '88vh',
          maxHeight: '88vh',
          backgroundColor: 'rgba(22, 28, 36, 0.98)',
          borderTop: '1px solid #2d333b',
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          boxShadow: '0 -12px 32px rgba(0,0,0,0.5)',
          transform: open ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 260ms cubic-bezier(0.22, 0.61, 0.36, 1)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: grabber + title + close */}
        <div
          className="shrink-0 relative flex items-center justify-center px-4"
          style={{
            height: 52,
            borderBottom: '1px solid #2d333b',
          }}
        >
          {/* Grabber */}
          <div
            style={{
              position: 'absolute',
              top: 6,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 36,
              height: 4,
              borderRadius: 2,
              background: 'rgba(255,255,255,0.18)',
            }}
          />
          <h2
            style={{
              color: '#e1e4e8',
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: '-0.01em',
            }}
          >
            Filters
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="absolute right-3 cursor-pointer flex items-center justify-center rounded-full transition-colors"
            style={{
              top: '50%',
              transform: 'translateY(-50%)',
              width: 34,
              height: 34,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#c9d1d9',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Scrollable filter content */}
        <div
          className="flex-1 min-h-0 overflow-y-auto"
          style={{
            WebkitOverflowScrolling: 'touch',
            overscrollBehavior: 'contain',
          }}
        >
          {children}
        </div>

        {/* Apply bar */}
        <div
          className="shrink-0 flex items-center justify-end px-4"
          style={{
            paddingTop: 10,
            paddingBottom: 'calc(env(safe-area-inset-bottom) + 10px)',
            borderTop: '1px solid #2d333b',
            background: 'rgba(22, 28, 36, 0.98)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer flex items-center justify-center transition-colors"
            style={{
              height: 44,
              padding: '0 22px',
              borderRadius: 10,
              background: '#58a6ff',
              color: '#0d1117',
              fontSize: 14,
              fontWeight: 600,
              border: 'none',
              minWidth: 120,
            }}
            data-testid="mobile-filters-apply"
          >
            Apply
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
