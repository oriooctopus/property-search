'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import type { Database } from '@/lib/types';
import Map from '@/components/Map';
import Filters, { type FiltersState, type SearchTag, type SortField, type MaxListingAge } from '@/components/Filters';
import ListingCard from '@/components/ListingCard';
import ListingDetail from '@/components/ListingDetail';
import RadarLoader from '@/components/RadarLoader';
import { SegmentedControl } from '@/components/ui';
import ChatPanel from '@/components/ChatPanel';
import SaveSearchModal from '@/components/SaveSearchModal';
import AISearchBar from '@/components/AISearchBar';
import FilterPills from '@/components/FilterPills';
import SwipeView from '@/components/SwipeView';
import { useConversation } from '@/lib/hooks/useConversation';
import { useConversations } from '@/lib/hooks/useConversations';

type Listing = Database['public']['Tables']['listings']['Row'];

interface PersonWithBio {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
}

// ---------------------------------------------------------------------------
// Seed data fallback (used when DB is empty)
// ---------------------------------------------------------------------------
const SEED_LISTINGS: Listing[] = [
  { id: -1, address: '240 E 6th St Apt 1', area: 'East Village', price: 9995, beds: 5, baths: 2, sqft: null, lat: 40.7262, lon: -73.9858, transit_summary: '~10 min walk to 1st Ave L', photos: 18, photo_urls: [], url: 'https://www.realtor.com/rentals/details/240-E-6th-St-Apt-1_New-York_NY_10003_M95522-46041', search_tag: 'ltrain', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', created_at: '' },
  { id: -2, address: '165 Attorney St Apt 5C', area: 'Lower East Side', price: 9450, beds: 6, baths: 2, sqft: null, lat: 40.7195, lon: -73.9845, transit_summary: '16 min J to Fulton', photos: 6, photo_urls: [], url: 'https://www.realtor.com/rentals/details/165-Attorney-St-Apt-5C_New-York_NY_10002_M94116-63343', search_tag: 'fulton', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', created_at: '' },
  { id: -3, address: '53 Park Pl Ph 2', area: 'Tribeca', price: 9000, beds: 5, baths: 2, sqft: null, lat: 40.7141, lon: -74.0079, transit_summary: 'Tribeca / Park Place', photos: 12, photo_urls: [], url: 'https://www.realtor.com/rentals/details/53-Park-Pl-2_New-York_NY_10007_M90339-21295', search_tag: 'manhattan', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', created_at: '' },
  { id: -4, address: '372 Bainbridge St', area: 'Stuyvesant Heights', price: 6995, beds: 5, baths: 4, sqft: null, lat: 40.6808, lon: -73.927, transit_summary: '34 min C to 14th/8th Ave', photos: 16, photo_urls: [], url: 'https://www.realtor.com/rentals/details/372-Bainbridge-St-Unit-Triplex_Brooklyn_NY_11233_M96732-47148', search_tag: 'brooklyn', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', created_at: '' },
  { id: -5, address: '171 Attorney St Unit 6A', area: 'Lower East Side', price: 11000, beds: 7, baths: 2.5, sqft: null, lat: 40.7198, lon: -73.9843, transit_summary: '16 min J to Fulton', photos: 3, photo_urls: [], url: 'https://www.realtor.com/rentals/details/171-Attorney-St-6A_New-York_NY_10002_M99751-50289', search_tag: 'fulton', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', created_at: '' },
  { id: -6, address: '386 Stuyvesant Ave', area: 'Stuyvesant Heights', price: 12500, beds: 6, baths: 3.5, sqft: 3200, lat: 40.6838, lon: -73.9298, transit_summary: '18 min A to Fulton / 30 min to 14th', photos: 24, photo_urls: [], url: 'https://www.realtor.com/rentals/details/386-Stuyvesant-Ave_Brooklyn_NY_11233_M44801-18988', search_tag: 'brooklyn', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', created_at: '' },
  { id: -7, address: '50 Murray St Unit 2211', area: 'Tribeca', price: 10000, beds: 5, baths: 2, sqft: null, lat: 40.7143, lon: -74.0086, transit_summary: 'Tribeca / Murray St', photos: 9, photo_urls: [], url: 'https://www.realtor.com/rentals/details/50-Murray-St-2211_New-York_NY_10007_M93038-48259', search_tag: 'manhattan', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', created_at: '' },
  { id: -8, address: '290 Jefferson Ave', area: 'Bedford-Stuyvesant', price: 10900, beds: 5, baths: 4, sqft: 3600, lat: 40.6862, lon: -73.943, transit_summary: '30 min A to 14th/8th Ave', photos: 19, photo_urls: [], url: 'https://www.realtor.com/rentals/details/290-Jefferson-Ave_Brooklyn_NY_11216_M49395-49974', search_tag: 'brooklyn', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', created_at: '' },
  { id: -9, address: '276 Halsey St #2', area: 'Bedford-Stuyvesant', price: 10750, beds: 5, baths: 3.5, sqft: null, lat: 40.6842, lon: -73.9418, transit_summary: '31 min A to 14th/8th Ave', photos: 16, photo_urls: [], url: 'https://www.realtor.com/rentals/details/276-Halsey-St-2_Brooklyn_NY_11216_M93027-20426', search_tag: 'brooklyn', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', created_at: '' },
  { id: -10, address: '53 Park Pl Apt 3E', area: 'Tribeca', price: 13500, beds: 5, baths: 3, sqft: null, lat: 40.7141, lon: -74.0079, transit_summary: 'Tribeca / Park Place', photos: 20, photo_urls: [], url: 'https://www.realtor.com/rentals/details/53-Park-Pl-Apt-3E_New-York_NY_10007_M39270-97535', search_tag: 'manhattan', list_date: null, last_update_date: null, availability_date: null, source: 'realtor', created_at: '' },
];

// ---------------------------------------------------------------------------
// Helpers: read / write URL query params
// ---------------------------------------------------------------------------
const VALID_VIEWS = new Set(['list', 'map', 'swipe']);
const VALID_TAGS = new Set<string>(['all', 'fulton', 'ltrain', 'manhattan', 'brooklyn']);
const VALID_SORTS = new Set<string>(['pricePerBed', 'price', 'beds', 'listDate']);
const VALID_LISTING_AGES = new Set<string>(['1w', '2w', '1m', '3m', '6m', '1y']);

function parseNumOrNull(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function readFiltersFromParams(params: URLSearchParams): FiltersState {
  const tag = params.get('tag');
  const sort = params.get('sort');
  const age = params.get('maxAge');
  return {
    searchTag: (tag && VALID_TAGS.has(tag) ? tag : 'all') as SearchTag,
    sort: (sort && VALID_SORTS.has(sort) ? sort : 'pricePerBed') as SortField,
    minBeds: parseNumOrNull(params.get('minBeds')),
    minBaths: parseNumOrNull(params.get('minBaths')),
    minRent: parseNumOrNull(params.get('minRent')),
    maxRent: parseNumOrNull(params.get('maxRent')),
    maxPricePerBed: parseNumOrNull(params.get('maxPerBed')),
    maxListingAge: (age === 'any' ? null : age && VALID_LISTING_AGES.has(age) ? age : '1m') as MaxListingAge,
    photosFirst: params.get('photosFirst') === '1',
    selectedSources: params.get('sources') ? params.get('sources')!.split(',') : null,
  };
}

function buildQueryString(view: 'list' | 'map' | 'swipe', f: FiltersState, chatMode?: boolean, listingId?: number | null): string {
  const p = new URLSearchParams();
  if (listingId != null) p.set('listing', String(listingId));
  if (chatMode) p.set('chat', '1');
  if (view !== 'list') p.set('view', view);
  if (f.searchTag !== 'all') p.set('tag', f.searchTag);
  if (f.sort !== 'pricePerBed') p.set('sort', f.sort);
  if (f.minBeds != null) p.set('minBeds', String(f.minBeds));
  if (f.minBaths != null) p.set('minBaths', String(f.minBaths));
  if (f.minRent != null) p.set('minRent', String(f.minRent));
  if (f.maxRent != null) p.set('maxRent', String(f.maxRent));
  if (f.maxPricePerBed != null) p.set('maxPerBed', String(f.maxPricePerBed));
  if (f.maxListingAge === null) p.set('maxAge', 'any');
  else if (f.maxListingAge !== '1m') p.set('maxAge', f.maxListingAge);
  if (f.photosFirst) p.set('photosFirst', '1');
  if (f.selectedSources !== null) p.set('sources', f.selectedSources.join(','));
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
  const [wouldLiveSet, setWouldLiveSet] = useState<Set<number>>(new Set());
  const [favoritesSet, setFavoritesSet] = useState<Set<number>>(new Set());
  const [wouldLivePeopleMap, setWouldLivePeopleMap] = useState<Record<number, PersonWithBio[]>>({});

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

  const persistHidden = useCallback((ids: Set<number>) => {
    try {
      localStorage.setItem('dwelligence_hidden_listings', JSON.stringify([...ids]));
    } catch { /* quota exceeded — silently ignore */ }
  }, []);

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

  const [saveSearchOpen, setSaveSearchOpen] = useState(false);
  const [lastAIQuery, setLastAIQuery] = useState<string | null>(null);
  const [lastAIError, setLastAIError] = useState<string | null>(null);
  const [chatDrawerOpen, setChatDrawerOpen] = useState(chatMode);

  // Open chat drawer when ?chat=1 is in URL
  useEffect(() => {
    if (chatMode) {
      setChatDrawerOpen(true);
    }
  }, [chatMode]);

  // Inline AI search bar handler — sends to chat API and applies filters
  const handleInlineAISearch = useCallback(
    async (query: string) => {
      setLastAIError(null);
      const success = await chat.sendMessage(query);
      if (success) {
        setLastAIQuery(query);
      } else {
        setLastAIError('Search failed — please try again');
      }
    },
    [chat],
  );

  // Sync state changes to URL via history.replaceState (avoids Next.js
  // navigation overhead and unnecessary re-renders).
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    window.history.replaceState(null, '', buildQueryString(mobileView, filters, chatMode, detailListing?.id ?? null));
  }, [mobileView, filters, chatMode, detailListing]);

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

      // Fetch listings
      const { data: dbListings } = await supabase
        .from('listings')
        .select('*')
        .order('price', { ascending: true });

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

      // Fetch would_live_there with profiles.
      // Try progressively simpler queries if the join or columns fail.
      let wltRows: unknown[] | null = null;
      {
        const { data, error } = await supabase
          .from('would_live_there')
          .select('listing_id, user_id, profiles:user_id(id, display_name, avatar_url, bio)');
        if (!error) {
          wltRows = data;
        } else {
          const { data: fb2, error: err2 } = await supabase
            .from('would_live_there')
            .select('listing_id, user_id, profiles:user_id(id, display_name, avatar_url)');
          if (!err2) {
            wltRows = fb2;
          } else {
            // Join itself is broken — fetch without profiles
            const { data: fb3 } = await supabase
              .from('would_live_there')
              .select('listing_id, user_id');
            wltRows = fb3;
          }
        }
      }

      if (wltRows) {
        const userSet = new Set<number>();
        const peopleMap: Record<number, PersonWithBio[]> = {};

        type WltRow = {
          listing_id: number;
          user_id: string;
          profiles: PersonWithBio | null;
        };

        for (const raw of wltRows) {
          const row = raw as unknown as WltRow;
          const lid = row.listing_id;
          if (!peopleMap[lid]) peopleMap[lid] = [];
          if (row.profiles) {
            peopleMap[lid].push(row.profiles);
          }
          if (uid && row.user_id === uid) {
            userSet.add(lid);
          }
        }
        setWouldLiveSet(userSet);
        setWouldLivePeopleMap(peopleMap);
      }

      // Fetch user's favorites
      if (uid) {
        const { data: favRows } = await supabase
          .from('favorites')
          .select('listing_id')
          .eq('user_id', uid);
        if (favRows) {
          setFavoritesSet(
            new Set(
              (favRows as unknown as { listing_id: number }[]).map(
                (r) => r.listing_id,
              ),
            ),
          );
        }
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

    // Filter out hidden listings
    result = result.filter((l) => !hiddenIds.has(l.id));

    // Scam filter: remove per-room listings (price per bedroom below $800)
    result = result.filter((l) => l.beds === 0 || l.price / l.beds >= 800);

    if (filters.searchTag !== 'all') {
      result = result.filter((l) => l.search_tag === filters.searchTag);
    }
    if (filters.maxPricePerBed !== null) {
      result = result.filter((l) => l.price / l.beds <= filters.maxPricePerBed!);
    }
    if (filters.minBeds !== null) {
      result = result.filter((l) => l.beds >= filters.minBeds!);
    }
    if (filters.minRent !== null) {
      result = result.filter((l) => l.price >= filters.minRent!);
    }
    if (filters.maxRent !== null) {
      result = result.filter((l) => l.price <= filters.maxRent!);
    }

    // Listing age filter
    if (filters.maxListingAge !== null) {
      const now = Date.now();
      const msMap: Record<string, number> = {
        '1w': 7 * 24 * 60 * 60 * 1000,
        '2w': 14 * 24 * 60 * 60 * 1000,
        '1m': 30 * 24 * 60 * 60 * 1000,
        '3m': 90 * 24 * 60 * 60 * 1000,
        '6m': 180 * 24 * 60 * 60 * 1000,
        '1y': 365 * 24 * 60 * 60 * 1000,
      };
      const cutoff = now - (msMap[filters.maxListingAge] ?? 0);
      result = result.filter((l) => {
        const dateStr = l.list_date ?? l.created_at;
        if (!dateStr) return true;
        return new Date(dateStr).getTime() >= cutoff;
      });
    }

    // Source filter
    if (filters.selectedSources !== null) {
      const srcSet = new Set(filters.selectedSources);
      result = result.filter((l) => l.source && srcSet.has(l.source));
    }

    result.sort((a, b) => {
      if (filters.photosFirst) {
        const aHasPhotos = (a.photos ?? 0) > 0 ? 0 : 1;
        const bHasPhotos = (b.photos ?? 0) > 0 ? 0 : 1;
        if (aHasPhotos !== bHasPhotos) return aHasPhotos - bHasPhotos;
      }
      switch (filters.sort) {
        case 'pricePerBed':
          return a.price / a.beds - b.price / b.beds;
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
  }, [listings, filters, hiddenIds]);

  // Keep the ref in sync so the chat hook's getListingCount stays current
  filteredListingsRef.current = filteredListings;

  // -----------------------------------------------------------------------
  // Toggle handlers
  // -----------------------------------------------------------------------
  const handleToggleWouldLive = useCallback(
    async (listingId: number) => {
      if (!userId) {
        router.push('/auth/login');
        return;
      }

      const already = wouldLiveSet.has(listingId);
      // Optimistic update
      setWouldLiveSet((prev) => {
        const next = new Set(prev);
        if (already) next.delete(listingId);
        else next.add(listingId);
        return next;
      });

      if (already) {
        await supabase
          .from('would_live_there')
          .delete()
          .eq('user_id', userId)
          .eq('listing_id', listingId);
      } else {
        await supabase
          .from('would_live_there')
          .insert({ user_id: userId, listing_id: listingId });
      }
    },
    [userId, wouldLiveSet, supabase, router],
  );

  const handleToggleFavorite = useCallback(
    async (listingId: number) => {
      if (!userId) {
        router.push('/auth/login');
        return;
      }

      const already = favoritesSet.has(listingId);
      setFavoritesSet((prev) => {
        const next = new Set(prev);
        if (already) next.delete(listingId);
        else next.add(listingId);
        return next;
      });

      if (already) {
        await supabase
          .from('favorites')
          .delete()
          .eq('user_id', userId)
          .eq('listing_id', listingId);
      } else {
        await supabase
          .from('favorites')
          .insert({ user_id: userId, listing_id: listingId });
      }
    },
    [userId, favoritesSet, supabase, router],
  );

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
          isFavorited={favoritesSet.has(listing.id)}
          wouldLiveThere={wouldLiveSet.has(listing.id)}
          wouldLivePeople={wouldLivePeopleMap[listing.id] ?? []}
          isHiding={hidingId === listing.id}
          onClick={() => setSelectedId(listing.id)}
          onToggleWouldLive={() => handleToggleWouldLive(listing.id)}
          onToggleFavorite={() => handleToggleFavorite(listing.id)}
          onExpand={() => setDetailListing(listing)}
          onHide={() => handleHideListing(listing.id)}
        />
      ))}

      {filteredListings.length === 0 && (
        <div className="text-center py-12 text-sm" style={{ color: '#8b949e' }}>
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
        { value: 'swipe', label: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8M12 8v8"/></svg> },
        { value: 'map', label: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg> },
      ]}
      className="lg:hidden"
    />
  );

  const mapPanel = (
    <div className={`flex-1 ${mobileView === 'list' ? 'hidden lg:block' : mobileView === 'map' ? 'block' : 'hidden lg:block'}`} style={{ minHeight: 'calc(100vh - 56px - 42px)' }}>
      <Map
        listings={filteredListings}
        selectedId={selectedId}
        favoritedIds={favoritesSet}
        wouldLiveIds={wouldLiveSet}
        onToggleFavorite={handleToggleFavorite}
        onToggleWouldLive={handleToggleWouldLive}
        onSelectDetail={(listing) => setDetailListing(listing)}
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
      wouldLiveThere={wouldLiveSet.has(detailListing.id)}
      isFavorited={favoritesSet.has(detailListing.id)}
      wouldLivePeople={wouldLivePeopleMap[detailListing.id] ?? []}
      onToggleWouldLive={() => handleToggleWouldLive(detailListing.id)}
      onToggleFavorite={() => handleToggleFavorite(detailListing.id)}
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
    <div className="flex flex-col lg:flex-row" style={{ height: 'calc(100vh - 56px)' }}>
      {/* Sidebar: AI search bar + filters + listing cards */}
      <div
        className={`w-full lg:w-[480px] shrink-0 flex flex-col ${mobileView === 'map' ? 'max-lg:shrink max-lg:flex-none' : ''}`}
        style={{ borderRight: '1px solid #2d333b' }}
      >
        {/* AI search bar */}
        <AISearchBar
          onSearch={handleInlineAISearch}
          isLoading={chat.isLoading}
          lastQuery={lastAIQuery}
          lastError={lastAIError}
          isLoggedIn={!!userId}
        />

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
          />
        </div>

        {mobileView === 'swipe' ? (
          <SwipeView
            listings={filteredListings}
            userId={userId}
            favoritesSet={favoritesSet}
            wouldLiveSet={wouldLiveSet}
            onToggleFavorite={handleToggleFavorite}
            onToggleWouldLive={handleToggleWouldLive}
            onHideListing={handleHideListing}
            onExpandDetail={(listing) => { setSelectedId(listing.id); setDetailListing(filteredListings.find(l => l.id === listing.id) ?? null); }}
            onSwitchView={() => setMobileView('list')}
          />
        ) : (
          <div className={`flex-1 overflow-y-auto min-h-0 px-3 py-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3 ${mobileView === 'map' ? 'hidden lg:grid' : ''}`}>
            {listingCards}
          </div>
        )}
      </div>

      {/* Map */}
      {mapPanel}

      {/* Chat drawer (slide-out) */}
      {chatDrawer}

      {/* Toast */}
      {toastEl}

      {/* Detail modal */}
      {detailModal}

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
