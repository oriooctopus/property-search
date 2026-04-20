'use client';

import { memo, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { ButtonBase, FilterChip, PillButton, PrimaryButton, TextButton } from '@/components/ui';
import { cn } from '@/lib/cn';
import SUBWAY_STATIONS from '@/lib/isochrone/subway-stations';
import SaveWishlistPanel, { type WishlistFilterSelection } from '@/components/SaveWishlistPanel';
import type { Wishlist } from '@/lib/hooks/useWishlists';

export type SortField = 'price' | 'beds' | 'listDate';

export type MaxListingAge = '1h' | '3h' | '6h' | '12h' | '1d' | '2d' | '3d' | '1w' | '2w' | '1m' | null;

export const ALL_SOURCES = ['craigslist', 'streeteasy', 'facebook-marketplace'] as const;
export type ListingSource = (typeof ALL_SOURCES)[number];

export const SOURCE_LABELS: Record<ListingSource, string> = {
  craigslist: 'Craigslist',
  streeteasy: 'StreetEasy',
  'facebook-marketplace': 'Facebook',
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
  userId?: string | null;
  savedSearches?: SavedSearchEntry[];
  onSaveSearch?: (name: string) => Promise<SavedSearchEntry | null>;
  onDeleteSearch?: (id: number) => void;
  onLoadSearch?: (filters: FiltersState) => void;
  onUpdateSearch?: (id: number, name: string) => void;
  onLoginRequired?: () => void;
  showHidden?: boolean;
  onToggleShowHidden?: () => void;
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

function commuteLabel(rules: CommuteRule[]): string {
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

function createDefaultRule(): CommuteRule {
  return {
    id: newRuleId(),
    type: 'subway-line',
    lines: [],
    stops: [],
    maxMinutes: 10,
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
    <div className="flex">
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

const CommuteRuleEditor = memo(function CommuteRuleEditor({
  rule,
  onChange,
  onDelete,
}: {
  rule: CommuteRule;
  onChange: (updated: CommuteRule) => void;
  onDelete: () => void;
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
        <div className="inline-flex rounded-[5px] border overflow-hidden h-7" style={{ borderColor: '#2d333b' }}>
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

type ChipId = 'price' | 'bedsBaths' | 'listingAge' | 'source' | 'commute' | 'yearBuilt' | 'sqft';

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

const Filters = memo(function Filters({ filters, onChange, listingCount, viewToggle, userId, savedSearches, onSaveSearch, onDeleteSearch, onLoadSearch, onUpdateSearch, onLoginRequired, showHidden, onToggleShowHidden, myWishlists = [], sharedWishlists = [], selectedWishlist = null, onSelectWishlist, onCreateWishlist, onOpenWishlistManager }: FiltersProps) {
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

  // Mobile filter bottom sheet state
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  // Save search dropdown state
  const [saveOpen, setSaveOpen] = useState(false);
  const [savePanelTab, setSavePanelTab] = useState<'save-search' | 'wishlist'>('save-search');
  const [saveName, setSaveName] = useState('');
  const [saveToastVisible, setSaveToastVisible] = useState(false);
  const saveToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveDropdownRef = useRef<HTMLDivElement>(null);
  const saveInputRef = useRef<HTMLInputElement>(null);

  // Saved search tabs state
  const [activeSearchId, setActiveSearchId] = useState<number | null>(null);
  const [editingSearchId, setEditingSearchId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

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
  }, [openChip, filters.minRent, filters.maxRent, filters.priceMode, filters.selectedBeds, filters.minBaths, filters.includeNaBaths, filters.maxListingAge, filters.selectedSources, filters.commuteRules, filters.minYearBuilt, filters.maxYearBuilt, filters.minSqft, filters.maxSqft, filters.excludeNoSqft]);

  // Click-outside handler — discard drafts. We don't close `saveOpen` here
  // because the SaveWishlistPanel renders in a fixed-position element outside
  // the containerRef and has its own outside-click handler that understands
  // that geometry.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
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
    
        {/* Divider + dual-purpose Save / Wishlist chip */}
        <>
          {/* Vertical divider */}
          <div className="h-4 w-px shrink-0" style={{ backgroundColor: '#2d333b' }} />
    
          {/* Dual chip: left = Save search, right = Filter by wishlist */}
          <div className="relative shrink-0" ref={saveDropdownRef}>
            <div
              className={cn(
                'inline-flex items-center rounded-[20px] overflow-hidden border h-[26px] font-medium whitespace-nowrap',
                saveOpen
                  ? 'border-[#58a6ff]'
                  : 'border-[#2d333b] hover:border-[#58a6ff]/40',
              )}
              style={{ background: 'transparent' }}
            >
              <ButtonBase
                onClick={() => {
                  if (!userId) {
                    onLoginRequired?.();
                    return;
                  }
                  setOpenChip(null);
                  setSaveName(suggestSearchName(filters));
                  // If already open on this tab → close. Otherwise open this tab.
                  if (saveOpen && savePanelTab === 'save-search') {
                    setSaveOpen(false);
                  } else {
                    setSavePanelTab('save-search');
                    setSaveOpen(true);
                    setTimeout(() => saveInputRef.current?.focus(), 50);
                  }
                }}
                className="flex items-center gap-1 px-2.5 h-full text-[11px]"
                style={{
                  color: saveOpen && savePanelTab === 'save-search' ? '#58a6ff' : '#8b949e',
                  borderRight: '1px solid #2d333b',
                  background: 'transparent',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
                Save
              </ButtonBase>
              <ButtonBase
                onClick={() => {
                  if (!userId) {
                    onLoginRequired?.();
                    return;
                  }
                  setOpenChip(null);
                  if (saveOpen && savePanelTab === 'wishlist') {
                    setSaveOpen(false);
                  } else {
                    setSavePanelTab('wishlist');
                    setSaveOpen(true);
                  }
                }}
                aria-label="Filter by wishlist"
                className="flex items-center gap-1 px-2 h-full text-[11px]"
                style={{
                  color: saveOpen && savePanelTab === 'wishlist' ? '#58a6ff' : '#e1e4e8',
                  background: selectedWishlist ? 'rgba(126,231,135,0.1)' : 'transparent',
                }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill={selectedWishlist ? '#7ee787' : 'none'}
                  stroke={selectedWishlist ? '#7ee787' : 'currentColor'}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ opacity: selectedWishlist ? 1 : 0.6 }}
                >
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.6 }}>
                  <path d="M2 3.5L5 6.5L8 3.5" />
                </svg>
              </ButtonBase>
            </div>
    
            {saveOpen && (
              <SaveWishlistPanel
                anchorRef={saveDropdownRef}
                initialTab={savePanelTab}
                onClose={() => setSaveOpen(false)}
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
              />
            )}
          </div>
        </>
    </>
  );

  return (
    <div
      ref={containerRef}
      className="pl-3 pr-2 sm:px-2 relative z-[1200]"
      style={{ backgroundColor: '#1c2028', borderBottom: '1px solid #2d333b' }}
    >
      {/* Row 1 (always visible): Area tabs + listing count + Filters button + Sort + View toggle */}
      <div className="flex items-center min-h-[36px] gap-1.5 sm:gap-3 overflow-visible">
        {/* Saved search tabs — horizontally scrollable, hidden scrollbar */}
        <div
          className="flex items-center flex-1 min-w-0 overflow-x-auto"
          style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', msOverflowStyle: 'none' } as React.CSSProperties}
        >
          <style dangerouslySetInnerHTML={{ __html: `.area-tabs-scroll::-webkit-scrollbar { display: none; }` }} />
          <div className="area-tabs-scroll flex items-center overflow-x-auto" style={{ scrollbarWidth: 'none' } as React.CSSProperties}>
            {/* "All" tab — always first; long-press shows build info */}
            <div className="relative group shrink-0">
              <button
                onClick={() => setActiveSearchId(null)}
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
                  'relative flex items-center h-8 pl-0 pr-2.5 sm:px-2.5 text-[11px] whitespace-nowrap cursor-pointer transition-colors duration-150',
                  activeSearchId === null ? 'text-[#e1e4e8]' : 'text-[#8b949e] hover:text-[#c0d6f5]',
                )}
              >
                All
                {activeSearchId === null && (
                  <span
                    className="absolute bottom-0 left-0 right-2.5 sm:left-2.5 h-0.5 rounded-sm"
                    style={{ backgroundColor: '#58a6ff' }}
                  />
                )}
              </button>
            </div>

            {/* Saved search tabs */}
            {savedSearches?.map((s) => {
              const active = activeSearchId === s.id;
              const isEditing = editingSearchId === s.id;
              return (
                <div key={s.id} className="relative group shrink-0">
                  {isEditing ? (
                    <div className="flex items-center h-8 px-1">
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
                        className="h-6 px-1.5 text-[11px] rounded outline-none"
                        style={{ backgroundColor: '#0f1117', border: '1px solid #58a6ff', color: '#e1e4e8', width: `${Math.max(editingName.length, 4) * 7 + 16}px`, maxWidth: '150px' }}
                      />
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setActiveSearchId(s.id);
                        onLoadSearch?.(s.filters as unknown as FiltersState);
                      }}
                      className={cn(
                        'relative flex items-center gap-1 h-8 px-2.5 text-[11px] whitespace-nowrap cursor-pointer transition-colors duration-150',
                        active ? 'text-[#e1e4e8]' : 'text-[#8b949e] hover:text-[#c0d6f5]',
                      )}
                    >
                      {s.name}
                      {active && (
                        <span
                          className="absolute bottom-0 left-2.5 right-2.5 h-0.5 rounded-sm"
                          style={{ backgroundColor: '#58a6ff' }}
                        />
                      )}
                      {/* Edit/delete icons on hover */}
                      <span className="hidden group-hover:flex items-center gap-0.5 ml-0.5">
                        <span
                          role="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingSearchId(s.id);
                            setEditingName(s.name);
                            setTimeout(() => editInputRef.current?.focus(), 50);
                          }}
                          className="w-4 h-4 rounded flex items-center justify-center text-[#484f58] hover:text-[#58a6ff] hover:bg-[#58a6ff]/10 cursor-pointer transition-colors"
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
        </div>

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
      {/* Mobile filter bottom sheet */}
      {mobileSheetOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-[1400] min-[600px]:hidden"
            style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
            onClick={() => setMobileSheetOpen(false)}
          />
          {/* Sheet */}
          <div
            className="fixed bottom-0 left-0 right-0 z-[1401] min-[600px]:hidden rounded-t-2xl"
            style={{
              backgroundColor: '#1c2028',
              paddingBottom: 'env(safe-area-inset-bottom)',
              boxShadow: '0 -8px 32px rgba(0,0,0,0.5)',
              animation: 'mobileSheetSlideUp 200ms ease-out',
            }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full" style={{ backgroundColor: '#484f58' }} />
            </div>

            {/* Close button */}
            <div className="flex items-center justify-between px-4 pb-2">
              <span className="text-sm font-semibold" style={{ color: '#e1e4e8' }}>Sort &amp; Filter</span>
              <button
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

            {/* Sort section */}
            <div className="px-4 pb-4" style={{ borderBottom: '1px solid #2d333b' }}>
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


            {/* Filter chips */}
            <div className="px-4 pt-3 pb-16 overflow-y-auto flex flex-wrap gap-1.5" style={{ maxHeight: '60vh' }}>
              {filterChipsContent}
            </div>
          </div>
          <style dangerouslySetInnerHTML={{ __html: `
            @keyframes mobileSheetSlideUp {
              from { transform: translateY(100%); }
              to { transform: translateY(0); }
            }
          ` }} />
        </>
      )}

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
});

export default Filters;
