'use client';

import { memo, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { ButtonBase, FilterChip, PillButton, PrimaryButton, TextButton } from '@/components/ui';
import { cn } from '@/lib/cn';
import SUBWAY_STATIONS from '@/lib/isochrone/subway-stations';

export type SearchTag = 'all' | 'fulton' | 'ltrain' | 'manhattan' | 'brooklyn' | 'uptown';
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
  maxPricePerBed: number | null;
  selectedBeds: number[] | null;
  minBaths: number | null;
  minRent: number | null;
  maxRent: number | null;
  sort: SortField;
  searchTag: SearchTag;
  maxListingAge: MaxListingAge;
  photosFirst: boolean;
  selectedSources: string[] | null;
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
  onSaveSearch?: (name: string) => void;
  onDeleteSearch?: (id: number) => void;
  onLoadSearch?: (filters: FiltersState) => void;
}

const SEARCH_TABS: { value: SearchTag; label: string; title: string }[] = [
  { value: 'all', label: 'All', title: 'Show all listings across every area, with no location filter applied' },
  { value: 'fulton', label: 'Fulton St', title: 'Listings within a 25-minute subway/bus ride of Fulton St station in Lower Manhattan' },
  { value: 'ltrain', label: 'L Train', title: 'Listings within a 10-minute walk of L train stops from Bedford Ave through DeKalb Ave' },
  { value: 'manhattan', label: 'Manhattan', title: 'Manhattan listings between Park Place (Tribeca) and 38th St (Midtown), covering Downtown, SoHo, the Village, Chelsea, and the Flatiron area' },
  { value: 'brooklyn', label: 'Brooklyn 14th', title: 'Brooklyn listings within a 35-minute subway ride of 14th St (any stop between 8th Ave and 1st Ave)' },
  { value: 'uptown', label: 'Uptown West', title: 'West side of Manhattan from Midtown to 100th St — Hell\'s Kitchen, Columbus Circle, Lincoln Center, Upper West Side (excludes Upper East Side)' },
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

function bedsBathsLabel(selectedBeds: number[] | null, minBaths: number | null): string {
  const parts: string[] = [];
  if (selectedBeds !== null && selectedBeds.length > 0) {
    const labels = selectedBeds
      .slice()
      .sort((a, b) => a - b)
      .map((b) => (b === 7 ? '7+' : String(b)));
    parts.push(`${labels.join(', ')} Beds`);
  }
  if (minBaths !== null) parts.push(`${minBaths}+ Baths`);
  return parts.length > 0 ? parts.join(', ') : 'Beds / Baths';
}

function pricePerBedLabel(maxPricePerBed: number | null): string {
  if (maxPricePerBed === null) return 'Price (per bedroom)';
  return `Under $${maxPricePerBed.toLocaleString()}/bed`;
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
    if (r.type === 'address' && r.address) return r.address;
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

  // Area
  const tag = SEARCH_TABS.find((t) => t.value === filters.searchTag);
  if (tag && filters.searchTag !== 'all') {
    parts.push(tag.label);
  }

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

  // Local state for text inputs — only sync to parent on blur / Enter to avoid
  // re-rendering the entire filter tree on every keystroke.
  const [localStationName, setLocalStationName] = useState(rule.stationName ?? '');
  const [localAddress, setLocalAddress] = useState(rule.address ?? '');

  // Sync local state when rule changes externally (e.g. reset, type change)
  useEffect(() => { setLocalStationName(rule.stationName ?? ''); }, [rule.stationName]);
  useEffect(() => { setLocalAddress(rule.address ?? ''); }, [rule.address]);

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
    setLocalAddress(value);
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
    setLocalAddress(displayName);
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

  const timePct = ((rule.maxMinutes - 1) / 59) * 100;
  const maxSlider = rule.type === 'subway-line' ? 20 : 60;
  const minSlider = 1;
  const sliderPct = ((rule.maxMinutes - minSlider) / (maxSlider - minSlider)) * 100;

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
          <option value="station">Station</option>
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
              type="text"
              placeholder="Search address..."
              value={localAddress}
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
                className="absolute left-0 right-0 top-[28px] z-50 rounded-md border shadow-lg overflow-hidden"
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
                {!addressLoading && !addressError && addressSuggestions.length === 0 && localAddress.trim().length > 0 && (
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

      {/* Coming-soon warnings for unimplemented rule types */}
      {rule.type === 'address' && (
        <p className="text-[10px] mt-1.5 ml-0.5" style={{ color: '#d29922' }}>
          Address filtering coming soon
        </p>
      )}
      {rule.type === 'park' && (
        <p className="text-[10px] mt-1.5 ml-0.5" style={{ color: '#d29922' }}>
          Park filtering coming soon
        </p>
      )}

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
            value={rule.maxMinutes}
            onChange={(e) => onChange({ ...rule, maxMinutes: Number(e.target.value) })}
            className="range-slider w-full"
            style={{
              background: `linear-gradient(to right, #58a6ff 0%, #58a6ff ${sliderPct}%, #2d333b ${sliderPct}%, #2d333b 100%)`,
            }}
          />
        </div>
        <span className="text-[11px] font-semibold min-w-[42px] text-right whitespace-nowrap" style={{ color: '#58a6ff' }}>
          {rule.maxMinutes} min
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

type ChipId = 'price' | 'bedsBaths' | 'pricePerBed' | 'listingAge' | 'source' | 'commute';

// ---------------------------------------------------------------------------
// Active filter count helper
// ---------------------------------------------------------------------------

function countActiveFilters(filters: FiltersState): number {
  let count = 0;
  if (filters.selectedBeds !== null) count++;
  if (filters.minBaths !== null) count++;
  if (filters.minRent !== null) count++;
  if (filters.maxRent !== null) count++;
  if (filters.maxPricePerBed !== null) count++;
  if (filters.maxListingAge !== null && filters.maxListingAge !== '1m') count++;
  if (filters.photosFirst) count++;
  if (filters.selectedSources !== null) count++;
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

export default function Filters({ filters, onChange, listingCount, viewToggle, userId, savedSearches, onSaveSearch, onDeleteSearch, onLoadSearch }: FiltersProps) {
  const [openChip, setOpenChip] = useState<ChipId | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // Draft state for dropdowns — only applied on "Done"
  const [draftMinRent, setDraftMinRent] = useState<number | null>(filters.minRent);
  const [draftMaxRent, setDraftMaxRent] = useState<number | null>(filters.maxRent);
  const [draftSelectedBeds, setDraftSelectedBeds] = useState<number[]>(filters.selectedBeds ?? []);
  const [draftMinBaths, setDraftMinBaths] = useState<number | null>(filters.minBaths);
  const [draftMaxPricePerBed, setDraftMaxPricePerBed] = useState<number | null>(
    filters.maxPricePerBed,
  );
  const [draftMaxListingAge, setDraftMaxListingAge] = useState<MaxListingAge>(
    filters.maxListingAge,
  );
  const [draftSources, setDraftSources] = useState<string[] | null>(filters.selectedSources);
  const [draftCommuteRules, setDraftCommuteRules] = useState<CommuteRule[]>(filters.commuteRules ?? []);

  // Save search dropdown state
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [mySearchesOpen, setMySearchesOpen] = useState(false);
  const [saveToastVisible, setSaveToastVisible] = useState(false);
  const saveToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveDropdownRef = useRef<HTMLDivElement>(null);
  const mySearchesDropdownRef = useRef<HTMLDivElement>(null);
  const saveInputRef = useRef<HTMLInputElement>(null);

  // Sync drafts when filters change externally
  useEffect(() => {
    setDraftMinRent(filters.minRent);
  }, [filters.minRent]);
  useEffect(() => {
    setDraftMaxRent(filters.maxRent);
  }, [filters.maxRent]);
  useEffect(() => {
    setDraftSelectedBeds(filters.selectedBeds ?? []);
  }, [filters.selectedBeds]);
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
  useEffect(() => {
    setDraftCommuteRules(filters.commuteRules ?? []);
  }, [filters.commuteRules]);

  // Reset drafts when a dropdown opens
  useEffect(() => {
    if (openChip === 'price') {
      setDraftMinRent(filters.minRent);
      setDraftMaxRent(filters.maxRent);
    } else if (openChip === 'bedsBaths') {
      setDraftSelectedBeds(filters.selectedBeds ?? []);
      setDraftMinBaths(filters.minBaths);
    } else if (openChip === 'pricePerBed') {
      setDraftMaxPricePerBed(filters.maxPricePerBed);
    } else if (openChip === 'listingAge') {
      setDraftMaxListingAge(filters.maxListingAge);
    } else if (openChip === 'source') {
      setDraftSources(filters.selectedSources);
    } else if (openChip === 'commute') {
      setDraftCommuteRules(filters.commuteRules ?? []);
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
        setSaveOpen(false);
        setMySearchesOpen(false);
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
      <div className="flex items-center h-8 gap-3">
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

        </div>

        {/* View toggle (list/map/swipe) — outside the scrollable area */}
        {viewToggle && <div className="shrink-0">{viewToggle}</div>}
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
            </div>

            <DropdownFooter
              onReset={() => {
                onChange({ ...filters, selectedBeds: null, minBaths: null });
                setOpenChip(null);
              }}
              onDone={() => {
                onChange({
                  ...filters,
                  selectedBeds: draftSelectedBeds.length > 0 ? draftSelectedBeds : null,
                  minBaths: draftMinBaths,
                });
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

          {/* Commute chip */}
          <FilterChip
            compact
            label={commuteLabel(filters.commuteRules ?? [])}
            active={(filters.commuteRules ?? []).length > 0}
            open={openChip === 'commute'}
            onToggle={() => toggleChip('commute')}
            dropdownAlign="right"
          >
            <div style={{ minWidth: 'min(380px, calc(100vw - 16px))', maxWidth: '440px' }}>
              <div className="flex items-center justify-between mb-3">
                <SectionTitle>Commute Rules</SectionTitle>
              </div>
              <div className="overflow-y-auto" style={{ maxHeight: 'min(400px, calc(100vh - 280px))', scrollbarWidth: 'thin', scrollbarColor: '#2d333b #1c2028' }}>
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

          {/* Divider + Save / My Searches — only when logged in */}
          {userId && (
            <>
              {/* Vertical divider */}
              <div className="h-4 w-px shrink-0" style={{ backgroundColor: '#2d333b' }} />

              {/* Save chip — only when at least one filter is active */}
              {activeCount > 0 && (
                <div className="relative shrink-0" ref={saveDropdownRef}>
                  <ButtonBase
                    onClick={() => {
                      setSaveOpen((prev) => {
                        if (!prev) {
                          setSaveName(suggestSearchName(filters));
                          setOpenChip(null);
                          setMySearchesOpen(false);
                          // Focus input after render
                          setTimeout(() => saveInputRef.current?.focus(), 50);
                        }
                        return !prev;
                      });
                    }}
                    className={cn(
                      'flex items-center gap-1 rounded-md font-medium whitespace-nowrap border px-2.5 py-0.5 text-[11px] h-[28px]',
                      saveOpen
                        ? 'bg-[#58a6ff]/[0.08] text-[#58a6ff] border-[#58a6ff]'
                        : 'bg-transparent text-[#8b949e] border-[#2d333b] hover:bg-[#58a6ff]/20 hover:text-[#c0d6f5] hover:border-[#58a6ff]/40',
                    )}
                  >
                    {/* Bookmark icon */}
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 1.5h6a.5.5 0 0 1 .5.5v8.5L6 8l-3.5 2.5V2a.5.5 0 0 1 .5-.5z" />
                    </svg>
                    Save
                  </ButtonBase>

                  {saveOpen && (
                    <div
                      className="fixed z-[9999] rounded-xl border border-[#2d333b] p-5 shadow-xl"
                      style={{
                        backgroundColor: '#1c2028',
                        minWidth: '300px',
                        maxWidth: 'calc(100vw - 16px)',
                        top: saveDropdownRef.current ? saveDropdownRef.current.getBoundingClientRect().bottom + 8 : 0,
                        right: saveDropdownRef.current ? window.innerWidth - saveDropdownRef.current.getBoundingClientRect().right : 0,
                      }}
                    >
                      <div className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#8b949e', letterSpacing: '0.05em' }}>
                        Save Search
                      </div>

                      <input
                        ref={saveInputRef}
                        type="text"
                        value={saveName}
                        onChange={(e) => setSaveName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && saveName.trim()) {
                            onSaveSearch?.(saveName.trim());
                            setSaveOpen(false);
                            // Show toast
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

                      {/* Active filter summary pills */}
                      <div className="flex flex-wrap gap-1 mb-4">
                        {filters.searchTag !== 'all' && (
                          <span className="inline-flex items-center rounded text-[10px] font-medium px-2 py-0.5" style={{ backgroundColor: '#58a6ff14', color: '#58a6ff', border: '1px solid #58a6ff40' }}>
                            {SEARCH_TABS.find((t) => t.value === filters.searchTag)?.label}
                          </span>
                        )}
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
                        {filters.maxPricePerBed !== null && (
                          <span className="inline-flex items-center rounded text-[10px] font-medium px-2 py-0.5" style={{ backgroundColor: '#58a6ff14', color: '#58a6ff', border: '1px solid #58a6ff40' }}>
                            {pricePerBedLabel(filters.maxPricePerBed)}
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
                          onClick={() => {
                            if (saveName.trim()) {
                              onSaveSearch?.(saveName.trim());
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
                    </div>
                  )}
                </div>
              )}

              {/* My Searches chip — only when user has saved searches */}
              {savedSearches && savedSearches.length > 0 && (
                <div className="relative shrink-0" ref={mySearchesDropdownRef}>
                  <ButtonBase
                    onClick={() => {
                      setMySearchesOpen((prev) => {
                        if (!prev) {
                          setOpenChip(null);
                          setSaveOpen(false);
                        }
                        return !prev;
                      });
                    }}
                    className={cn(
                      'flex items-center gap-1 rounded-md font-medium whitespace-nowrap border px-2.5 py-0.5 text-[11px] h-[28px]',
                      mySearchesOpen
                        ? 'bg-[#58a6ff]/[0.08] text-[#58a6ff] border-[#58a6ff]'
                        : 'bg-transparent text-[#8b949e] border-[#2d333b] hover:bg-[#58a6ff]/20 hover:text-[#c0d6f5] hover:border-[#58a6ff]/40',
                    )}
                  >
                    {/* List icon */}
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 3h8M2 6h8M2 9h8" />
                    </svg>
                    My Searches
                    <span className="bg-[#58a6ff] text-[#0f1117] text-[9px] font-bold rounded-full min-w-[14px] h-3.5 flex items-center justify-center px-1">
                      {savedSearches.length}
                    </span>
                  </ButtonBase>

                  {mySearchesOpen && (
                    <div
                      className="fixed z-[9999] rounded-xl border border-[#2d333b] p-4 shadow-xl"
                      style={{
                        backgroundColor: '#1c2028',
                        minWidth: '280px',
                        maxWidth: 'min(360px, calc(100vw - 16px))',
                        maxHeight: 'min(400px, calc(100vh - 200px))',
                        overflowY: 'auto',
                        scrollbarWidth: 'thin',
                        scrollbarColor: '#2d333b #1c2028',
                        top: mySearchesDropdownRef.current ? mySearchesDropdownRef.current.getBoundingClientRect().bottom + 8 : 0,
                        right: mySearchesDropdownRef.current ? window.innerWidth - mySearchesDropdownRef.current.getBoundingClientRect().right : 0,
                      }}
                    >
                      <div className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#8b949e', letterSpacing: '0.05em' }}>
                        Saved Searches
                      </div>

                      <div className="flex flex-col gap-1.5">
                        {savedSearches.map((s) => {
                          const savedFilters = s.filters as unknown as FiltersState;
                          const filterParts: string[] = [];
                          if (savedFilters.searchTag && savedFilters.searchTag !== 'all') {
                            filterParts.push(SEARCH_TABS.find((t) => t.value === savedFilters.searchTag)?.label ?? savedFilters.searchTag);
                          }
                          if (savedFilters.selectedBeds) filterParts.push(`${Array.isArray(savedFilters.selectedBeds) ? savedFilters.selectedBeds.join('/') : savedFilters.selectedBeds} bed`);
                          if (savedFilters.maxRent) filterParts.push(`Under $${(savedFilters.maxRent / 1000).toFixed(savedFilters.maxRent % 1000 === 0 ? 0 : 1)}K`);
                          if (savedFilters.commuteRules && savedFilters.commuteRules.length > 0) filterParts.push('Commute');
                          const summary = filterParts.length > 0 ? filterParts.join(' \u00B7 ') : 'All filters';
                          const dateStr = new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                          return (
                            <div
                              key={s.id}
                              className="group/card flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors hover:bg-[#161b22]"
                              onClick={() => {
                                onLoadSearch?.(savedFilters);
                                setMySearchesOpen(false);
                              }}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium truncate" style={{ color: '#e1e4e8' }}>
                                  {s.name}
                                </div>
                                <div className="text-[10px] truncate mt-0.5" style={{ color: '#8b949e' }}>
                                  {summary} &middot; {dateStr}
                                </div>
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDeleteSearch?.(s.id);
                                }}
                                className="shrink-0 w-6 h-6 rounded flex items-center justify-center text-sm opacity-0 group-hover/card:opacity-100 transition-opacity cursor-pointer text-[#484f58] hover:text-red-400 hover:bg-red-400/10"
                              >
                                &times;
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
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
}
