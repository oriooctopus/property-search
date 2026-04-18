'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PrimaryButton, TextButton } from '@/components/ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TourStep {
  /** data-tour attribute value to spotlight, or null for full-screen modal */
  target: string | null;
  title: string;
  body: string;
  /** If set, switch to this view before showing the step */
  switchView?: 'list' | 'swipe' | 'map';
}

interface TourGuideProps {
  onComplete: () => void;
  setMobileView: (view: 'list' | 'swipe' | 'map') => void;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

const STEPS: TourStep[] = [
  {
    target: null,
    title: 'Welcome to Dwelligence!',
    body: "Let's take a quick tour of the features that will help you find your next apartment.",
  },
  {
    target: 'view-modes',
    title: 'View Modes',
    body: 'Switch between Swipe and Map views. Swipe is great for quick decisions, and Map for exploring neighborhoods.',
  },
  {
    target: 'swipe-card',
    switchView: 'swipe',
    title: 'Swipe Mode',
    body: 'Swipe right to save a listing, left to skip, or down for later. You can also use arrow keys. Press Z to undo.',
  },
  {
    target: 'filters',
    title: 'Filters',
    body: 'Tap the Filters button to filter by price, bedrooms, commute time, and more. Your filters sync to the URL so you can share searches.',
  },
  {
    target: null,
    title: 'Wishlists',
    body: "Saved listings go to your Wishlists. Create multiple lists and share them with roommates. Access them from the menu in the top right.",
  },
  {
    target: null,
    title: "You're all set!",
    body: 'Happy apartment hunting. You can always explore the filters, try swipe mode, or ask the AI search assistant for help.',
  },
];

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

export default function TourGuide({ onComplete, setMobileView }: TourGuideProps) {
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [visible, setVisible] = useState(false); // for fade-in
  const rafRef = useRef<number>(0);
  const current = STEPS[step];

  // Track the target rect with rAF for smooth following
  const updateRect = useCallback(() => {
    if (current.target) {
      const r = getTargetRect(current.target);
      setTargetRect(r);
    } else {
      setTargetRect(null);
    }
    rafRef.current = requestAnimationFrame(updateRect);
  }, [current.target]);

  // When step changes, switch view if needed, then start tracking
  useEffect(() => {
    if (current.switchView) {
      setMobileView(current.switchView);
    }

    // Small delay to let the DOM settle after view switch
    const timer = setTimeout(() => {
      updateRect();
      setVisible(true);
    }, current.switchView ? 350 : 50);

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(rafRef.current);
    };
  }, [step, current.switchView, setMobileView, updateRect]);

  // Fade in on mount
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const goNext = useCallback(() => {
    if (step < STEPS.length - 1) {
      setVisible(false);
      setTimeout(() => {
        setStep((s) => s + 1);
      }, 200);
    } else {
      onComplete();
    }
  }, [step, onComplete]);

  const skip = useCallback(() => {
    onComplete();
  }, [onComplete]);

  const isModal = !current.target || !targetRect;
  const isLastStep = step === STEPS.length - 1;
  const isFirstStep = step === 0;

  // Overlay SVG with spotlight cutout
  const overlay = (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        transition: 'opacity 200ms ease',
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
            transition: 'all 300ms ease',
          }}
        />
      )}
    </div>
  );

  // Tooltip content
  const tooltip = (
    <div
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
            {step + 1} of {STEPS.length}
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
              {isFirstStep ? "Let's go" : isLastStep ? 'Start exploring' : 'Next'}
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
        {isModal && !isFirstStep && !isLastStep && (
          <div
            style={{
              color: '#8b949e',
              fontSize: 11,
              marginTop: 16,
              textAlign: 'center',
              fontWeight: 500,
            }}
          >
            {step + 1} of {STEPS.length}
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
