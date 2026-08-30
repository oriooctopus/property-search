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
