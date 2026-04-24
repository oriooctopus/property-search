'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PrimaryButton, TextButton } from '@/components/ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewMode = 'list' | 'swipe' | 'map';

interface TourStep {
  /** Stable id (debug + dedupe) */
  id: string;
  /** data-tour attribute value to spotlight, or null for full-screen modal */
  target: string | null;
  title: string;
  body: string;
  /** If set, switch to this view before showing the step. */
  switchView?: ViewMode;
  /**
   * If set, this step is only relevant when the user is in this view. Steps
   * whose `requireView` doesn't match the current view (and that aren't
   * being switched into via `switchView`) are skipped — they fire later
   * when the user enters that view, or never if they don't.
   */
  requireView?: ViewMode;
  /**
   * If true, this step is only relevant on desktop viewports (≥600px).
   * Mobile-only steps live behind `requireMobile`.
   */
  requireDesktop?: boolean;
  /** Mobile-only (viewport < 600px) */
  requireMobile?: boolean;
}

interface TourGuideProps {
  onComplete: () => void;
  setMobileView: (view: ViewMode) => void;
  /** Current view mode — drives which steps are eligible to fire. */
  currentView: ViewMode;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
//
// Steps are filtered at runtime against the current view + viewport. When the
// user switches views mid-tour, the eligible set is recomputed and any steps
// that just became eligible (and weren't shown yet) appear next.
//
// Order matters within the eligible set. Universal steps come first (welcome),
// then view-specific steps (swipe-card / view-modes), then shared
// (filters, wishlists, end).
//
// On mobile, the user lands on swipe by default, so swipe steps surface near
// the start. On desktop the user lands on list, so list-only / view-modes
// steps surface near the start.

const STEPS: TourStep[] = [
  // ---- Swipe-mode-specific steps ----
  // Desktop swipe: includes "up for next photo" hint + arrow keys
  {
    id: 'swipe-card-desktop',
    target: 'swipe-card',
    requireView: 'swipe',
    requireDesktop: true,
    title: 'Swipe to decide',
    body: 'Swipe right to save, left to skip, up for the next photo. Arrow keys work too.',
  },
  // Mobile swipe: no "up = photos" mention (mobile doesn't have that)
  {
    id: 'swipe-card-mobile',
    target: 'swipe-card',
    requireView: 'swipe',
    requireMobile: true,
    title: 'Swipe to decide',
    body: 'Swipe right to save, left to skip.',
  },
  {
    id: 'swipe-action-pill',
    target: 'swipe-action-pill',
    requireView: 'swipe',
    requireMobile: true,
    title: 'Quick actions',
    body: 'Tap the heart to save, X to skip, or undo your last decision. The list / map icons on the edges switch views.',
  },
  {
    id: 'filters-mobile',
    target: 'filters-mobile',
    requireView: 'swipe',
    requireMobile: true,
    title: 'Filters',
    body: 'Tap Filters to narrow down by price, bedrooms, commute time, and more. Your filters sync to the URL so you can share searches.',
  },

  // ---- Desktop list/map view-mode toggle ----
  {
    id: 'view-modes',
    target: 'view-modes',
    requireDesktop: true,
    title: 'View Modes',
    body: 'Switch between List, Swipe, and Map. Swipe is great for quick decisions, Map for exploring neighborhoods.',
  },

  // ---- Desktop filters control ----
  {
    id: 'filters-desktop',
    target: 'filters',
    requireDesktop: true,
    title: 'Filters',
    body: 'Click the Filters button to filter by price, bedrooms, commute time, and more. Your filters sync to the URL so you can share searches.',
  },

  // ---- Universal closing steps ----
  {
    id: 'wishlists',
    target: null,
    title: 'Wishlists',
    body: "Saved listings go to your Wishlists. Create multiple lists and share them with roommates. Access them from the menu in the top right.",
  },
  {
    id: 'done',
    target: null,
    title: "You're all set!",
    body: 'Happy apartment hunting. You can always explore the filters, try swipe mode, or ask the AI search assistant for help.',
  },
];

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 600;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setIsMobile(window.innerWidth < 600);
    update();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      timeoutId = setTimeout(update, 150);
    };
    window.addEventListener('resize', onResize, { passive: true });
    return () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return isMobile;
}

function isStepEligible(
  step: TourStep,
  currentView: ViewMode,
  isMobile: boolean,
): boolean {
  // Effective view = the view we'd be in after applying switchView.
  const effectiveView = step.switchView ?? currentView;
  if (step.requireView && step.requireView !== effectiveView) return false;
  if (step.requireDesktop && isMobile) return false;
  if (step.requireMobile && !isMobile) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 10; // px around the spotlight target

function getTargetRect(target: string): Rect | null {
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // Reject zero-sized rects (element is in DOM but display:none)
  if (r.width === 0 && r.height === 0) return null;
  return {
    top: r.top - PADDING,
    left: r.left - PADDING,
    width: r.width + PADDING * 2,
    height: r.height + PADDING * 2,
  };
}

type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

function bestPosition(rect: Rect): TooltipPosition {
  const tooltipH = 200;
  const tooltipW = 320;
  const vp = { w: window.innerWidth, h: window.innerHeight };

  // Prefer bottom if there's room
  if (rect.top + rect.height + tooltipH + 16 < vp.h) return 'bottom';
  // Then top
  if (rect.top - tooltipH - 16 > 0) return 'top';
  // Then right
  if (rect.left + rect.width + tooltipW + 16 < vp.w) return 'right';
  // Fallback left
  return 'left';
}

function tooltipStyle(rect: Rect, pos: TooltipPosition): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'fixed',
    zIndex: 2002,
    maxWidth: 340,
    width: 'max-content',
  };

  switch (pos) {
    case 'bottom':
      return {
        ...base,
        top: rect.top + rect.height + 12,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - 352)),
      };
    case 'top':
      return {
        ...base,
        bottom: window.innerHeight - rect.top + 12,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - 352)),
      };
    case 'right':
      return {
        ...base,
        top: Math.max(12, rect.top),
        left: rect.left + rect.width + 12,
      };
    case 'left':
      return {
        ...base,
        top: Math.max(12, rect.top),
        right: window.innerWidth - rect.left + 12,
      };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TourGuide({ onComplete, setMobileView, currentView }: TourGuideProps) {
  const isMobile = useIsMobile();

  // Compute the eligible steps for the current view + viewport. We recompute
  // on every relevant change so that a view switch mid-tour reveals any
  // newly-eligible steps the user hasn't seen yet.
  const eligibleSteps = useMemo(
    () => STEPS.filter((s) => isStepEligible(s, currentView, isMobile)),
    [currentView, isMobile],
  );

  // Track which step ids the user has already seen, so we don't replay them
  // when a view-switch shifts the eligible set.
  const seenIdsRef = useRef<Set<string>>(new Set());

  const [activeId, setActiveId] = useState<string | null>(() => eligibleSteps[0]?.id ?? null);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [visible, setVisible] = useState(false); // for fade-in
  const rafRef = useRef<number>(0);

  // Find the current step within the (updated) eligible set. If the active
  // step is no longer eligible (e.g. user switched view mid-step), advance
  // to the next unseen eligible step.
  const current = useMemo(() => {
    if (activeId) {
      const found = eligibleSteps.find((s) => s.id === activeId);
      if (found) return found;
    }
    // Pick the first unseen eligible step.
    return eligibleSteps.find((s) => !seenIdsRef.current.has(s.id)) ?? null;
  }, [activeId, eligibleSteps]);

  // If the active step disappeared (view switch demoted it), keep activeId
  // pointing at whatever `current` resolved to so subsequent renders are
  // stable.
  useEffect(() => {
    if (current && current.id !== activeId) {
      setActiveId(current.id);
    }
  }, [current, activeId]);

  // Mark each step as seen the moment it becomes the active one.
  useEffect(() => {
    if (current) seenIdsRef.current.add(current.id);
  }, [current]);

  // Track the target rect with rAF for smooth following
  const updateRect = useCallback(() => {
    if (current?.target) {
      const r = getTargetRect(current.target);
      setTargetRect(r);
    } else {
      setTargetRect(null);
    }
    rafRef.current = requestAnimationFrame(updateRect);
  }, [current?.target]);

  // When step changes, switch view if needed, then start tracking
  useEffect(() => {
    if (!current) return;
    const needsViewSwitch =
      !!current.switchView && current.switchView !== currentView;
    if (needsViewSwitch && current.switchView) {
      setMobileView(current.switchView);
    }

    // No-view-switch transitions are instant: position the spotlight on the
    // same frame and fade the tooltip in immediately so clicking Next has no
    // perceptible pause. Only when we actually need a view switch do we
    // briefly wait for the DOM to settle.
    if (!needsViewSwitch) {
      updateRect();
      setVisible(true);
      return () => {
        cancelAnimationFrame(rafRef.current);
      };
    }

    const timer = setTimeout(() => {
      updateRect();
      setVisible(true);
    }, 350);

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(rafRef.current);
    };
  }, [current, currentView, setMobileView, updateRect]);

  // Fade in on mount
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const goNext = useCallback(() => {
    if (!current) {
      onComplete();
      return;
    }
    const idx = eligibleSteps.findIndex((s) => s.id === current.id);
    // Find the next eligible unseen step. We compare seen ids so a
    // mid-tour view switch can surface previously-deferred steps.
    let nextStep: TourStep | undefined;
    for (let i = idx + 1; i < eligibleSteps.length; i++) {
      if (!seenIdsRef.current.has(eligibleSteps[i].id)) {
        nextStep = eligibleSteps[i];
        break;
      }
    }
    // If nothing later in the eligible list is unseen, scan the entire
    // eligible list (defensive — covers cases where a view switch added a
    // step earlier in the order than the current one).
    if (!nextStep) {
      nextStep = eligibleSteps.find((s) => !seenIdsRef.current.has(s.id));
    }

    if (nextStep) {
      // Move to the next step synchronously so the spotlight repositions on
      // the same frame as the click. The fade-in opacity is reset to 0 first
      // so the new tooltip CSS-transitions back in.
      setVisible(false);
      setActiveId(nextStep.id);
    } else {
      onComplete();
    }
  }, [current, eligibleSteps, onComplete]);

  const skip = useCallback(() => {
    onComplete();
  }, [onComplete]);

  // No eligible steps at all (shouldn't happen — `welcome` is always
  // eligible) — bail rather than render an empty overlay.
  if (!current) return null;

  // Compute step counter using "seen + pending" instead of raw STEPS index,
  // because eligibility changes between mobile and desktop.
  const stepNumber = seenIdsRef.current.size; // 1-based via the +0 since add() runs in effect
  // The `seenIdsRef` is updated in an effect, so on the first render of a
  // step it may not yet include the current one. Floor to 1.
  const displayStepNumber = Math.max(1, stepNumber);
  const totalSteps = Math.max(
    eligibleSteps.length,
    seenIdsRef.current.size + (current ? 1 : 0),
  );

  const isModal = !current.target || !targetRect;
  const isLastEligible = (() => {
    const idx = eligibleSteps.findIndex((s) => s.id === current.id);
    if (idx === -1) return false;
    for (let i = idx + 1; i < eligibleSteps.length; i++) {
      if (!seenIdsRef.current.has(eligibleSteps[i].id)) return false;
    }
    // Also check earlier indices for any unseen step (view switch may have
    // added one before current).
    for (let i = 0; i < idx; i++) {
      if (!seenIdsRef.current.has(eligibleSteps[i].id)) return false;
    }
    return true;
  })();
  const isFirstStep = displayStepNumber === 1;

  // Overlay SVG with spotlight cutout
  const overlay = (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        transition: 'opacity 120ms ease',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <svg
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0 }}
      >
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={targetRect.left}
                y={targetRect.top}
                width={targetRect.width}
                height={targetRect.height}
                rx={10}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.75)"
          mask="url(#tour-mask)"
        />
      </svg>

      {/* Spotlight border ring */}
      {targetRect && (
        <div
          style={{
            position: 'fixed',
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
            borderRadius: 10,
            border: '2px solid rgba(88, 166, 255, 0.5)',
            boxShadow: '0 0 20px rgba(88, 166, 255, 0.15)',
            pointerEvents: 'none',
            zIndex: 2001,
            transition: 'all 150ms ease',
          }}
        />
      )}
    </div>
  );

  // Tooltip content
  const tooltip = (
    <div
      data-tour-tooltip
      data-tour-step-id={current.id}
      style={
        isModal
          ? {
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 2002,
              maxWidth: 400,
              width: '90%',
            }
          : tooltipStyle(targetRect!, bestPosition(targetRect!))
      }
    >
      <div
        style={{
          backgroundColor: '#1c2028',
          border: '1px solid #2d333b',
          borderRadius: 12,
          padding: isModal ? '32px 28px' : '20px 20px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
        }}
      >
        {/* Step counter */}
        {!isModal && (
          <div
            style={{
              color: '#8b949e',
              fontSize: 11,
              marginBottom: 8,
              fontWeight: 500,
            }}
          >
            {displayStepNumber} of {totalSteps}
          </div>
        )}

        <h3
          style={{
            color: '#e1e4e8',
            fontSize: isModal ? 22 : 16,
            fontWeight: 600,
            margin: 0,
            marginBottom: 8,
            textAlign: isModal ? 'center' : 'left',
          }}
        >
          {current.title}
        </h3>

        <p
          style={{
            color: '#8b949e',
            fontSize: 14,
            lineHeight: 1.5,
            margin: 0,
            marginBottom: 20,
            textAlign: isModal ? 'center' : 'left',
          }}
        >
          {current.body}
        </p>

        {/* Buttons */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: isModal ? 'center' : 'space-between',
            gap: 12,
          }}
        >
          {isModal ? (
            // Full-screen modals: single centered button
            <PrimaryButton onClick={goNext} variant="accent">
              {isFirstStep ? "Let's go" : isLastEligible ? 'Start exploring' : 'Next'}
            </PrimaryButton>
          ) : (
            // Targeted steps: Skip + Next
            <>
              <TextButton variant="muted" onClick={skip} className="text-xs">
                Skip tour
              </TextButton>
              <PrimaryButton onClick={goNext} variant="accent" className="text-sm px-5">
                Next
              </PrimaryButton>
            </>
          )}
        </div>

        {/* Step counter for modals */}
        {isModal && !isFirstStep && !isLastEligible && (
          <div
            style={{
              color: '#8b949e',
              fontSize: 11,
              marginTop: 16,
              textAlign: 'center',
              fontWeight: 500,
            }}
          >
            {displayStepNumber} of {totalSteps}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(
    <>
      {overlay}
      {tooltip}
    </>,
    document.body,
  );
}
