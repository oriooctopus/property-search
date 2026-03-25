'use client';

import type { FiltersState, SearchTag, MaxListingAge } from '@/components/Filters';

interface FilterPillData {
  key: keyof FiltersState;
  label: string;
}

function getActiveFilters(filters: FiltersState): FilterPillData[] {
  const pills: FilterPillData[] = [];

  if (filters.minBeds !== null) {
    pills.push({ key: 'minBeds', label: `${filters.minBeds}+ Beds` });
  }
  if (filters.minBaths !== null) {
    pills.push({ key: 'minBaths', label: `${filters.minBaths}+ Baths` });
  }
  if (filters.maxRent !== null) {
    const k = filters.maxRent >= 1000 ? `$${(filters.maxRent / 1000).toFixed(filters.maxRent % 1000 === 0 ? 0 : 1)}K` : `$${filters.maxRent}`;
    pills.push({ key: 'maxRent', label: `Under ${k}` });
  }
  if (filters.minRent !== null) {
    const k = filters.minRent >= 1000 ? `$${(filters.minRent / 1000).toFixed(filters.minRent % 1000 === 0 ? 0 : 1)}K` : `$${filters.minRent}`;
    pills.push({ key: 'minRent', label: `${k}+` });
  }
  if (filters.maxPricePerBed !== null) {
    pills.push({ key: 'maxPricePerBed', label: `Under $${filters.maxPricePerBed.toLocaleString()}/bed` });
  }
  if (filters.searchTag !== 'all') {
    const tagLabels: Record<SearchTag, string> = {
      all: 'All',
      fulton: 'Near Fulton St',
      ltrain: 'Near L Train',
      manhattan: 'Manhattan',
      brooklyn: 'Brooklyn',
    };
    pills.push({ key: 'searchTag', label: tagLabels[filters.searchTag] });
  }
  if (filters.maxListingAge !== null) {
    const ageLabels: Record<string, string> = {
      '1w': '1 Week',
      '2w': '2 Weeks',
      '1m': '1 Month',
      '3m': '3 Months',
      '6m': '6 Months',
      '1y': '1 Year',
    };
    pills.push({ key: 'maxListingAge', label: `Within ${ageLabels[filters.maxListingAge] ?? filters.maxListingAge}` });
  }
  if (filters.selectedSources !== null) {
    pills.push({ key: 'selectedSources', label: `Sources (${filters.selectedSources.length})` });
  }

  return pills;
}

/** Default value used to "remove" a filter by key */
function getDefaultValue(key: keyof FiltersState): FiltersState[keyof FiltersState] {
  switch (key) {
    case 'searchTag':
      return 'all' as SearchTag;
    case 'sort':
      return 'pricePerBed';
    case 'maxListingAge':
      return '1m' as MaxListingAge;
    default:
      return null;
  }
}

interface FilterPillsProps {
  filters: FiltersState;
  onRemoveFilter: (filterKey: keyof FiltersState) => void;
}

export default function FilterPills({ filters, onRemoveFilter }: FilterPillsProps) {
  const pills = getActiveFilters(filters);

  if (pills.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-4 py-2" style={{ borderBottom: '1px solid #2d333b' }}>
      {pills.map((pill) => (
        <span
          key={pill.key}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
          style={{
            backgroundColor: 'rgba(88, 166, 255, 0.08)',
            color: '#58a6ff',
            border: '1px solid rgba(88, 166, 255, 0.3)',
          }}
        >
          {pill.label}
          <button
            onClick={() => onRemoveFilter(pill.key)}
            className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-white/10 cursor-pointer"
            aria-label={`Remove ${pill.label} filter`}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 2L8 8M8 2L2 8" />
            </svg>
          </button>
        </span>
      ))}
    </div>
  );
}

export { getActiveFilters, getDefaultValue };
export type { FilterPillData };
