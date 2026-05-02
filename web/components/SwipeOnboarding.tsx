'use client';

import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// SwipeOnboarding — Option A: animated demo card.
//
// First-time onboarding for the swipe view. Instead of a modal with a list
// of "← Pass / → Save / ↑ Top match", we render a FAKE listing card on top
// of the real one and animate it through each swipe direction on loop. The
// card itself is the lesson — no modal chrome, no prose, no "Got it" button.
//
// Dismissal: any pointer/touch interaction anywhere on the document, OR
// the parent calls onDismiss after first real card gesture. The fake card
// fades out and the real top card is revealed.
//
// pointer-events: none on the wrapper so taps/swipes pass through to the
// real card, exactly like the previous version.
// ---------------------------------------------------------------------------

interface SwipeOnboardingProps {
  onDismiss?: () => void;
}

type StepAction =
  | 'idle'
  | 'swipe-right'
  | 'swipe-left'
  | 'swipe-up'
  | 'return';

interface Step {
  action: StepAction;
  label?: string;
  labelColor?: string;
  duration: number;
}

// Loop sequence. Mirrors mockup-tour-guide-redesign-a.html.
const STEPS: Step[] = [
  { action: 'idle', duration: 800 },
  { action: 'swipe-right', label: '→ Save · Add to wishlist', labelColor: '#58a6ff', duration: 700 },
  { action: 'return', duration: 450 },
  { action: 'idle', duration: 500 },
  { action: 'swipe-left', label: '← Pass · Not for me', labelColor: '#8b949e', duration: 700 },
  { action: 'return', duration: 450 },
  { action: 'idle', duration: 500 },
  { action: 'swipe-up', label: '↑ Would live here · Top pick', labelColor: '#7ee787', duration: 700 },
  { action: 'return', duration: 450 },
  { action: 'idle', duration: 1000 },
];

function transformFor(action: StepAction): string {
  switch (action) {
    case 'swipe-right':
      return 'translateX(100px) rotate(12deg)';
    case 'swipe-left':
      return 'translateX(-100px) rotate(-12deg)';
    case 'swipe-up':
      return 'translateY(-80px) scale(0.96)';
    case 'return':
    case 'idle':
    default:
      return 'translateX(0) translateY(0) rotate(0deg) scale(1)';
  }
}

export default function SwipeOnboarding({ onDismiss }: SwipeOnboardingProps) {
  const [stepIdx, setStepIdx] = useState(0);
  const [fadingOut, setFadingOut] = useState(false);
  const timerRef = useRef<number | null>(null);

  // Drive the animation loop via setTimeout chained on the current step's duration
  useEffect(() => {
    if (fadingOut) return;
    const step = STEPS[stepIdx % STEPS.length];
    timerRef.current = window.setTimeout(() => {
      setStepIdx((i) => (i + 1) % STEPS.length);
    }, step.duration);
    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [stepIdx, fadingOut]);

  // First user interaction anywhere triggers fade-out → onDismiss
  useEffect(() => {
    const handler = () => {
      if (fadingOut) return;
      setFadingOut(true);
      window.setTimeout(() => {
        onDismiss?.();
      }, 250);
    };
    // Capture-phase passive listeners so they fire regardless of where the
    // user taps. We don't preventDefault — the underlying real card should
    // receive the gesture normally.
    document.addEventListener('pointerdown', handler, { capture: true, passive: true, once: true });
    document.addEventListener('touchstart', handler, { capture: true, passive: true, once: true });
    return () => {
      document.removeEventListener('pointerdown', handler, { capture: true } as EventListenerOptions);
      document.removeEventListener('touchstart', handler, { capture: true } as EventListenerOptions);
    };
  }, [fadingOut, onDismiss]);

  const step = STEPS[stepIdx % STEPS.length];
  const cardTransform = transformFor(step.action);
  const cardTransition =
    step.action === 'return'
      ? 'transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)'
      : 'transform 0.5s cubic-bezier(0.34, 1.1, 0.64, 1)';

  // Stamps fade in on the matching swipe action and out on return/idle
  const showSave = step.action === 'swipe-right';
  const showPass = step.action === 'swipe-left';
  const showTop = step.action === 'swipe-up';

  return (
    <div
      className="absolute inset-0"
      style={{
        zIndex: 1300,
        pointerEvents: 'none',
        opacity: fadingOut ? 0 : 1,
        transition: 'opacity 250ms ease-out',
      }}
    >
      {/* Opaque mask — covers the real card stack behind so when the fake
          card translates, what's exposed is THIS solid surface, not the
          real listing peeking through. Earlier 45% opacity left the real
          card visible whenever the fake card moved off-center, which read
          as "screen glitching." Solid panel-bg matches the SwipeView
          container so it blends seamlessly. */}
      <div
        className="absolute inset-0 rounded-3xl min-[600px]:rounded-xl"
        style={{
          backgroundColor: '#0d1117',
        }}
      />
      {/* Fake card overlay — opaque so it actually reads as a card, not a
          glitching real card. Uses the same rounded corners + dark panel bg
          as the real SwipeCard so the visual grammar matches. */}
      <div
        className="absolute inset-0 rounded-3xl min-[600px]:rounded-xl overflow-hidden"
        style={{
          backgroundColor: '#1c2028',
          border: '1px solid #2d333b',
          transform: cardTransform,
          transition: cardTransition,
          willChange: 'transform',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}
      >
        {/* Placeholder photo region — tinted gradient so it reads as a card,
            not an empty box. Approximates the real card's photo area
            position. */}
        <div
          className="absolute top-0 left-0 right-0"
          style={{
            height: '52%',
            background:
              'linear-gradient(135deg, #2d333b 0%, #1f2329 50%, #161b22 100%)',
          }}
        >
          {/* Soft house glyph centered in the photo area */}
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ color: '#3d444d', opacity: 0.7 }}
          >
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9.5L12 3l9 6.5V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <path d="M9 22V12h6v10" />
            </svg>
          </div>
        </div>
        {/* Placeholder info area below "photo" — fake address + price lines */}
        <div className="absolute bottom-0 left-0 right-0 px-5 py-4" style={{ height: '48%' }}>
          <div className="space-y-2">
            <div className="rounded h-3 w-3/5" style={{ backgroundColor: '#2d333b' }} />
            <div className="rounded h-3 w-2/5" style={{ backgroundColor: '#21262d' }} />
            <div className="rounded h-5 w-1/3 mt-3" style={{ backgroundColor: '#2d333b' }} />
            <div className="rounded h-3 w-1/4 mt-3" style={{ backgroundColor: '#21262d' }} />
          </div>
        </div>
        {/* Stamps that fade in/out matching the gesture */}
        <div
          className="absolute top-6 left-5 z-[5]"
          style={{
            opacity: showSave ? 1 : 0,
            transform: 'rotate(12deg)',
            transition: 'opacity 200ms',
          }}
        >
          <div
            className="px-3 py-1.5 text-2xl font-black uppercase tracking-widest"
            style={{ color: '#58a6ff', border: '3px solid #58a6ff', borderRadius: 6 }}
          >
            SAVE
          </div>
        </div>
        <div
          className="absolute top-6 right-5 z-[5]"
          style={{
            opacity: showPass ? 1 : 0,
            transform: 'rotate(-12deg)',
            transition: 'opacity 200ms',
          }}
        >
          <div
            className="px-3 py-1.5 text-2xl font-black uppercase tracking-widest"
            style={{ color: '#8b949e', border: '3px solid #8b949e', borderRadius: 6 }}
          >
            PASS
          </div>
        </div>
        <div
          className="absolute top-6 left-1/2 -translate-x-1/2 z-[5] whitespace-nowrap"
          style={{
            opacity: showTop ? 1 : 0,
            transition: 'opacity 200ms',
          }}
        >
          <div
            className="px-3 py-1.5 text-base font-black uppercase tracking-widest"
            style={{ color: '#7ee787', border: '3px solid #7ee787', borderRadius: 6 }}
          >
            TOP PICK
          </div>
        </div>
      </div>

      {/* Caption pill — sits ABOVE the card with its own backdrop so it
          never collides with anything underneath. Updates with the
          current gesture (label + label color from STEPS). */}
      <div
        className="absolute left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap"
        style={{
          top: 16,
          backgroundColor: 'rgba(15, 17, 23, 0.92)',
          border: '1px solid #2d333b',
          color: step.label ? (step.labelColor ?? '#e1e4e8') : '#e1e4e8',
          transition: 'color 200ms',
        }}
      >
        {step.label ?? 'Swipe to find your place'}
      </div>

      {/* Tiny "tap to dismiss" microhint below the caption pill */}
      <div
        className="absolute left-1/2 -translate-x-1/2 text-[10px]"
        style={{ top: 50, color: '#8b949e' }}
      >
        tap or swipe to start
      </div>
    </div>
  );
}
