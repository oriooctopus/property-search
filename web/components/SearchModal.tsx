'use client';

/**
 * SearchModal — "search a station or address" modal opened from the
 * permanent map-search icon (top-left of the map / swipe view, see
 * MapSearchButton + HomeClient's wiring). This replaces the old
 * empty-state-only StationSearchBox: search is now available everywhere,
 * not just when the current viewport has zero listings, and moving here
 * pans the map via a distinct sticky pin instead of quietly repositioning
 * the viewport underneath the listing grid.
 *
 * Deliberately does NOT touch filter state or trigger a listings search —
 * it only pans the map (via the same panMapToShowLatLng helper
 * GoToNearestMatch uses), so it composes with whatever filters are active
 * instead of fighting them. Selecting a suggestion (click or Enter) is a
 * direct user gesture, so panning here is allowed under the no-autoscroll
 * rule (MapInner.tsx) the same way GoToNearestMatch's click is — and the
 * pan happens synchronously inside that handler, never in a useEffect
 * keyed on the selection (a useEffect version would re-pan on unrelated
 * re-renders and fight the user's manual panning).
 *
 * Three suggestion sources, chosen by query state:
 *  - Empty query + signed in: recent searches from GET /api/recent-searches.
 *    Signed out (or that endpoint 404ing because its backend hasn't shipped
 *    yet) both degrade to "no recents" rather than an error.
 *  - Non-empty query: lib/station-search.ts (synchronous, in-memory, no
 *    network) merged with lib/geocode.ts (Nominatim, debounced + rate
 *    limited, network).
 *
 * Duplicate-station handling: SUBWAY_STATIONS lists one row per
 * (station, line-group) — some physical stations (e.g. two entries sharing
 * one transfer complex) share identical coordinates and must collapse into
 * one row with combined line badges, while same-named stations at genuinely
 * different locations (five separate "23 St"s) must stay separate, each
 * disambiguated by its own line badge so no two rows ever read identically.
 * See dedupeStationMatches below.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ButtonBase, IconButton } from '@/components/ui';
import { cn } from '@/lib/cn';
import { searchStations, type StationMatch } from '@/lib/station-search';
import { fetchNominatimSuggestions, type NominatimResult } from '@/lib/geocode';
import { dedupeAndLabelAddresses } from '@/lib/address-dedupe';
import { useLeafletMap } from '@/lib/viewport/LeafletMapContext';
import { useOccluders } from '@/lib/viewport/OccluderRegistry';
import { panMapToShowLatLng } from '@/lib/viewport/visibleMapView';

const NOMINATIM_DEBOUNCE_MS = 300;
// Nominatim's usage policy caps free-tier callers at ~1 req/sec. The 300ms
// debounce alone doesn't guarantee that — a user typing with ~350ms pauses
// between characters would still fire a request per pause — so we also
// enforce a hard floor between actual request *starts*.
const NOMINATIM_MIN_INTERVAL_MS = 1000;
const MIN_ADDRESS_QUERY_LEN = 2;

export interface SelectedPlace {
  label: string;
  sublabel: string | null;
  lat: number;
  lon: number;
  kind: 'station' | 'address';
}

/** Mirrors the (not-yet-landed) /api/recent-searches contract. Defined
 *  locally rather than in lib/types.ts, which a parallel agent owns. */
interface RecentSearchRow {
  id: string;
  label: string;
  sublabel: string | null;
  lat: number;
  lon: number;
  kind: 'station' | 'address';
  createdAt: string;
}

interface Suggestion {
  key: string;
  label: string;
  sublabel: string;
  lat: number;
  lon: number;
  source: 'station' | 'address' | 'recent';
}

/**
 * Collapse station matches that share a name AND a (rounded) coordinate —
 * the same physical stop listed once per line-group — into a single row
 * with a combined, de-duplicated line badge. Matches at genuinely different
 * coordinates (same name, different station) are left untouched so they
 * stay individually selectable and disambiguated by their own lines.
 */
function dedupeStationMatches(matches: StationMatch[]): StationMatch[] {
  const seen = new Map<string, StationMatch>();
  for (const m of matches) {
    const key = `${m.station.name}|${m.station.lat.toFixed(4)}|${m.station.lon.toFixed(4)}`;
    const existing = seen.get(key);
    if (existing) {
      existing.station.lines = Array.from(new Set([...existing.station.lines, ...m.station.lines]));
      if (m.score > existing.score) existing.score = m.score;
    } else {
      // Clone before mutating so we never touch the shared SUBWAY_STATIONS
      // objects that searchStations() returns references into.
      seen.set(key, { station: { ...m.station, lines: [...m.station.lines] }, score: m.score });
    }
  }
  return Array.from(seen.values());
}

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
  /** Called synchronously, after the map has already been panned, so the
   *  caller can set the sticky pin and record the recent search. */
  onSelect: (place: SelectedPlace) => void;
  userId: string | null;
  /** Element to restore focus to when the modal closes. */
  triggerRef?: React.RefObject<HTMLElement | null>;
}

export default function SearchModal({ open, onClose, onSelect, userId, triggerRef }: SearchModalProps) {
  const map = useLeafletMap();
  const occluders = useOccluders();

  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [addressResults, setAddressResults] = useState<NominatimResult[]>([]);
  const [addressLoading, setAddressLoading] = useState(false);
  const [recents, setRecents] = useState<RecentSearchRow[]>([]);
  const [recentsLoading, setRecentsLoading] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  const lastFetchStartRef = useRef(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const stationMatches = useMemo(
    () => dedupeStationMatches(searchStations(query, 10)).slice(0, 5),
    [query],
  );

  // Fresh state every time the modal opens — simpler than reconciling
  // stale state from the previous open, and fetches recents for a signed-in
  // user. A GET that 404s (backend not deployed yet) or errors degrades to
  // an empty recents list rather than surfacing anything to the user.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setHighlightedIndex(0);
    setAddressResults([]);
    setAddressLoading(false);
    if (userId) {
      setRecentsLoading(true);
      fetch('/api/recent-searches')
        .then((res) => (res.ok ? res.json() : { recents: [] }))
        .then((data: { recents?: RecentSearchRow[] }) => {
          setRecents(Array.isArray(data.recents) ? data.recents : []);
        })
        .catch(() => setRecents([]))
        .finally(() => setRecentsLoading(false));
    } else {
      setRecents([]);
    }
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open, userId]);

  // Restore focus to the button that opened the modal once it closes.
  useEffect(() => {
    if (!open) triggerRef?.current?.focus();
  }, [open, triggerRef]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    const trimmed = query.trim();
    if (trimmed.length < MIN_ADDRESS_QUERY_LEN) {
      setAddressResults([]);
      setAddressLoading(false);
      return;
    }

    setAddressLoading(true);
    const seq = ++seqRef.current;

    const fire = () => {
      const sinceLast = Date.now() - lastFetchStartRef.current;
      if (sinceLast < NOMINATIM_MIN_INTERVAL_MS) {
        debounceRef.current = setTimeout(fire, NOMINATIM_MIN_INTERVAL_MS - sinceLast);
        return;
      }
      lastFetchStartRef.current = Date.now();
      const controller = new AbortController();
      abortRef.current = controller;
      fetchNominatimSuggestions(trimmed, controller.signal)
        .then((results) => {
          // Sequence check backs up the AbortController in case an aborted
          // fetch's promise still resolves (e.g. a browser that resolves
          // instead of rejecting on abort) — guards against "j","je","jef"
          // resolving out of order and rendering the wrong list.
          if (controller.signal.aborted || seq !== seqRef.current) return;
          setAddressResults(results);
          setAddressLoading(false);
        })
        .catch(() => {
          // A failed/aborted/offline geocode must never blank out the
          // independently-tracked station results.
          if (controller.signal.aborted || seq !== seqRef.current) return;
          setAddressResults([]);
          setAddressLoading(false);
        });
    };
    debounceRef.current = setTimeout(fire, NOMINATIM_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const trimmedQuery = query.trim();
  const isEmptyQuery = trimmedQuery.length === 0;

  const suggestions: Suggestion[] = useMemo(() => {
    if (isEmptyQuery) {
      return recents.map((r) => ({
        key: `recent:${r.id}`,
        label: r.label,
        sublabel: r.sublabel ?? '',
        lat: r.lat,
        lon: r.lon,
        source: 'recent' as const,
      }));
    }
    const stations: Suggestion[] = stationMatches.map((m) => ({
      key: `station:${m.station.stopId}`,
      label: m.station.name,
      sublabel: m.station.lines.join(', '),
      lat: m.station.lat,
      lon: m.station.lon,
      source: 'station' as const,
    }));
    // dedupeAndLabelAddresses both drops true duplicate OSM way segments
    // and rewrites the label of any remaining same-named street so its
    // distinguishing detail (the ZIP) survives the 2-line clamp below —
    // see lib/address-dedupe.ts's header comment for why that's necessary
    // and dedupeStationMatches above for the equivalent station-side fix.
    const addresses: Suggestion[] = dedupeAndLabelAddresses(addressResults).map((a) => ({
      key: `address:${a.place_id}`,
      label: a.label,
      sublabel: a.type,
      lat: a.lat,
      lon: a.lon,
      source: 'address' as const,
    }));
    return [...stations, ...addresses];
  }, [isEmptyQuery, recents, stationMatches, addressResults]);

  // Keep the highlighted row in range whenever the list shrinks/grows.
  useEffect(() => {
    if (highlightedIndex >= suggestions.length) {
      setHighlightedIndex(suggestions.length > 0 ? suggestions.length - 1 : 0);
    }
  }, [suggestions.length, highlightedIndex]);

  const selectSuggestion = useCallback(
    (s: Suggestion) => {
      if (!map) return;
      // The only legal map-pan path outside a direct marker tap — see
      // GoToNearestMatch.tsx's header comment. Selecting a row (click or
      // Enter) IS the direct gesture that authorizes this call, and it runs
      // synchronously in this handler, never in an effect keyed on
      // selection state. No "same as last" guard: selecting the same place
      // twice in a row must pan again both times.
      panMapToShowLatLng(map, s.lat, s.lon, occluders?.getAll?.() ?? [], { minZoom: 15 });
      onSelect({
        label: s.label,
        sublabel: s.sublabel || null,
        lat: s.lat,
        lon: s.lon,
        kind: s.source === 'address' ? 'address' : 'station',
      });
      onClose();
    },
    [map, occluders, onSelect, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (suggestions.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((i) => (i + 1) % suggestions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const s = suggestions[highlightedIndex];
        if (s) selectSuggestion(s);
      }
    },
    [suggestions, highlightedIndex, selectSuggestion, onClose],
  );

  // Minimal focus trap: Tab/Shift+Tab cycle within the panel instead of
  // escaping to the page behind the backdrop.
  const handlePanelKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const focusable = panelRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const showNoMatches =
    !isEmptyQuery && trimmedQuery.length >= MIN_ADDRESS_QUERY_LEN && suggestions.length === 0 && !addressLoading;
  const showRecentsEmptyHint = isEmptyQuery && !!userId && !recentsLoading && recents.length === 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[2200] flex items-start justify-center px-4"
      style={{ backgroundColor: 'rgba(4, 6, 10, 0.65)', paddingTop: 'max(env(safe-area-inset-top), 16px)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search a station or address"
        onKeyDown={handlePanelKeyDown}
        className="w-full max-w-md rounded-xl border shadow-2xl overflow-hidden"
        style={{ backgroundColor: '#1c2028', borderColor: '#2d333b', marginTop: '8vh' }}
      >
        <div className="flex items-center gap-2 px-3 py-3 border-b" style={{ borderColor: '#2d333b' }}>
          <span style={{ color: '#8b949e' }} className="shrink-0" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11L14 14" />
            </svg>
          </span>
          <input
            ref={inputRef}
            type="text"
            inputMode="search"
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls="search-modal-listbox"
            aria-autocomplete="list"
            aria-activedescendant={suggestions.length > 0 ? `search-modal-option-${highlightedIndex}` : undefined}
            aria-label="Search a station or address"
            placeholder="Search a station or address"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlightedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent outline-none min-w-0"
            // Must stay >=16px or iOS Safari auto-zooms the page on focus,
            // leaving the map scaled after the modal closes.
            style={{ color: '#e1e4e8', fontSize: 16 }}
          />
          <IconButton variant="ghost" size="sm" aria-label="Close search" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
              <path d="M2 2l10 10M12 2L2 12" />
            </svg>
          </IconButton>
        </div>

        <div
          id="search-modal-listbox"
          role="listbox"
          aria-label="Search results"
          className="overflow-y-auto"
          style={{ maxHeight: '50vh' }}
        >
          {isEmptyQuery && !userId && (
            <div className="px-3 py-3 text-xs" style={{ color: '#8b949e' }}>
              Type a station or address to search.
            </div>
          )}
          {isEmptyQuery && recentsLoading && (
            <div className="px-3 py-3 text-xs" style={{ color: '#8b949e' }}>
              Loading recents…
            </div>
          )}
          {showRecentsEmptyHint && (
            <div className="px-3 py-3 text-xs" style={{ color: '#8b949e' }}>
              No recent searches yet.
            </div>
          )}
          {isEmptyQuery && suggestions.length > 0 && (
            <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#6e7681' }}>
              Recent
            </div>
          )}
          {showNoMatches && (
            <div className="px-3 py-3 text-xs" style={{ color: '#8b949e' }}>
              No matches for &ldquo;{trimmedQuery}&rdquo;
            </div>
          )}
          {suggestions.map((s, i) => (
            <ButtonBase
              key={s.key}
              id={`search-modal-option-${i}`}
              role="option"
              aria-selected={i === highlightedIndex}
              type="button"
              onClick={() => selectSuggestion(s)}
              onMouseEnter={() => setHighlightedIndex(i)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm',
                i === highlightedIndex ? 'bg-[#161b22]' : 'bg-transparent',
              )}
              style={{ color: '#e1e4e8', minHeight: 44 }}
            >
              <span
                className="flex-1 min-w-0"
                style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
              >
                {s.label}
                {s.sublabel && <span style={{ color: '#8b949e' }}> · {s.sublabel}</span>}
              </span>
              <span
                className="shrink-0 text-[9px] font-medium uppercase rounded px-1.5 py-0.5"
                style={{ backgroundColor: '#21262d', color: '#8b949e' }}
              >
                {s.source === 'station' ? 'Station' : s.source === 'recent' ? 'Recent' : 'Address'}
              </span>
            </ButtonBase>
          ))}
          {addressLoading && !isEmptyQuery && (
            <div className="flex items-center gap-2 px-3 py-2.5 text-xs" style={{ color: '#8b949e' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeLinecap="round" style={{ animation: 'spin 0.7s linear infinite' }} aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.15)" strokeWidth="2.5" />
                <path d="M21 12a9 9 0 1 1-6.219-8.56" stroke="#38bdf8" strokeWidth="2.5" />
              </svg>
              Searching addresses…
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
