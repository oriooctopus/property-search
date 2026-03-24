'use client';

import { useEffect, useRef, useState } from 'react';
import { FilterChip, PillButton, TagButton, PrimaryButton, TextButton } from '@/components/ui';

export type SearchTag = 'all' | 'fulton' | 'ltrain' | 'manhattan' | 'brooklyn';
export type SortField = 'pricePerBed' | 'price' | 'beds' | 'listDate';

export type MaxListingAge = '1w' | '2w' | '1m' | '3m' | '6m' | '1y' | null;

export interface FiltersState {
  maxPricePerBed: number | null;
  minBeds: number | null;
  minBaths: number | null;
  minRent: number | null;
  maxRent: number | null;
  sort: SortField;
  searchTag: SearchTag;
  maxListingAge: MaxListingAge;
  photosFirst: boolean;
}

interface FiltersProps {
  filters: FiltersState;
  onChange: (filters: FiltersState) => void;
  listingCount?: number;
  viewToggle?: React.ReactNode;
}

const SEARCH_TABS: { value: SearchTag; label: string; title: string }[] = [
  { value: 'all', label: 'All', title: 'Show all listings across every area, with no location filter applied' },
  { value: 'fulton', label: 'Fulton St', title: 'Listings within a 25-minute subway/bus ride of Fulton St station in Lower Manhattan' },
  { value: 'ltrain', label: 'L Train', title: 'Listings within a 10-minute walk of L train stops from Bedford Ave through DeKalb Ave' },
  { value: 'manhattan', label: 'Manhattan', title: 'Manhattan listings between Park Place (Tribeca) and 38th St (Midtown), covering Downtown, SoHo, the Village, Chelsea, and the Flatiron area' },
  { value: 'brooklyn', label: 'Brooklyn 14th', title: 'Brooklyn listings within a 35-minute subway ride of 14th St (any stop between 8th Ave and 1st Ave)' },
];

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'pricePerBed', label: 'Price/Bedroom' },
  { value: 'price', label: 'Price' },
  { value: 'beds', label: 'Beds' },
  { value: 'listDate', label: 'List Date' },
];

const PRICE_SLIDER_MIN = 0;
const PRICE_SLIDER_MAX = 25000;
const PRICE_SLIDER_STEP = 500;

const PRICE_PER_BED_SLIDER_MIN = 0;
const PRICE_PER_BED_SLIDER_MAX = 5000;
const PRICE_PER_BED_SLIDER_STEP = 250;

const BEDROOM_OPTIONS = [
  { value: null, label: 'Any' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5' },
  { value: 6, label: '6' },
  { value: 7, label: '7+' },
];

const BATHROOM_OPTIONS = [
  { value: null, label: 'Any' },
  { value: 1, label: '1+' },
  { value: 1.5, label: '1.5+' },
  { value: 2, label: '2+' },
  { value: 3, label: '3+' },
  { value: 4, label: '4+' },
];

function formatSliderPrice(value: number): string {
  return `$${value.toLocaleString()}`;
}

function RangeSlider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium" style={{ color: '#8b949e' }}>
          {label}
        </span>
        <span className="text-sm font-bold" style={{ color: '#e1e4e8' }}>
          {value === min && label.toLowerCase().includes('min')
            ? 'No min'
            : value === max && label.toLowerCase().includes('max')
              ? 'No max'
              : formatSliderPrice(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="range-slider w-full"
        style={{
          background: `linear-gradient(to right, #58a6ff 0%, #58a6ff ${pct}%, #2d333b ${pct}%, #2d333b 100%)`,
        }}
      />
      <div className="flex justify-between mt-1">
        <span className="text-[10px]" style={{ color: '#8b949e' }}>
          {formatSliderPrice(min)}
        </span>
        <span className="text-[10px]" style={{ color: '#8b949e' }}>
          {formatSliderPrice(max)}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chip label helpers
// ---------------------------------------------------------------------------

function priceLabel(minRent: number | null, maxRent: number | null): string {
  if (minRent === null && maxRent === null) return 'Price';
  if (minRent !== null && maxRent !== null) {
    return `$${(minRent / 1000).toFixed(minRent % 1000 === 0 ? 0 : 1)}K\u2013$${(maxRent / 1000).toFixed(maxRent % 1000 === 0 ? 0 : 1)}K`;
  }
  if (maxRent !== null) {
    return `Under $${(maxRent / 1000).toFixed(maxRent % 1000 === 0 ? 0 : 1)}K`;
  }
  return `$${(minRent! / 1000).toFixed(minRent! % 1000 === 0 ? 0 : 1)}K+`;
}

function bedsBathsLabel(minBeds: number | null, minBaths: number | null): string {
  const parts: string[] = [];
  if (minBeds !== null) parts.push(`${minBeds}+ Beds`);
  if (minBaths !== null) parts.push(`${minBaths}+ Baths`);
  return parts.length > 0 ? parts.join(', ') : 'Beds / Baths';
}

function pricePerBedLabel(maxPricePerBed: number | null): string {
  if (maxPricePerBed === null) return 'Price (per bedroom)';
  return `Under $${maxPricePerBed.toLocaleString()}/bed`;
}

// ---------------------------------------------------------------------------
// Chevron SVG
// ---------------------------------------------------------------------------

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 4.5L6 7.5L9 4.5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-xs font-bold uppercase tracking-wider mb-3"
      style={{ color: '#8b949e', letterSpacing: '0.05em' }}
    >
      {children}
    </div>
  );
}

function PillGroup<T extends number | string | null>({
  options,
  value,
  onSelect,
}: {
  options: { value: T; label: string }[];
  value: T;
  onSelect: (v: T) => void;
}) {
  return (
    <div className="flex">
      {options.map((opt, i) => {
        const position = options.length === 1
          ? 'only' as const
          : i === 0
            ? 'first' as const
            : i === options.length - 1
              ? 'last' as const
              : 'middle' as const;

        return (
          <PillButton
            key={opt.label}
            active={opt.value === value}
            position={position}
            onClick={() => onSelect(opt.value)}
          >
            {opt.label}
          </PillButton>
        );
      })}
    </div>
  );
}

function DropdownFooter({
  onReset,
  onDone,
}: {
  onReset: () => void;
  onDone: () => void;
}) {
  return (
    <div className="flex items-center justify-between mt-5">
      <TextButton
        variant="muted"
        onClick={onReset}
        className="text-xs font-bold uppercase tracking-wider"
      >
        Reset
      </TextButton>
      <PrimaryButton onClick={onDone} className="h-9 px-6 text-sm font-bold">
        Done
      </PrimaryButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Filters component
// ---------------------------------------------------------------------------

const LISTING_AGE_STEPS: { value: MaxListingAge; label: string }[] = [
  { value: '1w', label: '1 Week' },
  { value: '2w', label: '2 Weeks' },
  { value: '1m', label: '1 Month' },
  { value: '3m', label: '3 Months' },
  { value: '6m', label: '6 Months' },
  { value: '1y', label: '1 Year' },
  { value: null, label: 'Any' },
];

function listingAgeLabel(maxAge: MaxListingAge): string {
  if (maxAge === null) return 'Listed within';
  const opt = LISTING_AGE_STEPS.find((o) => o.value === maxAge);
  return `Within ${opt?.label ?? maxAge}`;
}

function listingAgeSliderIndex(maxAge: MaxListingAge): number {
  const idx = LISTING_AGE_STEPS.findIndex((o) => o.value === maxAge);
  return idx >= 0 ? idx : LISTING_AGE_STEPS.length - 1; // default to "Any" if not found
}

function ListingAgeSlider({
  value,
  onChange,
}: {
  value: MaxListingAge;
  onChange: (v: MaxListingAge) => void;
}) {
  const index = listingAgeSliderIndex(value);
  const maxIndex = LISTING_AGE_STEPS.length - 1;
  const pct = (index / maxIndex) * 100;
  const currentLabel = LISTING_AGE_STEPS[index].label;

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium" style={{ color: '#8b949e' }}>
          Listed within
        </span>
        <span className="text-sm font-bold" style={{ color: '#e1e4e8' }}>
          {currentLabel}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={maxIndex}
        step={1}
        value={index}
        onChange={(e) => {
          const i = Number(e.target.value);
          onChange(LISTING_AGE_STEPS[i].value);
        }}
        className="range-slider w-full"
        style={{
          background: `linear-gradient(to right, #58a6ff 0%, #58a6ff ${pct}%, #2d333b ${pct}%, #2d333b 100%)`,
        }}
      />
      <div className="flex justify-between mt-1">
        <span className="text-[10px]" style={{ color: '#8b949e' }}>
          1 Week
        </span>
        <span className="text-[10px]" style={{ color: '#8b949e' }}>
          Any
        </span>
      </div>
    </div>
  );
}

type ChipId = 'price' | 'bedsBaths' | 'pricePerBed' | 'listingAge';

export default function Filters({ filters, onChange, listingCount, viewToggle }: FiltersProps) {
  const [openChip, setOpenChip] = useState<ChipId | null>(null);
  const [sortOpen, setSortOpen] = useState(false);

  // Draft state for dropdowns — only applied on "Done"
  const [draftMinRent, setDraftMinRent] = useState<number | null>(filters.minRent);
  const [draftMaxRent, setDraftMaxRent] = useState<number | null>(filters.maxRent);
  const [draftMinBeds, setDraftMinBeds] = useState<number | null>(filters.minBeds);
  const [draftMinBaths, setDraftMinBaths] = useState<number | null>(filters.minBaths);
  const [draftMaxPricePerBed, setDraftMaxPricePerBed] = useState<number | null>(
    filters.maxPricePerBed,
  );
  const [draftMaxListingAge, setDraftMaxListingAge] = useState<MaxListingAge>(
    filters.maxListingAge,
  );

  // Sync drafts when filters change externally
  useEffect(() => {
    setDraftMinRent(filters.minRent);
  }, [filters.minRent]);
  useEffect(() => {
    setDraftMaxRent(filters.maxRent);
  }, [filters.maxRent]);
  useEffect(() => {
    setDraftMinBeds(filters.minBeds);
  }, [filters.minBeds]);
  useEffect(() => {
    setDraftMinBaths(filters.minBaths);
  }, [filters.minBaths]);
  useEffect(() => {
    setDraftMaxPricePerBed(filters.maxPricePerBed);
  }, [filters.maxPricePerBed]);
  useEffect(() => {
    setDraftMaxListingAge(filters.maxListingAge);
  }, [filters.maxListingAge]);

  // Reset drafts when a dropdown opens
  useEffect(() => {
    if (openChip === 'price') {
      setDraftMinRent(filters.minRent);
      setDraftMaxRent(filters.maxRent);
    } else if (openChip === 'bedsBaths') {
      setDraftMinBeds(filters.minBeds);
      setDraftMinBaths(filters.minBaths);
    } else if (openChip === 'pricePerBed') {
      setDraftMaxPricePerBed(filters.maxPricePerBed);
    } else if (openChip === 'listingAge') {
      setDraftMaxListingAge(filters.maxListingAge);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openChip]);

  // Click-outside handler — discard drafts
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenChip(null);
        setSortOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function toggleChip(chip: ChipId) {
    setOpenChip((prev) => (prev === chip ? null : chip));
    setSortOpen(false);
  }

  const sortLabel = SORT_OPTIONS.find((o) => o.value === filters.sort)?.label ?? 'PRICE/BEDROOM';

  return (
    <div
      ref={containerRef}
      className="px-4 py-3"
      style={{ backgroundColor: '#1c2028', borderBottom: '1px solid #2d333b' }}
    >
      {/* Row 1: Filter chips + view toggle */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
        {/* Price chip */}
        <FilterChip
          label={priceLabel(filters.minRent, filters.maxRent)}
          active={filters.minRent !== null || filters.maxRent !== null}
          open={openChip === 'price'}
          onToggle={() => toggleChip('price')}
        >
          <SectionTitle>Price</SectionTitle>
          <RangeSlider
            label="Min Price"
            min={PRICE_SLIDER_MIN}
            max={PRICE_SLIDER_MAX}
            step={PRICE_SLIDER_STEP}
            value={draftMinRent ?? PRICE_SLIDER_MIN}
            onChange={(v) => setDraftMinRent(v === PRICE_SLIDER_MIN ? null : v)}
          />
          <RangeSlider
            label="Max Price"
            min={PRICE_SLIDER_MIN}
            max={PRICE_SLIDER_MAX}
            step={PRICE_SLIDER_STEP}
            value={draftMaxRent ?? PRICE_SLIDER_MAX}
            onChange={(v) => setDraftMaxRent(v === PRICE_SLIDER_MAX ? null : v)}
          />
          <p className="text-xs mb-1" style={{ color: '#8b949e' }}>
            Applies to monthly rent
          </p>
          <DropdownFooter
            onReset={() => {
              onChange({ ...filters, minRent: null, maxRent: null });
              setOpenChip(null);
            }}
            onDone={() => {
              onChange({ ...filters, minRent: draftMinRent, maxRent: draftMaxRent });
              setOpenChip(null);
            }}
          />
        </FilterChip>

        {/* Beds / Baths chip */}
        <FilterChip
          label={bedsBathsLabel(filters.minBeds, filters.minBaths)}
          active={filters.minBeds !== null || filters.minBaths !== null}
          open={openChip === 'bedsBaths'}
          onToggle={() => toggleChip('bedsBaths')}
        >
          <SectionTitle>Bedrooms</SectionTitle>
          <PillGroup
            options={BEDROOM_OPTIONS}
            value={draftMinBeds}
            onSelect={setDraftMinBeds}
          />

          <div className="mt-5">
            <SectionTitle>Bathrooms</SectionTitle>
            <PillGroup
              options={BATHROOM_OPTIONS}
              value={draftMinBaths}
              onSelect={setDraftMinBaths}
            />
          </div>

          <DropdownFooter
            onReset={() => {
              onChange({ ...filters, minBeds: null, minBaths: null });
              setOpenChip(null);
            }}
            onDone={() => {
              onChange({ ...filters, minBeds: draftMinBeds, minBaths: draftMinBaths });
              setOpenChip(null);
            }}
          />
        </FilterChip>

        {/* $/Bedroom chip */}
        <FilterChip
          label={pricePerBedLabel(filters.maxPricePerBed)}
          active={filters.maxPricePerBed !== null}
          open={openChip === 'pricePerBed'}
          onToggle={() => toggleChip('pricePerBed')}
        >
          <SectionTitle>Max $/Bedroom</SectionTitle>
          <RangeSlider
            label="Max $/Bedroom"
            min={PRICE_PER_BED_SLIDER_MIN}
            max={PRICE_PER_BED_SLIDER_MAX}
            step={PRICE_PER_BED_SLIDER_STEP}
            value={draftMaxPricePerBed ?? PRICE_PER_BED_SLIDER_MAX}
            onChange={(v) => setDraftMaxPricePerBed(v === PRICE_PER_BED_SLIDER_MAX ? null : v)}
          />
          <DropdownFooter
            onReset={() => {
              onChange({ ...filters, maxPricePerBed: null });
              setOpenChip(null);
            }}
            onDone={() => {
              onChange({ ...filters, maxPricePerBed: draftMaxPricePerBed });
              setOpenChip(null);
            }}
          />
        </FilterChip>

        {/* Listing age chip */}
        <FilterChip
          label={listingAgeLabel(filters.maxListingAge)}
          active={filters.maxListingAge !== null}
          open={openChip === 'listingAge'}
          onToggle={() => toggleChip('listingAge')}
        >
          <ListingAgeSlider
            value={draftMaxListingAge}
            onChange={setDraftMaxListingAge}
          />
          <DropdownFooter
            onReset={() => {
              onChange({ ...filters, maxListingAge: '1m' });
              setOpenChip(null);
            }}
            onDone={() => {
              onChange({ ...filters, maxListingAge: draftMaxListingAge });
              setOpenChip(null);
            }}
          />
        </FilterChip>

        {/* Photos first toggle chip */}
        <FilterChip
          label="Photos first"
          active={filters.photosFirst}
          open={false}
          onToggle={() => onChange({ ...filters, photosFirst: !filters.photosFirst })}
        />

        </div>
        {/* List/Map segmented control (mobile only, right-aligned) */}
        {viewToggle && <div className="shrink-0">{viewToggle}</div>}
      </div>

      {/* Row 2: Search tags + Sort + listing count */}
      <div className="flex flex-wrap items-center gap-1.5 overflow-x-clip">
        {/* Search tags */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {SEARCH_TABS.map((tab) => {
            const active = filters.searchTag === tab.value;
            return (
              <div key={tab.value} className="relative group shrink-0">
                <TagButton
                  active={active}
                  onClick={() => onChange({ ...filters, searchTag: tab.value })}
                >
                  {tab.label}
                </TagButton>
                {/* Custom tooltip — left-aligned to avoid clipping at container edges */}
                <div
                  className="pointer-events-none absolute left-0 top-full mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-75 z-50"
                >
                  {/* Arrow */}
                  <div
                    className="absolute -top-1 w-2 h-2 rotate-45"
                    style={{ left: 12, backgroundColor: '#1c2028', border: '1px solid #2d333b', borderRight: 'none', borderBottom: 'none' }}
                  />
                  {/* Body */}
                  <div
                    className="rounded-md px-2.5 py-1.5 text-xs"
                    style={{
                      backgroundColor: '#1c2028',
                      color: '#e1e4e8',
                      border: '1px solid #2d333b',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                      maxWidth: 'min(260px, calc(100vw - 32px))',
                      width: 'max-content',
                      wordWrap: 'break-word',
                    }}
                  >
                    {tab.title}
                  </div>
                </div>
              </div>
            );
          })}

          {listingCount !== undefined && (
            <span className="text-xs ml-2 whitespace-nowrap" style={{ color: '#8b949e' }}>
              {listingCount} listing{listingCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Sort dropdown */}
        <div className="relative ml-auto sm:ml-auto shrink-0">
          <TextButton
            variant="muted"
            onClick={() => {
              setSortOpen((prev) => !prev);
              setOpenChip(null);
            }}
            className="flex items-center gap-1 text-xs font-medium tracking-wide whitespace-nowrap"
          >
            Sort by: {sortLabel}
            <ChevronDown className={`transition-transform ${sortOpen ? 'rotate-180' : ''}`} />
          </TextButton>

          {sortOpen && (
            <div
              className="absolute right-0 top-full mt-2 z-50 min-w-[140px] rounded-lg border border-[#2d333b] py-1 shadow-xl"
              style={{ backgroundColor: '#1c2028' }}
            >
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    onChange({ ...filters, sort: opt.value });
                    setSortOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs font-medium tracking-wide transition-colors hover:bg-[#2d333b] cursor-pointer"
                  style={{
                    color: filters.sort === opt.value ? '#58a6ff' : '#8b949e',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
