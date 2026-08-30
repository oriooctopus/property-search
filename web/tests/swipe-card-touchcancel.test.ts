/**
 * @vitest-environment jsdom
 *
 * Regression test for the "collapse the card, reopen it, double render"
 * bug reported on a real iPhone (components/SwipeCard.tsx +
 * components/SwipeView.tsx).
 *
 * Root cause: react-swipeable (node_modules/react-swipeable/src/index.ts)
 * only listens for touchstart/touchmove/touchend — it has no touchcancel
 * handler. A downward drag that ends near OS chrome (e.g. the iOS home
 * indicator) is exactly where the browser steals the gesture and fires
 * touchcancel instead of touchend, so react-swipeable's `onSwiped` never
 * runs. SwipeCard's `notifiedDragging` ref then never flips back to false,
 * so `onDragStateChange(false)` is never called — the `isDragging` flag in
 * SwipeView (which gates the top card's background/overflow: transparent +
 * visible while "dragging", so the user can peek at the card behind) stays
 * stuck true forever. The next card is always mounted underneath (comment
 * above it in SwipeView.tsx explains why — avoids fade-in lag), normally
 * hidden by the top card's opaque idle background; with that background
 * stuck transparent, the next card bleeds through as ghosted, overlapping
 * text — exactly the user's screenshot (two addresses/prices superimposed).
 *
 * The fix (SwipeCard.tsx, `forceEndDrag` + a window-level touchcancel/
 * pointercancel/visibilitychange effect) runs the same release cleanup
 * react-swipeable's `onSwiped` would have run, whenever those events fire.
 *
 * Proof this test bites: temporarily removing the touchcancel/pointercancel
 * effect (reverting to only react-swipeable's own touchend-only tracking)
 * makes this test fail — `onDragStateChange` is called with `true` and
 * never with `false` after the cancel. See the implementer report for the
 * actual before/after output.
 *
 * Run with: npx vitest run tests/swipe-card-touchcancel.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement } from 'react';

// react-dom's `act()` warns unless this flag is set — there's no test-runner
// integration (no @testing-library/react) doing it for us here.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Minimal fake TouchEvent — jsdom doesn't implement the real Touch/
// TouchEvent classes, and react-swipeable only reads `event.touches[0]`
// (.clientX/.clientY) and `event.timeStamp`, both of which a plain object
// on a real Event provides fine.
function dispatchTouch(
  target: HTMLElement | Window,
  type: 'touchstart' | 'touchmove' | 'touchcancel',
  x: number,
  y: number,
) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    touches: Array<{ clientX: number; clientY: number }>;
  };
  event.touches = [{ clientX: x, clientY: y }];
  target.dispatchEvent(event);
}

describe('SwipeCard survives a touchcancel mid-drag (no touchend delivered)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('calls onDragStateChange(false) after a touchcancel interrupts an in-progress drag', async () => {
    const { default: SwipeCard } = await import('@/components/SwipeCard');

    const listing = {
      id: 1,
      address: '87 Seagrave Street #24',
      area: 'Bushwick',
      price: 3350,
      beds: 1,
      baths: 1,
      sqft: null,
      photo_urls: [] as string[], // avoid next/image entirely
      source: 'craigslist',
      url: 'https://example.com/1',
    };

    const dragStates: boolean[] = [];

    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(SwipeCard, {
          listing,
          onSwipe: () => {},
          onExpandDetail: () => {},
          isTop: true,
          onDragStateChange: (dragging: boolean) => dragStates.push(dragging),
        }),
      );
    });

    // The gesture root is SwipeCard's single top-level element (has
    // touchAction:none and the react-swipeable handlers spread onto it —
    // see `{...gestureBindings}` at components/SwipeCard.tsx:600).
    const gestureRoot = container.firstElementChild as HTMLElement;
    expect(gestureRoot).not.toBeNull();

    await act(async () => {
      // Start a downward drag (the "collapse" motion) — mirrors dragging
      // the card down past react-swipeable's 5px delta.
      dispatchTouch(gestureRoot, 'touchstart', 100, 100);
      dispatchTouch(gestureRoot, 'touchmove', 100, 170); // deltaY = 70
    });

    // Card must be reporting itself as actively dragging — this is the
    // state SwipeView reads to make the top card transparent + overflow
    // visible so the user can peek at the card behind.
    expect(dragStates).toEqual([true]);

    await act(async () => {
      // Real iOS fires touchcancel here instead of touchend when it steals
      // the gesture near the home indicator. react-swipeable never sees
      // this event type at all.
      dispatchTouch(window, 'touchcancel', 100, 170);
    });

    // The fix's window-level touchcancel listener must still flip the flag
    // back — without it, `dragStates` stays `[true]` forever and the top
    // card in SwipeView is left permanently transparent, letting the
    // always-mounted next card bleed through.
    expect(dragStates).toEqual([true, false]);
  });
});
