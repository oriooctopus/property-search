'use client';

import { useEffect, useRef, useState } from 'react';
import { FilterChip, PillButton, TagButton, PrimaryButton, TextButton } from '@/components/ui';

export type SearchTag = 'all' | 'fulton' | 'ltrain' | 'manhattan' | 'brooklyn';
export type SortField = 'pricePerBed' | 'price' | 'beds';

export interface FiltersState {
  maxPricePerBed: number | null;
  minBeds: number | null;
  minBaths: number | null;
  minRent: number | null;
  maxRent: number | null;
  sort: SortField;
  searchTag: SearchTag;
}

interface FiltersProps {
  filters: FiltersState;
  onChange: (filters: FiltersState) => void;
  listingCount?: number;
}

const SEARCH_TABS: { value: SearchTag; label: string; title: string }[] = [
  { value: 'all', label: 'All', title: 'Show all listings across every area, with no location filter applied' },
  { value: 'fulton', label: 'Fulton St', title: 'Listings within a 25-minute subway/bus ride of Fulton St station in Lower Manhattan' },
  { value: 'ltrain', label: 'L Train', title: 'Listings within a 10-minute walk of L train stops from Bedford Ave through DeKalb Ave' },
  { value: 'manhattan', label: 'Manhattan', title: 'Manhattan listings between Park Place (Tribeca) and 38th St (Midtown), covering Downtown, SoHo, the Village, Chelsea, and the Flatiron area' },
  { value: 'brooklyn', label: 'Brooklyn 14th', title: 'Brooklyn listings within a 35-minute subway ride of 14th St (any stop between 8th Ave and 1st Ave)' },
];

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'pricePerBed', label: 'PRICE/BEDROOM' },
  { value: 'price', label: 'PRICE' },
  { value: 'beds', label: 'BEDS' },
];

const MIN_PRICE_OPTIONS = [
  { value: null, label: 'No min' },
  { value: 5000, label: '$5,000' },
  { value: 6000, label: '$6,000' },
  { value: 7000, label: '$7,000' },
  { value: 8000, label: '$8,000' },
  { value: 9000, label: '$9,000' },
  { value: 10000, label: '$10,000' },
  { value: 12000, label: '$12,000' },
  { value: 15000, label: '$15,000' },
];

const MAX_PRICE_OPTIONS = [
  { value: null, label: 'No max' },
  { value: 8000, label: '$8,000' },
  { value: 10000, label: '$10,000' },
  { value: 12000, label: '$12,000' },
  { value: 15000, label: '$15,000' },
  { value: 20000, label: '$20,000' },
  { value: 25000, label: '$25,000' },
  { value: 30000, label: '$30,000' },
];

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

const PRICE_PER_BED_OPTIONS = [
  { value: null, label: 'Any' },
  { value: 1500, label: '$1,500' },
  { value: 2000, label: '$2,000' },
  { value: 2500, label: '$2,500' },
  { value: 3000, label: '$3,000' },
  { value: 3500, label: '$3,500' },
];

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

function PillGroup<T extends number | null>({
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

type ChipId = 'price' | 'bedsBaths' | 'pricePerBed';

export default function Filters({ filters, onChange, listingCount }: FiltersProps) {
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
      {/* Row 1: Filter chips */}
      <div className="flex items-center gap-2 mb-3">
        {/* Price chip */}
        <FilterChip
          label={priceLabel(filters.minRent, filters.maxRent)}
          active={filters.minRent !== null || filters.maxRent !== null}
          open={openChip === 'price'}
          onToggle={() => toggleChip('price')}
        >
          <SectionTitle>Price</SectionTitle>
          <div className="flex items-center gap-2 mb-3">
            <select
              value={draftMinRent === null ? '' : String(draftMinRent)}
              onChange={(e) =>
                setDraftMinRent(e.target.value === '' ? null : Number(e.target.value))
              }
              className="h-10 flex-1 appearance-none rounded-lg border border-[#2d333b] bg-[#0f1117] px-3 text-sm text-[#e1e4e8] outline-none transition focus:border-[#58a6ff]"
            >
              {MIN_PRICE_OPTIONS.map((opt) => (
                <option key={opt.label} value={opt.value === null ? '' : String(opt.value)}>
                  {opt.label}
                </option>
              ))}
            </select>
            <span className="text-sm text-[#8b949e]">&ndash;</span>
            <select
              value={draftMaxRent === null ? '' : String(draftMaxRent)}
              onChange={(e) =>
                setDraftMaxRent(e.target.value === '' ? null : Number(e.target.value))
              }
              className="h-10 flex-1 appearance-none rounded-lg border border-[#2d333b] bg-[#0f1117] px-3 text-sm text-[#e1e4e8] outline-none transition focus:border-[#58a6ff]"
            >
              {MAX_PRICE_OPTIONS.map((opt) => (
                <option key={opt.label} value={opt.value === null ? '' : String(opt.value)}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
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
          <PillGroup
            options={PRICE_PER_BED_OPTIONS}
            value={draftMaxPricePerBed}
            onSelect={setDraftMaxPricePerBed}
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
      </div>

      {/* Row 2: Search tags + Sort + listing count */}
      <div className="flex items-center gap-1.5">
        {/* Search tags */}
        <div className="flex items-center gap-1.5 flex-1" style={{ overflow: 'visible' }}>
          {SEARCH_TABS.map((tab) => {
            const active = filters.searchTag === tab.value;
            return (
              <div key={tab.value} className="relative group">
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
        <div className="relative ml-auto shrink-0">
          <TextButton
            variant="muted"
            onClick={() => {
              setSortOpen((prev) => !prev);
              setOpenChip(null);
            }}
            className="flex items-center gap-1 text-xs font-medium tracking-wide whitespace-nowrap"
          >
            SORT BY: {sortLabel}
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
