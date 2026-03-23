'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import type { Database } from '@/lib/types';
import Map from '@/components/Map';
import Filters, { type FiltersState, type SearchTag, type SortField } from '@/components/Filters';
import ListingCard from '@/components/ListingCard';
import ListingDetail from '@/components/ListingDetail';
import RadarLoader from '@/components/RadarLoader';
import { SegmentedControl } from '@/components/ui';

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
  { id: -1, address: '240 E 6th St Apt 1', area: 'East Village', price: 9995, beds: 5, baths: 2, sqft: null, lat: 40.7262, lon: -73.9858, transit_summary: '~10 min walk to 1st Ave L', photos: 18, photo_urls: [], url: 'https://www.realtor.com/rentals/details/240-E-6th-St-Apt-1_New-York_NY_10003_M95522-46041', search_tag: 'ltrain', created_at: '' },
  { id: -2, address: '165 Attorney St Apt 5C', area: 'Lower East Side', price: 9450, beds: 6, baths: 2, sqft: null, lat: 40.7195, lon: -73.9845, transit_summary: '16 min J to Fulton', photos: 6, photo_urls: [], url: 'https://www.realtor.com/rentals/details/165-Attorney-St-Apt-5C_New-York_NY_10002_M94116-63343', search_tag: 'fulton', created_at: '' },
  { id: -3, address: '53 Park Pl Ph 2', area: 'Tribeca', price: 9000, beds: 5, baths: 2, sqft: null, lat: 40.7141, lon: -74.0079, transit_summary: 'Tribeca / Park Place', photos: 12, photo_urls: [], url: 'https://www.realtor.com/rentals/details/53-Park-Pl-2_New-York_NY_10007_M90339-21295', search_tag: 'manhattan', created_at: '' },
  { id: -4, address: '372 Bainbridge St', area: 'Stuyvesant Heights', price: 6995, beds: 5, baths: 4, sqft: null, lat: 40.6808, lon: -73.927, transit_summary: '34 min C to 14th/8th Ave', photos: 16, photo_urls: [], url: 'https://www.realtor.com/rentals/details/372-Bainbridge-St-Unit-Triplex_Brooklyn_NY_11233_M96732-47148', search_tag: 'brooklyn', created_at: '' },
  { id: -5, address: '171 Attorney St Unit 6A', area: 'Lower East Side', price: 11000, beds: 7, baths: 2.5, sqft: null, lat: 40.7198, lon: -73.9843, transit_summary: '16 min J to Fulton', photos: 3, photo_urls: [], url: 'https://www.realtor.com/rentals/details/171-Attorney-St-6A_New-York_NY_10002_M99751-50289', search_tag: 'fulton', created_at: '' },
  { id: -6, address: '386 Stuyvesant Ave', area: 'Stuyvesant Heights', price: 12500, beds: 6, baths: 3.5, sqft: 3200, lat: 40.6838, lon: -73.9298, transit_summary: '18 min A to Fulton / 30 min to 14th', photos: 24, photo_urls: [], url: 'https://www.realtor.com/rentals/details/386-Stuyvesant-Ave_Brooklyn_NY_11233_M44801-18988', search_tag: 'brooklyn', created_at: '' },
  { id: -7, address: '50 Murray St Unit 2211', area: 'Tribeca', price: 10000, beds: 5, baths: 2, sqft: null, lat: 40.7143, lon: -74.0086, transit_summary: 'Tribeca / Murray St', photos: 9, photo_urls: [], url: 'https://www.realtor.com/rentals/details/50-Murray-St-2211_New-York_NY_10007_M93038-48259', search_tag: 'manhattan', created_at: '' },
  { id: -8, address: '290 Jefferson Ave', area: 'Bedford-Stuyvesant', price: 10900, beds: 5, baths: 4, sqft: 3600, lat: 40.6862, lon: -73.943, transit_summary: '30 min A to 14th/8th Ave', photos: 19, photo_urls: [], url: 'https://www.realtor.com/rentals/details/290-Jefferson-Ave_Brooklyn_NY_11216_M49395-49974', search_tag: 'brooklyn', created_at: '' },
  { id: -9, address: '276 Halsey St #2', area: 'Bedford-Stuyvesant', price: 10750, beds: 5, baths: 3.5, sqft: null, lat: 40.6842, lon: -73.9418, transit_summary: '31 min A to 14th/8th Ave', photos: 16, photo_urls: [], url: 'https://www.realtor.com/rentals/details/276-Halsey-St-2_Brooklyn_NY_11216_M93027-20426', search_tag: 'brooklyn', created_at: '' },
  { id: -10, address: '53 Park Pl Apt 3E', area: 'Tribeca', price: 13500, beds: 5, baths: 3, sqft: null, lat: 40.7141, lon: -74.0079, transit_summary: 'Tribeca / Park Place', photos: 20, photo_urls: [], url: 'https://www.realtor.com/rentals/details/53-Park-Pl-Apt-3E_New-York_NY_10007_M39270-97535', search_tag: 'manhattan', created_at: '' },
];

// ---------------------------------------------------------------------------
// Helpers: read / write URL query params
// ---------------------------------------------------------------------------
const VALID_VIEWS = new Set(['list', 'map']);
const VALID_TAGS = new Set<string>(['all', 'fulton', 'ltrain', 'manhattan', 'brooklyn']);
const VALID_SORTS = new Set<string>(['pricePerBed', 'price', 'beds']);

function parseNumOrNull(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function readFiltersFromParams(params: URLSearchParams): FiltersState {
  const tag = params.get('tag');
  const sort = params.get('sort');
  return {
    searchTag: (tag && VALID_TAGS.has(tag) ? tag : 'all') as SearchTag,
    sort: (sort && VALID_SORTS.has(sort) ? sort : 'pricePerBed') as SortField,
    minBeds: parseNumOrNull(params.get('minBeds')),
    minBaths: parseNumOrNull(params.get('minBaths')),
    minRent: parseNumOrNull(params.get('minRent')),
    maxRent: parseNumOrNull(params.get('maxRent')),
    maxPricePerBed: parseNumOrNull(params.get('maxPerBed')),
  };
}

function buildQueryString(view: 'list' | 'map', f: FiltersState): string {
  const p = new URLSearchParams();
  if (view !== 'list') p.set('view', view);
  if (f.searchTag !== 'all') p.set('tag', f.searchTag);
  if (f.sort !== 'pricePerBed') p.set('sort', f.sort);
  if (f.minBeds != null) p.set('minBeds', String(f.minBeds));
  if (f.minBaths != null) p.set('minBaths', String(f.minBaths));
  if (f.minRent != null) p.set('minRent', String(f.minRent));
  if (f.maxRent != null) p.set('maxRent', String(f.maxRent));
  if (f.maxPricePerBed != null) p.set('maxPerBed', String(f.maxPricePerBed));
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

  // Data state
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [wouldLiveSet, setWouldLiveSet] = useState<Set<number>>(new Set());
  const [favoritesSet, setFavoritesSet] = useState<Set<number>>(new Set());
  const [wouldLivePeopleMap, setWouldLivePeopleMap] = useState<Record<number, PersonWithBio[]>>({});

  // UI state — initialised from URL query params
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailListing, setDetailListing] = useState<Listing | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'map'>(() => {
    const v = searchParams.get('view');
    return v && VALID_VIEWS.has(v) ? (v as 'list' | 'map') : 'list';
  });
  const [filters, setFilters] = useState<FiltersState>(() =>
    readFiltersFromParams(searchParams),
  );

  // Sync state changes to URL via history.replaceState (avoids Next.js
  // navigation overhead and unnecessary re-renders).
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    window.history.replaceState(null, '', buildQueryString(mobileView, filters));
  }, [mobileView, filters]);

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
        lat: Number(l.lat),
        lon: Number(l.lon),
        baths: Number(l.baths),
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
  // Filter + sort
  // -----------------------------------------------------------------------
  const filteredListings = useMemo(() => {
    let result = [...listings];

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

    result.sort((a, b) => {
      switch (filters.sort) {
        case 'pricePerBed':
          return a.price / a.beds - b.price / b.beds;
        case 'price':
          return a.price - b.price;
        case 'beds':
          return b.beds - a.beds;
        default:
          return 0;
      }
    });

    return result;
  }, [listings, filters]);

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

  return (
    <div className="flex flex-col lg:flex-row" style={{ height: 'calc(100vh - 56px)' }}>
      {/* Sidebar: filter bar is always visible; listing cards hide on mobile map view */}
      <div
        className={`w-full lg:w-[480px] shrink-0 flex flex-col ${mobileView === 'map' ? 'max-lg:shrink max-lg:flex-none' : ''}`}
        style={{ borderRight: '1px solid #2d333b' }}
      >
        <div className="relative z-10">
          <Filters
            filters={filters}
            onChange={setFilters}
            listingCount={filteredListings.length}
            viewToggle={
              <SegmentedControl
                value={mobileView}
                onChange={(v) => setMobileView(v as 'list' | 'map')}
                options={[
                  { value: 'list', label: 'List' },
                  { value: 'map', label: 'Map' },
                ]}
                className="lg:hidden"
              />
            }
          />
        </div>

        <div className={`flex-1 overflow-y-auto min-h-0 px-3 py-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3 ${mobileView === 'map' ? 'hidden lg:grid' : ''}`}>
          {filteredListings.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              isSelected={listing.id === selectedId}
              isFavorited={favoritesSet.has(listing.id)}
              wouldLiveThere={wouldLiveSet.has(listing.id)}
              wouldLivePeople={wouldLivePeopleMap[listing.id] ?? []}
              onClick={() => setSelectedId(listing.id)}
              onToggleWouldLive={() => handleToggleWouldLive(listing.id)}
              onToggleFavorite={() => handleToggleFavorite(listing.id)}
              onExpand={() => setDetailListing(listing)}
            />
          ))}

          {filteredListings.length === 0 && (
            <div className="text-center py-12 text-sm" style={{ color: '#8b949e' }}>
              No listings match your filters.
            </div>
          )}
        </div>
      </div>

      {/* Map */}
      <div className={`flex-1 ${mobileView === 'list' ? 'hidden lg:block' : 'block'}`} style={{ minHeight: 'calc(100vh - 56px - 42px)' }}>
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
            // Only scroll to card on desktop where the list panel is visible alongside the map.
            // On mobile, let the Leaflet Popup show naturally instead of switching views.
            if (window.innerWidth >= 1024) {
              setTimeout(() => {
                const el = document.getElementById(`listing-${id}`);
                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 100);
            }
          }}
        />
      </div>

      {/* Detail modal */}
      {detailListing && (
        <ListingDetail
          listing={detailListing}
          wouldLiveThere={wouldLiveSet.has(detailListing.id)}
          isFavorited={favoritesSet.has(detailListing.id)}
          wouldLivePeople={wouldLivePeopleMap[detailListing.id] ?? []}
          onToggleWouldLive={() => handleToggleWouldLive(detailListing.id)}
          onToggleFavorite={() => handleToggleFavorite(detailListing.id)}
          onClose={() => setDetailListing(null)}
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
