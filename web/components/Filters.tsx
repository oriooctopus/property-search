'use client';

import { memo, useEffect, useRef, useState, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { ButtonBase, FilterChip, PillButton, PrimaryButton, TextButton } from '@/components/ui';
import { cn } from '@/lib/cn';
import SUBWAY_STATIONS from '@/lib/isochrone/subway-stations';
import SaveWishlistPanel, { type WishlistFilterSelection } from '@/components/SaveWishlistPanel';
import type { Wishlist } from '@/lib/hooks/useWishlists';

export type SortField = 'price' | 'beds' | 'listDate';

export type MaxListingAge = '1h' | '3h' | '6h' | '12h' | '1d' | '2d' | '3d' | '1w' | '2w' | '1m' | null;

export const ALL_SOURCES = ['craigslist', 'streeteasy'] as const;
export type ListingSource = (typeof ALL_SOURCES)[number];

export const SOURCE_LABELS: Record<ListingSource, string> = {
  craigslist: 'Craigslist',
  streeteasy: 'StreetEasy',
};

export interface CommuteRule {
  id: string;
  type: 'subway-line' | 'station' | 'address' | 'park';
  lines?: string[];
  stops?: string[];
  stationName?: string;
  address?: string;
  addressLat?: number;
  addressLon?: number;
  parkName?: string;
  maxMinutes: number;
  mode: 'walk' | 'transit' | 'bike';
}

// ---------------------------------------------------------------------------
// Nominatim address autocomplete types + helpers
// ---------------------------------------------------------------------------

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type: string;
  class: string;
}

async function fetchNominatimSuggestions(
  query: string,
  signal?: AbortSignal,
): Promise<NominatimResult[]> {
  if (!query.trim()) return [];
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    countrycodes: 'us',
    viewbox: '-74.3,40.4,-73.6,40.95',
    bounded: '1',
    limit: '5',
  });
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
    {
      signal,
      headers: { 'User-Agent': 'Dwelligence/1.0' },
    },
  );
  if (!res.ok) throw new Error('Nominatim request failed');
  return res.json();
}

export interface FiltersState {
  selectedBeds: number[] | null;
  minBaths: number | null;
  includeNaBaths: boolean;
  minRent: number | null;
  maxRent: number | null;
  priceMode: 'total' | 'perRoom';
  sort: SortField;
  maxListingAge: MaxListingAge;
  photosFirst: boolean;
  selectedSources: string[] | null;
  minYearBuilt: number | null;
  maxYearBuilt: number | null;
  minSqft: number | null;
  maxSqft: number | null;
  excludeNoSqft: boolean;
  minAvailableDate: string | null;
  maxAvailableDate: string | null;
  includeNaAvailableDate: boolean;
  commuteRules: CommuteRule[];
}

export interface SavedSearchEntry {
  id: number;
  name: string;
  filters: Record<string, unknown>;
  created_at: string;
}

interface FiltersProps {
  filters: FiltersState;
  onChange: (filters: FiltersState) => void;
  listingCount?: number;
  viewToggle?: React.ReactNode;
  /** Inline slot rendered as the FIRST child of Row 1 (left of saved-search tabs).
   *  Used by the parent to drop the SetDestinationPill into the filters top bar
   *  so it doesn't need its own dedicated row. */
  destinationSlot?: React.ReactNode;
  userId?: string | null;
  savedSearches?: SavedSearchEntry[];
  onSaveSearch?: (name: string) => Promise<SavedSearchEntry | null>;
  onDeleteSearch?: (id: number) => void;
  onLoadSearch?: (filters: FiltersState) => void;
  onUpdateSearch?: (id: number, name: string) => void;
  /** Replace a saved search's filter snapshot in place. Used by the
   *  in-sheet "Edit saved search" flow. Returns true on success. */
  onUpdateSearchFilters?: (id: number, filters: FiltersState) => Promise<boolean>;
  onLoginRequired?: () => void;
  showHidden?: boolean;
  onToggleShowHidden?: () => void;
  /** Toggle: when true, delisted listings (those with delisted_at set)
   *  are surfaced in the wishlist view under the "Removed" section.
   *  When false (default), they're hidden entirely. */
  showDelisted?: boolean;
  onToggleShowDelisted?: () => void;
  /** Count of delisted listings in the active wishlist. The chip only
   *  renders when this is > 0 (and a wishlist is active). */
  delistedCount?: number;
  /** Wishlists the user owns — shown in the "Created by you" section. */
  myWishlists?: Wishlist[];
  /** Wishlists shared with the user — shown in the "Shared with you" section. */
  sharedWishlists?: Wishlist[];
  /** Current wishlist filter selection. */
  selectedWishlist?: WishlistFilterSelection;
  onSelectWishlist?: (selection: WishlistFilterSelection) => void;
  /** Resolves with the new wishlist's id (or null on failure) so the panel can auto-select it. */
  onCreateWishlist?: (name: string) => Promise<string | null>;
  onOpenWishlistManager?: () => void;
}

/**
 * Imperative handle exposed by <Filters>. Lets an ancestor (e.g. the page
 * container) open the mobile Sort & Filter bottom sheet directly — used by
 * the floating Filters pill in SwipeView so there's only ONE mobile sheet
 * (no nested drawer). This keeps filter state consistent because the same
 * <Filters> instance mounted in the sidebar owns the sheet.
 */
export interface FiltersHandle {
  openMobileSheet: () => void;
}

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'price', label: 'Price' },
  { value: 'beds', label: 'Beds' },
  { value: 'listDate', label: 'List Date' },
];

const PRICE_SLIDER_MIN = 0;
const PRICE_SLIDER_MAX = 25000;
const PRICE_SLIDER_STEP = 500;

const PRICE_PER_ROOM_MIN = 0;
const PRICE_PER_ROOM_MAX = 4000;
const PRICE_PER_ROOM_STEP = 50;


const BEDROOM_OPTIONS = [
  { value: null, label: 'Any' },
  { value: 0, label: 'Studio' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
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

const YEAR_BUILT_PRESETS = [
  { label: 'Pre-war', minYear: null, maxYear: 1940 },
  { label: 'Post-war', minYear: 1940, maxYear: 1970 },
  { label: 'Modern', minYear: 1970, maxYear: 2000 },
  { label: 'New', minYear: 2000, maxYear: null },
];

const YEAR_BUILT_MIN = 1800;
const YEAR_BUILT_MAX = new Date().getFullYear();

const SQFT_PRESETS = [
  { label: 'Studio', minSqft: null, maxSqft: 500 },
  { label: 'Small', minSqft: 500, maxSqft: 750 },
  { label: 'Medium', minSqft: 750, maxSqft: 1000 },
  { label: 'Large', minSqft: 1000, maxSqft: 1500 },
  { label: 'XL', minSqft: 1500, maxSqft: null },
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
          {formatSliderPrice(max)}+
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chip label helpers
// ---------------------------------------------------------------------------

function priceLabel(minRent: number | null, maxRent: number | null, priceMode?: 'total' | 'perRoom'): string {
  const suffix = priceMode === 'perRoom' ? '/rm' : '';
  if (minRent === null && maxRent === null) return priceMode === 'perRoom' ? 'Price/Room' : 'Price';
  if (priceMode === 'perRoom') {
    if (minRent !== null && maxRent !== null) {
      return `$${minRent.toLocaleString()}\u2013$${maxRent.toLocaleString()}${suffix}`;
    }
    if (maxRent !== null) return `Under $${maxRent.toLocaleString()}${suffix}`;
    return `$${minRent!.toLocaleString()}+${suffix}`;
  }
  if (minRent !== null && maxRent !== null) {
    return `$${(minRent / 1000).toFixed(minRent % 1000 === 0 ? 0 : 1)}K\u2013$${(maxRent / 1000).toFixed(maxRent % 1000 === 0 ? 0 : 1)}K`;
  }
  if (maxRent !== null) {
    return `Under $${(maxRent / 1000).toFixed(maxRent % 1000 === 0 ? 0 : 1)}K`;
  }
  return `$${(minRent! / 1000).toFixed(minRent! % 1000 === 0 ? 0 : 1)}K+`;
}

function bedsBathsLabel(selectedBeds: number[] | null, minBaths: number | null): string {
  const parts: string[] = [];
  if (selectedBeds !== null && selectedBeds.length > 0) {
    const labels = selectedBeds
      .slice()
      .sort((a, b) => a - b)
      .map((b) => (b === 0 ? 'Studio' : b === 7 ? '7+' : String(b)));
    parts.push(`${labels.join(', ')} Beds`);
  }
  if (minBaths !== null) parts.push(`${minBaths}+ Baths`);
  return parts.length > 0 ? parts.join(', ') : 'Beds / Baths';
}

function yearBuiltLabel(minYearBuilt: number | null, maxYearBuilt: number | null): string {
  if (minYearBuilt === null && maxYearBuilt === null) return 'Year Built';
  const parts: string[] = [];
  if (minYearBuilt !== null) parts.push(`${minYearBuilt}+`);
  if (maxYearBuilt !== null) parts.push(`before ${maxYearBuilt}`);
  return parts.join(', ');
}

function formatShortDate(iso: string): string {
  // Parse YYYY-MM-DD as a local date to avoid TZ shifts (avoid `new Date("YYYY-MM-DD")` which is UTC)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function availableDateLabel(
  minAvailableDate: string | null,
  maxAvailableDate: string | null,
): string {
  if (!minAvailableDate && !maxAvailableDate) return 'Move-in Date';
  if (minAvailableDate && maxAvailableDate) {
    return `${formatShortDate(minAvailableDate)} – ${formatShortDate(maxAvailableDate)}`;
  }
  if (maxAvailableDate) return `By ${formatShortDate(maxAvailableDate)}`;
  return `After ${formatShortDate(minAvailableDate!)}`;
}

function sqftLabel(minSqft: number | null, maxSqft: number | null, excludeNoSqft?: boolean): string {
  if (minSqft === null && maxSqft === null) {
    if (excludeNoSqft) return 'Has sqft';
    return 'Sqft';
  }
  if (minSqft !== null && maxSqft !== null) {
    return `${minSqft.toLocaleString()}\u2013${maxSqft.toLocaleString()} sqft`;
  }
  if (maxSqft !== null) return `Under ${maxSqft.toLocaleString()} sqft`;
  return `${minSqft!.toLocaleString()}+ sqft`;
}

// ---------------------------------------------------------------------------
// MTA line colors
// ---------------------------------------------------------------------------

const MTA_COLORS: Record<string, string> = {
  '1': '#ee352e', '2': '#ee352e', '3': '#ee352e',
  '4': '#00933c', '5': '#00933c', '6': '#00933c',
  '7': '#b933ad',
  'A': '#0039a6', 'C': '#0039a6', 'E': '#0039a6',
  'B': '#ff6319', 'D': '#ff6319', 'F': '#ff6319', 'M': '#ff6319',
  'G': '#6cbe45',
  'L': '#a7a9ac',
  'J': '#996633', 'Z': '#996633',
  'N': '#fccc0a', 'Q': '#fccc0a', 'R': '#fccc0a', 'W': '#fccc0a',
  'S': '#808183',
};

const DARK_TEXT_LINES = new Set(['N', 'Q', 'R', 'W']);

const ALL_SUBWAY_LINES = ['1', '2', '3', '4', '5', '6', '7', 'A', 'C', 'E', 'B', 'D', 'F', 'M', 'G', 'L', 'J', 'Z', 'N', 'Q', 'R', 'W', 'S'];

const NYC_PARKS = [
  { name: 'Central Park', borough: 'Manhattan' },
  { name: 'Prospect Park', borough: 'Brooklyn' },
  { name: 'Brooklyn Bridge Park', borough: 'Brooklyn' },
  { name: 'Washington Square Park', borough: 'Manhattan' },
  { name: 'Tompkins Square Park', borough: 'Manhattan' },
  { name: 'McCarren Park', borough: 'Brooklyn' },
  { name: 'Fort Greene Park', borough: 'Brooklyn' },
  { name: 'Domino Park', borough: 'Brooklyn' },
  { name: 'Hudson River Park', borough: 'Manhattan' },
  { name: 'The High Line', borough: 'Manhattan' },
  { name: 'Bryant Park', borough: 'Manhattan' },
  { name: 'Madison Square Park', borough: 'Manhattan' },
];

export function commuteLabel(rules: CommuteRule[]): string {
  if (rules.length === 0) return 'Commute';
  if (rules.length === 1) {
    const r = rules[0];
    if (r.type === 'subway-line' && r.lines && r.lines.length > 0) {
      const parts = r.lines.map((line) => {
        const lineStops = r.stops?.filter((s) => {
          const station = SUBWAY_STATIONS.find((st) => st.name === s);
          return station?.lines.includes(line);
        });
        if (lineStops && lineStops.length > 0) {
          const shortNames = lineStops.map((s) => s.replace(/\s*\(.*\)/, '').split(' - ')[0].split('–')[0].trim());
          return `${line} (${shortNames.join(', ')})`;
        }
        return line;
      });
      return parts.join(' · ');
    }
    if (r.type === 'station' && r.stationName) return r.stationName;
    if (r.type === 'address' && r.address) {
      const short = r.address.split(',').slice(0, 2).join(',').trim();
      return short.length > 35 ? short.slice(0, 35) + '…' : short;
    }
    if (r.type === 'park' && r.parkName) return r.parkName;
    return 'Commute';
  }
  return `${rules.length} commute rules`;
}

// ---------------------------------------------------------------------------
// Auto-suggest search name from active filters
// ---------------------------------------------------------------------------

export function suggestSearchName(filters: FiltersState): string {
  const parts: string[] = [];

  // Beds
  if (filters.selectedBeds !== null && filters.selectedBeds.length > 0) {
    const sorted = filters.selectedBeds.slice().sort((a, b) => a - b);
    if (sorted.length === 1) {
      parts.push(`${sorted[0] === 7 ? '7+' : sorted[0]} bed`);
    } else {
      parts.push(`${sorted.map((b) => (b === 7 ? '7+' : String(b))).join('/')} bed`);
    }
  }

  // Price
  if (filters.maxRent !== null) {
    const k = filters.maxRent / 1000;
    parts.push(`Under $${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`);
  } else if (filters.minRent !== null) {
    const k = filters.minRent / 1000;
    parts.push(`$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K+`);
  }

  // Commute
  if (filters.commuteRules && filters.commuteRules.length > 0) {
    const rule = filters.commuteRules[0];
    if (rule.type === 'subway-line' && rule.lines && rule.lines.length > 0) {
      parts.push(rule.lines.join('/') + ' train');
    } else if (rule.type === 'station' && rule.stationName) {
      parts.push(rule.stationName);
    }
  }

  // Sources
  if (filters.selectedSources !== null && filters.selectedSources.length < ALL_SOURCES.length) {
    parts.push(filters.selectedSources.map((s) => SOURCE_LABELS[s as ListingSource] ?? s).join(', '));
  }

  return parts.length > 0 ? parts.join(' \u00B7 ') : 'My Search';
}

let _ruleIdCounter = 0;
function newRuleId(): string {
  return `rule-${Date.now()}-${++_ruleIdCounter}`;
}

export function createDefaultRule(): CommuteRule {
  return {
    id: newRuleId(),
    type: 'address',
    address: '',
    maxMinutes: 30,
    mode: 'walk',
  };
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
    <div className="flex overflow-x-auto -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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

function MultiPillGroup({
  options,
  selected,
  onToggle,
}: {
  options: { value: number | null; label: string }[];
  selected: number[];
  onToggle: (v: number | null) => void;
}) {
  return (
    <div className="flex overflow-x-auto -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {options.map((opt, i) => {
        const position = options.length === 1
          ? 'only' as const
          : i === 0
            ? 'first' as const
            : i === options.length - 1
              ? 'last' as const
              : 'middle' as const;

        const isActive = opt.value === null
          ? selected.length === 0
          : selected.includes(opt.value);

        return (
          <PillButton
            key={opt.label}
            active={isActive}
            position={position}
            onClick={() => onToggle(opt.value)}
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
// Commute Rule Editor
// ---------------------------------------------------------------------------

export const CommuteRuleEditor = memo(function CommuteRuleEditor({
  rule,
  onChange,
  onDelete,
  hideMaxMinutes = false,
}: {
  rule: CommuteRule;
  onChange: (updated: CommuteRule) => void;
  onDelete: () => void;
  /** Hide the "Within X min" slider — used by Set Destination (which doesn't
   *  filter, so a max-minutes value is meaningless there). The mode selector
   *  remains visible so the user can pick a preferred travel mode. */
  hideMaxMinutes?: boolean;
}) {
  const [expandedLine, setExpandedLine] = useState<string | null>(null);

  // Local state for station name (synced on blur/Enter)
  const [localStationName, setLocalStationName] = useState(rule.stationName ?? '');
  useEffect(() => { setLocalStationName(rule.stationName ?? ''); }, [rule.stationName]);

  // Local state for slider — visual feedback while dragging, commits to parent on release
  const [localMaxMinutes, setLocalMaxMinutes] = useState(rule.maxMinutes);
  useEffect(() => { setLocalMaxMinutes(rule.maxMinutes); }, [rule.maxMinutes]);

  // Address input is uncontrolled — browser owns the value to avoid React
  // state resets wiping out mid-type characters.
  const addressInputRef = useRef<HTMLInputElement>(null);

  // Sync external address changes (e.g. suggestion select, search load) to DOM
  useEffect(() => {
    if (addressInputRef.current) {
      addressInputRef.current.value = rule.address ?? '';
    }
  }, [rule.address]);

  // --- Address autocomplete state ---
  const [addressSuggestions, setAddressSuggestions] = useState<NominatimResult[]>([]);
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [showAddressSuggestions, setShowAddressSuggestions] = useState(false);
  const addressAbortRef = useRef<AbortController | null>(null);
  const addressDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addressWrapperRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (addressWrapperRef.current && !addressWrapperRef.current.contains(e.target as Node)) {
        setShowAddressSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAddressInput = useCallback((value: string) => {
    setShowAddressSuggestions(true);

    // Clear previous debounce
    if (addressDebounceRef.current) clearTimeout(addressDebounceRef.current);
    // Abort previous request
    if (addressAbortRef.current) addressAbortRef.current.abort();

    if (!value.trim()) {
      setAddressSuggestions([]);
      setAddressLoading(false);
      setAddressError(null);
      return;
    }

    setAddressLoading(true);
    setAddressError(null);

    addressDebounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      addressAbortRef.current = controller;
      try {
        const results = await fetchNominatimSuggestions(value, controller.signal);
        if (!controller.signal.aborted) {
          setAddressSuggestions(results);
          setAddressLoading(false);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setAddressSuggestions([]);
          setAddressLoading(false);
          setAddressError('Search unavailable');
        }
      }
    }, 300);
  }, []);

  const handleAddressSelect = useCallback((result: NominatimResult) => {
    const displayName = result.display_name;
    if (addressInputRef.current) addressInputRef.current.value = displayName;
    setShowAddressSuggestions(false);
    setAddressSuggestions([]);
    onChange({
      ...rule,
      address: displayName,
      addressLat: parseFloat(result.lat),
      addressLon: parseFloat(result.lon),
    });
  }, [onChange, rule]);

  const stationsForLine = useCallback((line: string) => {
    return SUBWAY_STATIONS.filter((s) => s.lines.includes(line));
  }, []);

  const stopsForExpandedLine = useMemo(() => {
    if (!expandedLine) return [];
    return stationsForLine(expandedLine);
  }, [expandedLine, stationsForLine]);

  const selectedStopsOnLine = useMemo(() => {
    if (!expandedLine || !rule.stops) return new Set<string>();
    const lineStations = stationsForLine(expandedLine);
    const lineStationNames = new Set(lineStations.map((s) => s.name));
    return new Set(rule.stops.filter((s) => lineStationNames.has(s)));
  }, [expandedLine, rule.stops, stationsForLine]);

  const toggleLine = (line: string) => {
    const lines = rule.lines ?? [];
    if (lines.includes(line)) {
      onChange({ ...rule, lines: lines.filter((l) => l !== line) });
      if (expandedLine === line) setExpandedLine(null);
    } else {
      onChange({ ...rule, lines: [...lines, line] });
    }
  };

  const toggleExpandLine = (line: string) => {
    setExpandedLine((prev) => (prev === line ? null : line));
  };

  const toggleStop = (stopName: string) => {
    const stops = rule.stops ?? [];
    if (stops.includes(stopName)) {
      onChange({ ...rule, stops: stops.filter((s) => s !== stopName) });
    } else {
      onChange({ ...rule, stops: [...stops, stopName] });
    }
  };

  const selectAllStops = () => {
    if (!expandedLine) return;
    const lineStations = stationsForLine(expandedLine);
    const lineStationNames = lineStations.map((s) => s.name);
    const currentStops = rule.stops ?? [];
    const allSelected = lineStationNames.every((n) => currentStops.includes(n));
    if (allSelected) {
      // Deselect all stops on this line
      const lineSet = new Set(lineStationNames);
      onChange({ ...rule, stops: currentStops.filter((s) => !lineSet.has(s)) });
    } else {
      // Select all stops on this line
      const existing = new Set(currentStops);
      const merged = [...currentStops, ...lineStationNames.filter((n) => !existing.has(n))];
      onChange({ ...rule, stops: merged });
    }
  };

  const isPark = rule.type === 'park';

  const timePct = ((localMaxMinutes - 1) / 59) * 100;
  const maxSlider = rule.type === 'subway-line' ? 20 : 60;
  const minSlider = 1;
  const sliderPct = ((localMaxMinutes - minSlider) / (maxSlider - minSlider)) * 100;

  return (
    <div
      className="relative rounded-lg border p-2.5 mb-2"
      style={{
        backgroundColor: '#161b22',
        borderColor: '#2d333b',
        borderLeftWidth: isPark ? 3 : 1,
        borderLeftColor: isPark ? '#2ea043' : '#2d333b',
      }}
    >
      {/* Delete button — w-8 h-8 touch target, visual icon stays 20px via text-sm */}
      <button
        onClick={onDelete}
        className="absolute top-0.5 right-0.5 w-8 h-8 rounded flex items-center justify-center text-sm transition-colors cursor-pointer text-[#484f58] bg-transparent hover:text-red-400 hover:bg-red-400/10"
      >
        &times;
      </button>

      {/* Row 1: Type selector + content */}
      <div className="flex items-center gap-2 flex-wrap pr-6">
        <select
          value={rule.type}
          onChange={(e) => {
            const newType = e.target.value as CommuteRule['type'];
            onChange({
              ...rule,
              type: newType,
              lines: newType === 'subway-line' ? [] : undefined,
              stops: newType === 'subway-line' ? [] : undefined,
              stationName: newType === 'station' ? '' : undefined,
              address: newType === 'address' ? '' : undefined,
              addressLat: undefined,
              addressLon: undefined,
              parkName: newType === 'park' ? '' : undefined,
              maxMinutes: newType === 'subway-line' ? 10 : 30,
              mode: newType === 'subway-line' ? 'walk' : rule.mode,
            });
            setExpandedLine(null);
          }}
          className="h-[26px] text-[11px] font-medium rounded-[5px] pl-2 pr-6 cursor-pointer border appearance-none"
          style={{
            color: '#e1e4e8',
            backgroundColor: '#0d1117',
            borderColor: '#2d333b',
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%238b949e'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 8px center',
          }}
        >
          <option value="subway-line">Subway Line</option>
          <option value="address">Address</option>
          <option value="park">Park</option>
        </select>

        {/* Station / Address inline inputs */}
        {rule.type === 'station' && (
          <input
            type="text"
            placeholder="Station name..."
            value={localStationName}
            onChange={(e) => setLocalStationName(e.target.value)}
            onBlur={() => onChange({ ...rule, stationName: localStationName })}
            onKeyDown={(e) => { if (e.key === 'Enter') onChange({ ...rule, stationName: localStationName }); }}
            className="h-[26px] text-[11px] rounded-[5px] px-2 border flex-1 min-w-[120px]"
            style={{ color: '#e1e4e8', backgroundColor: '#0d1117', borderColor: '#2d333b' }}
          />
        )}
        {rule.type === 'address' && (
          <div ref={addressWrapperRef} className="relative flex-1 min-w-[120px]">
            <input
              ref={addressInputRef}
              type="text"
              placeholder="Search address..."
              defaultValue={rule.address ?? ''}
              autoFocus={!rule.address}
              onChange={(e) => handleAddressInput(e.target.value)}
              onFocus={() => { if (addressSuggestions.length > 0 || addressLoading || addressError) setShowAddressSuggestions(true); }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setShowAddressSuggestions(false);
              }}
              className="h-[26px] text-[11px] rounded-[5px] px-2 border w-full"
              style={{ color: '#e1e4e8', backgroundColor: '#0d1117', borderColor: '#2d333b' }}
            />
            {showAddressSuggestions && (rule.type === 'address') && (
              <div
                className="absolute left-0 right-0 top-[28px] z-[9999] rounded-md border shadow-lg overflow-hidden"
                style={{ backgroundColor: '#1c2028', borderColor: '#2d333b' }}
              >
                {addressLoading && (
                  <div className="flex items-center gap-2 px-3 py-2 text-[11px]" style={{ color: '#8b949e' }}>
                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Searching...
                  </div>
                )}
                {addressError && !addressLoading && (
                  <div className="px-3 py-2 text-[11px]" style={{ color: '#f85149' }}>
                    {addressError}
                  </div>
                )}
                {!addressLoading && !addressError && addressSuggestions.length === 0 && showAddressSuggestions && (
                  <div className="px-3 py-2 text-[11px]" style={{ color: '#8b949e' }}>
                    No results found
                  </div>
                )}
                {!addressLoading && addressSuggestions.map((result) => (
                  <button
                    key={result.place_id}
                    type="button"
                    onClick={() => handleAddressSelect(result)}
                    className="w-full text-left px-3 py-1.5 text-[11px] cursor-pointer transition-colors duration-150 hover:bg-[#161b22] flex items-center gap-2"
                    style={{ color: '#e1e4e8' }}
                  >
                    <span className="flex-1 truncate">{result.display_name}</span>
                    <span
                      className="shrink-0 text-[9px] font-medium uppercase rounded px-1.5 py-0.5"
                      style={{ backgroundColor: '#21262d', color: '#8b949e' }}
                    >
                      {result.type}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {rule.type === 'park' && rule.parkName && (
          <span
            className="inline-flex items-center gap-1 rounded text-[11px] font-medium px-2 py-0.5"
            style={{ backgroundColor: '#0d1c14', borderColor: '#1b3325', color: '#7ee787', border: '1px solid #1b3325' }}
          >
            🌳 {rule.parkName}
          </span>
        )}
      </div>

      {/* Subway line pills */}
      {rule.type === 'subway-line' && (
        <div className="flex flex-wrap gap-1 mt-2">
          {ALL_SUBWAY_LINES.map((line) => {
            const selected = rule.lines?.includes(line) ?? false;
            return (
              <button
                key={line}
                onClick={() => toggleLine(line)}
                className="w-[22px] h-[22px] rounded-full text-[10px] font-bold flex items-center justify-center cursor-pointer transition-all relative"
                style={{
                  backgroundColor: MTA_COLORS[line] ?? '#808183',
                  color: DARK_TEXT_LINES.has(line) ? '#333' : '#fff',
                  opacity: selected ? 1 : 0.35,
                  border: selected ? '2px solid #58a6ff' : '2px solid transparent',
                  transform: selected ? 'scale(1.1)' : 'scale(1)',
                }}
              >
                {line}
              </button>
            );
          })}
        </div>
      )}

      {/* Selected line summary tags */}
      {rule.type === 'subway-line' && rule.lines && rule.lines.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2 items-center">
          {rule.lines.map((line) => {
            const lineStations = stationsForLine(line);
            const stopsOnLine = (rule.stops ?? []).filter((s) => lineStations.some((st) => st.name === s));
            const isExpanded = expandedLine === line;
            return (
              <button
                key={line}
                onClick={() => toggleExpandLine(line)}
                className="inline-flex items-center gap-1 rounded text-[10px] font-medium px-2 py-0.5 cursor-pointer transition-all"
                style={{
                  backgroundColor: '#0d1b2a',
                  border: '1px solid #1d3557',
                  color: '#58a6ff',
                }}
              >
                <span
                  className="w-3 h-3 rounded-full text-[7px] font-bold flex items-center justify-center shrink-0"
                  style={{ backgroundColor: MTA_COLORS[line], color: DARK_TEXT_LINES.has(line) ? '#333' : '#fff' }}
                >
                  {line}
                </span>
                <span>{stopsOnLine.length > 0 ? `${stopsOnLine.length} stop${stopsOnLine.length > 1 ? 's' : ''}` : 'all'}</span>
                <span
                  className="text-[7px] ml-0.5 transition-transform"
                  style={{ opacity: 0.6, transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                >
                  &#9662;
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Stop drill-down panel */}
      {rule.type === 'subway-line' && expandedLine && rule.lines?.includes(expandedLine) && (
        <div className="mt-2 rounded-md border overflow-hidden" style={{ backgroundColor: '#0d1117', borderColor: '#2d333b' }}>
          <div className="flex items-center justify-between px-2.5 py-2" style={{ borderBottom: '1px solid #2d333b' }}>
            <div className="flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: '#c9d1d9' }}>
              <span
                className="w-3.5 h-3.5 rounded-full text-[8px] font-bold flex items-center justify-center"
                style={{ backgroundColor: MTA_COLORS[expandedLine], color: DARK_TEXT_LINES.has(expandedLine) ? '#333' : '#fff' }}
              >
                {expandedLine}
              </span>
              {expandedLine} train stops
            </div>
            <button
              onClick={selectAllStops}
              className="text-[10px] font-medium px-1.5 py-0.5 rounded cursor-pointer transition-colors text-[#58a6ff] bg-transparent hover:bg-[#58a6ff]/10"
            >
              {stopsForExpandedLine.every((s) => (rule.stops ?? []).includes(s.name)) ? 'Deselect All' : 'Select All'}
            </button>
          </div>
          <div className="max-h-[180px] overflow-y-auto py-1" style={{ scrollbarWidth: 'thin', scrollbarColor: '#2d333b #0d1117' }}>
            {stopsForExpandedLine.map((station) => {
              const isChecked = selectedStopsOnLine.has(station.name);
              return (
                <div
                  key={station.stopId}
                  onClick={() => toggleStop(station.name)}
                  className={cn(
                    'flex items-center gap-2 px-2.5 py-1 cursor-pointer transition-colors text-[11px] hover:bg-[#161b22]',
                    isChecked ? 'text-[#e1e4e8]' : 'text-[#8b949e]',
                  )}
                >
                  <div
                    className="w-3.5 h-3.5 rounded-[3px] flex items-center justify-center shrink-0 border transition-all"
                    style={{
                      backgroundColor: isChecked ? '#58a6ff' : '#0d1117',
                      borderColor: isChecked ? '#58a6ff' : '#2d333b',
                    }}
                  >
                    {isChecked && (
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1.5 4L3.5 6L6.5 2" />
                      </svg>
                    )}
                  </div>
                  <span className="flex-1">{station.name}</span>
                  {/* Transfer line dots */}
                  <div className="flex gap-0.5">
                    {station.lines.filter((l) => l !== expandedLine).map((l) => (
                      <span
                        key={l}
                        className="w-2.5 h-2.5 rounded-full text-[6px] font-bold flex items-center justify-center"
                        style={{
                          backgroundColor: MTA_COLORS[l],
                          color: DARK_TEXT_LINES.has(l) ? '#333' : '#fff',
                          opacity: 0.5,
                        }}
                      >
                        {l}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between px-2.5 py-1.5 text-[10px]" style={{ borderTop: '1px solid #2d333b', color: '#8b949e' }}>
            <span>
              <span style={{ color: '#58a6ff', fontWeight: 600 }}>{selectedStopsOnLine.size}</span> of {stopsForExpandedLine.length} stops selected
            </span>
          </div>
        </div>
      )}

      {/* Park selection grid */}
      {rule.type === 'park' && (
        <div className="mt-2 rounded-md border overflow-hidden" style={{ backgroundColor: '#0d1117', borderColor: '#2d333b' }}>
          <div className="flex items-center gap-1.5 px-2.5 py-2 text-[10px] font-semibold" style={{ borderBottom: '1px solid #2d333b', color: '#7ee787' }}>
            🌳 Select a park
          </div>
          <div className="max-h-[140px] overflow-y-auto py-1" style={{ scrollbarWidth: 'thin', scrollbarColor: '#2d333b #0d1117' }}>
            {NYC_PARKS.map((park) => {
              const isSelected = rule.parkName === park.name;
              return (
                <div
                  key={park.name}
                  onClick={() => onChange({ ...rule, parkName: park.name })}
                  className={cn(
                    'flex items-center gap-2 px-2.5 py-1.5 cursor-pointer transition-colors text-[11px]',
                    isSelected
                      ? 'text-[#7ee787] bg-[#7ee787]/5'
                      : 'text-[#8b949e] bg-transparent hover:bg-[#161b22]',
                  )}
                >
                  <div
                    className="w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0 border transition-all"
                    style={{
                      backgroundColor: isSelected ? '#2ea043' : '#0d1117',
                      borderColor: isSelected ? '#2ea043' : '#2d333b',
                    }}
                  >
                    {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <span className="flex-1">{park.name}</span>
                  <span className="text-[9px] font-medium" style={{ color: '#484f58' }}>{park.borough}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Time slider + mode toggle */}
      <div className="flex items-center gap-2 mt-2">
        {!hideMaxMinutes && (
          <>
            <span className="text-[11px]" style={{ color: '#8b949e' }}>Within</span>
            <div className="flex-1 relative">
              <input
                type="range"
                min={minSlider}
                max={maxSlider}
                step={1}
                value={localMaxMinutes}
                onChange={(e) => setLocalMaxMinutes(Number(e.target.value))}
                onPointerUp={(e) => onChange({ ...rule, maxMinutes: Number((e.target as HTMLInputElement).value) })}
                onKeyUp={(e) => onChange({ ...rule, maxMinutes: localMaxMinutes })}
                className="range-slider w-full"
                style={{
                  background: `linear-gradient(to right, #58a6ff 0%, #58a6ff ${sliderPct}%, #2d333b ${sliderPct}%, #2d333b 100%)`,
                }}
              />
            </div>
            <span className="text-[11px] font-semibold min-w-[42px] text-right whitespace-nowrap" style={{ color: '#58a6ff' }}>
              {localMaxMinutes} min
            </span>
          </>
        )}
        {hideMaxMinutes && (
          <span className="text-[11px]" style={{ color: '#8b949e' }}>Preferred mode</span>
        )}
        <div
          className={cn(
            'inline-flex rounded-[5px] border overflow-hidden h-7',
            hideMaxMinutes && 'ml-auto',
          )}
          style={{ borderColor: '#2d333b' }}
        >
          {(['walk', 'transit', 'bike'] as const)
            .filter((m) => rule.type === 'subway-line' ? m !== 'transit' : true)
            .map((m) => (
              <button
                key={m}
                onClick={() => {
                  if (rule.type === 'subway-line' && m === 'bike') return;
                  onChange({ ...rule, mode: m });
                }}
                title={rule.type === 'subway-line' && m === 'bike' ? 'Bike isochrones coming soon' : undefined}
                disabled={rule.type === 'subway-line' && m === 'bike'}
                className="text-[10px] font-medium px-2 flex items-center transition-all"
                style={{
                  backgroundColor: rule.mode === m ? '#1d3557' : '#0d1117',
                  color: rule.mode === m ? '#58a6ff' : '#8b949e',
                  borderLeft: m !== 'walk' && !(rule.type === 'subway-line' && m === 'bike') ? '1px solid #2d333b' : 'none',
                  opacity: rule.type === 'subway-line' && m === 'bike' ? 0.4 : 1,
                  cursor: rule.type === 'subway-line' && m === 'bike' ? 'not-allowed' : 'pointer',
                }}
              >
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main Filters component
// ---------------------------------------------------------------------------

const LISTING_AGE_STEPS: { value: MaxListingAge; label: string }[] = [
  { value: '1h', label: '1 Hour' },
  { value: '3h', label: '3 Hours' },
  { value: '6h', label: '6 Hours' },
  { value: '12h', label: '12 Hours' },
  { value: '1d', label: '1 Day' },
  { value: '2d', label: '2 Days' },
  { value: '3d', label: '3 Days' },
  { value: '1w', label: '1 Week' },
  { value: '2w', label: '2 Weeks' },
  { value: '1m', label: '1 Month' },
];

function listingAgeLabel(maxAge: MaxListingAge): string {
  if (maxAge === null) return 'Listed within';
  const opt = LISTING_AGE_STEPS.find((o) => o.value === maxAge);
  return `Within ${opt?.label ?? maxAge}`;
}

function listingAgeSliderIndex(maxAge: MaxListingAge): number {
  if (maxAge === null) return 0;
  const idx = LISTING_AGE_STEPS.findIndex((o) => o.value === maxAge);
  return idx >= 0 ? idx : 0;
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
  const currentLabel = value !== null ? LISTING_AGE_STEPS[index].label : null;

  return (
    <div className="mb-4">
      <div className="flex items-center justify-end mb-2">
        <span className="text-sm font-bold" style={{ color: '#58a6ff' }}>
          {currentLabel ?? 'No limit'}
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
          1 Hour
        </span>
        <span className="text-[10px]" style={{ color: '#8b949e' }}>
          1 Month
        </span>
      </div>
    </div>
  );
}

type ChipId = 'price' | 'bedsBaths' | 'listingAge' | 'availableDate' | 'source' | 'commute' | 'yearBuilt' | 'sqft';

// ---------------------------------------------------------------------------
// Active filter count helper
// ---------------------------------------------------------------------------

function countActiveFilters(filters: FiltersState): number {
  let count = 0;
  if (filters.selectedBeds !== null) count++;
  if (filters.minBaths !== null) count++;
  if (filters.minRent !== null) count++;
  if (filters.maxRent !== null) count++;
  if (filters.maxListingAge !== null) count++;
  if (filters.minAvailableDate !== null || filters.maxAvailableDate !== null) count++;
  if (filters.photosFirst) count++;
  if (filters.selectedSources !== null) count++;
  if (filters.minYearBuilt !== null || filters.maxYearBuilt !== null) count++;
  if (filters.minSqft !== null || filters.maxSqft !== null) count++;
  if (filters.excludeNoSqft) count++;
  if (filters.commuteRules && filters.commuteRules.length > 0) count++;
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

const Filters = memo(forwardRef<FiltersHandle, FiltersProps>(function Filters({ filters, onChange, listingCount, viewToggle, destinationSlot, userId, savedSearches, onSaveSearch, onDeleteSearch, onLoadSearch, onUpdateSearch, onUpdateSearchFilters, onLoginRequired, showHidden, onToggleShowHidden, showDelisted, onToggleShowDelisted, delistedCount = 0, myWishlists = [], sharedWishlists = [], selectedWishlist = null, onSelectWishlist, onCreateWishlist, onOpenWishlistManager }, ref) {
  const [openChip, setOpenChip] = useState<ChipId | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(true);

  // Draft state for dropdowns — only applied on "Done"
  const [draftMinRent, setDraftMinRent] = useState<number | null>(filters.minRent);
  const [draftMaxRent, setDraftMaxRent] = useState<number | null>(filters.maxRent);
  const [draftPriceMode, setDraftPriceMode] = useState<'total' | 'perRoom'>(filters.priceMode);
  const [draftSelectedBeds, setDraftSelectedBeds] = useState<number[]>(filters.selectedBeds ?? []);
  const [draftMinBaths, setDraftMinBaths] = useState<number | null>(filters.minBaths);
  const [draftIncludeNaBaths, setDraftIncludeNaBaths] = useState<boolean>(filters.includeNaBaths);
  const [draftMaxListingAge, setDraftMaxListingAge] = useState<MaxListingAge>(
    filters.maxListingAge,
  );
  const [draftSources, setDraftSources] = useState<string[] | null>(filters.selectedSources);
  const [draftCommuteRules, setDraftCommuteRules] = useState<CommuteRule[]>(filters.commuteRules ?? []);
  const [draftMinYearBuilt, setDraftMinYearBuilt] = useState<number | null>(filters.minYearBuilt);
  const [draftMaxYearBuilt, setDraftMaxYearBuilt] = useState<number | null>(filters.maxYearBuilt);
  const [draftMinSqft, setDraftMinSqft] = useState<number | null>(filters.minSqft);
  const [draftMaxSqft, setDraftMaxSqft] = useState<number | null>(filters.maxSqft);
  const [draftExcludeNoSqft, setDraftExcludeNoSqft] = useState<boolean>(filters.excludeNoSqft);
  const [draftMinAvailableDate, setDraftMinAvailableDate] = useState<string | null>(filters.minAvailableDate);
  const [draftMaxAvailableDate, setDraftMaxAvailableDate] = useState<string | null>(filters.maxAvailableDate);
  const [draftIncludeNaAvailableDate, setDraftIncludeNaAvailableDate] = useState<boolean>(filters.includeNaAvailableDate);

  // Mobile filter bottom sheet state
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  // Drag-to-dismiss translate for the mobile sheet. Starts at 0 (fully open).
  // While the user drags the header/handle downward, this tracks finger Y
  // delta. On release past threshold, closes the sheet; otherwise snaps
  // back to 0 via CSS transition.
  const [mobileSheetDragY, setMobileSheetDragY] = useState(0);
  const mobileSheetDragActiveRef = useRef(false);
  const mobileSheetDragStartYRef = useRef(0);
  const mobileSheetDragStartTimeRef = useRef(0);
  // Fade the backdrop proportional to drag progress so the user sees the
  // dismiss happening live.
  const MOBILE_SHEET_DISMISS_DISTANCE_PX = 80;
  const MOBILE_SHEET_DISMISS_VELOCITY_PX_PER_MS = 0.5;

  const handleMobileSheetPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Only left mouse / primary touch. Ignore multi-touch, etc.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    mobileSheetDragActiveRef.current = true;
    mobileSheetDragStartYRef.current = e.clientY;
    mobileSheetDragStartTimeRef.current = performance.now();
    // Capture the pointer so we keep receiving move/up even if the finger
    // slides outside the header element.
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
  }, []);

  const handleMobileSheetPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!mobileSheetDragActiveRef.current) return;
    const dy = e.clientY - mobileSheetDragStartYRef.current;
    // Clamp to >=0 so the sheet can only move DOWN, never up above its
    // resting position.
    setMobileSheetDragY(Math.max(0, dy));
  }, []);

  const handleMobileSheetPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!mobileSheetDragActiveRef.current) return;
    mobileSheetDragActiveRef.current = false;
    const dy = Math.max(0, e.clientY - mobileSheetDragStartYRef.current);
    const elapsed = Math.max(1, performance.now() - mobileSheetDragStartTimeRef.current);
    const velocity = dy / elapsed;
    const shouldClose =
      dy >= MOBILE_SHEET_DISMISS_DISTANCE_PX ||
      (dy > 20 && velocity >= MOBILE_SHEET_DISMISS_VELOCITY_PX_PER_MS);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
    if (shouldClose) {
      // Animate to off-screen via the snapback transition and then unmount.
      // Using a large offset here so the slide-down is visible; transition
      // duration on the sheet's style provides the animation.
      setMobileSheetDragY(800);
      window.setTimeout(() => {
        setMobileSheetOpen(false);
        setMobileSheetDragY(0);
      }, 220);
    } else {
      // Snap back
      setMobileSheetDragY(0);
    }
  }, []);

  // Expose imperative openMobileSheet() so ancestors (e.g. the SwipeView
  // floating Filters pill via page.tsx) can open this single source-of-truth
  // bottom sheet directly — no nested drawer.
  useImperativeHandle(ref, () => ({
    openMobileSheet: () => setMobileSheetOpen(true),
  }), []);

  // Save search dropdown state
  const [saveOpen, setSaveOpen] = useState(false);
  const [savePanelTab, setSavePanelTab] = useState<'save-search' | 'wishlist'>('save-search');
  // Sticky-footer "Save current search as…" inline expansion state.
  const [stickySaveExpanded, setStickySaveExpanded] = useState(false);
  const stickySaveInputRef = useRef<HTMLInputElement>(null);
  const [saveName, setSaveName] = useState('');
  const [saveToastVisible, setSaveToastVisible] = useState(false);
  const saveToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clusterDropdownRef = useRef<HTMLDivElement>(null);
  const saveInputRef = useRef<HTMLInputElement>(null);

  // Saved search tabs state
  const [activeSearchId, setActiveSearchId] = useState<number | null>(null);
  const [editingSearchId, setEditingSearchId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  // === Edit-saved-search flow (Option C) ===
  // When the user taps the pencil in the mobile filter sheet's saved-search
  // list, we enter "edit mode": the search's filter snapshot is loaded into
  // the live filters, a banner appears, and a sticky bottom bar surfaces
  // Save changes / Save as new actions when the user mutates anything.
  const [editingFiltersSearchId, setEditingFiltersSearchId] = useState<number | null>(null);
  const [editingFiltersName, setEditingFiltersName] = useState<string>('');
  // Original filter snapshot at the moment edit mode started — used both to
  // diff for the "N changes" counter and to revert on Cancel. We compare via
  // JSON.stringify since FiltersState is plain data (no Dates/functions).
  const [editingFiltersSnapshot, setEditingFiltersSnapshot] = useState<FiltersState | null>(null);
  // Inline rename prompt for "Save as new" — when set, we render a small
  // input above the sticky bar to capture the new search's name.
  const [saveAsNewOpen, setSaveAsNewOpen] = useState(false);
  const [saveAsNewName, setSaveAsNewName] = useState('');
  const saveAsNewInputRef = useRef<HTMLInputElement>(null);

  // Stable JSON of the snapshot for cheap diffing inside render.
  const editingSnapshotJson = editingFiltersSnapshot ? JSON.stringify(editingFiltersSnapshot) : null;
  const currentFiltersJson = JSON.stringify(filters);
  const editingChangedCount = (() => {
    if (!editingFiltersSnapshot) return 0;
    if (editingSnapshotJson === currentFiltersJson) return 0;
    // Per-key diff so the banner can show a meaningful change count rather
    // than a binary 0/1 "something changed". Each top-level FiltersState key
    // counts as one change when its serialized form differs.
    let n = 0;
    for (const k of Object.keys(filters) as (keyof FiltersState)[]) {
      if (JSON.stringify(filters[k]) !== JSON.stringify(editingFiltersSnapshot[k])) n++;
    }
    return n;
  })();

  const enterEditMode = useCallback((s: SavedSearchEntry) => {
    // Snapshot the SAVED search's filters as the baseline — we want both
    // the diff (for the change counter) and the cancel-revert to compare
    // against the persisted snapshot, not whatever transient filters
    // happened to be active when the user tapped the pencil.
    const saved = s.filters as unknown as FiltersState;
    setEditingFiltersSearchId(s.id);
    setEditingFiltersName(s.name);
    setEditingFiltersSnapshot(saved);
    onLoadSearch?.(saved);
    setActiveSearchId(s.id);
  }, [onLoadSearch]);

  // When the mobile filter sheet closes mid-edit, revert any in-progress
  // changes so the user doesn't see stale filters bleed onto the map.
  useEffect(() => {
    if (!mobileSheetOpen && editingFiltersSearchId !== null) {
      if (editingFiltersSnapshot) {
        onLoadSearch?.(editingFiltersSnapshot);
      }
      setEditingFiltersSearchId(null);
      setEditingFiltersName('');
      setEditingFiltersSnapshot(null);
      setSaveAsNewOpen(false);
      setSaveAsNewName('');
    }
  }, [mobileSheetOpen, editingFiltersSearchId, editingFiltersSnapshot, onLoadSearch]);

  const exitEditMode = useCallback((revert: boolean) => {
    if (revert && editingFiltersSnapshot) {
      onLoadSearch?.(editingFiltersSnapshot);
    }
    setEditingFiltersSearchId(null);
    setEditingFiltersName('');
    setEditingFiltersSnapshot(null);
    setSaveAsNewOpen(false);
    setSaveAsNewName('');
  }, [editingFiltersSnapshot, onLoadSearch]);

  // Sync all drafts from committed filters when no dropdown is open
  useEffect(() => {
    if (openChip !== null) return;
    setDraftMinRent(filters.minRent);
    setDraftMaxRent(filters.maxRent);
    setDraftPriceMode(filters.priceMode);
    setDraftSelectedBeds(filters.selectedBeds ?? []);
    setDraftMinBaths(filters.minBaths);
    setDraftIncludeNaBaths(filters.includeNaBaths);
    setDraftMaxListingAge(filters.maxListingAge);
    setDraftSources(filters.selectedSources);
    setDraftCommuteRules(filters.commuteRules ?? []);
    setDraftMinYearBuilt(filters.minYearBuilt);
    setDraftMaxYearBuilt(filters.maxYearBuilt);
    setDraftMinSqft(filters.minSqft);
    setDraftMaxSqft(filters.maxSqft);
    setDraftExcludeNoSqft(filters.excludeNoSqft);
    setDraftMinAvailableDate(filters.minAvailableDate);
    setDraftMaxAvailableDate(filters.maxAvailableDate);
    setDraftIncludeNaAvailableDate(filters.includeNaAvailableDate);
  }, [openChip, filters.minRent, filters.maxRent, filters.priceMode, filters.selectedBeds, filters.minBaths, filters.includeNaBaths, filters.maxListingAge, filters.selectedSources, filters.commuteRules, filters.minYearBuilt, filters.maxYearBuilt, filters.minSqft, filters.maxSqft, filters.excludeNoSqft, filters.minAvailableDate, filters.maxAvailableDate, filters.includeNaAvailableDate]);

  // Click-outside handler — discard drafts. We don't close `saveOpen` here
  // because the SaveWishlistPanel renders in a fixed-position element outside
  // the containerRef and has its own outside-click handler that understands
  // that geometry.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      // Treat clicks inside a portaled FilterChip dropdown or the portaled
      // SaveWishlistPanel as "inside" — both live outside containerRef
      // because they're portaled to document.body so they can escape the
      // mobile sheet's transform context.
      if (
        target instanceof Element &&
        target.closest('[data-filter-chip-dropdown], [data-save-wishlist-panel]')
      ) {
        return;
      }
      if (containerRef.current && !containerRef.current.contains(target)) {
        setOpenChip(null);
        setSortOpen(false);
        setEditingSearchId(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function toggleChip(chip: ChipId) {
    setOpenChip((prev) => {
      if (prev === chip) return null;
      // Reset drafts for the opening chip synchronously (avoids double-render from useEffect)
      if (chip === 'price') {
        setDraftMinRent(filters.minRent);
        setDraftMaxRent(filters.maxRent);
        setDraftPriceMode(filters.priceMode);
      } else if (chip === 'bedsBaths') {
        setDraftSelectedBeds(filters.selectedBeds ?? []);
        setDraftMinBaths(filters.minBaths);
        setDraftIncludeNaBaths(filters.includeNaBaths);
      } else if (chip === 'listingAge') {
        setDraftMaxListingAge(filters.maxListingAge);
      } else if (chip === 'source') {
        setDraftSources(filters.selectedSources);
      } else if (chip === 'commute') {
        setDraftCommuteRules(filters.commuteRules ?? []);
      } else if (chip === 'yearBuilt') {
        setDraftMinYearBuilt(filters.minYearBuilt);
        setDraftMaxYearBuilt(filters.maxYearBuilt);
      } else if (chip === 'sqft') {
        setDraftMinSqft(filters.minSqft);
        setDraftMaxSqft(filters.maxSqft);
        setDraftExcludeNoSqft(filters.excludeNoSqft);
      } else if (chip === 'availableDate') {
        setDraftMinAvailableDate(filters.minAvailableDate);
        setDraftMaxAvailableDate(filters.maxAvailableDate);
        setDraftIncludeNaAvailableDate(filters.includeNaAvailableDate);
      }
      return chip;
    });
    setSortOpen(false);
  }

  const sortLabel = SORT_OPTIONS.find((o) => o.value === filters.sort)?.label ?? 'PRICE/BEDROOM';
  const activeCount = countActiveFilters(filters);

  const expandedRowRef = useRef<HTMLDivElement>(null);


  const filterChipsContent = (
    <>
        {/* Price chip */}
        <FilterChip
          compact
          label={priceLabel(filters.minRent, filters.maxRent, filters.priceMode)}
          active={filters.minRent !== null || filters.maxRent !== null}
          open={openChip === 'price'}
          onToggle={() => toggleChip('price')}
        >
          <SectionTitle>Price</SectionTitle>
          <div className="flex rounded-lg p-0.5 mb-3" style={{ backgroundColor: '#0d1117' }}>
            <button
              className="flex-1 text-xs font-medium py-1.5 rounded-md transition-colors"
              style={{
                backgroundColor: draftPriceMode === 'total' ? '#58a6ff' : 'transparent',
                color: draftPriceMode === 'total' ? '#ffffff' : '#8b949e',
              }}
              onClick={() => {
                setDraftPriceMode('total');
                setDraftMinRent(null);
                setDraftMaxRent(null);
              }}
            >
              Total
            </button>
            <button
              className="flex-1 text-xs font-medium py-1.5 rounded-md transition-colors"
              style={{
                backgroundColor: draftPriceMode === 'perRoom' ? '#58a6ff' : 'transparent',
                color: draftPriceMode === 'perRoom' ? '#ffffff' : '#8b949e',
              }}
              onClick={() => {
                setDraftPriceMode('perRoom');
                setDraftMinRent(null);
                setDraftMaxRent(null);
              }}
            >
              Per Room
            </button>
          </div>
          <RangeSlider
            label={draftPriceMode === 'total' ? 'Min Price' : 'Min / Room'}
            min={draftPriceMode === 'total' ? PRICE_SLIDER_MIN : PRICE_PER_ROOM_MIN}
            max={draftPriceMode === 'total' ? PRICE_SLIDER_MAX : PRICE_PER_ROOM_MAX}
            step={draftPriceMode === 'total' ? PRICE_SLIDER_STEP : PRICE_PER_ROOM_STEP}
            value={draftMinRent ?? (draftPriceMode === 'total' ? PRICE_SLIDER_MIN : PRICE_PER_ROOM_MIN)}
            onChange={(v) => setDraftMinRent(v === (draftPriceMode === 'total' ? PRICE_SLIDER_MIN : PRICE_PER_ROOM_MIN) ? null : v)}
          />
          <RangeSlider
            label={draftPriceMode === 'total' ? 'Max Price' : 'Max / Room'}
            min={draftPriceMode === 'total' ? PRICE_SLIDER_MIN : PRICE_PER_ROOM_MIN}
            max={draftPriceMode === 'total' ? PRICE_SLIDER_MAX : PRICE_PER_ROOM_MAX}
            step={draftPriceMode === 'total' ? PRICE_SLIDER_STEP : PRICE_PER_ROOM_STEP}
            value={draftMaxRent ?? (draftPriceMode === 'total' ? PRICE_SLIDER_MAX : PRICE_PER_ROOM_MAX)}
            onChange={(v) => setDraftMaxRent(v === (draftPriceMode === 'total' ? PRICE_SLIDER_MAX : PRICE_PER_ROOM_MAX) ? null : v)}
          />
          <DropdownFooter
            onReset={() => {
              onChange({ ...filters, minRent: null, maxRent: null, priceMode: 'total' });
              setOpenChip(null);
            }}
            onDone={() => {
              onChange({ ...filters, minRent: draftMinRent, maxRent: draftMaxRent, priceMode: draftPriceMode });
              setOpenChip(null);
            }}
          />
        </FilterChip>
    
        {/* Beds / Baths chip */}
        <FilterChip
          compact
          label={bedsBathsLabel(filters.selectedBeds, filters.minBaths)}
          active={filters.selectedBeds !== null || filters.minBaths !== null}
          open={openChip === 'bedsBaths'}
          onToggle={() => toggleChip('bedsBaths')}
        >
          <SectionTitle>Bedrooms</SectionTitle>
          <MultiPillGroup
            options={BEDROOM_OPTIONS}
            selected={draftSelectedBeds}
            onToggle={(v) => {
              if (v === null) {
                // "Any" clears all selections
                setDraftSelectedBeds([]);
              } else {
                setDraftSelectedBeds((prev) =>
                  prev.includes(v) ? prev.filter((b) => b !== v) : [...prev, v],
                );
              }
            }}
          />
    
          <div className="mt-5">
            <SectionTitle>Bathrooms</SectionTitle>
            <PillGroup
              options={BATHROOM_OPTIONS}
              value={draftMinBaths}
              onSelect={setDraftMinBaths}
            />
            {draftMinBaths !== null && (
              <>
                <label className="flex items-center gap-2 cursor-pointer mt-2">
                  <input
                    type="checkbox"
                    checked={draftIncludeNaBaths}
                    onChange={(e) => setDraftIncludeNaBaths(e.target.checked)}
                    className="accent-[#58a6ff] w-4 h-4 rounded cursor-pointer"
                  />
                  <span className="text-sm" style={{ color: '#8b949e' }}>Include N/A</span>
                </label>
                <p className="text-xs mt-1 ml-6" style={{ color: '#6e7681', fontStyle: 'italic' }}>
                  Some listings on Craigslist or Marketplace may not have bathroom data
                </p>
              </>
            )}
          </div>
    
          <DropdownFooter
            onReset={() => {
              onChange({ ...filters, selectedBeds: null, minBaths: null, includeNaBaths: false });
              setOpenChip(null);
            }}
            onDone={() => {
              onChange({
                ...filters,
                selectedBeds: draftSelectedBeds.length > 0 ? draftSelectedBeds : null,
                minBaths: draftMinBaths,
                includeNaBaths: draftIncludeNaBaths,
              });
              setOpenChip(null);
            }}
          />
        </FilterChip>
    
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
              onChange({ ...filters, maxListingAge: null });
              setOpenChip(null);
            }}
            onDone={() => {
              onChange({ ...filters, maxListingAge: draftMaxListingAge });
              setOpenChip(null);
            }}
          />
        </FilterChip>

        {/* Move-in Date chip */}
        <FilterChip
          compact
          label={availableDateLabel(filters.minAvailableDate, filters.maxAvailableDate)}
          active={filters.minAvailableDate !== null || filters.maxAvailableDate !== null}
          open={openChip === 'availableDate'}
          onToggle={() => toggleChip('availableDate')}
        >
          <SectionTitle>Move-in Date</SectionTitle>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#8b949e' }}>
                From
              </label>
              <input
                type="date"
                value={draftMinAvailableDate ?? ''}
                onChange={(e) => setDraftMinAvailableDate(e.target.value || null)}
                onClick={(e) => {
                  try { e.currentTarget.showPicker?.(); } catch {}
                }}
                className="w-full h-8 rounded px-2 text-sm border cursor-pointer"
                style={{
                  backgroundColor: '#0d1117',
                  color: '#e1e4e8',
                  borderColor: '#2d333b',
                  colorScheme: 'dark',
                }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#8b949e' }}>
                To
              </label>
              <input
                type="date"
                value={draftMaxAvailableDate ?? ''}
                onChange={(e) => setDraftMaxAvailableDate(e.target.value || null)}
                onClick={(e) => {
                  try { e.currentTarget.showPicker?.(); } catch {}
                }}
                className="w-full h-8 rounded px-2 text-sm border cursor-pointer"
                style={{
                  backgroundColor: '#0d1117',
                  color: '#e1e4e8',
                  borderColor: '#2d333b',
                  colorScheme: 'dark',
                }}
              />
            </div>
          </div>
          {(draftMinAvailableDate !== null || draftMaxAvailableDate !== null) && (
            <>
              <label className="flex items-center gap-2 cursor-pointer mt-1">
                <input
                  type="checkbox"
                  checked={draftIncludeNaAvailableDate}
                  onChange={(e) => setDraftIncludeNaAvailableDate(e.target.checked)}
                  className="accent-[#58a6ff] w-4 h-4 rounded cursor-pointer"
                />
                <span className="text-sm" style={{ color: '#8b949e' }}>Include N/A</span>
              </label>
              <p className="text-xs mt-1 ml-6" style={{ color: '#6e7681', fontStyle: 'italic' }}>
                Some listings on Craigslist or Marketplace may not have a move-in date
              </p>
            </>
          )}
          <DropdownFooter
            onReset={() => {
              onChange({ ...filters, minAvailableDate: null, maxAvailableDate: null, includeNaAvailableDate: false });
              setOpenChip(null);
            }}
            onDone={() => {
              onChange({
                ...filters,
                minAvailableDate: draftMinAvailableDate,
                maxAvailableDate: draftMaxAvailableDate,
                includeNaAvailableDate: draftIncludeNaAvailableDate,
              });
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
    
        {/* Year Built chip */}
        <FilterChip
          compact
          label={yearBuiltLabel(filters.minYearBuilt, filters.maxYearBuilt)}
          active={filters.minYearBuilt !== null || filters.maxYearBuilt !== null}
          open={openChip === 'yearBuilt'}
          onToggle={() => toggleChip('yearBuilt')}
        >
          <SectionTitle>Year Built Presets</SectionTitle>
          <div className="flex flex-col gap-2 mb-4">
            {YEAR_BUILT_PRESETS.map((preset) => (
              <button
                key={preset.label}
                onClick={() => {
                  setDraftMinYearBuilt(preset.minYear);
                  setDraftMaxYearBuilt(preset.maxYear);
                }}
                className={cn(
                  'px-3 py-2 rounded-md text-sm text-left transition-colors cursor-pointer border',
                  draftMinYearBuilt === preset.minYear && draftMaxYearBuilt === preset.maxYear
                    ? 'bg-[#58a6ff]/10 border-[#58a6ff] text-[#58a6ff]'
                    : 'bg-transparent border-[#2d333b] text-[#8b949e] hover:bg-[#58a6ff]/5 hover:border-[#58a6ff]/30',
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
    
          <SectionTitle>Custom Range</SectionTitle>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#8b949e' }}>
                Min Year
              </label>
              <input
                type="number"
                value={draftMinYearBuilt ?? ''}
                onChange={(e) => {
                  const val = e.target.value ? parseInt(e.target.value, 10) : null;
                  setDraftMinYearBuilt(val && val >= YEAR_BUILT_MIN ? val : null);
                }}
                placeholder="1800"
                min={YEAR_BUILT_MIN}
                max={YEAR_BUILT_MAX}
                className="w-full h-8 rounded px-2 text-sm border"
                style={{
                  backgroundColor: '#0d1117',
                  color: '#e1e4e8',
                  borderColor: '#2d333b',
                }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#8b949e' }}>
                Max Year
              </label>
              <input
                type="number"
                value={draftMaxYearBuilt ?? ''}
                onChange={(e) => {
                  const val = e.target.value ? parseInt(e.target.value, 10) : null;
                  setDraftMaxYearBuilt(val && val <= YEAR_BUILT_MAX ? val : null);
                }}
                placeholder={String(YEAR_BUILT_MAX)}
                min={YEAR_BUILT_MIN}
                max={YEAR_BUILT_MAX}
                className="w-full h-8 rounded px-2 text-sm border"
                style={{
                  backgroundColor: '#0d1117',
                  color: '#e1e4e8',
                  borderColor: '#2d333b',
                }}
              />
            </div>
          </div>
    
          <DropdownFooter
            onReset={() => {
              onChange({ ...filters, minYearBuilt: null, maxYearBuilt: null });
              setOpenChip(null);
            }}
            onDone={() => {
              onChange({ ...filters, minYearBuilt: draftMinYearBuilt, maxYearBuilt: draftMaxYearBuilt });
              setOpenChip(null);
            }}
          />
        </FilterChip>
    
        {/* Sqft chip */}
        <FilterChip
          compact
          label={sqftLabel(filters.minSqft, filters.maxSqft, filters.excludeNoSqft)}
          active={filters.minSqft !== null || filters.maxSqft !== null || filters.excludeNoSqft}
          open={openChip === 'sqft'}
          onToggle={() => toggleChip('sqft')}
        >
          <SectionTitle>Size Presets</SectionTitle>
          <div className="flex flex-col gap-2 mb-4">
            {SQFT_PRESETS.map((preset) => (
              <button
                key={preset.label}
                onClick={() => {
                  setDraftMinSqft(preset.minSqft);
                  setDraftMaxSqft(preset.maxSqft);
                }}
                className={cn(
                  'px-3 py-2 rounded-md text-sm text-left transition-colors cursor-pointer border',
                  draftMinSqft === preset.minSqft && draftMaxSqft === preset.maxSqft
                    ? 'bg-[#58a6ff]/10 border-[#58a6ff] text-[#58a6ff]'
                    : 'bg-transparent border-[#2d333b] text-[#8b949e] hover:bg-[#58a6ff]/5 hover:border-[#58a6ff]/30',
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
    
          <SectionTitle>Custom Range</SectionTitle>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#8b949e' }}>
                Min Sqft
              </label>
              <input
                type="number"
                value={draftMinSqft ?? ''}
                onChange={(e) => {
                  const val = e.target.value ? parseInt(e.target.value, 10) : null;
                  setDraftMinSqft(val && val > 0 ? val : null);
                }}
                placeholder="0"
                min={0}
                className="w-full h-8 rounded px-2 text-sm border"
                style={{
                  backgroundColor: '#0d1117',
                  color: '#e1e4e8',
                  borderColor: '#2d333b',
                }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#8b949e' }}>
                Max Sqft
              </label>
              <input
                type="number"
                value={draftMaxSqft ?? ''}
                onChange={(e) => {
                  const val = e.target.value ? parseInt(e.target.value, 10) : null;
                  setDraftMaxSqft(val && val > 0 ? val : null);
                }}
                placeholder="No max"
                min={0}
                className="w-full h-8 rounded px-2 text-sm border"
                style={{
                  backgroundColor: '#0d1117',
                  color: '#e1e4e8',
                  borderColor: '#2d333b',
                }}
              />
            </div>
          </div>
    
          <label className="flex items-center gap-2 cursor-pointer mb-2">
            <input
              type="checkbox"
              checked={draftExcludeNoSqft}
              onChange={(e) => setDraftExcludeNoSqft(e.target.checked)}
              className="accent-[#58a6ff] w-4 h-4 rounded cursor-pointer"
            />
            <span className="text-sm" style={{ color: '#8b949e' }}>Exclude listings without sqft</span>
          </label>
    
          <DropdownFooter
            onReset={() => {
              onChange({ ...filters, minSqft: null, maxSqft: null, excludeNoSqft: false });
              setOpenChip(null);
            }}
            onDone={() => {
              onChange({ ...filters, minSqft: draftMinSqft, maxSqft: draftMaxSqft, excludeNoSqft: draftExcludeNoSqft });
              setOpenChip(null);
            }}
          />
        </FilterChip>
    
        {/* Commute chip */}
        <FilterChip
          compact
          label={commuteLabel(filters.commuteRules ?? [])}
          active={(filters.commuteRules ?? []).length > 0}
          open={openChip === 'commute'}
          onToggle={() => toggleChip('commute')}
          dropdownAlign="right"
          data-testid="commute-chip"
        >
          <div style={{ minWidth: 'min(380px, calc(100vw - 16px))', maxWidth: '440px' }}>
            <div className="flex items-center justify-between mb-3">
              <SectionTitle>Commute Rules</SectionTitle>
            </div>
            {draftCommuteRules.length === 0 ? (
              /* Animated subway train empty state */
              <div className="flex flex-col items-center py-6 gap-4">
                <style>{`
                  @keyframes commuteTrainSlide {
                    from { left: -90px; }
                    to   { left: 50%; transform: translateX(-50%); }
                  }
                  @keyframes commuteTrainBob {
                    0%, 100% { transform: translateX(-50%) translateY(0px); }
                    50%       { transform: translateX(-50%) translateY(-3px); }
                  }
                `}</style>
                <div style={{ position: 'relative', width: 220, height: 80, overflow: 'hidden' }}>
                  {/* Track ties */}
                  <div style={{ position: 'absolute', bottom: 14, left: 0, right: 0, display: 'flex', gap: 14, padding: '0 4px' }}>
                    {Array.from({ length: 14 }).map((_, i) => (
                      <div key={i} style={{ width: 4, height: 8, background: '#2d333b', borderRadius: 1, flexShrink: 0 }} />
                    ))}
                  </div>
                  {/* Track line */}
                  <div style={{ position: 'absolute', bottom: 18, left: 0, right: 0, height: 2, background: '#2d333b', borderRadius: 1 }} />
                  {/* Station dots */}
                  <div style={{ position: 'absolute', bottom: 15, left: 20, width: 6, height: 6, borderRadius: '50%', background: '#2d333b', border: '1.5px solid #3d4450' }} />
                  <div style={{ position: 'absolute', bottom: 15, right: 20, width: 6, height: 6, borderRadius: '50%', background: '#2d333b', border: '1.5px solid #3d4450' }} />
                  {/* Train */}
                  <div style={{
                    position: 'absolute',
                    bottom: 20,
                    animation: 'commuteTrainSlide 1.6s cubic-bezier(0.22, 1, 0.36, 1) 0.3s both, commuteTrainBob 2.4s ease-in-out 2.2s infinite',
                  }}>
                    <svg width="72" height="38" viewBox="0 0 72 38" fill="none">
                      <rect x="2" y="8" width="68" height="26" rx="5" fill="#252d38" stroke="#3d4450" strokeWidth="1.5"/>
                      <path d="M60 8 Q70 8 70 20 Q70 34 60 34" fill="#2d3748" stroke="#3d4450" strokeWidth="1.5"/>
                      <rect x="2" y="8" width="68" height="5" rx="3" fill="#58a6ff" opacity="0.7"/>
                      <rect x="8" y="16" width="10" height="9" rx="2" fill="#1a2535" stroke="#58a6ff" strokeWidth="1" opacity="0.9"/>
                      <rect x="24" y="16" width="10" height="9" rx="2" fill="#1a2535" stroke="#58a6ff" strokeWidth="1" opacity="0.9"/>
                      <rect x="40" y="16" width="10" height="9" rx="2" fill="#1a2535" stroke="#58a6ff" strokeWidth="1" opacity="0.9"/>
                      <rect x="10" y="18" width="2" height="2" rx="1" fill="#58a6ff" opacity="0.5"/>
                      <rect x="26" y="18" width="2" height="2" rx="1" fill="#58a6ff" opacity="0.5"/>
                      <rect x="42" y="18" width="2" height="2" rx="1" fill="#58a6ff" opacity="0.5"/>
                      <circle cx="65" cy="20" r="3" fill="#7ee787" opacity="0.85"/>
                      <circle cx="65" cy="20" r="1.5" fill="#fff" opacity="0.7"/>
                      <circle cx="14" cy="36" r="4" fill="#1c2028" stroke="#3d4450" strokeWidth="1.5"/>
                      <circle cx="14" cy="36" r="1.5" fill="#3d4450"/>
                      <circle cx="36" cy="36" r="4" fill="#1c2028" stroke="#3d4450" strokeWidth="1.5"/>
                      <circle cx="36" cy="36" r="1.5" fill="#3d4450"/>
                      <circle cx="58" cy="36" r="4" fill="#1c2028" stroke="#3d4450" strokeWidth="1.5"/>
                      <circle cx="58" cy="36" r="1.5" fill="#3d4450"/>
                    </svg>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: '#8b949e', textAlign: 'center', lineHeight: 1.5 }}>Where do you commute?</div>
                <button
                  onClick={() => setDraftCommuteRules((prev) => [...prev, createDefaultRule()])}
                  className="inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-150"
                  style={{ padding: '9px 18px', background: 'rgba(88,166,255,0.12)', border: '1px solid rgba(88,166,255,0.3)', borderRadius: 8, color: '#58a6ff', fontSize: 13, fontWeight: 600 }}
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <path d="M6.5 1v11M1 6.5h11" stroke="#58a6ff" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  Add commute filter
                </button>
              </div>
            ) : (
              <>
                <div className="overflow-y-auto dark-scrollbar" style={{ maxHeight: 'min(400px, calc(100vh - 280px))', scrollbarWidth: 'thin', scrollbarColor: '#2d333b #1c2028' }}>
                  {draftCommuteRules.map((rule, idx) => (
                    <CommuteRuleEditor
                      key={rule.id}
                      rule={rule}
                      onChange={(updated) => {
                        setDraftCommuteRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
                      }}
                      onDelete={() => {
                        setDraftCommuteRules((prev) => prev.filter((r) => r.id !== rule.id));
                      }}
                    />
                  ))}
                </div>
                {draftCommuteRules.length < 10 && (
                  <button
                    onClick={() => setDraftCommuteRules((prev) => [...prev, createDefaultRule()])}
                    className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-[11px] font-medium cursor-pointer transition-all mt-1 mb-1 text-[#58a6ff] bg-transparent border border-dashed border-[#2d333b] hover:border-[#58a6ff] hover:bg-[#58a6ff]/[0.04]"
                  >
                    + Add rule
                  </button>
                )}
              </>
            )}
            {draftCommuteRules.length > 0 && (
              <div
                className="mt-2 mb-1 flex items-start gap-1.5 text-[11px] leading-snug"
                style={{ color: '#8b949e' }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span>Approximate. See each card for the exact transit time.</span>
              </div>
            )}
            <DropdownFooter
              onReset={() => {
                onChange({ ...filters, commuteRules: [] });
                setOpenChip(null);
              }}
              onDone={() => {
                onChange({ ...filters, commuteRules: draftCommuteRules });
                setOpenChip(null);
              }}
            />
          </div>
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
    
        {/* Show hidden toggle chip */}
        {onToggleShowHidden !== undefined && (
          <div className="relative group shrink-0">
            <FilterChip
              compact
              label="Show hidden"
              active={showHidden ?? false}
              open={false}
              onToggle={onToggleShowHidden}
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
                Include listings you&apos;ve hidden
              </div>
            </div>
          </div>
        )}

        {/* Show delisted toggle chip — only visible when a wishlist is
            active AND it contains at least one delisted listing. The
            count reflects the delisted-in-this-wishlist total, regardless
            of toggle state, so the user always sees how many are hidden. */}
        {selectedWishlist != null && delistedCount > 0 && onToggleShowDelisted !== undefined && (
          <div className="relative group shrink-0">
            <FilterChip
              compact
              label={`${showDelisted ? 'Hide' : 'Show'} delisted (${delistedCount})`}
              active={showDelisted ?? false}
              open={false}
              onToggle={onToggleShowDelisted}
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
                Show listings in this wishlist that have been taken down by the source
              </div>
            </div>
          </div>
        )}

        {/* Save + Wishlist chips were removed — replaced by the top-left
            Saved cluster pill (anchored via clusterDropdownRef in the topbar). */}
    </>
  );

  // Save/wishlist panel — rendered ONCE at the Filters root (not inside
  // filterChipsContent which gets inlined into both the desktop top bar AND
  // the mobile bottom sheet). Without this, two copies of the panel would
  // render simultaneously, sharing the same anchor ref.
  const saveWishlistPanelEl = saveOpen ? (
    <SaveWishlistPanel
      anchorRef={clusterDropdownRef}
      initialTab={savePanelTab}
      onClose={() => { setSaveOpen(false); setStickySaveExpanded(false); }}
      myWishlists={myWishlists}
      sharedWishlists={sharedWishlists}
      selected={selectedWishlist}
      onSelect={(sel) => {
        onSelectWishlist?.(sel);
        setSaveOpen(false);
      }}
      onCreateWishlist={async (name) => {
        const id = await onCreateWishlist?.(name);
        return id ?? null;
      }}
      onOpenManager={() => {
        setSaveOpen(false);
        onOpenWishlistManager?.();
      }}
      saveSearchContent={(
                  <>
                    <div className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#8b949e', letterSpacing: '0.05em' }}>
                      Save Search
                    </div>
                    {activeCount === 0 ? (
                      <div className="text-[12px]" style={{ color: '#8b949e' }}>
                        Add at least one filter to save a search.
                      </div>
                    ) : (
                      <>
                        <input
                          ref={saveInputRef}
                          type="text"
                          value={saveName}
                          onChange={(e) => setSaveName(e.target.value)}
                          onKeyDown={async (e) => {
                            if (e.key === 'Enter' && saveName.trim()) {
                              const saved = await onSaveSearch?.(saveName.trim());
                              if (saved) setActiveSearchId(saved.id);
                              setSaveOpen(false);
                              if (saveToastTimerRef.current) clearTimeout(saveToastTimerRef.current);
                              setSaveToastVisible(true);
                              saveToastTimerRef.current = setTimeout(() => setSaveToastVisible(false), 3000);
                            }
                            if (e.key === 'Escape') setSaveOpen(false);
                          }}
                          placeholder="e.g. Brooklyn 5-bed hunt"
                          className="w-full rounded-lg px-3 py-2 text-sm outline-none mb-3"
                          style={{ backgroundColor: '#0f1117', border: '1px solid #2d333b', color: '#e1e4e8' }}
                        />
    
                        <div className="flex flex-wrap gap-1 mb-4">
                          {filters.selectedBeds !== null && (
                            <span className="inline-flex items-center rounded text-[10px] font-medium px-2 py-0.5" style={{ backgroundColor: '#58a6ff14', color: '#58a6ff', border: '1px solid #58a6ff40' }}>
                              {filters.selectedBeds.slice().sort((a, b) => a - b).map((b) => (b === 7 ? '7+' : String(b))).join(', ')} bed
                            </span>
                          )}
                          {(filters.minRent !== null || filters.maxRent !== null) && (
                            <span className="inline-flex items-center rounded text-[10px] font-medium px-2 py-0.5" style={{ backgroundColor: '#58a6ff14', color: '#58a6ff', border: '1px solid #58a6ff40' }}>
                              {priceLabel(filters.minRent, filters.maxRent)}
                            </span>
                          )}
                          {filters.commuteRules && filters.commuteRules.length > 0 && (
                            <span className="inline-flex items-center rounded text-[10px] font-medium px-2 py-0.5" style={{ backgroundColor: '#58a6ff14', color: '#58a6ff', border: '1px solid #58a6ff40' }}>
                              {commuteLabel(filters.commuteRules)}
                            </span>
                          )}
                          {filters.selectedSources !== null && (
                            <span className="inline-flex items-center rounded text-[10px] font-medium px-2 py-0.5" style={{ backgroundColor: '#58a6ff14', color: '#58a6ff', border: '1px solid #58a6ff40' }}>
                              {filters.selectedSources.length} source{filters.selectedSources.length !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
    
                        <div className="flex items-center justify-end gap-3">
                          <TextButton variant="muted" onClick={() => setSaveOpen(false)}>
                            Cancel
                          </TextButton>
                          <PrimaryButton
                            onClick={async () => {
                              if (saveName.trim()) {
                                const saved = await onSaveSearch?.(saveName.trim());
                                if (saved) setActiveSearchId(saved.id);
                                setSaveOpen(false);
                                if (saveToastTimerRef.current) clearTimeout(saveToastTimerRef.current);
                                setSaveToastVisible(true);
                                saveToastTimerRef.current = setTimeout(() => setSaveToastVisible(false), 3000);
                              }
                            }}
                            disabled={!saveName.trim()}
                            className="h-8 px-5 text-xs font-bold"
                          >
                            Save
                          </PrimaryButton>
                        </div>
                      </>
                    )}
                  </>
                )}
      stickyFooter={
        <div className="px-4 py-2.5">
          {stickySaveExpanded ? (
            activeCount === 0 ? (
              <div className="text-[12px]" style={{ color: '#8b949e' }}>
                Add at least one filter to save the current search.
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  ref={stickySaveInputRef}
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' && saveName.trim()) {
                      const saved = await onSaveSearch?.(saveName.trim());
                      if (saved) setActiveSearchId(saved.id);
                      setStickySaveExpanded(false);
                      setSaveOpen(false);
                      if (saveToastTimerRef.current) clearTimeout(saveToastTimerRef.current);
                      setSaveToastVisible(true);
                      saveToastTimerRef.current = setTimeout(() => setSaveToastVisible(false), 3000);
                    }
                    if (e.key === 'Escape') setStickySaveExpanded(false);
                  }}
                  placeholder={suggestSearchName(filters) || 'e.g. Brooklyn 5-bed hunt'}
                  className="flex-1 rounded-md px-2 py-1 text-xs outline-none"
                  style={{ backgroundColor: '#0f1117', border: '1px solid #2d333b', color: '#e1e4e8' }}
                />
                <PrimaryButton
                  onClick={async () => {
                    if (saveName.trim()) {
                      const saved = await onSaveSearch?.(saveName.trim());
                      if (saved) setActiveSearchId(saved.id);
                      setStickySaveExpanded(false);
                      setSaveOpen(false);
                      if (saveToastTimerRef.current) clearTimeout(saveToastTimerRef.current);
                      setSaveToastVisible(true);
                      saveToastTimerRef.current = setTimeout(() => setSaveToastVisible(false), 3000);
                    }
                  }}
                  disabled={!saveName.trim()}
                  className="text-[11px] px-2.5 py-1"
                >
                  Save
                </PrimaryButton>
                <TextButton
                  variant="muted"
                  onClick={() => setStickySaveExpanded(false)}
                  className="text-[11px]"
                >
                  Cancel
                </TextButton>
              </div>
            )
          ) : (
            <ButtonBase
              onClick={() => {
                setSaveName(suggestSearchName(filters));
                setStickySaveExpanded(true);
                setTimeout(() => stickySaveInputRef.current?.focus(), 50);
              }}
              disabled={activeCount === 0}
              title={activeCount === 0 ? 'Add at least one filter to save the current search.' : undefined}
              className="flex items-center gap-1.5 text-[12px] font-medium"
              style={{
                color: activeCount === 0 ? '#6e7681' : '#58a6ff',
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: activeCount === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={activeCount === 0 ? '#6e7681' : '#58a6ff'} strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Save current search as…
            </ButtonBase>
          )}
        </div>
      }
              />
    ) : null;

  // Shared render helper for the saved-search tabs (used by both the always-visible
  // top bar and the mobile filter bottom sheet). Keeping this inline preserves
  // access to the local state (activeSearchId, editingSearchId, editingName,
  // editInputRef) without prop-drilling through a standalone sub-component.
  // `variant` controls layout: 'topbar' keeps the horizontal scroll treatment,
  // 'sheet' wraps and includes a short empty-state when there are no saves yet.
  const renderSavedSearchTabsContent = (variant: 'topbar' | 'sheet') => (
    <>
      {/* Single segmented control wrapping the "All" tab + every named saved-search
          tab. One outer rounded-full border, vertical interior dividers between
          segments, blue-tint bg for the active segment. We avoid `overflow-hidden`
          on the wrapper so the inner content can be horizontally scrolled by the
          parent without being clipped. Border radius is applied per-segment via
          first/last classes so the active blue-tint bg follows the rounded shape. */}
      <div
        className="inline-flex items-center h-7 rounded-full border border-[#2d333b] bg-transparent whitespace-nowrap shrink-0"
      >
        {/* "All" segment — always first; long-press shows build info */}
        <button
          onClick={() => {
            // Switching to "All" cancels any in-progress edit so the banner
            // doesn't get stranded over an unrelated filter set.
            if (variant === 'sheet' && editingFiltersSearchId !== null) {
              exitEditMode(true);
            }
            setActiveSearchId(null);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            const raw = document.querySelector('footer')?.textContent?.replace('Built ', '').trim() || '';
            const d = new Date(raw);
            const buildInfo = isNaN(d.getTime()) ? 'Build info unavailable' : `Built ${d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`;
            alert(buildInfo);
          }}
          onTouchStart={(e) => {
            const el = e.currentTarget as HTMLElement;
            el.dataset.lptFired = '0';
            const t = setTimeout(() => {
              el.dataset.lptFired = '1';
              const raw = document.querySelector('footer')?.textContent?.replace('Built ', '').trim() || '';
              const d = new Date(raw);
              const msg = isNaN(d.getTime()) ? 'Build info unavailable' : `Built ${d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`;
              alert(msg);
            }, 500);
            el.dataset.lpt = String(t);
          }}
          onTouchEnd={(e) => {
            const el = e.currentTarget as HTMLElement;
            const t = el.dataset.lpt;
            if (t) clearTimeout(Number(t));
            if (el.dataset.lptFired === '1') e.preventDefault();
          }}
          className={cn(
            'flex items-center h-full px-2.5 text-[11px] whitespace-nowrap cursor-pointer transition-colors duration-150 rounded-l-full',
            !savedSearches?.length && 'rounded-r-full',
            activeSearchId === null
              ? 'bg-[rgba(88,166,255,0.1)] text-[#58a6ff]'
              : 'bg-transparent text-[#8b949e] hover:text-[#c0d6f5]',
          )}
        >
          All
        </button>

        {/* Saved-search segments */}
        {savedSearches?.map((s, idx) => {
          const active = activeSearchId === s.id;
          const isEditing = editingSearchId === s.id;
          const isLast = idx === (savedSearches.length - 1);
          return (
            <div
              key={s.id}
              className={cn(
                'relative group flex items-center h-full border-l border-[#2d333b]',
                isLast && 'rounded-r-full overflow-hidden',
              )}
            >
              {isEditing ? (
                <div className="flex items-center h-full px-1">
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && editingName.trim()) {
                        onUpdateSearch?.(s.id, editingName.trim());
                        setEditingSearchId(null);
                      }
                      if (e.key === 'Escape') setEditingSearchId(null);
                    }}
                    onBlur={() => {
                      if (editingName.trim()) {
                        onUpdateSearch?.(s.id, editingName.trim());
                      }
                      setEditingSearchId(null);
                    }}
                    className="h-5 px-1.5 text-[11px] rounded outline-none"
                    style={{ backgroundColor: '#0f1117', border: '1px solid #58a6ff', color: '#e1e4e8', width: `${Math.max(editingName.length, 4) * 7 + 16}px`, maxWidth: '150px' }}
                  />
                </div>
              ) : (
                <button
                  onClick={() => {
                    // If we're editing a different saved search, cancel that
                    // edit before loading this one — banner should always
                    // describe the currently-loaded search.
                    if (
                      variant === 'sheet' &&
                      editingFiltersSearchId !== null &&
                      editingFiltersSearchId !== s.id
                    ) {
                      exitEditMode(true);
                    }
                    setActiveSearchId(s.id);
                    onLoadSearch?.(s.filters as unknown as FiltersState);
                  }}
                  className={cn(
                    'flex items-center gap-1 h-full px-2.5 text-[11px] whitespace-nowrap cursor-pointer transition-colors duration-150',
                    active
                      ? 'bg-[rgba(88,166,255,0.1)] text-[#58a6ff]'
                      : 'bg-transparent text-[#8b949e] hover:text-[#c0d6f5]',
                  )}
                >
                  {s.name}
                  {/* Edit/delete icons — hover on desktop, always visible in
                      mobile sheet so touch users can rename/delete. */}
                  <span
                    className={cn(
                      'items-center gap-0.5 ml-0.5',
                      variant === 'sheet' ? 'flex' : 'hidden group-hover:flex',
                    )}
                  >
                    <span
                      role="button"
                      data-testid={variant === 'sheet' ? `saved-search-edit-${s.id}` : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (variant === 'sheet') {
                          // Sheet variant: pencil enters the EDIT-FILTERS flow
                          // — load this search's snapshot into the live
                          // filters, raise the banner, and let the user
                          // mutate chips. Rename is still available via the
                          // top-bar pencil on desktop.
                          enterEditMode(s);
                        } else {
                          setEditingSearchId(s.id);
                          setEditingName(s.name);
                          setTimeout(() => editInputRef.current?.focus(), 50);
                        }
                      }}
                      className="w-4 h-4 rounded flex items-center justify-center text-[#484f58] hover:text-[#58a6ff] hover:bg-[#58a6ff]/10 cursor-pointer transition-colors"
                      aria-label={variant === 'sheet' ? `Edit filters for ${s.name}` : `Rename ${s.name}`}
                    >
                      <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M8.5 1.5l2 2L4 10H2v-2z" />
                      </svg>
                    </span>
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (activeSearchId === s.id) setActiveSearchId(null);
                        onDeleteSearch?.(s.id);
                      }}
                      className="w-4 h-4 rounded flex items-center justify-center text-[#484f58] hover:text-red-400 hover:bg-red-400/10 cursor-pointer transition-colors"
                    >
                      <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <path d="M2 2L8 8M8 2L2 8" />
                      </svg>
                    </span>
                  </span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Empty state — only in the mobile sheet variant. */}
      {variant === 'sheet' && (!savedSearches || savedSearches.length === 0) && (
        <div className="italic text-[11px] py-1" style={{ color: '#6e7681' }}>
          No saved searches yet. Save the current filters from the Save button.
        </div>
      )}
    </>
  );

  return (
    <div
      ref={containerRef}
      className="pl-4 pr-2 sm:pl-4 sm:pr-2 relative z-[1200]"
      style={{ backgroundColor: '#1c2028', borderBottom: '1px solid #2d333b' }}
    >
      {/* Row 1 (always visible): Saved cluster + Destination pill + Area tabs + listing count + Filters button + Sort + View toggle */}
      <div className="flex items-center min-h-[36px] gap-1.5 sm:gap-3 overflow-visible">
        {/* Saved cluster pill — consolidated entry-point for save-search and
            wishlist filtering. Anchors the SaveWishlistPanel via clusterDropdownRef. */}
        {(() => {
          const allWishlists = [...(myWishlists || []), ...(sharedWishlists || [])];
          const selectedWishlistObj =
            selectedWishlist && selectedWishlist !== 'all-saved'
              ? allWishlists.find((w) => w.id === selectedWishlist)
              : null;
          const clusterLabel =
            selectedWishlist === 'all-saved'
              ? 'All saved'
              : selectedWishlistObj
                ? selectedWishlistObj.name.length > 16
                  ? selectedWishlistObj.name.slice(0, 16) + '…'
                  : selectedWishlistObj.name
                : 'Saved';
          const hasSelection = !!selectedWishlist;
          return (
            <div className="shrink-0 flex items-center" ref={clusterDropdownRef}>
              <ButtonBase
                onClick={() => {
                  if (!userId) {
                    onLoginRequired?.();
                    return;
                  }
                  setOpenChip(null);
                  if (saveOpen) {
                    setSaveOpen(false);
                  } else {
                    setSavePanelTab('wishlist');
                    setSaveOpen(true);
                  }
                }}
                aria-label="Saved (filter by wishlist or save current search)"
                className={cn(
                  'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[12px] font-medium whitespace-nowrap transition-colors',
                  hasSelection
                    ? 'border-[#7ee787] text-[#7ee787]'
                    : 'border-[#2d333b] hover:border-[rgba(126,231,135,0.6)] text-[#e1e4e8]',
                )}
                style={{
                  background: hasSelection ? 'rgba(126,231,135,0.1)' : 'transparent',
                }}
              >
                {hasSelection ? (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="#7ee787"
                    stroke="#7ee787"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                ) : (
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                )}
                <span>{clusterLabel}</span>
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.7 }}>
                  <path d="M2 3.5L5 6.5L8 3.5" />
                </svg>
              </ButtonBase>
            </div>
          );
        })()}

        {/* Inline destination pill — first child so it sits to the left of the
            saved-search tabs scroll area. shrink-0 keeps it from collapsing. */}
        {destinationSlot && (
          <div className="shrink-0 flex items-center">{destinationSlot}</div>
        )}

        {/* Spacer — pushes right-side controls to the right edge.
            (The saved-search "All | <name>" segmented slider that used to live
            here was replaced by the top-left Saved cluster pill.) */}
        <div className="flex-1 min-w-0" />

        {/* Right-side controls */}
        <div className="flex items-center gap-1.5 shrink-0 pl-2">
          {/* Mobile: compact filter pill that opens bottom sheet */}
          <button
            onClick={() => setMobileSheetOpen(true)}
            className="flex min-[600px]:hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap transition-colors duration-150 cursor-pointer"
            style={{
              background: activeCount > 0 ? 'rgba(88, 166, 255, 0.1)' : '#2d333b',
              color: activeCount > 0 ? '#58a6ff' : '#8b949e',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 2h10M3 6h6M5 10h2" />
            </svg>
            Filters
            {activeCount > 0 && (
              <span className="bg-[#58a6ff] text-[#0f1117] text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                {activeCount}
              </span>
            )}
          </button>

          {/* Desktop: Sort dropdown (hidden on mobile) */}
          <div className="relative shrink-0 hidden min-[600px]:flex items-center">
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

          {/* Desktop: Filters toggle button (hidden on mobile) */}
          <div data-tour="filters" className="shrink-0 hidden min-[600px]:flex items-center">
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
          </div>

          {/* View toggle (list/map/swipe) — desktop only; mobile uses MobileBottomNav */}
          {viewToggle && <div className="shrink-0 hidden min-[600px]:flex items-center">{viewToggle}</div>}
        </div>
      </div>


      {/* Row 2 (expandable): Filter chips — desktop only; mobile shows these in bottom sheet */}
      {filtersExpanded && (
        <div ref={expandedRowRef} className="hidden min-[600px]:flex items-center gap-1.5 flex-wrap pt-1.5 pb-1" style={{ borderTop: '1px solid #2d333b' }}>
          {filterChipsContent}
        </div>
      )}
      {/* Mobile filter bottom sheet — portaled to document.body so it escapes
          any ancestor with `display: none` (e.g. the sidebar is hidden via
          body[data-swipe-mobile] in swipe view but still mounts this
          component as the single source of truth for filter state). */}
      {mobileSheetOpen && typeof document !== 'undefined' && createPortal(
        <>
          {/* Backdrop — opacity fades as the sheet is dragged down so the
              dismiss feels physical. */}
          <div
            className="fixed inset-0 z-[1400] min-[600px]:hidden"
            style={{
              backgroundColor: 'rgba(0,0,0,0.5)',
              opacity: Math.max(0, 1 - mobileSheetDragY / 250),
              transition: mobileSheetDragActiveRef.current ? 'none' : 'opacity 220ms ease-out',
            }}
            onClick={() => setMobileSheetOpen(false)}
          />
          {/* Sheet — translateY follows drag; snaps back or slides off on
              release via handleMobileSheetPointerUp. */}
          <div
            className="fixed bottom-0 left-0 right-0 z-[1401] min-[600px]:hidden rounded-t-2xl"
            data-testid="mobile-filters-sheet"
            style={{
              backgroundColor: '#1c2028',
              paddingBottom: 'env(safe-area-inset-bottom)',
              boxShadow: '0 -8px 32px rgba(0,0,0,0.5)',
              animation: mobileSheetDragY === 0 && !mobileSheetDragActiveRef.current ? 'mobileSheetSlideUp 200ms ease-out' : undefined,
              transform: `translateY(${mobileSheetDragY}px)`,
              transition: mobileSheetDragActiveRef.current ? 'none' : 'transform 220ms ease-out',
              touchAction: 'pan-y',
            }}
          >
            {/* Drag header (handle + title row) — pointer events here start
                the drag-to-dismiss gesture. Covers the top ~60px so the user
                has a comfortable target. */}
            <div
              data-testid="mobile-filters-sheet-drag-header"
              onPointerDown={handleMobileSheetPointerDown}
              onPointerMove={handleMobileSheetPointerMove}
              onPointerUp={handleMobileSheetPointerUp}
              onPointerCancel={handleMobileSheetPointerUp}
              style={{ touchAction: 'none', cursor: 'grab' }}
            >
              {/* Drag handle pill */}
              <div className="flex justify-center pt-3 pb-2">
                <div className="w-10 h-1 rounded-full" style={{ backgroundColor: '#484f58' }} />
              </div>

              {/* Close button + title */}
              <div className="flex items-center justify-between px-4 pb-2">
                <span className="text-sm font-semibold" style={{ color: '#e1e4e8' }}>Sort &amp; Filter</span>
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setMobileSheetOpen(false)}
                  className="rounded p-1.5 transition-colors hover:bg-white/5 cursor-pointer"
                  style={{ color: '#8b949e' }}
                  aria-label="Close"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M3 3L13 13M13 3L3 13" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Editing banner (Option C) — appears below the title bar
                whenever the user is editing a saved search's filter snapshot.
                Updates to "Editing · N changes" once the user mutates anything,
                then the sticky bottom bar surfaces Save changes / Save as new. */}
            {editingFiltersSearchId !== null && (
              <div
                className="mx-4 mb-3 mt-1 p-2.5 rounded-lg flex items-center gap-2.5"
                data-testid="edit-saved-search-banner"
                style={{
                  backgroundColor: 'rgba(88, 166, 255, 0.10)',
                  border: '1px solid rgba(88, 166, 255, 0.30)',
                }}
              >
                <div
                  className="w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: 'rgba(88, 166, 255, 0.15)', color: '#58a6ff' }}
                >
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8.5 1.5l2 2L4 10H2v-2z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    className="text-[10px] font-bold uppercase"
                    style={{ color: '#58a6ff', letterSpacing: '0.08em' }}
                  >
                    {editingChangedCount > 0
                      ? `Editing · ${editingChangedCount} change${editingChangedCount === 1 ? '' : 's'}`
                      : 'Editing'}
                  </div>
                  <div
                    className="text-[13px] font-semibold truncate"
                    style={{ color: '#e1e4e8', marginTop: '1px' }}
                    data-testid="edit-saved-search-banner-name"
                  >
                    {editingFiltersName}
                  </div>
                </div>
                <button
                  onClick={() => exitEditMode(true)}
                  data-testid="edit-saved-search-cancel"
                  className="text-[11px] font-medium h-[26px] px-2.5 rounded-md cursor-pointer transition-colors"
                  style={{
                    backgroundColor: 'transparent',
                    border: '1px solid rgba(88, 166, 255, 0.30)',
                    color: '#58a6ff',
                  }}
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Destination section — mirrors the inline destination pill in
                the top bar so the mobile filter sheet (used in swipe view where
                the top bar is hidden) can still set/edit a preferred destination. */}
            {destinationSlot && (
              <div className="px-4 pb-4" data-testid="mobile-filters-destination" style={{ borderBottom: '1px solid #2d333b' }}>
                <div className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: '#8b949e' }}>Destination</div>
                <div className="flex flex-wrap items-center gap-2">{destinationSlot}</div>
              </div>
            )}

            {/* Sort section */}
            <div className="px-4 pt-5 pb-4" style={{ borderBottom: '1px solid #2d333b' }}>
              <div className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: '#8b949e' }}>Sort by</div>
              <div className="flex flex-wrap gap-2">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      onChange({ ...filters, sort: opt.value });
                    }}
                    className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer"
                    style={{
                      backgroundColor: filters.sort === opt.value ? 'rgba(88, 166, 255, 0.15)' : '#2d333b',
                      color: filters.sort === opt.value ? '#58a6ff' : '#8b949e',
                      border: filters.sort === opt.value ? '1px solid rgba(88, 166, 255, 0.3)' : '1px solid transparent',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* My searches section — mirrors the top-bar saved-search tabs so
                the mobile filter sheet (used in swipe view where the top bar
                is hidden) can still reach them. */}
            <div className="px-4 py-4" data-testid="mobile-filters-saved-searches" style={{ borderBottom: '1px solid #2d333b' }}>
              <div className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: '#8b949e' }}>My searches</div>
              <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
                {renderSavedSearchTabsContent('sheet')}
              </div>
            </div>


            {/* Filter chips */}
            <div
              className="px-4 pt-3 overflow-y-auto flex flex-wrap gap-1.5"
              style={{
                maxHeight: '60vh',
                // Pad bottom extra when the sticky save bar is visible so
                // the last row of chips is never hidden under it.
                paddingBottom: editingFiltersSearchId !== null && editingChangedCount > 0 ? '88px' : '24px',
              }}
            >
              {filterChipsContent}
            </div>

            {/* Sticky save bar (Option C state 3) — slides up the moment the
                user mutates a chip while editing. Two CTAs: Save as new
                (secondary) creates a new saved-search row with a
                user-supplied name; Save changes (primary blue) updates the
                current saved-search row's filter snapshot in place. */}
            {editingFiltersSearchId !== null && editingChangedCount > 0 && (
              <div
                data-testid="edit-saved-search-actionbar"
                className="absolute left-0 right-0 bottom-0 flex items-center gap-2 px-3"
                style={{
                  height: '64px',
                  backgroundColor: '#1c2028',
                  borderTop: '1px solid #2d333b',
                  paddingBottom: 'env(safe-area-inset-bottom)',
                  zIndex: 2,
                }}
              >
                {saveAsNewOpen ? (
                  <>
                    <input
                      ref={saveAsNewInputRef}
                      type="text"
                      value={saveAsNewName}
                      onChange={(e) => setSaveAsNewName(e.target.value)}
                      placeholder="New search name"
                      data-testid="edit-saved-search-newname-input"
                      className="flex-1 h-10 px-3 rounded-md text-sm outline-none"
                      style={{
                        backgroundColor: '#0d1117',
                        border: '1px solid #2d333b',
                        color: '#e1e4e8',
                      }}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter' && saveAsNewName.trim()) {
                          const created = await onSaveSearch?.(saveAsNewName.trim());
                          if (created) {
                            setActiveSearchId(created.id);
                            exitEditMode(false);
                          }
                        }
                        if (e.key === 'Escape') {
                          setSaveAsNewOpen(false);
                          setSaveAsNewName('');
                        }
                      }}
                    />
                    <button
                      data-testid="edit-saved-search-newname-confirm"
                      disabled={!saveAsNewName.trim()}
                      onClick={async () => {
                        if (!saveAsNewName.trim()) return;
                        const created = await onSaveSearch?.(saveAsNewName.trim());
                        if (created) {
                          setActiveSearchId(created.id);
                          exitEditMode(false);
                        }
                      }}
                      className="h-10 px-4 rounded-md text-[13px] font-semibold cursor-pointer disabled:opacity-50"
                      style={{ backgroundColor: '#58a6ff', color: '#03111f' }}
                    >
                      Create
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      data-testid="edit-saved-search-save-as-new"
                      onClick={() => {
                        setSaveAsNewOpen(true);
                        setSaveAsNewName(`${editingFiltersName} (copy)`);
                        setTimeout(() => saveAsNewInputRef.current?.select(), 50);
                      }}
                      className="h-10 px-4 rounded-md text-[13px] font-semibold cursor-pointer transition-colors shrink-0"
                      style={{
                        backgroundColor: 'transparent',
                        border: '1px solid #2d333b',
                        color: '#e1e4e8',
                      }}
                    >
                      Save as new
                    </button>
                    <button
                      data-testid="edit-saved-search-save-changes"
                      onClick={async () => {
                        if (!editingFiltersSearchId) return;
                        const ok = await onUpdateSearchFilters?.(editingFiltersSearchId, filters);
                        if (ok) {
                          // Successful save — exit edit mode without
                          // reverting (current filters are now the new
                          // baseline / the persisted snapshot).
                          setEditingFiltersSearchId(null);
                          setEditingFiltersName('');
                          setEditingFiltersSnapshot(null);
                          setSaveAsNewOpen(false);
                          setSaveAsNewName('');
                          setSaveToastVisible(true);
                          if (saveToastTimerRef.current) clearTimeout(saveToastTimerRef.current);
                          saveToastTimerRef.current = setTimeout(() => setSaveToastVisible(false), 2000);
                        }
                      }}
                      className="flex-1 h-10 px-4 rounded-md text-[13px] font-semibold cursor-pointer"
                      style={{ backgroundColor: '#58a6ff', color: '#03111f' }}
                    >
                      Save changes
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          <style dangerouslySetInnerHTML={{ __html: `
            @keyframes mobileSheetSlideUp {
              from { transform: translateY(100%); }
              to { transform: translateY(0); }
            }
          ` }} />
        </>,
        document.body,
      )}

      {/* Save / wishlist panel — single instance, portaled to document.body
          inside SaveWishlistPanel. Rendered here (not inside filterChipsContent)
          so we don't get a duplicate when the chip JSX is inlined into both
          the desktop top bar and the mobile bottom sheet. */}
      {saveWishlistPanelEl}

      {/* Save success toast — positioned at bottom center */}
      {saveToastVisible && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-2 rounded-lg px-4 py-2.5 shadow-xl transition-opacity"
          style={{
            backgroundColor: '#1c2028',
            border: '1px solid #58a6ff',
            color: '#e1e4e8',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#58a6ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 7.5L6 10L10.5 4" />
          </svg>
          <span className="text-sm font-medium">Search saved</span>
        </div>
      )}
    </div>
  );
}));

export default Filters;
