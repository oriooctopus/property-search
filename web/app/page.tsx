'use client';

import { Suspense, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase-browser';
import type { Database } from '@/lib/types';
import Map from '@/components/Map';
import Filters, { type FiltersState, type FiltersHandle, type SortField, type MaxListingAge } from '@/components/Filters';
import { type CommuteInfo } from '@/components/ListingCard';
import VirtualListingGrid, { type VirtualListingGridHandle } from '@/components/VirtualListingGrid';
import ListingDetail from '@/components/ListingDetail';
import RadarLoader from '@/components/RadarLoader';
import { SegmentedControl } from '@/components/ui';
import ChatPanel from '@/components/ChatPanel';
import SaveSearchModal from '@/components/SaveSearchModal';
import FilterPills from '@/components/FilterPills';
import SetDestinationPill from '@/components/SetDestinationPill';
import DestinationCommuteFetcher from '@/components/DestinationCommuteFetcher';
import SwipeView from '@/components/SwipeView';
import GoToNearestMatch from '@/components/GoToNearestMatch';
import TourGuide from '@/components/TourGuide';
import { useConversation } from '@/lib/hooks/useConversation';
import { useConversations } from '@/lib/hooks/useConversations';
import { useSavedSearches } from '@/lib/hooks/useSavedSearches';
import { useProfile, PROFILE_QUERY_KEY } from '@/lib/hooks/useProfile';
import { useWishlists, useWishlistsSplit, useWishlistMutations, useWishlistedListingIds } from '@/lib/hooks/useWishlists';
import { useHiddenListings, useHiddenMutations } from '@/lib/hooks/useHiddenListings';
import WishlistPicker from '@/components/WishlistPicker';
import ManageWishlistsModal from '@/components/ManageWishlistsModal';
import AuthModal from '@/components/AuthModal';
import { setLastUsedWishlistId } from '@/lib/wishlist-storage';
import type { WishlistFilterSelection } from '@/components/SaveWishlistPanel';
import { OccluderProvider } from '@/lib/viewport/OccluderRegistry';
import { OcclusionDebugOverlay } from '@/lib/viewport/OcclusionDebugOverlay';
import { LeafletMapProvider } from '@/lib/viewport/LeafletMapContext';

type Listing = Database['public']['Tables']['listings']['Row'];

// ---------------------------------------------------------------------------
// Seed data fallback (used when DB is empty)
// ---------------------------------------------------------------------------
const SEED_LISTINGS: Listing[] = [
  { id: -1, address: '240 E 6th St Apt 1', area: 'East Village', price: 9995, beds: 5, baths: 2, sqft: null, lat: 40.7262, lon: -73.9858, transit_summary: '~10 min walk to 1st Ave L', photos: 18, photo_urls: [], url: 'https://www.realtor.com/rentals/details/240-E-6th-St-Apt-1_New-York_NY_10003_M95522-46041', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', year_built: null, created_at: '', external_id: null, last_seen_at: null, delisted_at: null, description: null, gross_price: null, net_effective_price: null, concession_months_free: null },
  { id: -2, address: '165 Attorney St Apt 5C', area: 'Lower East Side', price: 9450, beds: 6, baths: 2, sqft: null, lat: 40.7195, lon: -73.9845, transit_summary: '16 min J to Fulton', photos: 6, photo_urls: [], url: 'https://www.realtor.com/rentals/details/165-Attorney-St-Apt-5C_New-York_NY_10002_M94116-63343', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', year_built: null, created_at: '', external_id: null, last_seen_at: null, delisted_at: null, description: null, gross_price: null, net_effective_price: null, concession_months_free: null },
  { id: -3, address: '53 Park Pl Ph 2', area: 'Tribeca', price: 9000, beds: 5, baths: 2, sqft: null, lat: 40.7141, lon: -74.0079, transit_summary: 'Tribeca / Park Place', photos: 12, photo_urls: [], url: 'https://www.realtor.com/rentals/details/53-Park-Pl-2_New-York_NY_10007_M90339-21295', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', year_built: null, created_at: '', external_id: null, last_seen_at: null, delisted_at: null, description: null, gross_price: null, net_effective_price: null, concession_months_free: null },
  { id: -4, address: '372 Bainbridge St', area: 'Stuyvesant Heights', price: 6995, beds: 5, baths: 4, sqft: null, lat: 40.6808, lon: -73.927, transit_summary: '34 min C to 14th/8th Ave', photos: 16, photo_urls: [], url: 'https://www.realtor.com/rentals/details/372-Bainbridge-St-Unit-Triplex_Brooklyn_NY_11233_M96732-47148', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', year_built: null, created_at: '', external_id: null, last_seen_at: null, delisted_at: null, description: null, gross_price: null, net_effective_price: null, concession_months_free: null },
  { id: -5, address: '171 Attorney St Unit 6A', area: 'Lower East Side', price: 11000, beds: 7, baths: 2.5, sqft: null, lat: 40.7198, lon: -73.9843, transit_summary: '16 min J to Fulton', photos: 3, photo_urls: [], url: 'https://www.realtor.com/rentals/details/171-Attorney-St-6A_New-York_NY_10002_M99751-50289', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', year_built: null, created_at: '', external_id: null, last_seen_at: null, delisted_at: null, description: null, gross_price: null, net_effective_price: null, concession_months_free: null },
  { id: -6, address: '386 Stuyvesant Ave', area: 'Stuyvesant Heights', price: 12500, beds: 6, baths: 3.5, sqft: 3200, lat: 40.6838, lon: -73.9298, transit_summary: '18 min A to Fulton / 30 min to 14th', photos: 24, photo_urls: [], url: 'https://www.realtor.com/rentals/details/386-Stuyvesant-Ave_Brooklyn_NY_11233_M44801-18988', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', year_built: null, created_at: '', external_id: null, last_seen_at: null, delisted_at: null, description: null, gross_price: null, net_effective_price: null, concession_months_free: null },
  { id: -7, address: '50 Murray St Unit 2211', area: 'Tribeca', price: 10000, beds: 5, baths: 2, sqft: null, lat: 40.7143, lon: -74.0086, transit_summary: 'Tribeca / Murray St', photos: 9, photo_urls: [], url: 'https://www.realtor.com/rentals/details/50-Murray-St-2211_New-York_NY_10007_M93038-48259', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', year_built: null, created_at: '', external_id: null, last_seen_at: null, delisted_at: null, description: null, gross_price: null, net_effective_price: null, concession_months_free: null },
  { id: -8, address: '290 Jefferson Ave', area: 'Bedford-Stuyvesant', price: 10900, beds: 5, baths: 4, sqft: 3600, lat: 40.6862, lon: -73.943, transit_summary: '30 min A to 14th/8th Ave', photos: 19, photo_urls: [], url: 'https://www.realtor.com/rentals/details/290-Jefferson-Ave_Brooklyn_NY_11216_M49395-49974', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', year_built: null, created_at: '', external_id: null, last_seen_at: null, delisted_at: null, description: null, gross_price: null, net_effective_price: null, concession_months_free: null },
  { id: -9, address: '276 Halsey St #2', area: 'Bedford-Stuyvesant', price: 10750, beds: 5, baths: 3.5, sqft: null, lat: 40.6842, lon: -73.9418, transit_summary: '31 min A to 14th/8th Ave', photos: 16, photo_urls: [], url: 'https://www.realtor.com/rentals/details/276-Halsey-St-2_Brooklyn_NY_11216_M93027-20426', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', year_built: null, created_at: '', external_id: null, last_seen_at: null, delisted_at: null, description: null, gross_price: null, net_effective_price: null, concession_months_free: null },
  { id: -10, address: '53 Park Pl Apt 3E', area: 'Tribeca', price: 13500, beds: 5, baths: 3, sqft: null, lat: 40.7141, lon: -74.0079, transit_summary: 'Tribeca / Park Place', photos: 20, photo_urls: [], url: 'https://www.realtor.com/rentals/details/53-Park-Pl-Apt-3E_New-York_NY_10007_M39270-97535', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', year_built: null, created_at: '', external_id: null, last_seen_at: null, delisted_at: null, description: null, gross_price: null, net_effective_price: null, concession_months_free: null },
];

// ---------------------------------------------------------------------------
// Helpers: read / write URL query params
// ---------------------------------------------------------------------------
const VALID_VIEWS = new Set(['list', 'map', 'swipe']);
const VALID_SORTS = new Set<string>(['price', 'beds', 'listDate']);
const VALID_LISTING_AGES = new Set<string>(['1h', '3h', '6h', '12h', '1d', '2d', '3d', '1w', '2w', '1m']);


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
    includeNaBaths: params.get('includeNaBaths') === '1',
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
    minAvailableDate: params.get('minAvailableDate') || null,
    maxAvailableDate: params.get('maxAvailableDate') || null,
    includeNaAvailableDate: params.get('includeNaAvailableDate') === '1',
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

function buildQueryString(view: 'list' | 'map' | 'swipe', f: FiltersState, chatMode?: boolean, listingId?: number | null, mapPos?: MapPosition | null, wishlistSel?: string | null): string {
  const p = new URLSearchParams();
  // Preserve debug=pins so the viewport-occlusion overlay survives the
  // URL-state rewrites that fire on filter / map position changes.
  if (typeof window !== 'undefined') {
    const current = new URLSearchParams(window.location.search);
    const debugVal = current.get('debug');
    if (debugVal) p.set('debug', debugVal);
  }
  if (listingId != null) p.set('listing', String(listingId));
  if (chatMode) p.set('chat', '1');
  if (view !== 'list') p.set('view', view);
  if (wishlistSel) p.set('wishlist', wishlistSel);
  if (f.sort !== 'price') p.set('sort', f.sort);
  if (f.selectedBeds != null) p.set('beds', f.selectedBeds.join(','));
  if (f.minBaths != null) p.set('minBaths', String(f.minBaths));
  if (f.includeNaBaths) p.set('includeNaBaths', '1');
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
  if (f.minAvailableDate) p.set('minAvailableDate', f.minAvailableDate);
  if (f.maxAvailableDate) p.set('maxAvailableDate', f.maxAvailableDate);
  if (f.includeNaAvailableDate) p.set('includeNaAvailableDate', '1');
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
  const queryClient = useQueryClient();

  // Feature flag: conversational search mode
  const chatMode = searchParams.get('chat') === '1';

  // Tour trigger: ?tour=1 in URL
  const tourParam = searchParams.get('tour') === '1';

  // Data state
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [authModal, setAuthModal] = useState<'login' | 'signup' | null>(null);

  // Profile for tour status
  const { data: profile } = useProfile(userId);
  const [showTour, setShowTour] = useState(false);

  // Show tour when: ?tour=1 AND user is logged in
  useEffect(() => {
    if (tourParam && profile) {
      setShowTour(true);
    }
  }, [tourParam, profile]);

  const handleTourComplete = useCallback(async () => {
    setShowTour(false);
    // Remove ?tour=1 from URL
    const url = new URL(window.location.href);
    url.searchParams.delete('tour');
    window.history.replaceState(null, '', url.toString());
    // Mark tour as completed in DB
    if (userId) {
      await supabase
        .from('profiles')
        .update({ has_completed_tour: true })
        .eq('id', userId);
      queryClient.invalidateQueries({ queryKey: [...PROFILE_QUERY_KEY] });
    }
  }, [userId, supabase, queryClient]);

  // User email — needed for shared-wishlist lookup
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Wishlist system
  const { data: wishlists } = useWishlists(userId);
  const { mine: myWishlists, shared: sharedWishlists, all: allWishlists } = useWishlistsSplit(userId, userEmail);
  const wishlistedIds = useWishlistedListingIds(userId);
  const {
    addToWishlist,
    removeFromWishlist,
    createWishlist,
    deleteWishlist,
    renameWishlist,
    addShare,
    removeShare,
    updateSharePermission,
    leaveSharedWishlist,
  } = useWishlistMutations(userId);
  const [pickerListingId, setPickerListingId] = useState<number | null>(null);
  const [pickerAnchorRect, setPickerAnchorRect] = useState<DOMRect | null>(null);

  // Wishlist filter selection — null (no filter), 'all-saved', or a wishlist id.
  const initialWishlistSelection: WishlistFilterSelection = (() => {
    const v = searchParams.get('wishlist');
    if (!v) return null;
    if (v === 'all-saved') return 'all-saved';
    return v;
  })();
  const [selectedWishlist, setSelectedWishlist] = useState<WishlistFilterSelection>(initialWishlistSelection);
  const [manageWishlistsOpen, setManageWishlistsOpen] = useState<boolean>(() => searchParams.get('manageWishlists') === '1');

  // Listen for global "open-wishlist-manager" event (fired from the nav menu).
  useEffect(() => {
    function handleOpen() { setManageWishlistsOpen(true); }
    window.addEventListener('open-wishlist-manager', handleOpen);
    return () => window.removeEventListener('open-wishlist-manager', handleOpen);
  }, []);

  // Clear ?manageWishlists=1 query param once the modal is opened.
  useEffect(() => {
    if (manageWishlistsOpen && typeof window !== 'undefined' && new URL(window.location.href).searchParams.get('manageWishlists')) {
      const url = new URL(window.location.href);
      url.searchParams.delete('manageWishlists');
      window.history.replaceState(null, '', url.toString());
    }
  }, [manageWishlistsOpen]);

  // Viewport loading state (map pan/zoom queries).
  // Default true so the initial render (before the first bounds query fires)
  // shows the spinner instead of flashing the "No listings found" empty state.
  // Flipped to false once the first query completes in loadForViewport().
  const [viewportLoading, setViewportLoading] = useState(true);
  const [viewportCount, setViewportCount] = useState<number | null>(null);
  const viewportRequestRef = useRef(0);
  const hasInitialViewportLoad = useRef(false);
  const lastLoadedBounds = useRef<{ latMin: number; latMax: number; lonMin: number; lonMax: number } | null>(null);
  // Shared ref: historically used to suppress bounds-watcher callbacks during
  // a programmatic flyTo. Kept around as a plumbing no-op now that auto-recenter
  // has been removed — nothing in MapInner sets it to true any more, so all
  // viewport changes (which can only be user-initiated) feed through to the
  // bounds watcher. Left intact so we can easily re-introduce a suppression
  // guard if a future "locate me" / "reset view" button is added.
  const suppressBoundsRef = useRef(false);
  // Tracks whether the user is currently actively dragging/panning the map.
  // Threaded into MapInner via BoundsWatcher's `isPanningRef` so consumers
  // can defer side effects mid-gesture (e.g. avoid running deck-pick logic
  // off a stale projection while the camera is still settling).
  const isPanningRef = useRef(false);
  // AbortController for the CURRENT in-flight /api/listings/search call
  // triggered by a viewport change. A new pan aborts the previous request so
  // rapid successive pans only ever resolve to the LAST query's response;
  // late responses from aborted fetches throw `AbortError` in loadForViewport
  // and are caught silently.
  const viewportAbortRef = useRef<AbortController | null>(null);

  // -----------------------------------------------------------------------
  // Infinite-scroll pagination state
  //
  // The /api/listings/search endpoint now returns pages of up to 100 rows
  // (instead of 2000 up-front). `listings` starts with page 1 on every
  // filter/bounds change; subsequent pages are appended as the grid's
  // virtualizer scrolls near the end.
  //
  // The map consumes the same `listings` array — so map pins grow as more
  // pages load. We chose this over a separate full-pins endpoint because
  // map popups expect full Listing objects (address, photos, url), and
  // splitting the data source would double the network cost of every
  // filter change.
  // -----------------------------------------------------------------------
  const PAGE_SIZE = 100;
  const [hasMoreListings, setHasMoreListings] = useState(false);
  const [loadingMoreListings, setLoadingMoreListings] = useState(false);
  // Next offset to request. null = no more to load.
  const nextOffsetRef = useRef<number | null>(null);
  // Tracks the in-flight "load more" request so late responses can be
  // discarded after a filter/bounds change invalidates them.
  const loadMoreRequestRef = useRef(0);
  // Mirror of loadingMoreListings for synchronous reads inside the callback
  // (setState is batched / async, so checking the state value would miss
  // rapid re-entry from the virtualizer).
  const loadingMoreListingsRef = useRef(false);

  // Viewport version counter — triggers commute filter re-run after viewport loads
  const [viewportVersion, setViewportVersion] = useState(0);

  // Commute filter state — the server now pre-intersects listings with
  // commute rules, so we only keep the per-listing metadata map for UI
  // badges and the message string for the "no data" banner.
  const [commuteInfoMap, setCommuteInfoMap] = useState<globalThis.Map<number, CommuteInfo> | null>(null);
  const [commuteMessage, setCommuteMessage] = useState<string | null>(null);
  const [commuteLoading, setCommuteLoading] = useState(false);

  // Filter-changing overlay state
  const [filterChanging, setFilterChanging] = useState(false);
  const filterMountedRef = useRef(false);

  // Hidden listings — synced via hook (DB for authed users, localStorage fallback)
  const { data: hiddenIds = new Set<number>(), isLoading: hiddenLoading } = useHiddenListings(userId);
  const { hide: hideMutation, unhide: unhideMutation, clearAll: clearAllHidden } = useHiddenMutations(userId);
  const [hidingId, setHidingId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ listingId: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [showHidden, setShowHidden] = useState(false);

  // Keep a ref to the latest filters so loadForViewport (stable across
  // renders) always sees the most recent filter state without needing to
  // be re-created.
  const filtersRef = useRef<FiltersState | null>(null);
  // Populate synchronously during render so the first async loadForViewport
  // (kicked off from the initial boot useEffect) sees the URL-derived filters.
  // The matching useEffect below keeps this in sync on subsequent changes.

  // Keep refs so loadForViewport stays stable yet always reads the latest values.
  const selectedWishlistRef = useRef<WishlistFilterSelection>(selectedWishlist);
  selectedWishlistRef.current = selectedWishlist;
  const allWishlistsRef = useRef(allWishlists);
  allWishlistsRef.current = allWishlists;

  const loadForViewport = useCallback(async (bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number }) => {
    lastLoadedBounds.current = bounds;
    const requestId = ++viewportRequestRef.current;
    // Abort any in-flight viewport search — a newer pan supersedes it so
    // we stop waiting on (and paying network/CPU for) the stale response.
    if (viewportAbortRef.current) {
      viewportAbortRef.current.abort();
    }
    const controller = new AbortController();
    viewportAbortRef.current = controller;
    setViewportLoading(true);
    const currentFilters = filtersRef.current;
    const commuteRules = currentFilters?.commuteRules ?? [];
    if (commuteRules.length > 0) setCommuteLoading(true);
    // Resolve wishlist selection → array of ids (or null for "no restriction")
    let wishlistIds: string[] | null = null;
    const sel = selectedWishlistRef.current;
    if (sel === 'all-saved') {
      wishlistIds = allWishlistsRef.current.map((w) => w.id);
    } else if (typeof sel === 'string') {
      wishlistIds = [sel];
    }
    // A new viewport/filter fetch invalidates any in-flight "load more".
    loadMoreRequestRef.current++;
    try {
      const res = await fetch('/api/listings/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          bounds,
          wishlistIds,
          filters: currentFilters ? {
            selectedBeds: currentFilters.selectedBeds,
            minBaths: currentFilters.minBaths,
            includeNaBaths: currentFilters.includeNaBaths,
            minRent: currentFilters.minRent,
            maxRent: currentFilters.maxRent,
            priceMode: currentFilters.priceMode,
            maxListingAge: currentFilters.maxListingAge,
            selectedSources: currentFilters.selectedSources,
            minYearBuilt: currentFilters.minYearBuilt,
            maxYearBuilt: currentFilters.maxYearBuilt,
            minSqft: currentFilters.minSqft,
            maxSqft: currentFilters.maxSqft,
            excludeNoSqft: currentFilters.excludeNoSqft,
            minAvailableDate: currentFilters.minAvailableDate,
            maxAvailableDate: currentFilters.maxAvailableDate,
            includeNaAvailableDate: currentFilters.includeNaAvailableDate,
          } : {},
          commuteRules,
          limit: PAGE_SIZE,
          offset: 0,
        }),
      });
      // Discard stale responses from superseded requests
      if (requestId !== viewportRequestRef.current) return;
      if (!res.ok) {
        console.error('[viewport] query error:', res.status, await res.text().catch(() => ''));
        return;
      }
      const data = await res.json() as {
        listings: Listing[];
        commuteInfo: Record<number, { minutes: number; station: string; mode: string }>;
        total: number;
        commuteMessage: string | null;
        hasMore?: boolean;
        nextOffset?: number | null;
      };
      if (requestId !== viewportRequestRef.current) return;

      const newListings = (data.listings ?? []).map((l) => ({
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

      // Commute info handling (server side has already intersected):
      // - If commute rules are active, always update commute state — even
      //   for empty results — so filtering is reactive. Otherwise clear it.
      if (commuteRules.length > 0) {
        // Determine route letter and color from the first subway-line/station rule
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
        let routeLetter: string | undefined;
        let routeColor: string | undefined;
        for (const rule of commuteRules) {
          if ((rule.type === 'subway-line' || rule.type === 'station') && rule.lines && rule.lines.length > 0) {
            routeLetter = rule.lines[0];
            routeColor = SUBWAY_COLORS[routeLetter] ?? '#8b949e';
            break;
          }
        }
        const infoMap: globalThis.Map<number, CommuteInfo> = new globalThis.Map();
        for (const [idStr, meta] of Object.entries(data.commuteInfo ?? {})) {
          infoMap.set(Number(idStr), {
            minutes: meta.minutes,
            route: routeLetter,
            routeColor,
            destination: meta.station,
          });
        }
        // Build the commute match ID set from the returned listings (they
        // are, by definition, the intersection of bounds ∩ filters ∩ commute).
        setCommuteInfoMap(infoMap.size > 0 ? infoMap : null);
        setCommuteMessage(data.commuteMessage);
      } else {
        setCommuteInfoMap(null);
        setCommuteMessage(null);
      }

      // Only replace listings if results were found; keep existing pins when
      // panning to empty areas (parks, water, outside city).
      if (newListings.length > 0) {
        setListings(newListings);
        setViewportVersion(v => v + 1);
        // Null out viewport count so the badge falls back to the accurate
        // filtered count.
        setViewportCount(null);
        // Page 1 populated — remember pagination cursor for load-more.
        nextOffsetRef.current = data.nextOffset ?? null;
        setHasMoreListings(Boolean(data.hasMore));
      } else if (commuteRules.length > 0) {
        // Commute filter active and nothing matched — clear listings so the
        // "no match" state is honest.
        setListings([]);
        setViewportVersion(v => v + 1);
        setViewportCount(0);
        nextOffsetRef.current = null;
        setHasMoreListings(false);
      } else {
        // Empty area (no commute) — keep existing listings, update badge.
        // Leave pagination state alone; it still reflects the last populated
        // viewport's cursor.
        setViewportCount(0);
      }
    } catch (err) {
      // An AbortError is expected whenever the user pans again before the
      // previous query finishes — that's the correct behavior, not an error.
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      // Also treat TypeError('AbortError') thrown by older runtimes gracefully.
      if (err && typeof err === 'object' && 'name' in err && (err as { name?: string }).name === 'AbortError') {
        return;
      }
      console.error('[viewport] fetch failed:', err);
    } finally {
      if (requestId === viewportRequestRef.current) {
        setViewportLoading(false);
        setCommuteLoading(false);
        // Clear the controller ref only if it's still the one we owned;
        // a later call may have replaced it.
        if (viewportAbortRef.current === controller) {
          viewportAbortRef.current = null;
        }
      }
    }
  }, []);

  // ---------------------------------------------------------------------
  // Load the next page for infinite scroll.
  //
  // Uses the bounds + filters + wishlist currently on screen (not a snapshot
  // — refs are live). Appends to `listings` rather than replacing. If a
  // filter/viewport change fires while this is in-flight, the response is
  // discarded via `loadMoreRequestRef`.
  // ---------------------------------------------------------------------
  const loadMoreListings = useCallback(async () => {
    const offset = nextOffsetRef.current;
    if (offset == null) return;
    const bounds = lastLoadedBounds.current;
    if (!bounds) return;
    // Prevent overlapping load-more requests
    if (loadingMoreListingsRef.current) return;
    loadingMoreListingsRef.current = true;
    setLoadingMoreListings(true);
    const requestId = ++loadMoreRequestRef.current;
    const currentFilters = filtersRef.current;
    const commuteRules = currentFilters?.commuteRules ?? [];
    let wishlistIds: string[] | null = null;
    const sel = selectedWishlistRef.current;
    if (sel === 'all-saved') {
      wishlistIds = allWishlistsRef.current.map((w) => w.id);
    } else if (typeof sel === 'string') {
      wishlistIds = [sel];
    }
    try {
      const res = await fetch('/api/listings/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bounds,
          wishlistIds,
          filters: currentFilters ? {
            selectedBeds: currentFilters.selectedBeds,
            minBaths: currentFilters.minBaths,
            includeNaBaths: currentFilters.includeNaBaths,
            minRent: currentFilters.minRent,
            maxRent: currentFilters.maxRent,
            priceMode: currentFilters.priceMode,
            maxListingAge: currentFilters.maxListingAge,
            selectedSources: currentFilters.selectedSources,
            minYearBuilt: currentFilters.minYearBuilt,
            maxYearBuilt: currentFilters.maxYearBuilt,
            minSqft: currentFilters.minSqft,
            maxSqft: currentFilters.maxSqft,
            excludeNoSqft: currentFilters.excludeNoSqft,
            minAvailableDate: currentFilters.minAvailableDate,
            maxAvailableDate: currentFilters.maxAvailableDate,
            includeNaAvailableDate: currentFilters.includeNaAvailableDate,
          } : {},
          commuteRules,
          limit: PAGE_SIZE,
          offset,
        }),
      });
      if (requestId !== loadMoreRequestRef.current) return;
      if (!res.ok) {
        console.error('[loadMore] query error:', res.status, await res.text().catch(() => ''));
        return;
      }
      const data = await res.json() as {
        listings: Listing[];
        commuteInfo: Record<number, { minutes: number; station: string; mode: string }>;
        total: number;
        commuteMessage: string | null;
        hasMore?: boolean;
        nextOffset?: number | null;
      };
      if (requestId !== loadMoreRequestRef.current) return;

      const newListings = (data.listings ?? []).map((l) => ({
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

      // Merge into the existing list, de-duping by id (defensive — the
      // endpoint uses a stable sort with an `id` tiebreaker, but if filter
      // state drifted between pages a duplicate is still possible).
      if (newListings.length > 0) {
        setListings((prev) => {
          const seen = new Set(prev.map((l) => l.id));
          const additions = newListings.filter((l) => !seen.has(l.id));
          return additions.length > 0 ? [...prev, ...additions] : prev;
        });

        // Merge commute info entries for the newly appended rows.
        if (commuteRules.length > 0 && data.commuteInfo) {
          setCommuteInfoMap((prev) => {
            const next = new globalThis.Map<number, CommuteInfo>(prev ?? []);
            // Preserve route styling from the existing map
            let routeLetter: string | undefined;
            let routeColor: string | undefined;
            if (prev) {
              const firstEntry = prev.values().next().value;
              if (firstEntry) {
                routeLetter = firstEntry.route;
                routeColor = firstEntry.routeColor;
              }
            }
            for (const [idStr, meta] of Object.entries(data.commuteInfo)) {
              next.set(Number(idStr), {
                minutes: meta.minutes,
                route: routeLetter,
                routeColor,
                destination: meta.station,
              });
            }
            return next;
          });
        }
      }

      nextOffsetRef.current = data.nextOffset ?? null;
      setHasMoreListings(Boolean(data.hasMore));
    } catch (err) {
      console.error('[loadMore] fetch failed:', err);
    } finally {
      if (requestId === loadMoreRequestRef.current) {
        setLoadingMoreListings(false);
      }
      loadingMoreListingsRef.current = false;
    }
  }, []);

  // Auto-search on any pan or zoom (swipe-triggered pans are already
  // suppressed by suppressBoundsRef in BoundsWatcher)
  const handleBoundsChange = useCallback((bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number }) => {
    if (!hasInitialViewportLoad.current) {
      hasInitialViewportLoad.current = true;
    }
    loadForViewport(bounds);
  }, [loadForViewport]);

  const handleHideListing = useCallback((listingId: number) => {
    if (!userId) { setAuthModal('login'); return; }
    // Start fade-out animation
    setHidingId(listingId);

    // Clear any existing toast timer
    if (toastRef.current) clearTimeout(toastRef.current.timer);

    // After animation completes, actually hide it
    setTimeout(() => {
      hideMutation.mutate(listingId);
      setHidingId(null);

      // Show toast with undo
      const timer = setTimeout(() => {
        setToast(null);
      }, 5000);
      setToast({ listingId, timer });
    }, 300);
  }, [userId, hideMutation]);

  const handleUndoHide = useCallback(() => {
    if (!toast) return;
    clearTimeout(toast.timer);
    const restoredId = toast.listingId;
    unhideMutation.mutate(restoredId);
    setToast(null);
  }, [toast, unhideMutation]);

  // UI state — initialised from URL query params
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailListing, setDetailListing] = useState<Listing | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'map' | 'swipe'>(() => {
    const v = searchParams.get('view');
    if (v && VALID_VIEWS.has(v)) return v as 'list' | 'map' | 'swipe';
    return 'list';
  });
  // Measured height of the sidebar filter bar. Used in swipe view on mobile to
  // push the swipe card down so it doesn't sit underneath the absolute filter
  // bar. Kept as state so SwipeView re-renders when the filter bar resizes
  // (e.g. AI filter pills appearing).
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [sidebarHeight, setSidebarHeight] = useState(0);
  const [filters, setFilters] = useState<FiltersState>(() =>
    readFiltersFromParams(searchParams),
  );
  // Sync the ref synchronously on every render so the stable loadForViewport
  // callback always reads the latest filter state without re-creating.
  filtersRef.current = filters;

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
  // Ref to the sidebar-mounted <Filters> — lets the floating Filters pill
  // in SwipeView open Filters' internal mobile bottom sheet directly, so
  // there's only ONE sheet (no nested drawer) and one source of truth for
  // filter state.
  const filtersHandleRef = useRef<FiltersHandle | null>(null);

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

  // Measure the sidebar (filter bar) height so SwipeView can push the card
  // down on mobile when the sidebar overlays the swipe view. Only measured
  // in swipe mode (in other modes the sidebar contains the listing grid and
  // takes up the full viewport, which isn't a useful inset for SwipeView).
  // Uses useLayoutEffect so the first paint of the swipe view already has
  // the correct topInset, avoiding a frame where the card snaps down.
  // ResizeObserver picks up dynamic changes (e.g. AI filter pills mounting).
  useLayoutEffect(() => {
    const el = sidebarRef.current;
    if (!el || mobileView !== 'swipe') {
      setSidebarHeight(0);
      return;
    }
    let rafId: number | null = null;
    let lastHeight = -1;
    const measure = () => {
      rafId = null;
      const h = el.getBoundingClientRect().height;
      // Only update when the height changes by more than 1px to avoid
      // sub-pixel ping-pong triggering React state updates every frame.
      if (Math.abs(h - lastHeight) < 1) return;
      lastHeight = h;
      setSidebarHeight(h);
    };
    const schedule = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(measure);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [mobileView]);

  // Set body[data-swipe-mobile] when swipe view is active so global CSS can
  // hide the Navbar + sidebar filter bar on mobile (<600px). Prefer CSS-level
  // hiding over unmounting to keep view-switch fast (no Leaflet/grid re-init).
  // Must run before any conditional early-return (e.g. `if (loading)`) to
  // keep hook order stable.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (mobileView === 'swipe') {
      document.body.setAttribute('data-swipe-mobile', '1');
    } else {
      document.body.removeAttribute('data-swipe-mobile');
    }
    return () => {
      document.body.removeAttribute('data-swipe-mobile');
    };
  }, [mobileView]);

  // Sync state changes to URL via history.replaceState (avoids Next.js
  // navigation overhead and unnecessary re-renders).
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    window.history.replaceState(null, '', buildQueryString(mobileView, filters, chatMode, detailListing?.id ?? null, mapPosition, selectedWishlist));
  }, [mobileView, filters, chatMode, detailListing, mapPosition, selectedWishlist]);

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
      setUserEmail(user?.email ?? null);

      // Load default NYC bounds immediately so listings appear even before
      // the map mounts (e.g. list view on mobile where the map is hidden).
      // If the map later fires onBoundsChange with real viewport bounds,
      // it will replace these with the correct geographic area.
      if (!hasInitialViewportLoad.current) {
        hasInitialViewportLoad.current = true;
        await loadForViewport({ latMin: 40.65, latMax: 40.82, lonMin: -74.05, lonMax: -73.88 });
      }

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
  // Server-side search: when filters change, re-run loadForViewport so the
  // 2000-row server cap is shared across ALL active filters (not just
  // bounds+delisted_at). Debounced to avoid hammering the API on every
  // keystroke in a min/max input.
  // -----------------------------------------------------------------------
  const filterChangeFirstRunRef = useRef(true);
  useEffect(() => {
    // filtersRef is updated synchronously during render; no need to update it here.
    if (filterChangeFirstRunRef.current) {
      filterChangeFirstRunRef.current = false;
      return;
    }
    const bounds = lastLoadedBounds.current ?? { latMin: 40.65, latMax: 40.82, lonMin: -74.05, lonMax: -73.88 };
    const t = setTimeout(() => {
      loadForViewport(bounds);
    }, 250);
    return () => clearTimeout(t);
  }, [filters, selectedWishlist, loadForViewport]);

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
  //
  // Server-side filtering (via /api/listings/search) now handles beds, baths,
  // price, listing age, year built, sqft, sources, commute intersection, the
  // scam filter, and bounds — all in SQL with a shared 2000-row cap. That
  // fixes the old bug where a 500-row viewport cap would truncate results
  // before client-side filters saw them (e.g. "1 of 1" in swipe view).
  //
  // The only work left on the client is cheap UI-only stuff:
  //   - `showHidden` toggle (user-specific, per-device, no point round-tripping)
  //   - `photosFirst` + final sort (tiny in-memory sort)
  // -----------------------------------------------------------------------
  const filteredListings = useMemo(() => {
    let result = showHidden ? [...listings] : listings.filter((l) => !hiddenIds.has(l.id));

    result = [...result].sort((a, b) => {
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
  }, [listings, filters.photosFirst, filters.sort, hiddenIds, showHidden]);

  // Wishlist mode: partition the visible listings into active (still live)
  // and removed (delisted_at IS NOT NULL) so the grid can show removed items
  // in a separate section below the active ones. The /api/listings/search
  // endpoint includes delisted rows whenever wishlistIds is provided, so this
  // partition is a no-op outside wishlist mode.
  //
  // We only branch on `selectedWishlist` to avoid leaking removed cards into
  // non-wishlist views (where the API filters them out anyway, but a future
  // caller might not — belt and suspenders).
  const { activeFilteredListings, removedFilteredListings } = useMemo(() => {
    if (selectedWishlist === null) {
      return { activeFilteredListings: filteredListings, removedFilteredListings: [] as Listing[] };
    }
    const active: Listing[] = [];
    const removed: Listing[] = [];
    for (const l of filteredListings) {
      if (l.delisted_at != null) removed.push(l);
      else active.push(l);
    }
    return { activeFilteredListings: active, removedFilteredListings: removed };
  }, [filteredListings, selectedWishlist]);

  // Keep the ref in sync so the chat hook's getListingCount stays current
  filteredListingsRef.current = filteredListings;

  // -----------------------------------------------------------------------
  // Wishlist handlers
  // -----------------------------------------------------------------------
  const handleStarClick = useCallback((listingId: number, anchorRect: DOMRect) => {
    if (!userId) { setAuthModal('login'); return; }
    setPickerListingId(listingId);
    setPickerAnchorRect(anchorRect);
  }, [userId]);

  const handleWishlistToggle = useCallback((wishlistId: string, checked: boolean) => {
    if (!pickerListingId) return;
    if (checked) {
      addToWishlist.mutate({ wishlistId, listingId: pickerListingId });
      setLastUsedWishlistId(wishlistId);
    } else {
      removeFromWishlist.mutate({ wishlistId, listingId: pickerListingId });
    }
  }, [pickerListingId, addToWishlist, removeFromWishlist]);

  const switchMobileView = useCallback((v: 'list' | 'map' | 'swipe') => {
    startTransition(() => setMobileView(v));
  }, []);

  // Stable handlers for ListingCard so React.memo can skip re-renders when
  // the parent re-renders for unrelated reasons.
  const handleCardSelect = useCallback((id: number) => {
    setSelectedId(id);
  }, []);
  const handleCardExpand = useCallback((l: Listing) => {
    setDetailListing(l);
  }, []);

  // Ref to the virtualized listing grid — used to scroll to a listing when
  // a map marker is clicked (since the target card may not be in the DOM).
  const virtualGridRef = useRef<VirtualListingGridHandle>(null);

  // Stable callbacks for <Map> — inline arrows used to force Map (and its
  // heavy Leaflet tree) to re-render on every parent state change, including
  // view-switches on mobile. Extracted so the Map's memo can skip re-renders
  // when only unrelated state (filters, mobileView) changes.
  const handleMapToggleFavorite = useCallback((id: number) => {
    const btn = document.querySelector(`[data-action="save"][data-listing-id="${id}"]`);
    const rect = btn?.getBoundingClientRect() ?? new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0);
    handleStarClick(id, rect);
  }, [handleStarClick]);

  const handleMapSelectDetail = useCallback((listing: Listing) => {
    console.log(`[page] onSelectDetail called for listing #${listing.id} "${listing.address}"`);
    setDetailListing(listing);
  }, []);

  const handleMapMarkerClick = useCallback((id: number) => {
    setSelectedId(id);
    if (window.innerWidth >= 1024) {
      setTimeout(() => {
        virtualGridRef.current?.scrollToListing(id);
      }, 100);
    }
  }, []);

  // Card peek mini-map → "Full map" shortcut. Selects the listing so the
  // map view auto-centers/auto-shifts onto its pin, then switches the
  // mobile view to map. Desktop already shows the map alongside the list,
  // so the switchMobileView call there is a no-op visually but still
  // updates the URL contract (`?view=map&listing=<id>`) for shareability.
  const handleOpenFullMapFromCard = useCallback((listing: Listing) => {
    setSelectedId(listing.id);
    switchMobileView('map');
  }, [switchMobileView]);

  // -----------------------------------------------------------------------
  // "Go to nearest match" empty-state CTA. Returns the current filters in
  // the shape /api/listings/search expects so the button can POST without
  // re-deriving the payload itself. Stable identity (refs) so the button
  // doesn't reset its internal state on unrelated parent renders.
  // -----------------------------------------------------------------------
  const getNearestSearchPayload = useCallback(() => {
    const f = filtersRef.current;
    let wishlistIds: string[] | null = null;
    const sel = selectedWishlistRef.current;
    if (sel === 'all-saved') {
      wishlistIds = allWishlistsRef.current.map((w) => w.id);
    } else if (typeof sel === 'string') {
      wishlistIds = [sel];
    }
    return {
      filters: f
        ? {
            selectedBeds: f.selectedBeds,
            minBaths: f.minBaths,
            includeNaBaths: f.includeNaBaths,
            minRent: f.minRent,
            maxRent: f.maxRent,
            priceMode: f.priceMode,
            maxListingAge: f.maxListingAge,
            selectedSources: f.selectedSources,
            minYearBuilt: f.minYearBuilt,
            maxYearBuilt: f.maxYearBuilt,
            minSqft: f.minSqft,
            maxSqft: f.maxSqft,
            excludeNoSqft: f.excludeNoSqft,
            minAvailableDate: f.minAvailableDate,
            maxAvailableDate: f.maxAvailableDate,
            includeNaAvailableDate: f.includeNaAvailableDate,
          }
        : {},
      commuteRules: f?.commuteRules ?? null,
      wishlistIds,
    };
  }, []);

  // When the user taps "Go to nearest match" we mark the matched listing as
  // selected (so the deck/card opens onto it) and seed it into `listings` so
  // the pin appears immediately — the subsequent viewport-bounds reload (fired
  // by the map.setView pan) will replace the array with the proper page.
  const handleNearestMatchSelected = useCallback((listing: Listing) => {
    setSelectedId(listing.id);
    setListings((prev) => {
      if (prev.some((l) => l.id === listing.id)) return prev;
      return [
        {
          ...listing,
          lat: listing.lat != null ? Number(listing.lat) : null,
          lon: listing.lon != null ? Number(listing.lon) : null,
          baths: listing.baths != null ? Number(listing.baths) : null,
          sqft: listing.sqft != null ? Number(listing.sqft) : null,
          price: Number(listing.price),
          beds: Number(listing.beds),
          photos: Number(listing.photos),
          photo_urls: listing.photo_urls ?? [],
        },
        ...prev,
      ];
    });
    setViewportVersion((v) => v + 1);
  }, []);

  const goToNearestEmptyExtra = (
    <GoToNearestMatch
      getFiltersPayload={getNearestSearchPayload}
      onMatchSelected={handleNearestMatchSelected}
    />
  );

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  if (loading) {
    return <RadarLoader />;
  }

  // -----------------------------------------------------------------------
  // Shared listing cards renderer — virtualized via VirtualListingGrid.
  // Renders only visible rows (+ overscan) instead of all ~2000 cards.
  // -----------------------------------------------------------------------
  // For loading-spinner gating we only consider the active listings — when
  // a wishlist contains nothing but removed items we still want the cards to
  // render (in the Removed section) instead of a perpetual loader.
  const listingGridLoading = filteredListings.length === 0 && (loading || viewportLoading || commuteLoading);

  const viewToggle = (
    <div data-tour="view-modes" className="flex items-center">
    <SegmentedControl
      value={mobileView}
      onChange={(v) => switchMobileView(v as 'list' | 'map' | 'swipe')}
      options={[
        { value: 'list', label: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg> },
        { value: 'swipe', label: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="14" height="18" rx="2"/><rect x="8" y="2" width="14" height="18" rx="2"/></svg> },
        { value: 'map', label: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg> },
      ]}
    />
    </div>
  );

  const isMapView = mobileView === 'map';

  const isSwipeView = mobileView === 'swipe';

  // Mobile: render the map as an absolute overlay on top of the sidebar
  // when in map view (keeps sidebar dimensions constant → no grid resize).
  // Desktop (≥lg): fall back to the standard side-by-side flex layout.
  // `max-lg:hidden` hides the map on mobile list view; in map view, the
  // absolute positioning covers the sidebar including its filter bar (the
  // previous behavior already hid the grid content when in map view, so this
  // is functionally equivalent from the user's perspective).
  const mapPanelMobileClass = mobileView === 'map'
    ? 'max-lg:absolute max-lg:inset-0 max-lg:z-10'
    : 'max-lg:hidden';
  const mapPanel = (
    <div
      className={`flex-1 relative lg:block ${mapPanelMobileClass}`}
      style={{ minHeight: 'calc(100vh - 60px - 42px)' }}
    >
      <Map
        listings={activeFilteredListings}
        selectedId={selectedId}
        favoritedIds={wishlistedIds}
        onHideListing={handleHideListing}
        onToggleFavorite={handleMapToggleFavorite}
        onSelectDetail={handleMapSelectDetail}
        commuteInfoMap={commuteInfoMap ?? undefined}
        onBoundsChange={handleBoundsChange}
        onMapMove={handleMapMove}
        suppressBoundsRef={suppressBoundsRef}
        isPanningRef={isPanningRef}
        initialCenter={initialCenter}
        initialZoom={initialZoom}
        visible={isMapView}
        onMarkerClick={handleMapMarkerClick}
      />

      {/* Map overlay: loading spinner */}
      {(viewportLoading || commuteLoading) && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500]">
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
        </div>
      )}

      {/* Mobile-only empty-state CTA: when the visible map area has no
          listings, surface a "Go to nearest match" button so the user can
          opt in to leaving the current viewport. Hidden on desktop because
          the sidebar's VirtualListingGrid empty state already shows the
          same CTA there. Hidden during loads to avoid a flicker between
          "Searching..." and "no results".

          Trigger uses `viewportCount === 0` (set by `loadForViewport` after
          the most recent fetch returned no rows for the visible bounds)
          rather than `filteredListings.length === 0`, because page.tsx
          intentionally keeps the previous listings array around when the
          user pans into an empty area — so the "in-list" length stays
          positive but the in-viewport count goes to zero. The list-view and
          swipe-view empty-state buttons still use `listings.length === 0`
          (they only render when no listings exist in the array at all,
          which is the right signal for those views). */}
      {isMapView && !viewportLoading && !commuteLoading && viewportCount === 0 && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-[400] lg:hidden pointer-events-auto"
          style={{ bottom: 90 }}
        >
          <div
            className="flex flex-col items-center gap-2 rounded-xl px-4 py-3"
            style={{
              backgroundColor: 'rgba(28, 32, 40, 0.95)',
              border: '1px solid #2d333b',
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            }}
          >
            <div className="text-xs" style={{ color: '#8b949e' }}>
              No listings in view
            </div>
            <GoToNearestMatch
              getFiltersPayload={getNearestSearchPayload}
              onMatchSelected={handleNearestMatchSelected}
              compact
            />
          </div>
        </div>
      )}
    </div>
  );

  const toastEl = toast && mobileView !== 'swipe' && (
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
          width: 'min(420px, 100%)',
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
    <div
      className={`relative flex flex-col lg:flex-row ${isSwipeView ? 'swipe-root-height' : 'normal-root-height'}`}
    >
      {/* Sidebar: AI search bar + filters + listing cards.
          On mobile the sidebar fills the full viewport regardless of which
          view is active — the map panel overlays it via `absolute inset-0`
          when in map view, instead of being a flex sibling that takes space.
          This keeps the VirtualListingGrid's container height constant across
          view switches, avoiding the ResizeObserver cascade that used to
          re-mount every visible <ListingCard> (each with ~10 Next.js <Image>
          components whose getImgProps is ~15ms each in dev mode). */}
      <div
        ref={sidebarRef}
        data-swipe-sidebar={isSwipeView ? '1' : undefined}
        className={`${isSwipeView ? 'absolute top-0 left-0 right-0 z-20' : `w-full lg:w-[480px] shrink-0 max-lg:flex-1 max-lg:min-h-0`} flex flex-col`}
        style={{ borderRight: isSwipeView ? 'none' : '1px solid #2d333b' }}
      >
        {/* AI-applied filter pills */}
        {hasAIFilters && (
          <div>
            <FilterPills
              filters={filters}
              onRemoveFilter={chat.removeFilter}
            />
          </div>
        )}

        {/* Headless: triggers OTP burst for visible listings whenever the user
            has set a preferred destination. Renders nothing. */}
        <DestinationCommuteFetcher listings={activeFilteredListings} />

        {/* Preferred-destination pill — informational chip on every card,
            tap-to-popup with full transit breakdown. Doesn't filter results. */}
        <div className={`flex items-center gap-2 px-4 py-2 ${isSwipeView ? '' : ''}`} style={{ borderBottom: '1px solid #2d333b' }}>
          <SetDestinationPill />
        </div>

        <div className="relative z-[1100]">
          <Filters
            ref={filtersHandleRef}
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
            onLoginRequired={() => setAuthModal('login')}
            showHidden={showHidden}
            onToggleShowHidden={() => setShowHidden((v) => !v)}
            myWishlists={myWishlists}
            sharedWishlists={sharedWishlists}
            selectedWishlist={selectedWishlist}
            onSelectWishlist={setSelectedWishlist}
            onCreateWishlist={async (name) => {
              try {
                const created = await createWishlist.mutateAsync(name);
                return created?.id ?? null;
              } catch {
                return null;
              }
            }}
            onOpenWishlistManager={() => setManageWishlistsOpen(true)}
          />
        </div>

        <div className="relative flex-1 min-h-0 flex flex-col">
          {!isSwipeView && (
            <>
              {/*
                Performance note: on mobile, view switching (list↔map) used to
                trigger a full re-render of the virtualized listing grid
                because VirtualListingGrid took a `hiddenOnMobile` prop that
                flipped on every switch. Each re-render re-materialized every
                visible <ListingCard>, which ran Next.js <Image>'s getImgProps
                per photo (dev-mode picomatch regex compile + URL parse is
                ~15ms per image). With ~5 cards × 10 images per card that's
                ~750ms of wasted work per switch on throttled mobile CPU.

                Now the hidden class lives on an outer wrapper, so the grid's
                props stay stable across view switches and React.memo can
                short-circuit the re-render. See VirtualListingGrid's memo
                equality fn and the `max-lg:hidden` class below.
              */}
              <VirtualListingGrid
                ref={virtualGridRef}
                listings={activeFilteredListings}
                removedListings={removedFilteredListings}
                selectedId={selectedId}
                wishlistedIds={wishlistedIds}
                hidingId={hidingId}
                commuteInfoMap={commuteInfoMap}
                onCardSelect={handleCardSelect}
                onStarClick={handleStarClick}
                onExpand={handleCardExpand}
                onHide={handleHideListing}
                onOpenFullMap={handleOpenFullMapFromCard}
                commuteMessage={commuteMessage}
                commuteLoading={commuteLoading}
                isDimmed={filterChanging || commuteLoading}
                suppressEmptyState={listingGridLoading}
                hasMore={hasMoreListings}
                isLoadingMore={loadingMoreListings}
                onLoadMore={loadMoreListings}
                containerClassName={mobileView === 'map' ? 'max-lg:hidden' : ''}
                emptyStateExtra={goToNearestEmptyExtra}
              />
              {listingGridLoading && (
                <div
                  className={`absolute inset-0 flex items-center justify-center min-h-[200px] ${mobileView === 'map' ? 'hidden lg:flex' : 'flex'}`}
                  style={{ pointerEvents: 'none' }}
                >
                  <RadarLoader />
                </div>
              )}
            </>
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
            listings={activeFilteredListings}
            userId={userId}
            onHideListing={handleHideListing}
            onUnhideListing={(id) => unhideMutation.mutate(id)}
            onExpandDetail={(listing) => { setSelectedId(listing.id); setDetailListing(activeFilteredListings.find(l => l.id === listing.id) ?? null); }}
            onSwitchView={() => switchMobileView('list')}
            onSwitchToMap={() => switchMobileView('map')}
            onOpenFilters={() => filtersHandleRef.current?.openMobileSheet()}
            topInset={sidebarHeight}
            onBoundsChange={handleBoundsChange}
            onMapMove={handleMapMove}
            suppressBoundsRef={suppressBoundsRef}
            isPanningRef={isPanningRef}
            initialCenter={initialCenter}
            initialZoom={initialZoom}
            commuteInfoMap={commuteInfoMap ?? undefined}
            onLoginRequired={() => setAuthModal('login')}
            showHidden={showHidden}
            isLoading={viewportLoading}
            wishlistedIds={wishlistedIds}
            emptyStateExtra={goToNearestEmptyExtra}
          />

          {/* Loading spinner overlay for swipe mode */}
          {(viewportLoading || commuteLoading) && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] pointer-events-none">
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
            </div>
          )}
        </div>
      )}

      {/* Chat drawer (slide-out) */}
      {chatDrawer}

      {/* Toast */}
      {toastEl}

      {/* Mobile bottom nav — view mode toggle (list/swipe/map).
          Hidden in swipe view: SwipeView renders its own unified pill that
          combines the view-mode toggle with the X/undo/heart swipe actions. */}
      <div
        className={`fixed bottom-0 left-1/2 -translate-x-1/2 z-[1300] min-[600px]:hidden ${isSwipeView ? 'hidden' : ''}`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div
          className="flex items-center gap-1 rounded-full px-1.5 py-1.5 mb-3"
          style={{
            background: 'rgba(28, 32, 40, 0.85)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06)',
          }}
        >
          {[
            {
              value: 'list' as const,
              label: 'List',
              icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                </svg>
              ),
            },
            {
              value: 'swipe' as const,
              label: 'Swipe',
              icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="14" height="18" rx="2" />
                  <rect x="8" y="2" width="14" height="18" rx="2" />
                </svg>
              ),
            },
            {
              value: 'map' as const,
              label: 'Map',
              icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              ),
            },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => switchMobileView(opt.value)}
              className="relative flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium transition-all duration-200 cursor-pointer"
              style={{
                background: mobileView === opt.value ? 'rgba(88, 166, 255, 0.15)' : 'transparent',
                color: mobileView === opt.value ? '#58a6ff' : '#8b949e',
              }}
            >
              {opt.icon}
              {mobileView === opt.value && (
                <span className="text-[11px] font-semibold">{opt.label}</span>
              )}
            </button>
          ))}
        </div>
      </div>

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

      {/* Tour guide overlay */}
      {showTour && (
        <TourGuide
          onComplete={handleTourComplete}
          setMobileView={setMobileView}
        />
      )}

      {/* Manage wishlists modal */}
      {manageWishlistsOpen && (
        <ManageWishlistsModal
          myWishlists={myWishlists}
          sharedWishlists={sharedWishlists}
          currentUserEmail={userEmail}
          onClose={() => setManageWishlistsOpen(false)}
          onCreate={async (name) => {
            await createWishlist.mutateAsync(name);
          }}
          onRename={async (id, name) => {
            await renameWishlist.mutateAsync({ id, name });
          }}
          onDelete={async (id) => {
            await deleteWishlist.mutateAsync(id);
            if (selectedWishlist === id) setSelectedWishlist(null);
          }}
          onAddShare={async (wishlistId, email, permission) => {
            await addShare.mutateAsync({ wishlistId, email, permission });
          }}
          onRemoveShare={async (shareId) => {
            await removeShare.mutateAsync({ shareId });
          }}
          onUpdateSharePermission={async (shareId, permission) => {
            await updateSharePermission.mutateAsync({ shareId, permission });
          }}
          onLeave={async (wishlistId, email) => {
            await leaveSharedWishlist.mutateAsync({ wishlistId, email });
            if (selectedWishlist === wishlistId) setSelectedWishlist(null);
          }}
        />
      )}

      {/* Auth modal overlay */}
      {authModal && (
        <AuthModal
          mode={authModal}
          onClose={() => setAuthModal(null)}
          onSuccess={async () => {
            setAuthModal(null);
            const { data: { user } } = await supabase.auth.getUser();
            setUserId(user?.id ?? null);
          }}
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
      <OccluderProvider>
        <LeafletMapProvider>
          <HomeInner />
          <OcclusionDebugOverlay />
        </LeafletMapProvider>
      </OccluderProvider>
    </Suspense>
  );
}
