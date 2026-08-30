/**
 * @vitest-environment jsdom
 *
 * Regression test for the mobile "compact subway row" (`data-testid=
 * "compact-subway-row"`, components/SwipeCard.tsx `CompactSubwayRow`)
 * gaining a station-name span.
 *
 * Before this change the row rendered only a LineBadge + "N min" (e.g.
 * "[L] 6 min"), which is ambiguous whenever the two closest lines both pass
 * through nearby-but-different stations — the user has no way to tell which
 * physical station the time is measured to. The fix appends the station
 * name inline: "[L] 6 min · Graham Av".
 *
 * SwipeCard renders this row from TWO separate call sites — the `layoutOnly`
 * probe branch (used to measure card height before the real motion.div
 * mounts) and the main branch (the actual swipeable card) — both gated on
 * the same `compactMobile` prop but reached through different `layoutOnly`
 * values. They used to be duplicated JSX; a prior version of this test only
 * rendered `layoutOnly: false` (the default), so deleting the station-name
 * span from ONLY the `layoutOnly: true` branch left the suite green despite
 * a since-corrected comment here claiming both paths were covered. Both
 * paths now render the same `CompactSubwayRow` component, but this test
 * still renders BOTH `layoutOnly` values explicitly — a future call site
 * passing a wrong/stale prop (e.g. an empty `lines` array) at only one of
 * the two sites would otherwise go undetected.
 *
 * Uses a real fixture coordinate (Graham Av station, L11 in
 * lib/isochrone/subway-stations.ts, lat 40.714565 / lon -73.944053) so
 * `getClosestDistinctLines` returns real, deterministic station data — no
 * mocking of the subway dataset.
 *
 * Proof this test bites: temporarily removing the station-name `<span>`
 * from `CompactSubwayRow` in SwipeCard.tsx makes both cases below fail with
 * "Graham Av" absent from the row's text content. Proof the two cases are
 * independent: removing the span from only the `layoutOnly` call site (by
 * reintroducing per-branch duplication) fails only the `layoutOnly: true`
 * case, and vice versa. See the implementer report for the actual
 * before/after command output.
 *
 * Run with: npx vitest run tests/swipe-card-compact-subway-name.test.ts
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement } from 'react';

// react-dom's `act()` warns unless this flag is set — there's no test-runner
// integration (no @testing-library/react) doing it for us here. Same pattern
// as tests/swipe-card-touchcancel.test.ts.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Coordinates sit right on Graham Av (L) so the row's closest line is
// deterministic and the expected station name is known ahead of time.
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
  lat: 40.714565,
  lon: -73.944053,
};

describe('SwipeCard mobile compact-subway-row shows the station name', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  // Renders SwipeCard with the given `layoutOnly` value and returns the
  // compact-subway-row element's text content.
  async function renderCompactRowText(layoutOnly: boolean): Promise<string> {
    const { default: SwipeCard } = await import('@/components/SwipeCard');

    container = document.createElement('div');
    document.body.appendChild(container);

    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(SwipeCard, {
          listing,
          onSwipe: () => {},
          onExpandDetail: () => {},
          isTop: true,
          compactMobile: true,
          layoutOnly,
          onDragStateChange: () => {},
        }),
      );
    });

    const row = container.querySelector('[data-testid="compact-subway-row"]');
    expect(row).not.toBeNull();
    return row!.textContent ?? '';
  }

  it('renders the station name alongside the line badge and minutes (main branch)', async () => {
    const text = await renderCompactRowText(false);
    // Must show the minutes (existing behavior) AND the station name
    // (the new behavior under test) — asserting just "the row exists" or
    // just "min" is present would still pass on the old, name-less row.
    expect(text).toMatch(/\d+\s*min/);
    expect(text).toContain('Graham Av');
  });

  it('renders the station name alongside the line badge and minutes (layoutOnly branch)', async () => {
    const text = await renderCompactRowText(true);
    expect(text).toMatch(/\d+\s*min/);
    expect(text).toContain('Graham Av');
  });
});

/**
 * Regression test for the mobile photo block (`data-testid=
 * "swipe-card-photo-block"`) shrinking on short viewports instead of
 * pushing `CompactSubwayRow` out the bottom of the card.
 *
 * Shipped in commit e77bdc0 the mobile subway stations went from one-per-
 * line to side-by-side (+~18px) and the photo grew 179px -> 184px (+5px),
 * ~23px more content than the 667px-tall viewport (iPhone SE/8-class) had
 * room for — enough to push the whole compact-subway-row below the card's
 * clip boundary. Measured on production, and reproduced locally with a
 * corrected Playwright script (see the implementer report for why the
 * first pass at that script gave misleading numbers — it grabbed the
 * always-mounted invisible ghost card's row instead of the visible top
 * card's): the row's bottom edge sat 35.45-63.45px below the card,
 * invisible with no scroll affordance.
 *
 * Fix: `MOBILE_PHOTO_HEIGHT_CLASS` (components/SwipeCard.tsx) makes the
 * photo on mobile widths a genuinely flex-shrinkable item — `h-[184px]`
 * preferred (used as flex-basis), `min-h-[90px]` floor, default
 * flex-shrink:1 (no `flex-shrink-0`) — inside `panelRef`, which is now a
 * `flex flex-col` container whose OTHER child (the text-content block) is
 * pinned `flex-shrink-0` so all the squeeze lands on the photo. This
 * replaced an earlier version that computed the height via `clamp()` on
 * viewport-height alone — reverted because it couldn't adapt to the ~28px
 * content difference between StreetEasy- and Craigslist-format cards (one
 * measured a 3.55px margin, uncomfortably close to reintroducing the bug),
 * and because `dvh` tracks Safari's collapsing address bar, which would
 * have resized the photo mid-scroll on a real phone. The flex version lets
 * the browser do the per-listing arithmetic instead of a fitted formula.
 *
 * jsdom does NOT run a real layout/CSS engine — `getBoundingClientRect()`
 * always returns zeros here, so the actual clipping behavior (does the row
 * end up inside or outside the card at a given viewport height, does the
 * photo actually shrink) can only be observed in a real browser. That was
 * verified with headless Playwright at 375x667 / 320x568 / 390x844 /
 * desktop widths — see the implementer report for the exact before/after
 * pixel measurements, INCLUDING a real, measured limitation: at 390x844 the
 * photo does NOT always stay pixel-identical to 184px, because a small
 * pre-existing content overflow below the fold (previously invisible,
 * absorbed by `panelRef`'s own scroll) now gets absorbed by the photo
 * instead. Card height itself is unaffected there. What jsdom CAN check,
 * and what these two tests cover, is the markup-level contract the
 * Playwright numbers depend on:
 *   1. the mobile height class is actually shrinkable (no forced
 *      `flex-shrink-0`, has the `min-h-[90px]` floor) — i.e. this fix
 *      hasn't been silently reverted to a rigid static height, and
 *   2. the two SwipeCard call sites that each render this div (the
 *      `layoutOnly` ghost used only to size the deck, and the real card)
 *      use the IDENTICAL height/shrink classes — see the `CompactSubwayRow`
 *      comment above and its own regression test for why this file treats
 *      that divergence as a recurring, previously-real bug class (a verify
 *      pass caught the two sites silently drifting apart once already).
 *
 * Proof this test bites (see implementer report for actual output):
 *   - Reverting `MOBILE_PHOTO_HEIGHT_CLASS` to the old
 *     `'h-[184px] min-[600px]:h-[226px]'` (implicitly relying on the
 *     call sites' own unconditional `flex-shrink-0`) fails the "is
 *     shrinkable" assertion (no `min-h-[` floor present).
 *   - Hardcoding the `layoutOnly` call site back to that same old literal
 *     string while leaving the real call site on `MOBILE_PHOTO_HEIGHT_CLASS`
 *     fails the "both call sites match" assertion.
 */
describe('SwipeCard mobile photo block shrinks on short viewports (both call sites)', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  async function renderPhotoBlockClassName(layoutOnly: boolean): Promise<string> {
    const { default: SwipeCard } = await import('@/components/SwipeCard');

    // Unmount any root left mounted by a PREVIOUS call within the same test
    // (the "matches exactly" test below calls this twice, sequentially, to
    // compare both branches). Without this, two sequential renders leak the
    // first root/DOM node — harmless for the assertion itself since each
    // call re-queries its own freshly-created `container`, but it leaves
    // stray mounted React trees in `document.body` across renders.
    if (root) {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }

    container = document.createElement('div');
    document.body.appendChild(container);

    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(SwipeCard, {
          listing,
          onSwipe: () => {},
          onExpandDetail: () => {},
          isTop: true,
          compactMobile: true,
          layoutOnly,
          onDragStateChange: () => {},
        }),
      );
    });

    const block = container.querySelector('[data-testid="swipe-card-photo-block"]');
    expect(block).not.toBeNull();
    return block!.className;
  }

  it('main branch: mobile is genuinely shrinkable (no forced flex-shrink-0, has a floor); desktop untouched', async () => {
    const className = await renderPhotoBlockClassName(false);
    const tokens = className.split(/\s+/);

    // The photo's preferred mobile size is still 184px (used as flex-basis)...
    expect(tokens).toContain('h-[184px]');
    // ...but with an explicit floor it can shrink down to instead of being
    // pinned there. Presence of this floor is the load-bearing signal that
    // shrinking is actually possible — a `min-h-[90px]` with no shrink
    // capability would be a dead class.
    expect(tokens).toContain('min-h-[90px]');
    // Mobile widths must NOT carry an unconditional flex-shrink-0 — that
    // would zero out the default flex-shrink:1 and silently restore the old
    // rigid-height bug. (The outer template string's own always-on
    // flex-shrink-0 was removed for exactly this reason — see the two
    // SwipeCard call sites.)
    expect(tokens).not.toContain('flex-shrink-0');
    // Desktop (>=600px width) must be forced back to fixed/non-shrinking —
    // a hard rule, not just "desktop happens to have enough room".
    expect(tokens).toContain('min-[600px]:h-[226px]');
    expect(tokens).toContain('min-[600px]:flex-shrink-0');
  });

  it('layoutOnly ghost branch: same height/shrink classes, matches the main branch exactly', async () => {
    // Sequential, NOT Promise.all — both renders reuse the describe-level
    // `container`/`root` variables (see renderPhotoBlockClassName), so
    // running them concurrently races: the second call's `container =
    // document.createElement(...)` reassignment can happen before the first
    // call reads `container.querySelector(...)`, making both reads resolve
    // against the SAME (second) container and passing regardless of whether
    // the two branches actually match. Caught by mutation-testing this
    // exact test — see the implementer report.
    const mainClassName = await renderPhotoBlockClassName(false);
    const layoutOnlyClassName = await renderPhotoBlockClassName(true);

    // The two divs intentionally differ in their non-height classes (the
    // real card's div is `photoAreaRef` and needs `relative overflow-hidden`
    // for the carousel/tap-zone logic; the ghost placeholder doesn't) — so
    // comparing the FULL className would fail even on correct code. Extract
    // just the height/shrink utility classes that come from
    // `MOBILE_PHOTO_HEIGHT_CLASS` (height, min-height floor, and the
    // desktop-only flex-shrink-0 override) and compare those in isolation.
    const heightClasses = (cls: string) =>
      cls
        .split(/\s+/)
        .filter((c) => c.startsWith('h-[') || c.startsWith('min-h-[') || c.startsWith('min-[600px]:'));

    // The ghost card establishes the deck's height; the real card renders
    // into it. If the two ever disagree on this class, the deck sizes
    // itself for one photo height while the real card renders another —
    // exactly the class of bug CompactSubwayRow's own extraction above
    // fixed for the subway row markup.
    expect(heightClasses(layoutOnlyClassName)).toEqual(heightClasses(mainClassName));
  });
});

/**
 * Regression test for the must-fit/trailing split (components/SwipeCard.tsx,
 * data-testid `swipe-card-must-fit-wrapper` / `swipe-card-footer`).
 *
 * The flex-shrink fix above (photo shrinks under height pressure) initially
 * made the whole detail-content block — including the trailing "View on
 * <source> →" footer link, which sits BELOW the compact subway row and is
 * fine to reach only by scrolling — flex-shrink-0 as ONE unit. That meant
 * the footer's own natural height counted toward how much the photo had to
 * shrink: measured at 390x844, a viewport with plenty of room (production
 * reference: "everything fits" there), the photo still shrank to 172px
 * (StreetEasy) / 144px (Craigslist) instead of staying 184px, because a
 * small PRE-EXISTING footer-only overflow (harmlessly absorbed by scroll in
 * shipped code, per the implementer report) got miscounted as "the photo
 * needs to make room for this too."
 *
 * Fix: the footer is now a SEPARATE sibling, rendered after a dedicated
 * `max-h-full overflow-y-auto` wrapper that contains ONLY the photo and the
 * content through the compact subway row (the "must-fit set"). Flexbox
 * shrink is computed per flex CONTAINER — nesting the must-fit content in
 * its own wrapper is what excludes the footer's size from the calculation
 * a flat sibling list can't (see that wrapper's own comment in
 * SwipeCard.tsx for why `overflow-y-auto`, not `overflow-hidden` — the
 * short version: `hidden` would permanently discard any residual overflow
 * beyond the photo's floor, the exact "content invisible with no way to
 * reach it" failure this whole fix exists to prevent, measured to occur at
 * 320x568 in the implementer report).
 *
 * jsdom can't verify the actual pixel/shrink outcome (no real layout engine
 * — see the CompactSubwayRow test block's docstring above for the general
 * caveat). What IS checkable here, and load-bearing for the fix, is the
 * STRUCTURAL claim the pixel behavior depends on: the footer must NOT be a
 * descendant of the must-fit wrapper. If it were, it would be back inside
 * the wrapper's own `max-h-full`-bounded flex column and its size would
 * count toward the photo's shrink math again — silently reintroducing the
 * exact bug this test file exists to catch.
 *
 * Proof this test bites: moving the footer div back inside the must-fit
 * wrapper (i.e. before its closing tag) makes the "footer is not nested
 * inside the must-fit wrapper" assertion fail, in BOTH the main and
 * layoutOnly branches. See the implementer report for the actual
 * before/after command output.
 */
describe('SwipeCard footer link is excluded from the must-fit shrink wrapper', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  async function renderCard(layoutOnly: boolean): Promise<HTMLDivElement> {
    const { default: SwipeCard } = await import('@/components/SwipeCard');

    container = document.createElement('div');
    document.body.appendChild(container);

    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(SwipeCard, {
          listing,
          onSwipe: () => {},
          onExpandDetail: () => {},
          isTop: true,
          compactMobile: true,
          layoutOnly,
          onDragStateChange: () => {},
        }),
      );
    });
    return container;
  }

  function assertFooterExcludedFromMustFitWrapper(root: HTMLDivElement) {
    const wrapper = root.querySelector('[data-testid="swipe-card-must-fit-wrapper"]');
    const footer = root.querySelector('[data-testid="swipe-card-footer"]');
    const row = root.querySelector('[data-testid="compact-subway-row"]');
    expect(wrapper).not.toBeNull();
    expect(footer).not.toBeNull();
    // Sanity check the wrapper actually contains the thing it's supposed to
    // protect — a wrapper that excludes the footer but ALSO excludes the row
    // would trivially "pass" the real assertion below for the wrong reason.
    expect(wrapper!.contains(row)).toBe(true);
    // The load-bearing assertion: footer must be OUTSIDE the must-fit
    // wrapper's DOM subtree, not just visually below it.
    expect(wrapper!.contains(footer)).toBe(false);
  }

  it('main branch: footer is a sibling of the must-fit wrapper, not nested inside it', async () => {
    const root = await renderCard(false);
    assertFooterExcludedFromMustFitWrapper(root);
  });

  it('layoutOnly ghost branch: same exclusion', async () => {
    const root = await renderCard(true);
    assertFooterExcludedFromMustFitWrapper(root);
  });
});
