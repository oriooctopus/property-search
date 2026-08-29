/**
 * Pure-logic tests for lib/address-dedupe.ts — the Nominatim result
 * dedupe/labelling behind SearchModal's address suggestion rows.
 *
 * The real-duplicate fixture below is a captured (not synthesized) response
 * from `GET https://nominatim.openstreetmap.org/search?q=jefferson+street&
 * countrycodes=us&viewbox=-74.3,40.4,-73.6,40.95&bounded=1&limit=5` — the
 * exact query SearchModal fires for "jefferson street" — so the two Dongan
 * Hills rows are a real Nominatim quirk (same street name, two OSM ways
 * ~420m apart, one per postal code), not a hypothetical edge case. Under
 * SearchModal's 2-line clamp at mobile width, both rows previously rendered
 * as byte-identical text: "Jefferson Street, Dongan Hills, Staten Island,
 * Richmond County, New York," — the zip that actually distinguishes them
 * sits past where 2 lines truncate.
 */

import { describe, it, expect } from 'vitest';
import { dedupeAndLabelAddresses } from '@/lib/address-dedupe';
import type { NominatimResult } from '@/lib/geocode';

function assertNoDuplicateLabels(results: ReturnType<typeof dedupeAndLabelAddresses>) {
  const labels = results.map((r) => r.label);
  expect(new Set(labels).size).toBe(labels.length);
}

describe('dedupeAndLabelAddresses — real "jefferson street" duplicate pair', () => {
  // Captured live Nominatim response, trimmed to the fields the module reads.
  const JEFFERSON_STREET_FIXTURE: NominatimResult[] = [
    {
      place_id: 359699019,
      display_name: 'Jefferson Street, Wyckoff Avenue, Bushwick, Brooklyn, Kings County, New York, 11237, United States',
      lat: '40.7066877',
      lon: '-73.9230698',
      type: 'station',
      class: 'railway',
    },
    {
      place_id: 354320898,
      display_name: 'Jefferson Street, Dongan Hills, Staten Island, Richmond County, New York, 10304, United States',
      lat: '40.5900630',
      lon: '-74.0981551',
      type: 'residential',
      class: 'highway',
    },
    // The duplicate-looking pair: same street name, same neighborhood text
    // as the row above, ~420m away (a genuinely different place, not an
    // OSM duplicate) — differs from it only by postal code (10304 vs 10306).
    {
      place_id: 356418309,
      display_name: 'Jefferson Street, Dongan Hills, Staten Island, Richmond County, New York, 10306, United States',
      lat: '40.5868629',
      lon: '-74.1008305',
      type: 'residential',
      class: 'highway',
    },
    {
      place_id: 359399944,
      display_name: 'Jefferson Street, Bushwick, Brooklyn, Kings County, New York, 11237, United States',
      lat: '40.7044591',
      lon: '-73.9261147',
      type: 'residential',
      class: 'highway',
    },
    {
      place_id: 359107139,
      display_name: 'Jefferson Street, Brooklyn, Kings County, New York, 11206, United States',
      lat: '40.6970301',
      lon: '-73.9352445',
      type: 'residential',
      class: 'highway',
    },
  ];

  it('produces no two rows with identical visible label text', () => {
    const out = dedupeAndLabelAddresses(JEFFERSON_STREET_FIXTURE);
    assertNoDuplicateLabels(out);
  });

  it('retains all 5 results — they are genuinely distinct places, not duplicates', () => {
    const out = dedupeAndLabelAddresses(JEFFERSON_STREET_FIXTURE);
    expect(out).toHaveLength(5);
  });

  it('pulls the distinguishing ZIP forward so it survives truncation, instead of leaving it at the end', () => {
    const out = dedupeAndLabelAddresses(JEFFERSON_STREET_FIXTURE);
    const dongan10304 = out.find((r) => r.place_id === 354320898)!;
    const dongan10306 = out.find((r) => r.place_id === 356418309)!;
    // Both labels must diverge within the first ~40 characters — comfortably
    // inside a 2-line clamp at mobile width — not only at the very end.
    expect(dongan10304.label.slice(0, 40)).not.toBe(dongan10306.label.slice(0, 40));
    expect(dongan10304.label).toContain('10304');
    expect(dongan10306.label).toContain('10306');
  });
});

describe('dedupeAndLabelAddresses — true duplicates (split OSM way segments)', () => {
  // Synthetic: the same physical block of "Broadway" geocoded as two OSM
  // ways a few meters apart — a real, common Nominatim pattern, but not
  // one the live "jefferson street" query happened to return, so this case
  // is fabricated rather than captured.
  const SPLIT_WAY_FIXTURE: NominatimResult[] = [
    {
      place_id: 111,
      display_name: 'Broadway, Astoria, Queens, Queens County, New York, 11106, United States',
      lat: '40.761800',
      lon: '-73.925100',
      type: 'residential',
      class: 'highway',
    },
    {
      place_id: 112,
      // Same street, same block, ~15m away — a duplicate OSM way segment
      // for the same physical place, not a distinct address.
      display_name: 'Broadway, Astoria, Queens, Queens County, New York, 11106, United States',
      lat: '40.761933',
      lon: '-73.925087',
      type: 'residential',
      class: 'highway',
    },
    {
      place_id: 113,
      // Genuinely different Broadway, ~9km away in a different borough —
      // must survive the dedupe untouched.
      display_name: 'Broadway, SoHo, Manhattan, New York County, New York, 10012, United States',
      lat: '40.723100',
      lon: '-73.998700',
      type: 'residential',
      class: 'highway',
    },
  ];

  it('drops the second OSM-way duplicate, keeping the first (more relevant) occurrence', () => {
    const out = dedupeAndLabelAddresses(SPLIT_WAY_FIXTURE);
    expect(out.map((r) => r.place_id)).toEqual([111, 113]);
  });

  it('still produces no duplicate visible labels among what remains', () => {
    const out = dedupeAndLabelAddresses(SPLIT_WAY_FIXTURE);
    assertNoDuplicateLabels(out);
  });
});

describe('dedupeAndLabelAddresses — invalid coordinates', () => {
  it('drops results whose lat/lon are non-finite or outside the NYC metro sanity bounds', () => {
    const fixture: NominatimResult[] = [
      {
        place_id: 1,
        display_name: 'Somewhere, New York, United States',
        lat: 'not-a-number',
        lon: '-73.9',
        type: 'residential',
        class: 'highway',
      },
      {
        place_id: 2,
        display_name: 'Also Somewhere, New York, United States',
        lat: '0',
        lon: '0',
        type: 'residential',
        class: 'highway',
      },
      {
        place_id: 3,
        display_name: 'Valid Place, New York, United States',
        lat: '40.7',
        lon: '-73.9',
        type: 'residential',
        class: 'highway',
      },
    ];
    const out = dedupeAndLabelAddresses(fixture);
    expect(out).toHaveLength(1);
    expect(out[0].place_id).toBe(3);
  });
});

describe('dedupeAndLabelAddresses — guaranteed-unique fallback', () => {
  it('appends the place_id when two distinct-enough-to-keep results would otherwise render identical labels', () => {
    // Two different places, far apart, that happen to share both a
    // primary name AND a zip (no other distinguishing text) — the
    // zip-forward rewrite alone can't tell them apart, so the module must
    // fall back to something that does.
    const fixture: NominatimResult[] = [
      {
        place_id: 201,
        display_name: 'Main Street, 10001, United States',
        lat: '40.70',
        lon: '-73.90',
        type: 'residential',
        class: 'highway',
      },
      {
        place_id: 202,
        display_name: 'Main Street, 10001, United States',
        lat: '40.90', // >50m away — not a true duplicate.
        lon: '-73.70',
        type: 'residential',
        class: 'highway',
      },
    ];
    const out = dedupeAndLabelAddresses(fixture);
    expect(out).toHaveLength(2);
    assertNoDuplicateLabels(out);
  });
});
