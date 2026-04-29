# Mobile swipe — canonical test scenarios

When working on `SwipeCard.tsx` / `SwipeView.tsx` / `SwipeOnboarding.tsx`,
exercise EVERY scenario in this list before declaring a fix done. Past
verification runs missed real bugs because the scenario list was incomplete.

The Playwright spec at `web/tests/swipe-scenarios.spec.ts` automates as many of
these as touch emulation can reliably exercise (some need a real finger and are
flagged below as "real-device only").

## Gesture primitives

For each scenario, run BOTH a fast flick (~1500 px/s, ~150ms) and a slow drag
(~300 px/s, ~750ms). Each scenario gets 10 iterations; pass criterion is 10/10
unless noted.

Viewport: iPhone 13 (390×844), `hasTouch: true`, `isMobile: true`. Anonymous
user — never log in with `oliverullman@gmail.com`.

## Scenarios

### Card translation
1. **Horizontal flick from card center → commits left/right swipe.** Card
   animates off-screen, next card appears.
2. **Slow horizontal drag past threshold → commits.** Same as #1 but slow.
3. **Slow horizontal drag UNDER threshold → snaps back.** Card returns to
   origin without committing.
4. **Vertical down-flick from the info panel area → commits down (back of
   queue).** Card slides down, next card appears.
5. **Vertical down-drag UNDER threshold → snaps back.**
6. **Diagonal drag (250px right + 80px down) → axis locks horizontal,
   commits as right swipe.** No vertical component should leak into the
   final transform. (Currently flaky in Playwright; real-device only.)

### Photo area gestures (the prior 5-item list missed this)
7. **Horizontal flick STARTING ON THE PHOTO → commits card swipe**, NOT
   carousel navigation. (Was broken until the 2026-04-29 holistic-fix-2
   commit which removed the photoCarouselGesture short-circuit.)
8. **Tap on left third of photo → carousel previous photo.**
9. **Tap on right third of photo → carousel next photo.**
10. **Tap on photo arrow buttons (visible 32×32 chevron in 52px-wide column)
    → carousel nav.** Tap registers anywhere in the column vertically.
11. **Tap on top-right open-listing icon → opens external link, no carousel
    nav.** Right column starts at top:48px to leave the corner clear.
12. **Vertical drag starting on photo → snaps back (no commit).** The photo
    isn't the right surface for a back-of-queue gesture; users who want
    dismiss should use the grabber strip.

### Inner panel scroll + swipe interaction (the prior list missed this too)
13. **Scroll the info panel down (e.g. drag up on listing details) → panel
    scrolls, card does not translate.** Native browser scroll via
    touch-action: pan-y.
14. **AFTER scrolling, horizontal flick on the panel → commits card swipe.**
    (Was broken until the 2026-04-29 fix that changed
    scrollingContent.current from "kill all gestures" to "only kill vertical
    when scrolled".)
15. **AFTER scrolling, vertical drag → continues scrolling the panel** (does
    NOT commit a back-of-queue).

### Onboarding overlay (first-time mobile users)
16. **Onboarding modal appears** when localStorage `dwelligence_swipe_onboarded`
    is unset, on mobile only.
17. **Tap X / Got it / Start swiping button → modal dismisses** and flag is
    set in localStorage.
18. **Tap an action-bar button (skip/like/up/down) without dismissing the
    modal → swipe fires AND modal dismisses** (handleSwipe also calls
    dismissOnboarding).
19. **Swipe the card with the modal showing → swipe fires AND modal
    dismisses** (backdrop is pointer-events: none, so gesture flows to
    card; first-drag dismisses).

### Edge cases
20. **Pointercancel mid-drag (palm rejection sim) → snap back, no commit**
    even if movement crossed threshold.
21. **Photo carousel arrow tap area extends full height of photo column.**
    Tap at top of left column → previous. Tap at bottom of right column →
    next (except top-right corner = open listing).
22. **Pull-down tray gesture from grabber strip** still works; not
    affected by photo-area gestures or panel scroll state.
23. **Card preload:** swipe off the top card → no blank flash for >100ms
    before next card's photo renders. (Preload effect runs `new Image()`
    for next two listings' first photos on currentIndex change.)

### Onboarding tastemaker pass
24. **Onboarding copy:** header reads "Swipe to find your place"
    (lowercase), labels are Pass / Save / Would live here / Later, CTA is
    "Start swiping", microhint reads "or just swipe — we'll get out of your
    way".

## Definition of done for any swipe-related PR

- [ ] All 24 scenarios above run in the Playwright spec and pass 10/10
      (except those flagged real-device only).
- [ ] tsc clean, next lint clean.
- [ ] HTML report at `~/Documents/coding/screenshots/property-search/<task>/index.html`
      with per-scenario pass count + at least one screenshot.
- [ ] Code-skeptic review on the diff (see prior runs in
      `~/Documents/coding/screenshots/property-search/mobile-jank-impl/skeptic-review.html`)
      addresses every Critical and Warning finding before merge.
- [ ] Vercel deploy READY before declaring task done.
