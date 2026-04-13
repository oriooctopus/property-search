'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import type { Database } from '@/lib/types';
import Map from '@/components/Map';
import Filters, { type FiltersState, type SortField, type MaxListingAge } from '@/components/Filters';
import ListingCard, { type CommuteInfo } from '@/components/ListingCard';
import ListingDetail from '@/components/ListingDetail';
import RadarLoader from '@/components/RadarLoader';
import { SegmentedControl } from '@/components/ui';
import ChatPanel from '@/components/ChatPanel';
import SaveSearchModal from '@/components/SaveSearchModal';
import FilterPills from '@/components/FilterPills';
import SwipeView from '@/components/SwipeView';
import { useConversation } from '@/lib/hooks/useConversation';
import { useConversations } from '@/lib/hooks/useConversations';
import { useSavedSearches } from '@/lib/hooks/useSavedSearches';
import { useWishlists, useWishlistMutations, useWishlistedListingIds } from '@/lib/hooks/useWishlists';
import WishlistPicker from '@/components/WishlistPicker';
import { setLastUsedWishlistId } from '@/lib/wishlist-storage';

type Listing = Database['public']['Tables']['listings']['Row'];

// ---------------------------------------------------------------------------
// Seed data fallback (used when DB is empty)
// ---------------------------------------------------------------------------
const SEED_LISTINGS: Listing[] = [
  { id: -1, address: '240 E 6th St Apt 1', area: 'East Village', price: 9995, beds: 5, baths: 2, sqft: null, lat: 40.7262, lon: -73.9858, transit_summary: '~10 min walk to 1st Ave L', photos: 18, photo_urls: [], url: 'https://www.realtor.com/rentals/details/240-E-6th-St-Apt-1_New-York_NY_10003_M95522-46041', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', year_built: null, created_at: '', external_id: null, last_seen_at: null, delisted_at: null },
  { id: -2, address: '165 Attorney St Apt 5C', area: 'Lower East Side', price: 9450, beds: 6, baths: 2, sqft: null, lat: 40.7195, lon: -73.9845, transit_summary: '16 min J to Fulton', photos: 6, photo_urls: [], url: 'https://www.realtor.com/rentals/details/165-Attorney-St-Apt-5C_New-York_NY_10002_M94116-63343', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', year_built: null, created_at: '', external_id: null, last_seen_at: null, delisted_at: null },
  { id: -3, address: '53 Park Pl Ph 2', area: 'Tribeca', price: 9000, beds: 5, baths: 2, sqft: null, lat: 40.7141, lon: -74.0079, transit_summary: 'Tribeca / Park Place', photos: 12, photo_urls: [], url: 'https://www.realtor.com/rentals/details/53-Park-Pl-2_New-York_NY_10007_M90339-21295', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', year_built: null, created_at: '', external_id: null, last_seen_at: null, delisted_at: null },
  { id: -4, address: '372 Bainbridge St', area: 'Stuyvesant Heights', price: 6995, beds: 5, baths: 4, sqft: null, lat: 40.6808, lon: -73.927, transit_summary: '34 min C to 14th/8th Ave', photos: 16, photo_urls: [], url: 'https://www.realtor.com/rentals/details/372-Bainbridge-St-Unit-Triplex_Brooklyn_NY_11233_M96732-47148', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', year_built: null, created_at: '', external_id: null, last_seen_at: null, delisted_at: null },
  { id: -5, address: '171 Attorney St Unit 6A', area: 'Lower East Side', price: 11000, beds: 7, baths: 2.5, sqft: null, lat: 40.7198, lon: -73.9843, transit_summary: '16 min J to Fulton', photos: 3, photo_urls: [], url: 'https://www.realtor.com/rentals/details/171-Attorney-St-6A_New-York_NY_10002_M99751-50289', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', year_built: null, created_at: '', external_id: null, last_seen_at: null, delisted_at: null },
  { id: -6, address: '386 Stuyvesant Ave', area: 'Stuyvesant Heights', price: 12500, beds: 6, baths: 3.5, sqft: 3200, lat: 40.6838, lon: -73.9298, transit_summary: '18 min A to Fulton / 30 min to 14th', photos: 24, photo_urls: [], url: 'https://www.realtor.com/rentals/details/386-Stuyvesant-Ave_Brooklyn_NY_11233_M44801-18988', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', year_built: null, created_at: '', external_id: null, last_seen_at: null, delisted_at: null },
  { id: -7, address: '50 Murray St Unit 2211', area: 'Tribeca', price: 10000, beds: 5, baths: 2, sqft: null, lat: 40.7143, lon: -74.0086, transit_summary: 'Tribeca / Murray St', photos: 9, photo_urls: [], url: 'https://www.realtor.com/rentals/details/50-Murray-St-2211_New-York_NY_10007_M93038-48259', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', year_built: null, created_at: '', external_id: null, last_seen_at: null, delisted_at: null },
  { id: -8, address: '290 Jefferson Ave', area: 'Bedford-Stuyvesant', price: 10900, beds: 5, baths: 4, sqft: 3600, lat: 40.6862, lon: -73.943, transit_summary: '30 min A to 14th/8th Ave', photos: 19, photo_urls: [], url: 'https://www.realtor.com/rentals/details/290-Jefferson-Ave_Brooklyn_NY_11216_M49395-49974', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', year_built: null, created_at: '', external_id: null, last_seen_at: null, delisted_at: null },
  { id: -9, address: '276 Halsey St #2', area: 'Bedford-Stuyvesant', price: 10750, beds: 5, baths: 3.5, sqft: null, lat: 40.6842, lon: -73.9418, transit_summary: '31 min A to 14th/8th Ave', photos: 16, photo_urls: [], url: 'https://www.realtor.com/rentals/details/276-Halsey-St-2_Brooklyn_NY_11216_M93027-20426', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', year_built: null, created_at: '', external_id: null, last_seen_at: null, delisted_at: null },
  { id: -10, address: '53 Park Pl Apt 3E', area: 'Tribeca', price: 13500, beds: 5, baths: 3, sqft: null, lat: 40.7141, lon: -74.0079, transit_summary: 'Tribeca / Park Place', photos: 20, photo_urls: [], url: 'https://www.realtor.com/rentals/details/53-Park-Pl-Apt-3E_New-York_NY_10007_M39270-97535', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', year_built: null, created_at: '', external_id: null, last_seen_at: null, delisted_at: null },
];

// ---------------------------------------------------------------------------
// Helpers: read / write URL query params
// ---------------------------------------------------------------------------
const VALID_VIEWS = new Set(['list', 'map', 'swipe']);
const VALID_SORTS = new Set<string>(['price', 'beds', 'listDate']);
const VALID_LISTING_AGES = new Set<string>(['1h', '3h', '6h', '12h', '1d', '2d', '3d', '1w', '2w', '1m']);

function boundsFromCenter(lat: number, lng: number, zoom: number) {
  // Approximate degrees visible at given zoom level
  const latSpan = 180 / Math.pow(2, zoom);
  const lngSpan = 360 / Math.pow(2, zoom);
  return {
    latMin: lat - latSpan / 2,
    latMax: lat + latSpan / 2,
    lonMin: lng - lngSpan / 2,
    lonMax: lng + lngSpan / 2,
  };
}

function parseNumOrNull(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function readFiltersFromParams(params: URLSearchParams): FiltersState {
  const sort = params.get('sort');
  const age = params.get('maxAge');
  return {
    sort: (sort && VALID_SORTS.has(sort) ? sort : 'price') as SortField,
    selectedBeds: params.get('beds') ? params.get('beds')!.split(',').map(Number).filter(Number.isFinite) : null,
    minBaths: parseNumOrNull(params.get('minBaths')),
    minRent: parseNumOrNull(params.get('minRent')),
    maxRent: parseNumOrNull(params.get('maxRent')),
    priceMode: params.get('priceMode') === 'perRoom' ? 'perRoom' : 'total',
    maxListingAge: (age && VALID_LISTING_AGES.has(age) ? age : null) as MaxListingAge,
    photosFirst: params.get('photosFirst') === '1',
    selectedSources: params.get('sources') ? params.get('sources')!.split(',') : null,
    minYearBuilt: parseNumOrNull(params.get('minYearBuilt')),
    maxYearBuilt: parseNumOrNull(params.get('maxYearBuilt')),
    minSqft: parseNumOrNull(params.get('minSqft')),
    maxSqft: parseNumOrNull(params.get('maxSqft')),
    excludeNoSqft: params.get('excludeNoSqft') === '1',
    commuteRules: (() => {
      try {
        const raw = params.get('commute');
        return raw ? JSON.parse(raw) : [];
      } catch { return []; }
    })(),
  };
}

interface MapPosition {
  lat: number;
  lng: number;
  zoom: number;
}

function buildQueryString(view: 'list' | 'map' | 'swipe', f: FiltersState, chatMode?: boolean, listingId?: number | null, mapPos?: MapPosition | null): string {
  const p = new URLSearchParams();
  if (listingId != null) p.set('listing', String(listingId));
  if (chatMode) p.set('chat', '1');
  if (view !== 'list') p.set('view', view);
  if (f.sort !== 'price') p.set('sort', f.sort);
  if (f.selectedBeds != null) p.set('beds', f.selectedBeds.join(','));
  if (f.minBaths != null) p.set('minBaths', String(f.minBaths));
  if (f.minRent != null) p.set('minRent', String(f.minRent));
  if (f.maxRent != null) p.set('maxRent', String(f.maxRent));
  if (f.priceMode === 'perRoom') p.set('priceMode', 'perRoom');
  if (f.maxListingAge !== null) p.set('maxAge', f.maxListingAge);
  if (f.photosFirst) p.set('photosFirst', '1');
  if (f.selectedSources !== null) p.set('sources', f.selectedSources.join(','));
  if (f.minYearBuilt != null) p.set('minYearBuilt', String(f.minYearBuilt));
  if (f.maxYearBuilt != null) p.set('maxYearBuilt', String(f.maxYearBuilt));
  if (f.minSqft != null) p.set('minSqft', String(f.minSqft));
  if (f.maxSqft != null) p.set('maxSqft', String(f.maxSqft));
  if (f.excludeNoSqft) p.set('excludeNoSqft', '1');
  if (f.commuteRules && f.commuteRules.length > 0) p.set('commute', JSON.stringify(f.commuteRules));
  if (mapPos != null) {
    p.set('lat', mapPos.lat.toFixed(4));
    p.set('lng', mapPos.lng.toFixed(4));
    p.set('zoom', mapPos.zoom.toFixed(1));
  }
  const qs = p.toString();
  return qs ? `?${qs}` : '/';
}

// ---------------------------------------------------------------------------
// Inner component that uses useSearchParams (must be inside Suspense)
// ---------------------------------------------------------------------------
function HomeInner() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Feature flag: conversational search mode
  const chatMode = searchParams.get('chat') === '1';

  // Data state
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  // Wishlist system
  const { data: wishlists } = useWishlists(userId);
  const wishlistedIds = useWishlistedListingIds(userId);
  const { addToWishlist, removeFromWishlist, createWishlist } = useWishlistMutations(userId);
  const [pickerListingId, setPickerListingId] = useState<number | null>(null);
  const [pickerAnchorRect, setPickerAnchorRect] = useState<DOMRect | null>(null);

  // Viewport loading state (map pan/zoom queries)
  const [viewportLoading, setViewportLoading] = useState(false);
  const [viewportCount, setViewportCount] = useState<number | null>(null);
  const viewportRequestRef = useRef(0);
  // Pending bounds from map pan/zoom — shown as "Search this area" button
  const [pendingBounds, setPendingBounds] = useState<{ latMin: number; latMax: number; lonMin: number; lonMax: number } | null>(null);
  const hasInitialViewportLoad = useRef(false);
  // Shared ref: BoundsWatcher skips one callback when FlyToSelected sets this
  const suppressBoundsRef = useRef(false);

  // Viewport version counter — triggers commute filter re-run after viewport loads
  const [viewportVersion, setViewportVersion] = useState(0);

  // Commute filter state
  const [commuteMatchIds, setCommuteMatchIds] = useState<Set<number> | null>(null);
  const [commuteInfoMap, setCommuteInfoMap] = useState<globalThis.Map<number, CommuteInfo> | null>(null);
  const [commuteMessage, setCommuteMessage] = useState<string | null>(null);
  const [commuteLoading, setCommuteLoading] = useState(false);

  // Filter-changing overlay state
  const [filterChanging, setFilterChanging] = useState(false);
  const filterMountedRef = useRef(false);

  // Hidden listings — persisted in localStorage
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = localStorage.getItem('dwelligence_hidden_listings');
      return stored ? new Set(JSON.parse(stored) as number[]) : new Set();
    } catch {
      return new Set();
    }
  });
  const [hidingId, setHidingId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ listingId: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const persistHidden = useCallback((ids: Set<number>) => {
    try {
      localStorage.setItem('dwelligence_hidden_listings', JSON.stringify([...ids]));
    } catch { /* quota exceeded — silently ignore */ }
  }, []);

  const loadForViewport = useCallback(async (bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number }) => {
    const requestId = ++viewportRequestRef.current;
    setViewportLoading(true);
    try {
      const { data, error } = await supabase
        .from('listings')
        .select('*')
        .is('delisted_at', null)
        .gte('lat', bounds.latMin)
        .lte('lat', bounds.latMax)
        .gte('lon', bounds.lonMin)
        .lte('lon', bounds.lonMax)
        .order('last_update_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(500);
      // Discard stale responses from superseded requests
      if (requestId !== viewportRequestRef.current) return;
      if (error) {
        console.error('[viewport] query error:', error.message);
        return;
      }
      if (data) {
        const newListings = (data as unknown as Listing[]).map((l) => ({
          ...l,
          lat: l.lat != null ? Number(l.lat) : null,
          lon: l.lon != null ? Number(l.lon) : null,
          baths: l.baths != null ? Number(l.baths) : null,
          sqft: l.sqft != null ? Number(l.sqft) : null,
          price: Number(l.price),
          beds: Number(l.beds),
          photos: Number(l.photos),
          photo_urls: l.photo_urls ?? [],
        }));
        // Only replace listings if results were found; keep existing pins when
        // panning to empty areas (parks, water, outside city).
        if (newListings.length > 0) {
          setListings(newListings);
          setViewportVersion(v => v + 1);
          // Null out viewport count so the badge falls back to the accurate
          // filtered count (client-side filters have not been applied to
          // newListings yet at this point).
          setViewportCount(null);
        } else {
          // Empty area — keep existing listings but show "0 rentals" in badge
          setViewportCount(0);
        }
      }
    } catch (err) {
      console.error('[viewport] fetch failed:', err);
    } finally {
      if (requestId === viewportRequestRef.current) {
        setViewportLoading(false);
        setPendingBounds(null);
      }
    }
  }, [supabase]);

  const handleHideListing = useCallback((listingId: number) => {
    // Start fade-out animation
    setHidingId(listingId);

    // Clear any existing toast timer
    if (toast) clearTimeout(toast.timer);

    // After animation completes, actually hide it
    setTimeout(() => {
      setHiddenIds((prev) => {
        const next = new Set(prev);
        next.add(listingId);
        persistHidden(next);
        return next;
      });
      setHidingId(null);

      // Show toast with undo
      const timer = setTimeout(() => {
        setToast(null);
      }, 5000);
      setToast({ listingId, timer });
    }, 300);
  }, [toast, persistHidden]);

  const handleUndoHide = useCallback(() => {
    if (!toast) return;
    clearTimeout(toast.timer);
    const restoredId = toast.listingId;
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.delete(restoredId);
      persistHidden(next);
      return next;
    });
    setToast(null);
  }, [toast, persistHidden]);

  // UI state — initialised from URL query params
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailListing, setDetailListing] = useState<Listing | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'map' | 'swipe'>(() => {
    const v = searchParams.get('view');
    if (v && VALID_VIEWS.has(v)) return v as 'list' | 'map' | 'swipe';
    return 'list';
  });
  const [filters, setFilters] = useState<FiltersState>(() =>
    readFiltersFromParams(searchParams),
  );

  // Map position — read initial values from URL params if present and valid
  const [mapPosition, setMapPosition] = useState<MapPosition | null>(() => {
    const latStr = searchParams.get('lat');
    const lngStr = searchParams.get('lng');
    const zoomStr = searchParams.get('zoom');
    if (latStr == null || lngStr == null) return null;
    const lat = Number(latStr);
    const lng = Number(lngStr);
    const zoom = zoomStr != null ? Number(zoomStr) : 13;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (!Number.isFinite(zoom) || zoom < 1 || zoom > 20) return null;
    return { lat, lng, zoom };
  });

  const initialCenter: [number, number] | undefined = mapPosition != null
    ? [mapPosition.lat, mapPosition.lng]
    : undefined;
  const initialZoom: number | undefined = mapPosition?.zoom;

  // -----------------------------------------------------------------------
  // Chat mode hooks
  // -----------------------------------------------------------------------
  const filteredListingsRef = useRef<Listing[]>([]);

  const chat = useConversation({
    onFiltersChange: useCallback((newFilters: FiltersState) => {
      setFilters(newFilters);
    }, []),
    getListingCount: useCallback(() => filteredListingsRef.current.length, []),
  });

  const { conversations, invalidate: invalidateConversations } = useConversations();
  const { savedSearches, saveSearch: saveSavedSearch, deleteSearch: deleteSavedSearch, updateSearch: updateSavedSearch } = useSavedSearches(userId);

  const [saveSearchOpen, setSaveSearchOpen] = useState(false);
  const [chatDrawerOpen, setChatDrawerOpen] = useState(chatMode);

  // Open chat drawer when ?chat=1 is in URL
  useEffect(() => {
    if (chatMode) {
      setChatDrawerOpen(true);
    }
  }, [chatMode]);

  // Called by BoundsWatcher when the user pans/zooms the map
  const handleMapMove = useCallback((center: { lat: number; lng: number }, zoom: number) => {
    setMapPosition({ lat: center.lat, lng: center.lng, zoom });
  }, []);

  // Sync state changes to URL via history.replaceState (avoids Next.js
  // navigation overhead and unnecessary re-renders).
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    window.history.replaceState(null, '', buildQueryString(mobileView, filters, chatMode, detailListing?.id ?? null, mapPosition));
  }, [mobileView, filters, chatMode, detailListing, mapPosition]);

  // Show filter-loading overlay whenever filters change (skip initial mount)
  useEffect(() => {
    if (!filterMountedRef.current) {
      filterMountedRef.current = true;
      return;
    }
    setFilterChanging(true);
    const timer = setTimeout(() => setFilterChanging(false), 400);
    return () => clearTimeout(timer);
  }, [filters]);

  // -----------------------------------------------------------------------
  // Fetch data
  // -----------------------------------------------------------------------
  useEffect(() => {
    async function load() {
      try {
      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const uid = user?.id ?? null;
      setUserId(uid);

      // Fetch listings — if URL has a saved map position, scope the initial
      // query to those bounds so we don't load listings from the wrong area.
      const initLat = searchParams.get('lat');
      const initLng = searchParams.get('lng');
      const initZoom = searchParams.get('zoom');
      const hasUrlPosition = initLat != null && initLng != null && Number.isFinite(Number(initLat)) && Number.isFinite(Number(initLng));

      let listingsQuery = supabase
        .from('listings')
        .select('*')
        .is('delisted_at', null);

      if (hasUrlPosition) {
        const urlBounds = boundsFromCenter(
          Number(initLat),
          Number(initLng),
          initZoom != null && Number.isFinite(Number(initZoom)) ? Number(initZoom) : 13,
        );
        listingsQuery = listingsQuery
          .gte('lat', urlBounds.latMin)
          .lte('lat', urlBounds.latMax)
          .gte('lon', urlBounds.lonMin)
          .lte('lon', urlBounds.lonMax)
          .order('last_update_date', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(500);
        hasInitialViewportLoad.current = true;
      } else {
        // Default NYC viewport — covers all 5 boroughs. Matches the gating
        // envelope in pipeline.ts. Bounded query + 500-row cap keeps cold
        // load fast (single round-trip instead of paginating 8k+ rows).
        listingsQuery = listingsQuery
          .gte('lat', 40.55)
          .lte('lat', 40.92)
          .gte('lon', -74.05)
          .lte('lon', -73.70)
          .order('last_update_date', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(500);
        hasInitialViewportLoad.current = true;
      }

      const { data: listingsData } = await listingsQuery;
      const dbListings: unknown[] = listingsData ?? [];

      // Supabase returns Postgres `numeric` columns as strings.
      // Coerce lat, lon, baths (and sqft just in case) to real numbers
      // so every downstream component receives proper JS numbers.
      const rawListings: Listing[] =
        dbListings && dbListings.length > 0
          ? (dbListings as unknown as Listing[])
          : SEED_LISTINGS;
      const allListings = rawListings.map((l) => ({
        ...l,
        lat: l.lat != null ? Number(l.lat) : null,
        lon: l.lon != null ? Number(l.lon) : null,
        baths: l.baths != null ? Number(l.baths) : null,
        sqft: l.sqft != null ? Number(l.sqft) : null,
        price: Number(l.price),
        beds: Number(l.beds),
        photos: Number(l.photos),
        photo_urls: l.photo_urls ?? [],
      }));
      setListings(allListings);

      } catch (err) {
        console.error('Failed to load data:', err);
      } finally {
        setLoading(false);
      }
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------------------------------------------------
  // Commute filter: call API when commuteRules change
  // -----------------------------------------------------------------------
  useEffect(() => {
    const rules = filters.commuteRules;
    if (!rules || rules.length === 0) {
      setCommuteMatchIds(null);
      setCommuteInfoMap(null);
      setCommuteMessage(null);
      setCommuteLoading(false);
      return;
    }

    let cancelled = false;
    setCommuteLoading(true);

    // NYC subway line colors for commute badges
    const SUBWAY_COLORS: Record<string, string> = {
      '1': '#EE352E', '2': '#EE352E', '3': '#EE352E',
      '4': '#00933C', '5': '#00933C', '6': '#00933C',
      '7': '#B933AD',
      'A': '#0039A6', 'C': '#0039A6', 'E': '#0039A6',
      'B': '#FF6319', 'D': '#FF6319', 'F': '#FF6319', 'M': '#FF6319',
      'G': '#6CBE45',
      'J': '#996633', 'Z': '#996633',
      'L': '#A7A9AC',
      'N': '#FCCC0A', 'Q': '#FCCC0A', 'R': '#FCCC0A', 'W': '#FCCC0A',
      'S': '#808183',
    };

    // Determine the route letter and color from the commute rules
    // Use the first subway-line or station rule's first line
    let routeLetter: string | undefined;
    let routeColor: string | undefined;
    let destination: string | undefined;
    for (const rule of rules) {
      if ((rule.type === 'subway-line' || rule.type === 'station') && rule.lines && rule.lines.length > 0) {
        routeLetter = rule.lines[0];
        routeColor = SUBWAY_COLORS[routeLetter] ?? '#8b949e';
        break;
      }
    }

    (async () => {
      try {
        const res = await fetch('/api/commute-filter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commuteRules: rules }),
        });
        if (cancelled) return;
        const data = await res.json();
        if (cancelled) return;

        if (data.listingIds != null) {
          setCommuteMatchIds(new Set(data.listingIds as number[]));
          setCommuteMessage(null);

          // Build CommuteInfo map from API response
          // Use globalThis.Map because the local `Map` import shadows the global Map constructor
          const infoMap: globalThis.Map<number, CommuteInfo> = new globalThis.Map();
          const apiMeta = data.commuteInfo as Record<string, { minutes: number; station: string; mode: string }> | null;
          if (apiMeta) {
            for (const [idStr, meta] of Object.entries(apiMeta)) {
              const id = Number(idStr);
              // Determine destination: use station name from API
              destination = meta.station;

              infoMap.set(id, {
                minutes: meta.minutes,
                route: routeLetter,
                routeColor,
                destination,
              });
            }
          }
          setCommuteInfoMap(infoMap.size > 0 ? infoMap : null);
        } else {
          setCommuteMatchIds(null);
          setCommuteInfoMap(null);
          setCommuteMessage(data.message ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[commute-filter] fetch failed:', err);
          setCommuteMatchIds(null);
          setCommuteInfoMap(null);
          setCommuteMessage('Failed to apply commute filter');
        }
      } finally {
        if (!cancelled) setCommuteLoading(false);
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.commuteRules]);

  // -----------------------------------------------------------------------
  // Deep-link: auto-open listing from ?listing=ID on page load
  // -----------------------------------------------------------------------
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (deepLinkHandled.current || loading || listings.length === 0) return;
    deepLinkHandled.current = true;

    const listingParam = searchParams.get('listing');
    if (!listingParam) return;

    const listingId = Number(listingParam);
    if (!Number.isFinite(listingId)) return;

    // First check if the listing is already loaded
    const found = listings.find((l) => l.id === listingId);
    if (found) {
      setSelectedId(found.id);
      setDetailListing(found);
      return;
    }

    // Otherwise fetch it from Supabase
    (async () => {
      const { data } = await supabase
        .from('listings')
        .select('*')
        .eq('id', listingId)
        .single();
      if (data) {
        const raw = data as unknown as Listing;
        const l: Listing = {
          ...raw,
          lat: raw.lat != null ? Number(raw.lat) : null,
          lon: raw.lon != null ? Number(raw.lon) : null,
          baths: raw.baths != null ? Number(raw.baths) : null,
          sqft: raw.sqft != null ? Number(raw.sqft) : null,
          price: Number(raw.price),
          beds: Number(raw.beds),
          photos: Number(raw.photos),
          photo_urls: raw.photo_urls ?? [],
        };
        setSelectedId(l.id);
        setDetailListing(l);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, listings]);

  // -----------------------------------------------------------------------
  // Filter + sort
  // -----------------------------------------------------------------------
  const filteredListings = useMemo(() => {
    let result = [...listings];

    // Filter out hidden listings (unless showHidden is active)
    if (!showHidden) {
      result = result.filter((l) => !hiddenIds.has(l.id));
    }

    // Scam filter: remove per-room listings (price per bedroom below $800)
    result = result.filter((l) => l.beds === 0 || l.price / l.beds >= 800);

    if (filters.selectedBeds !== null && filters.selectedBeds.length > 0) {
      result = result.filter((l) => {
        // If 7 is selected, include listings with 7+ beds
        if (filters.selectedBeds!.includes(7) && l.beds >= 7) return true;
        return filters.selectedBeds!.includes(l.beds);
      });
    }
    if (filters.minRent !== null) {
      result = result.filter((l) => {
        const effectivePrice = filters.priceMode === 'perRoom'
          ? l.price / Math.max(l.beds ?? 1, 1)
          : l.price;
        return effectivePrice >= filters.minRent!;
      });
    }
    if (filters.maxRent !== null) {
      result = result.filter((l) => {
        const effectivePrice = filters.priceMode === 'perRoom'
          ? l.price / Math.max(l.beds ?? 1, 1)
          : l.price;
        return effectivePrice <= filters.maxRent!;
      });
    }

    // Listing age filter
    if (filters.maxListingAge !== null) {
      const now = Date.now();
      const msMap: Record<string, number> = {
        '1h': 3_600_000,
        '3h': 10_800_000,
        '6h': 21_600_000,
        '12h': 43_200_000,
        '1d': 86_400_000,
        '2d': 172_800_000,
        '3d': 259_200_000,
        '1w': 604_800_000,
        '2w': 1_209_600_000,
        '1m': 2_592_000_000,
      };
      const cutoff = now - (msMap[filters.maxListingAge] ?? 0);
      result = result.filter((l) => {
        const dateStr = l.list_date ?? l.created_at;
        if (!dateStr) return true;
        return new Date(dateStr).getTime() >= cutoff;
      });
    }

    // Bathroom filter
    if (filters.minBaths !== null) {
      result = result.filter((l) => (l.baths ?? 0) >= filters.minBaths!);
    }

    // Year built filter
    if (filters.minYearBuilt !== null) {
      result = result.filter((l) => (l.year_built ?? 0) >= filters.minYearBuilt!);
    }
    if (filters.maxYearBuilt !== null) {
      result = result.filter((l) => (l.year_built ?? new Date().getFullYear()) <= filters.maxYearBuilt!);
    }

    // Sqft filter
    if (filters.excludeNoSqft) {
      result = result.filter((l) => l.sqft != null);
    }
    if (filters.minSqft !== null) {
      result = result.filter((l) => l.sqft != null && l.sqft >= filters.minSqft!);
    }
    if (filters.maxSqft !== null) {
      result = result.filter((l) => l.sqft != null && l.sqft <= filters.maxSqft!);
    }

    // Source filter
    if (filters.selectedSources !== null) {
      const srcSet = new Set(filters.selectedSources);
      result = result.filter((l) => l.source && srcSet.has(l.source));
    }

    // Commute filter: restrict to listings matching commute rules
    if (commuteMatchIds !== null) {
      result = result.filter((l) => commuteMatchIds.has(l.id));
    }

    result.sort((a, b) => {
      if (filters.photosFirst) {
        const aHasPhotos = (a.photos ?? 0) > 0 ? 0 : 1;
        const bHasPhotos = (b.photos ?? 0) > 0 ? 0 : 1;
        if (aHasPhotos !== bHasPhotos) return aHasPhotos - bHasPhotos;
      }
      switch (filters.sort) {
        case 'price':
          return a.price - b.price;
        case 'beds':
          return b.beds - a.beds;
        case 'listDate':
          return new Date((b.list_date ?? b.created_at) || 0).getTime() - new Date((a.list_date ?? a.created_at) || 0).getTime();
        default:
          return 0;
      }
    });

    return result;
  }, [listings, filters, hiddenIds, showHidden, commuteMatchIds]);

  // Keep the ref in sync so the chat hook's getListingCount stays current
  filteredListingsRef.current = filteredListings;

  // -----------------------------------------------------------------------
  // Wishlist handlers
  // -----------------------------------------------------------------------
  const handleStarClick = useCallback((listingId: number, anchorRect: DOMRect) => {
    setPickerListingId(listingId);
    setPickerAnchorRect(anchorRect);
  }, []);

  const handleWishlistToggle = useCallback((wishlistId: string, checked: boolean) => {
    if (!pickerListingId) return;
    if (checked) {
      addToWishlist.mutate({ wishlistId, listingId: pickerListingId });
      setLastUsedWishlistId(wishlistId);
    } else {
      removeFromWishlist.mutate({ wishlistId, listingId: pickerListingId });
    }
  }, [pickerListingId, addToWishlist, removeFromWishlist]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  if (loading) {
    return <RadarLoader />;
  }

  // -----------------------------------------------------------------------
  // Shared listing cards renderer
  // -----------------------------------------------------------------------
  const listingCards = (
    <>
      {filteredListings.map((listing) => (
        <ListingCard
          key={listing.id}
          listing={listing}
          isSelected={listing.id === selectedId}
          isFavorited={wishlistedIds.has(listing.id)}
          isHiding={hidingId === listing.id}
          commuteInfo={commuteInfoMap?.get(listing.id)}
          onClick={() => setSelectedId(listing.id)}
          onStarClick={handleStarClick}
          onExpand={() => setDetailListing(listing)}
          onHide={() => handleHideListing(listing.id)}
        />
      ))}

{commuteMessage && !commuteLoading && (
        <div className="text-center py-4 text-xs" style={{ color: '#f0883e' }}>
          {commuteMessage}
        </div>
      )}
      {filteredListings.length === 0 && !commuteLoading && (
        <div className="col-span-full flex items-center justify-center min-h-[200px] text-center text-sm" style={{ color: '#8b949e' }}>
          No listings match your filters.
        </div>
      )}
    </>
  );

  const viewToggle = (
    <SegmentedControl
      value={mobileView}
      onChange={(v) => setMobileView(v as 'list' | 'map' | 'swipe')}
      options={[
        { value: 'list', label: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg> },
        { value: 'swipe', label: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="14" height="18" rx="2"/><rect x="8" y="2" width="14" height="18" rx="2"/></svg> },
        { value: 'map', label: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg> },
      ]}
    />
  );

  const isMapView = mobileView === 'map';

  const isSwipeView = mobileView === 'swipe';

  const mapPanel = (
    <div className={`flex-1 relative ${mobileView === 'list' ? 'hidden lg:block' : mobileView === 'map' ? 'block' : 'hidden'}`} style={{ minHeight: 'calc(100vh - 60px - 42px)' }}>
      <Map
        listings={filteredListings}
        selectedId={selectedId}
        favoritedIds={wishlistedIds}
        onHideListing={handleHideListing}
        onToggleFavorite={(id) => {
          const btn = document.querySelector(`[data-action="save"][data-listing-id="${id}"]`);
          const rect = btn?.getBoundingClientRect() ?? new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0);
          handleStarClick(id, rect);
        }}
        onSelectDetail={(listing) => { console.log(`[page] onSelectDetail called for listing #${listing.id} "${listing.address}"`); setDetailListing(listing); }}
        commuteInfoMap={commuteInfoMap ?? undefined}
        onBoundsChange={(bounds) => {
          // First bounds event: auto-load to populate the initial view
          if (!hasInitialViewportLoad.current) {
            hasInitialViewportLoad.current = true;
            loadForViewport(bounds);
          } else {
            // Subsequent moves: show "Search this area" button
            setPendingBounds(bounds);
          }
        }}
        onMapMove={handleMapMove}
        suppressBoundsRef={suppressBoundsRef}
        initialCenter={initialCenter}
        initialZoom={initialZoom}
        visible={isMapView}
        onMarkerClick={(id) => {
          setSelectedId(id);
          if (window.innerWidth >= 1024) {
            setTimeout(() => {
              const el = document.getElementById(`listing-${id}`);
              el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
          }
        }}
      />

      {/* Map overlay: "Search this area" button or loading spinner */}
      {(viewportLoading || commuteLoading || pendingBounds) && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500]">
          {(viewportLoading || commuteLoading) ? (
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium pointer-events-none"
              style={{
                backgroundColor: '#1c2028',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#8b949e',
                boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeLinecap="round"
                style={{ animation: 'spin 0.7s linear infinite', flexShrink: 0 }}>
                <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.12)" strokeWidth="2.5" />
                <path d="M21 12a9 9 0 1 1-6.219-8.56" stroke="#38bdf8" strokeWidth="2.5" />
              </svg>
              Searching...
            </div>
          ) : (
            <button
              onClick={() => {
                if (pendingBounds) {
                  loadForViewport(pendingBounds);
                  setPendingBounds(null);
                }
              }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium"
              style={{
                backgroundColor: '#1c2028',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#e1e4e8',
                boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
                cursor: 'pointer',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              Search this area
            </button>
          )}
        </div>
      )}
    </div>
  );

  const toastEl = toast && (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[1400] flex items-center gap-3 rounded-lg px-4 py-3 shadow-lg"
      style={{
        backgroundColor: '#1c2028',
        border: '1px solid #2d333b',
        color: '#e1e4e8',
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        animation: 'toast-in 200ms ease-out',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
      <span className="text-sm">Listing hidden</span>
      <button
        onClick={handleUndoHide}
        className="text-sm font-medium hover:underline cursor-pointer"
        style={{ color: '#58a6ff', background: 'none', border: 'none', padding: 0 }}
      >
        Undo
      </button>
    </div>
  );

  const detailModal = detailListing && (
    <ListingDetail
      listing={detailListing}
      isFavorited={wishlistedIds.has(detailListing.id)}
      commuteRules={filters.commuteRules}
      onStarClick={handleStarClick}
      onHide={() => handleHideListing(detailListing.id)}
      onClose={() => {
        setDetailListing(null);
      }}
    />
  );

  // -----------------------------------------------------------------------
  // Shared: AI-applied filter pills (shown when AI has applied criteria)
  // -----------------------------------------------------------------------
  const hasAIFilters = chat.messages.length > 0;

  // -----------------------------------------------------------------------
  // Chat drawer (slide-out panel from the right)
  // -----------------------------------------------------------------------
  const chatDrawer = chatDrawerOpen && (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[1300] lg:hidden"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
        onClick={() => setChatDrawerOpen(false)}
      />
      {/* Drawer panel */}
      <div
        className="fixed inset-y-0 right-0 z-[1400] flex flex-col"
        style={{
          width: 'min(420px, 100vw)',
          backgroundColor: '#0f1117',
          borderLeft: '1px solid #2d333b',
          boxShadow: '-8px 0 24px rgba(0,0,0,0.4)',
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {/* Drawer header */}
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ borderBottom: '1px solid #2d333b' }}
        >
          <h2 className="text-sm font-semibold" style={{ color: '#e1e4e8' }}>
            AI Search
          </h2>
          <button
            onClick={() => setChatDrawerOpen(false)}
            className="rounded p-1.5 transition-colors hover:bg-white/5 cursor-pointer"
            style={{ color: '#8b949e' }}
            aria-label="Close chat"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M3 3L13 13M13 3L3 13" />
            </svg>
          </button>
        </div>

        {/* Chat sidebar tabs for conversations */}
        <div className="flex shrink-0 overflow-x-auto gap-1 px-3 py-2" style={{ borderBottom: '1px solid #2d333b' }}>
          <button
            onClick={() => chat.newConversation()}
            className="shrink-0 text-xs px-3 py-1.5 rounded-full transition-colors hover:bg-[#58a6ff]/10 cursor-pointer"
            style={{
              color: '#58a6ff',
              border: '1px solid #2d333b',
              backgroundColor: 'transparent',
            }}
          >
            + New
          </button>
          {conversations.slice(0, 5).map((c) => (
            <button
              key={c.id}
              onClick={() => chat.loadConversation(c.id)}
              className="shrink-0 text-xs px-3 py-1.5 rounded-full transition-colors cursor-pointer truncate max-w-[120px]"
              style={{
                color: chat.conversation?.id === c.id ? '#58a6ff' : '#8b949e',
                border: `1px solid ${chat.conversation?.id === c.id ? 'rgba(88,166,255,0.3)' : '#2d333b'}`,
                backgroundColor: chat.conversation?.id === c.id ? 'rgba(88,166,255,0.08)' : 'transparent',
              }}
            >
              {c.name || c.firstMessage?.slice(0, 20) || 'Untitled'}
            </button>
          ))}
        </div>

        {/* Chat panel — full conversation */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <ChatPanel
            messages={chat.messages}
            filters={filters}
            onSendMessage={chat.sendMessage}
            onRemoveFilter={chat.removeFilter}
            onReAddFilter={chat.reAddFilter}
            onSaveSearch={() => setSaveSearchOpen(true)}
            isLoading={chat.isLoading}
            listingCount={filteredListings.length}
            conversationName={chat.conversation?.name}
          />
        </div>
      </div>
    </>
  );

  // -----------------------------------------------------------------------
  // Unified layout: AI search bar + filters + listings + map
  // Chat drawer slides over from right when opened
  // -----------------------------------------------------------------------
  return (
    <div className="relative flex flex-col lg:flex-row" style={{ height: 'calc(100dvh - 60px - env(safe-area-inset-top))' }}>
      {/* Sidebar: AI search bar + filters + listing cards */}
      <div
        className={`${isSwipeView ? 'absolute top-0 left-0 right-0 z-20' : `w-full lg:w-[480px] shrink-0 ${mobileView === 'map' ? 'max-lg:shrink max-lg:flex-none' : ''}`} flex flex-col`}
        style={{ borderRight: isSwipeView ? 'none' : '1px solid #2d333b' }}
      >
        {/* AI-applied filter pills */}
        {hasAIFilters && (
          <FilterPills
            filters={filters}
            onRemoveFilter={chat.removeFilter}
          />
        )}

        <div className="relative z-[1100]">
          <Filters
            filters={filters}
            onChange={setFilters}
            listingCount={filteredListings.length}
            viewToggle={viewToggle}
            userId={userId}
            savedSearches={savedSearches}
            onSaveSearch={async (name) => saveSavedSearch(name, filters)}
            onDeleteSearch={deleteSavedSearch}
            onLoadSearch={setFilters}
            onUpdateSearch={updateSavedSearch}
            onLoginRequired={() => router.push('/auth/login')}
            showHidden={showHidden}
            onToggleShowHidden={() => setShowHidden((v) => !v)}
          />
        </div>

        <div className="relative flex-1 min-h-0 flex flex-col">
          {!isSwipeView && (
            <div
              className={`flex-1 overflow-y-auto dark-scrollbar min-h-0 px-3 py-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3 relative z-0 ${mobileView === 'map' ? 'hidden lg:grid' : ''}`}
              style={{ opacity: (filterChanging || commuteLoading) ? 0.35 : 1, transition: 'opacity 150ms' }}
            >
              {listingCards}
            </div>
          )}

          {/* Filter-changing overlay — uses pointer-events-none + fixed centering scoped to sidebar */}
          {(filterChanging || commuteLoading) && mobileView !== 'swipe' && (
            <div
              className={mobileView === 'map' ? 'hidden lg:block' : 'block'}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 10,
                pointerEvents: 'none',
              }}
            >
              {/* Sticky inner: stays centered in the visible viewport slice */}
              <div
                style={{
                  position: 'sticky',
                  top: 0,
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'column',
                  gap: 10,
                  background: 'rgba(15, 17, 23, 0.65)',
                }}
              >
                {/* Mini radar animation */}
                <div style={{ position: 'relative', width: 90, height: 90 }}>
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M3 10.5L12 3l9 7.5V21H15v-6H9v6H3V10.5z" fill="#58a6ff" fillOpacity="0.9" />
                    </svg>
                  </div>
                  {[
                    { r: 18, dur: '1.2s', delay: '0s', size: 5 },
                    { r: 26, dur: '1.8s', delay: '-0.4s', size: 4 },
                    { r: 34, dur: '2.4s', delay: '-0.9s', size: 5 },
                    { r: 40, dur: '3.0s', delay: '-1.5s', size: 3 },
                    { r: 44, dur: '3.6s', delay: '-2.1s', size: 4 },
                  ].map((dot, i) => (
                    <div
                      key={i}
                      style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        width: dot.size,
                        height: dot.size,
                        marginTop: -dot.size / 2,
                        marginLeft: -dot.size / 2,
                        borderRadius: '50%',
                        background: '#58a6ff',
                        animation: `filterOrbit${dot.r} ${dot.dur} linear infinite`,
                        animationDelay: dot.delay,
                        transformOrigin: '50% 50%',
                      }}
                    />
                  ))}
                </div>
                <span style={{ color: '#8b949e', fontSize: 12, fontWeight: 500, letterSpacing: '0.03em' }}>
                  {commuteLoading ? 'Applying commute filter…' : 'Filtering…'}
                </span>
                <style>{`
                  @keyframes filterOrbit18 { from { transform: rotate(0deg) translateX(18px); } to { transform: rotate(360deg) translateX(18px); } }
                  @keyframes filterOrbit26 { from { transform: rotate(0deg) translateX(26px); } to { transform: rotate(360deg) translateX(26px); } }
                  @keyframes filterOrbit34 { from { transform: rotate(0deg) translateX(34px); } to { transform: rotate(360deg) translateX(34px); } }
                  @keyframes filterOrbit40 { from { transform: rotate(0deg) translateX(40px); } to { transform: rotate(360deg) translateX(40px); } }
                  @keyframes filterOrbit44 { from { transform: rotate(0deg) translateX(44px); } to { transform: rotate(360deg) translateX(44px); } }
                `}</style>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Map (hidden in swipe mode — SwipeView has its own map) */}
      {!isSwipeView && mapPanel}

      {/* Full-screen swipe view (replaces sidebar + map) */}
      {isSwipeView && (
        <div className="relative flex-1">
          <SwipeView
            listings={filteredListings}
            userId={userId}
            onHideListing={handleHideListing}
            onSaveListing={() => {}}
            onExpandDetail={(listing) => { setSelectedId(listing.id); setDetailListing(filteredListings.find(l => l.id === listing.id) ?? null); }}
            onSwitchView={() => setMobileView('list')}
            onBoundsChange={(bounds) => {
              if (!hasInitialViewportLoad.current) {
                hasInitialViewportLoad.current = true;
                loadForViewport(bounds);
              } else {
                setPendingBounds(bounds);
              }
            }}
            onMapMove={handleMapMove}
            suppressBoundsRef={suppressBoundsRef}
            initialCenter={initialCenter}
            initialZoom={initialZoom}
            commuteInfoMap={commuteInfoMap ?? undefined}
          />

          {/* "Search this area" pill overlay for swipe mode */}
          {(viewportLoading || commuteLoading || pendingBounds) && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] pointer-events-none">
              {(viewportLoading || commuteLoading) ? (
                <div
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
                  style={{
                    backgroundColor: '#1c2028',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: '#8b949e',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeLinecap="round"
                    style={{ animation: 'spin 0.7s linear infinite', flexShrink: 0 }}>
                    <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.12)" strokeWidth="2.5" />
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" stroke="#38bdf8" strokeWidth="2.5" />
                  </svg>
                  Searching...
                </div>
              ) : (
                <button
                  onClick={() => {
                    if (pendingBounds) {
                      loadForViewport(pendingBounds);
                      setPendingBounds(null);
                    }
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium"
                  style={{
                    backgroundColor: '#1c2028',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: '#e1e4e8',
                    boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
                    cursor: 'pointer',
                    pointerEvents: 'auto',
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                  </svg>
                  Search this area
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Chat drawer (slide-out) */}
      {chatDrawer}

      {/* Toast */}
      {toastEl}

      {/* Detail modal */}
      {detailModal}

      {/* Wishlist picker */}
      {pickerListingId !== null && wishlists && (
        <WishlistPicker
          listingId={pickerListingId}
          wishlists={wishlists}
          onToggle={handleWishlistToggle}
          onCreateNew={(name) => createWishlist.mutate(name)}
          onClose={() => setPickerListingId(null)}
          anchorRect={pickerAnchorRect}
        />
      )}

      {/* Save search modal */}
      {saveSearchOpen && (
        <SaveSearchModal
          suggestedName={chat.conversation?.name || chat.messages.find((m) => m.role === 'user')?.content || 'My Search'}
          onSave={async (name) => {
            await chat.saveConversation(name);
            invalidateConversations();
            setSaveSearchOpen(false);
          }}
          onCancel={() => setSaveSearchOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Default export wraps HomeInner in Suspense (required by useSearchParams)
// ---------------------------------------------------------------------------
export default function Home() {
  return (
    <Suspense
      fallback={<RadarLoader />}
    >
      <HomeInner />
    </Suspense>
  );
}
