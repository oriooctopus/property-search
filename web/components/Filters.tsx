'use client';

import { useEffect, useRef, useState } from 'react';
import { ButtonBase, FilterChip, PillButton, PrimaryButton, TextButton } from '@/components/ui';
import { cn } from '@/lib/cn';

export type SearchTag = 'all' | 'fulton' | 'ltrain' | 'manhattan' | 'brooklyn';
export type SortField = 'pricePerBed' | 'price' | 'beds' | 'listDate';

export type MaxListingAge = '1w' | '2w' | '1m' | '3m' | '6m' | '1y' | null;

export const ALL_SOURCES = ['realtor', 'craigslist', 'streeteasy', 'zillow', 'facebook'] as const;
export type ListingSource = (typeof ALL_SOURCES)[number];

export const SOURCE_LABELS: Record<ListingSource, string> = {
  realtor: 'Realtor.com',
  craigslist: 'Craigslist',
  streeteasy: 'StreetEasy',
  zillow: 'Zillow',
  facebook: 'Facebook',
};

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
  selectedSources: string[] | null;
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

type ChipId = 'price' | 'bedsBaths' | 'pricePerBed' | 'listingAge' | 'source';

// ---------------------------------------------------------------------------
// Active filter count helper
// ---------------------------------------------------------------------------

function countActiveFilters(filters: FiltersState): number {
  let count = 0;
  if (filters.minBeds !== null) count++;
  if (filters.minBaths !== null) count++;
  if (filters.minRent !== null) count++;
  if (filters.maxRent !== null) count++;
  if (filters.maxPricePerBed !== null) count++;
  if (filters.maxListingAge !== null && filters.maxListingAge !== '1m') count++;
  if (filters.photosFirst) count++;
  if (filters.selectedSources !== null) count++;
  return count;
}

// ---------------------------------------------------------------------------
// Filter toggle button (funnel icon)
// ---------------------------------------------------------------------------

function FilterToggleButton({
  activeCount,
  expanded,
  onClick,
}: {
  activeCount: number;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <ButtonBase
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 rounded-md px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap border h-[26px]',
        expanded
          ? 'bg-[#58a6ff]/[0.08] text-[#58a6ff] border-[#58a6ff]'
          : activeCount > 0
            ? 'bg-[#58a6ff]/[0.08] text-[#58a6ff] border-[#58a6ff] hover:bg-[#58a6ff]/[0.18]'
            : 'bg-transparent text-[#8b949e] border-[#2d333b] hover:bg-[#58a6ff]/20 hover:text-[#c0d6f5] hover:border-[#58a6ff]/40',
      )}
    >
      {/* Funnel icon */}
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 2h10M3 6h6M5 10h2" />
      </svg>
      Filters
      {activeCount > 0 && (
        <span className="bg-[#58a6ff] text-[#0f1117] text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
          {activeCount}
        </span>
      )}
    </ButtonBase>
  );
}

export default function Filters({ filters, onChange, listingCount, viewToggle }: FiltersProps) {
  const [openChip, setOpenChip] = useState<ChipId | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

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
  const [draftSources, setDraftSources] = useState<string[] | null>(filters.selectedSources);

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
  useEffect(() => {
    setDraftSources(filters.selectedSources);
  }, [filters.selectedSources]);

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
    } else if (openChip === 'source') {
      setDraftSources(filters.selectedSources);
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
  const activeCount = countActiveFilters(filters);

  // Measure the expanded row for smooth transition
  const expandedRowRef = useRef<HTMLDivElement>(null);
  const [expandedHeight, setExpandedHeight] = useState(0);
  useEffect(() => {
    if (expandedRowRef.current) {
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setExpandedHeight(entry.contentRect.height);
        }
      });
      ro.observe(expandedRowRef.current);
      return () => ro.disconnect();
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className="px-2 relative z-[1200]"
      style={{ backgroundColor: '#1c2028', borderBottom: '1px solid #2d333b' }}
    >
      {/* Row 1 (always visible): Area tabs + listing count + Filters button + Sort + View toggle */}
      <div className="flex items-center h-8">
        {/* Search tags — horizontally scrollable, hidden scrollbar */}
        <div
          className="flex items-center flex-1 min-w-0 overflow-x-auto"
          style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', msOverflowStyle: 'none' } as React.CSSProperties}
        >
          <style dangerouslySetInnerHTML={{ __html: `.area-tabs-scroll::-webkit-scrollbar { display: none; }` }} />
          <div className="area-tabs-scroll flex items-center overflow-x-auto" style={{ scrollbarWidth: 'none' } as React.CSSProperties}>
            {SEARCH_TABS.map((tab) => {
              const active = filters.searchTag === tab.value;
              return (
                <div key={tab.value} className="relative group shrink-0">
                  <button
                    onClick={() => onChange({ ...filters, searchTag: tab.value })}
                    className={cn(
                      'relative flex items-center h-8 px-2.5 text-[11px] whitespace-nowrap cursor-pointer transition-colors duration-150',
                      active ? 'text-[#e1e4e8]' : 'text-[#8b949e] hover:text-[#c0d6f5]',
                    )}
                  >
                    {tab.label}
                    {/* Active underline indicator */}
                    {active && (
                      <span
                        className="absolute bottom-0 left-2.5 right-2.5 h-0.5 rounded-sm"
                        style={{ backgroundColor: '#58a6ff' }}
                      />
                    )}
                  </button>
                  {/* Custom tooltip */}
                  <div
                    className="pointer-events-none absolute left-0 top-full mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-75 z-50"
                  >
                    <div
                      className="absolute -top-1 w-2 h-2 rotate-45"
                      style={{ left: 12, backgroundColor: '#1c2028', border: '1px solid #2d333b', borderRight: 'none', borderBottom: 'none' }}
                    />
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
          </div>
        </div>

        {/* Right-side controls */}
        <div className="flex items-center gap-1.5 shrink-0 pl-2">
          {listingCount !== undefined && (
            <span className="text-[11px] whitespace-nowrap" style={{ color: '#8b949e' }}>
              {listingCount}
            </span>
          )}

          {/* Sort dropdown */}
          <div className="relative shrink-0">
            <button
              onClick={() => {
                setSortOpen((prev) => !prev);
                setOpenChip(null);
              }}
              className="flex items-center gap-1 text-[11px] text-[#8b949e] hover:text-[#e1e4e8] cursor-pointer whitespace-nowrap px-1 transition-colors duration-150"
            >
              <span>&#8645;</span>
              <span className="hidden sm:inline">{sortLabel}</span>
              <span className="sm:hidden">Sort</span>
              <ChevronDown className={`transition-transform ${sortOpen ? 'rotate-180' : ''}`} />
            </button>

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

          {/* Filters toggle button */}
          <FilterToggleButton
            activeCount={activeCount}
            expanded={filtersExpanded}
            onClick={() => {
              setFiltersExpanded((prev) => !prev);
              if (filtersExpanded) {
                setOpenChip(null);
              }
            }}
          />

          {/* View toggle (list/map) */}
          {viewToggle && <div className="shrink-0">{viewToggle}</div>}
        </div>
      </div>

      {/* Row 2 (expandable): Filter chips — conditional render so dropdowns aren't clipped */}
      {filtersExpanded && (
        <div ref={expandedRowRef} className="flex items-center gap-1.5 flex-wrap pt-1.5 pb-1" style={{ borderTop: '1px solid #2d333b' }}>
          {/* Price chip */}
          <FilterChip
            compact
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
            compact
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
            compact
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
            compact
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

          {/* Source chip */}
          <FilterChip
            compact
            label={filters.selectedSources !== null ? `Sources (${filters.selectedSources.length})` : 'Source'}
            active={filters.selectedSources !== null}
            open={openChip === 'source'}
            onToggle={() => toggleChip('source')}
          >
            <SectionTitle>Sources</SectionTitle>
            <div className="flex flex-col gap-2">
              {ALL_SOURCES.map((src) => {
                const checked = draftSources === null || draftSources.includes(src);
                return (
                  <label key={src} className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: '#e1e4e8' }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        if (draftSources === null) {
                          // All selected -> uncheck this one
                          setDraftSources(ALL_SOURCES.filter((s) => s !== src) as string[]);
                        } else if (checked) {
                          const next = draftSources.filter((s) => s !== src);
                          setDraftSources(next.length === 0 ? null : next);
                        } else {
                          const next = [...draftSources, src];
                          setDraftSources(next.length === ALL_SOURCES.length ? null : next);
                        }
                      }}
                      className="accent-[#58a6ff] w-4 h-4"
                    />
                    {SOURCE_LABELS[src]}
                  </label>
                );
              })}
            </div>
            <DropdownFooter
              onReset={() => {
                onChange({ ...filters, selectedSources: null });
                setOpenChip(null);
              }}
              onDone={() => {
                onChange({ ...filters, selectedSources: draftSources });
                setOpenChip(null);
              }}
            />
          </FilterChip>

          {/* Photos first toggle chip */}
          <div className="relative group shrink-0">
            <FilterChip
              compact
              label="Photos first"
              active={filters.photosFirst}
              open={false}
              onToggle={() => onChange({ ...filters, photosFirst: !filters.photosFirst })}
            />
            <div
              className="pointer-events-none absolute left-0 top-full mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-75 z-50"
            >
              <div
                className="absolute -top-1 w-2 h-2 rotate-45"
                style={{ left: 12, backgroundColor: '#1c2028', border: '1px solid #2d333b', borderRight: 'none', borderBottom: 'none' }}
              />
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
                Prioritize listings with photos at the top of results
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
