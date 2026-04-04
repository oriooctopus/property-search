'use client';

import { useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Database } from '@/lib/types';
import type { CommuteInfo } from './ListingCard';

type Listing = Database['public']['Tables']['listings']['Row'];

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

const TAG_COLORS: Record<string, string> = {
  manhattan: '#38bdf8',
  brooklyn: '#4ade80',
};

/* ------------------------------------------------------------------ */
/*  Dark-themed Leaflet popup overrides                                */
/* ------------------------------------------------------------------ */
const POPUP_STYLES = `
  .dark-popup .leaflet-popup-content-wrapper {
    background: #1c2028;
    border: 1px solid #2d333b;
    border-radius: 12px;
    padding: 0;
    box-shadow: 0 8px 24px rgba(0,0,0,0.45);
  }
  .dark-popup .leaflet-popup-content {
    margin: 0;
    line-height: 1.4;
  }
  .dark-popup .leaflet-popup-tip {
    background: #1c2028;
    border: 1px solid #2d333b;
    box-shadow: none;
  }
  .dark-popup .leaflet-popup-close-button {
    color: #8b949e !important;
    font-size: 18px;
    top: 4px !important;
    right: 6px !important;
  }
  .dark-popup .leaflet-popup-close-button:hover {
    color: #e1e4e8 !important;
  }
  .dark-popup [data-action="would-live"] {
    transition: color 150ms, background-color 150ms;
    border-radius: 4px;
  }
  .dark-popup [data-action="would-live"]:hover {
    background-color: rgba(249, 115, 22, 0.15) !important;
    color: #fb923c !important;
  }
  .dark-popup [data-action="favorite"] {
    transition: color 150ms, background-color 150ms;
    border-radius: 4px;
  }
  .dark-popup [data-action="favorite"]:hover {
    background-color: rgba(251, 191, 36, 0.15) !important;
    color: #fcd34d !important;
  }
  .dark-popup [data-action="open-detail-btn"] {
    transition: color 150ms, background-color 150ms;
  }
  .dark-popup [data-action="open-detail-btn"]:hover {
    background-color: rgba(88, 166, 255, 0.1) !important;
    color: #79c0ff !important;
  }
  .dark-popup [data-action="open-detail-btn"]:active {
    background-color: rgba(88, 166, 255, 0.2) !important;
  }
`;

function InjectPopupStyles() {
  useEffect(() => {
    const id = 'dwelligence-popup-styles';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = POPUP_STYLES;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, []);
  return null;
}

function InvalidateSize({ visible }: { visible: boolean }) {
  const map = useMap();

  // On mount: initial invalidation
  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 100);
    return () => clearTimeout(timer);
  }, [map]);

  // When the container transitions from hidden→visible (e.g. mobile list→map toggle),
  // ResizeObserver may not fire because display:none elements have no layout.
  // Explicitly invalidate with a safe delay whenever visible becomes true.
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => map.invalidateSize(), 150);
    return () => clearTimeout(timer);
  }, [map, visible]);

  // Handle container resize (e.g. window resize, browser zoom)
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);

  return null;
}

function FlyToSelected({ listing, suppressBoundsRef }: { listing: Listing | undefined; suppressBoundsRef: React.MutableRefObject<boolean> }) {
  const map = useMap();
  const prevId = useRef<number | null>(null);

  useEffect(() => {
    if (listing && listing.id !== prevId.current) {
      prevId.current = listing.id;
      const lat = Number(listing.lat);
      const lon = Number(listing.lon);
      // Guard against NaN coordinates and hidden/zero-size map containers
      // (Leaflet's flyTo calls unproject which produces NaN when the
      // container has no dimensions, e.g. display:none on mobile).
      const size = map.getSize();
      if (!isNaN(lat) && !isNaN(lon) && size.x > 0 && size.y > 0) {
        // Suppress the bounds-change callback triggered by this programmatic
        // flyTo so we don't accidentally replace the full listing set.
        suppressBoundsRef.current = true;
        map.flyTo([lat, lon], 15, { duration: 0.8 });
      }
    }
  }, [listing, map, suppressBoundsRef]);

  return null;
}

export interface ViewportBounds {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

export interface MapProps {
  listings: Listing[];
  selectedId: number | null;
  onMarkerClick: (id: number) => void;
  onSelectDetail: (listing: Listing) => void;
  favoritedIds: Set<number>;
  wouldLiveIds: Set<number>;
  onToggleFavorite: (id: number) => void;
  onToggleWouldLive: (id: number) => void;
  onHideListing: (id: number) => void;
  onBoundsChange?: (bounds: ViewportBounds) => void;
  onMapMove?: (center: { lat: number; lng: number }, zoom: number) => void;
  suppressBoundsRef?: React.MutableRefObject<boolean>;
  initialCenter?: [number, number];
  initialZoom?: number;
  /** Whether the map container is currently visible. Used to trigger invalidateSize on show. */
  visible?: boolean;
  /** Per-listing commute info keyed by listing id */
  commuteInfoMap?: Map<number, CommuteInfo>;
}

/* ------------------------------------------------------------------ */
/*  Viewport bounds watcher — fires onBoundsChange after 500ms idle   */
/* ------------------------------------------------------------------ */
function BoundsWatcher({ onBoundsChange, onMapMove, suppressBoundsRef }: { onBoundsChange: (bounds: ViewportBounds) => void; onMapMove?: (center: { lat: number; lng: number }, zoom: number) => void; suppressBoundsRef: React.MutableRefObject<boolean> }) {
  const map = useMap();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onBoundsChangeRef = useRef(onBoundsChange);
  onBoundsChangeRef.current = onBoundsChange;
  const onMapMoveRef = useRef(onMapMove);
  onMapMoveRef.current = onMapMove;

  useEffect(() => {
    const fireBounds = () => {
      // Skip viewport reload triggered by a programmatic flyTo
      if (suppressBoundsRef.current) {
        suppressBoundsRef.current = false;
        return;
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const b = map.getBounds();
        const latMin = b.getSouth();
        const latMax = b.getNorth();
        const lonMin = b.getWest();
        const lonMax = b.getEast();
        // Guard against degenerate bbox (map not sized yet, or immediate
        // list→map toggle before invalidateSize completes).
        if (latMax === latMin || Math.abs(latMax - latMin) > 5 || Math.abs(lonMax - lonMin) > 5) return;
        onBoundsChangeRef.current({ latMin, latMax, lonMin, lonMax });
        // Also sync map center + zoom to URL (only for user-initiated moves)
        if (onMapMoveRef.current) {
          const c = map.getCenter();
          onMapMoveRef.current({ lat: c.lat, lng: c.lng }, map.getZoom());
        }
      }, 500);
    };

    map.on('moveend', fireBounds);
    map.on('zoomend', fireBounds);

    return () => {
      map.off('moveend', fireBounds);
      map.off('zoomend', fireBounds);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [map, suppressBoundsRef]);

  return null;
}

/* ------------------------------------------------------------------ */
/*  Rich popup content builder                                         */
/* ------------------------------------------------------------------ */
function buildPopupContent(listing: Listing, isFavorited: boolean, isWouldLive: boolean, commuteInfo?: CommuteInfo): string {
  const photos = listing.photo_urls ?? [];
  const hasPhoto = photos.length > 0;
  const totalPhotos = photos.length;

  const arrowBtnStyle = `
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: rgba(0,0,0,0.55);
    border: none;
    color: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    line-height: 1;
    padding: 0;
    z-index: 2;
  `.replace(/\n\s*/g, ' ');

  const photoHtml = hasPhoto
    ? `<div data-photo-container style="
        position: relative;
        width: 140px;
        flex-shrink: 0;
        overflow: hidden;
        border-radius: 11px 0 0 11px;
        aspect-ratio: 3 / 2;
      ">
        <img
          data-photo-img
          src="${escapeHtml(photos[0])}"
          alt=""
          data-photo-index="0"
          data-photo-urls="${escapeHtml(JSON.stringify(photos))}"
          style="
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
          "
        />
        ${totalPhotos > 1 ? `
          <button data-action="photo-prev" data-listing-id="${listing.id}" style="${arrowBtnStyle} left: 4px;">&#8249;</button>
          <button data-action="photo-next" data-listing-id="${listing.id}" style="${arrowBtnStyle} right: 4px;">&#8250;</button>
        ` : ''}
        ${totalPhotos > 1 ? `
          <div data-photo-counter style="
            position: absolute;
            bottom: 4px;
            right: 4px;
            background: rgba(0,0,0,0.6);
            color: #fff;
            font-size: 10px;
            padding: 1px 5px;
            border-radius: 4px;
            z-index: 2;
          ">1/${totalPhotos}</div>
        ` : ''}
      </div>`
    : '';

  const wouldLiveColor = isWouldLive ? '#f97316' : '#8b949e';
  const likeColor = isFavorited ? '#58a6ff' : '#8b949e';

  const actionBtnStyle = `background:none;border:none;cursor:pointer;padding:4px;display:flex;align-items:center;border-radius:4px;`;

  const actionsHtml = `
    <div style="display: flex; gap: 8px; margin-top: 6px;">
      <button
        data-action="dislike"
        data-listing-id="${listing.id}"
        title="Dislike"
        style="${actionBtnStyle} color: #8b949e;"
      ><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2H20a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3m-7 2v4a3 3 0 0 0 3 3l4-9V2H6.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10"/></svg></button>
      <button
        data-action="would-live"
        data-listing-id="${listing.id}"
        title="Would live here"
        style="${actionBtnStyle} color: ${wouldLiveColor};"
      ><svg width="16" height="16" viewBox="0 0 24 24" fill="${isWouldLive ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><rect x="9" y="12" width="6" height="10"/></svg></button>
      <button
        data-action="favorite"
        data-listing-id="${listing.id}"
        title="Like"
        style="${actionBtnStyle} color: ${likeColor};"
      ><svg width="16" height="16" viewBox="0 0 24 24" fill="${isFavorited ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3m7-2V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14"/></svg></button>
    </div>`;

  return `
    <div data-action="open-detail" data-listing-id="${listing.id}" style="
      display: flex;
      min-width: ${hasPhoto ? '280px' : '180px'};
      max-width: 340px;
      color: #e1e4e8;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      cursor: pointer;
    ">
      ${photoHtml}
      <div style="
        padding: 10px 14px;
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
        min-width: 0;
      ">
        <div style="
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #8b949e;
          margin-bottom: 1px;
        ">${escapeHtml(listing.area)}</div>
        <div style="
          font-weight: 700;
          font-size: 13px;
          color: #e1e4e8;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        ">${escapeHtml(listing.address)}</div>
        <div style="
          font-weight: 700;
          font-size: 15px;
          color: #3fb950;
          margin: 2px 0;
        ">$${listing.price.toLocaleString()}/mo</div>
        <div style="
          font-size: 11px;
          color: #8b949e;
          margin-bottom: 2px;
        ">${listing.beds > 0 ? `$${Math.round(listing.price / listing.beds).toLocaleString()}/bed · ` : ''}${listing.beds === 0 ? 'Studio' : `${listing.beds} bd`} / ${listing.baths} ba</div>
        ${'' /* Commute badge removed — inaccurate for OTP polygon filters */}
        ${actionsHtml}
        <div data-action="open-detail-btn" data-listing-id="${listing.id}" style="
          margin-top: 6px;
          padding: 6px 0;
          font-size: 11px;
          font-weight: 600;
          color: #58a6ff;
          text-align: center;
          cursor: pointer;
          border-top: 1px solid #2d333b;
        ">View details &rarr;</div>
      </div>
    </div>
  `;
}

export default function MapInner({ listings, selectedId, onMarkerClick, onSelectDetail, favoritedIds, wouldLiveIds, onToggleFavorite, onToggleWouldLive, onHideListing, onBoundsChange, onMapMove, suppressBoundsRef: suppressBoundsRefProp, initialCenter, initialZoom, visible = true, commuteInfoMap }: MapProps) {
  // Fall back to a local ref if the caller doesn't provide one
  const localSuppressBoundsRef = useRef(false);
  const suppressBoundsRef = suppressBoundsRefProp ?? localSuppressBoundsRef;
  // Supabase returns numeric columns as strings — coerce to numbers
  const validListings = listings
    .map((l) => ({ ...l, lat: Number(l.lat), lon: Number(l.lon) }))
    .filter((l) => !isNaN(l.lat) && !isNaN(l.lon) && l.lat !== 0 && l.lon !== 0);

  const selectedListing = validListings.find((l) => l.id === selectedId);

  const computedCenter: [number, number] = validListings.length > 0
    ? [
        validListings.reduce((s, l) => s + l.lat, 0) / validListings.length,
        validListings.reduce((s, l) => s + l.lon, 0) / validListings.length,
      ]
    : [40.7128, -74.006];

  // Use URL-provided initial position if valid, otherwise fall back to listing average
  const center: [number, number] = initialCenter ?? computedCenter;
  const zoom: number = initialZoom ?? 13;

  // Track whether each popup was opened by click (persistent) vs hover (auto-close)
  const clickedRef = useRef<Set<number>>(new Set());
  // Track debounce timers for hover-close so moving to the popup doesn't close it
  const closeTimerRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  // Track popup elements by listing id so we can detect mouse-over-popup
  const popupElRef = useRef<Map<number, HTMLElement>>(new Map());

  // Keep stable refs for the toggle callbacks so popupopen handlers always see latest
  const onToggleFavoriteRef = useRef(onToggleFavorite);
  onToggleFavoriteRef.current = onToggleFavorite;
  const onToggleWouldLiveRef = useRef(onToggleWouldLive);
  onToggleWouldLiveRef.current = onToggleWouldLive;
  const onHideListingRef = useRef(onHideListing);
  onHideListingRef.current = onHideListing;
  const onSelectDetailRef = useRef(onSelectDetail);
  onSelectDetailRef.current = onSelectDetail;
  // Keep a map of listings by id for the detail callback
  const listingsMapRef = useRef<Map<number, Listing>>(new Map());
  useEffect(() => {
    const m = new Map<number, Listing>();
    listings.forEach((l) => m.set(l.id, l));
    listingsMapRef.current = m;
  }, [listings]);

  const handlePopupOpen = useCallback((listing: Listing) => {
    return (e: L.LeafletEvent) => {
      const popup = (e as unknown as { popup: L.Popup }).popup;
      const container = popup?.getElement?.();
      console.log(`[popup] popupopen fired for listing #${listing.id}`, {
        hasContainer: !!container,
        hasPopup: !!popup,
        isClicked: clickedRef.current.has(listing.id),
      });
      if (!container) {
        console.warn(`[popup] NO CONTAINER for listing #${listing.id} — handlers will NOT be wired`);
        return;
      }

      // Track popup element for hover detection
      popupElRef.current.set(listing.id, container);

      // When the mouse enters the popup, cancel any pending close timer
      const onPopupMouseEnter = () => {
        const timer = closeTimerRef.current.get(listing.id);
        if (timer) {
          clearTimeout(timer);
          closeTimerRef.current.delete(listing.id);
        }
      };
      // When the mouse leaves the popup (and it was a hover-opened popup), close it
      const onPopupMouseLeave = () => {
        if (!clickedRef.current.has(listing.id)) {
          const marker = e.target as L.CircleMarker;
          const timer = setTimeout(() => {
            closeTimerRef.current.delete(listing.id);
            marker.closePopup();
          }, 200);
          closeTimerRef.current.set(listing.id, timer);
        }
      };

      container.addEventListener('mouseenter', onPopupMouseEnter);
      container.addEventListener('mouseleave', onPopupMouseLeave);

      // Use event delegation on the container — works immediately regardless
      // of when child elements render. No need to wait for rAF or query children.
      if (!container.getAttribute('data-delegated')) {
        container.setAttribute('data-delegated', '1');
        L.DomEvent.disableClickPropagation(container);

        const handleAction = (ev: Event) => {
          const target = ev.target as HTMLElement;
          const actionEl = target.closest('[data-action]') as HTMLElement | null;
          if (!actionEl) return;

          const action = actionEl.getAttribute('data-action');
          const id = Number(actionEl.getAttribute('data-listing-id') || '0');
          ev.stopPropagation();
          if (ev.type === 'touchend') (ev as TouchEvent).preventDefault();

          console.log(`[popup] delegated ${ev.type} — action="${action}" listing=#${id}`);

          switch (action) {
            case 'would-live':
              onToggleWouldLiveRef.current(id);
              break;
            case 'favorite':
              onToggleFavoriteRef.current(id);
              break;
            case 'dislike':
              onHideListingRef.current(id);
              break;
            case 'photo-prev':
            case 'photo-next': {
              const img = container.querySelector('[data-photo-img]') as HTMLImageElement | null;
              const counter = container.querySelector('[data-photo-counter]') as HTMLElement | null;
              if (img) {
                let urls: string[] = [];
                try { urls = JSON.parse(img.getAttribute('data-photo-urls') || '[]'); } catch { /* ignore */ }
                let idx = Number(img.getAttribute('data-photo-index') || '0');
                const total = urls.length;
                if (total > 0) {
                  idx = action === 'photo-prev' ? (idx - 1 + total) % total : (idx + 1) % total;
                  img.src = urls[idx];
                  img.setAttribute('data-photo-index', String(idx));
                  if (counter) counter.textContent = `${idx + 1}/${total}`;
                }
              }
              break;
            }
            case 'open-detail-btn': {
              const foundListing = listingsMapRef.current.get(id);
              console.log(`[popup] "View details" — id=${id}, found=${!!foundListing}`);
              if (foundListing) onSelectDetailRef.current(foundListing);
              break;
            }
            case 'open-detail': {
              // Card area click — only if target isn't a nested action button
              const nestedAction = target.closest('[data-action]:not([data-action="open-detail"])') as HTMLElement | null;
              if (nestedAction) return;
              const foundListing = listingsMapRef.current.get(id);
              console.log(`[popup] card click — id=${id}, found=${!!foundListing}`);
              if (foundListing) onSelectDetailRef.current(foundListing);
              break;
            }
          }
        };

        container.addEventListener('click', handleAction);
        container.addEventListener('touchend', handleAction);
        console.log(`[popup] event delegation attached to container for listing #${listing.id}`);
      }
    };
  }, []);

  // wirePopupHandlers removed — replaced by event delegation in handlePopupOpen

  const handleMouseOver = useCallback((listing: Listing) => {
    return (e: L.LeafletMouseEvent) => {
      // Skip synthetic mouseover events on touch devices
      if (e.originalEvent && 'touches' in (e.originalEvent as unknown as object)) return;
      // Cancel any pending close timer for this marker
      const timer = closeTimerRef.current.get(listing.id);
      if (timer) {
        clearTimeout(timer);
        closeTimerRef.current.delete(listing.id);
      }
      if (!clickedRef.current.has(listing.id)) {
        e.target.openPopup();
      }
    };
  }, []);

  const handleMouseOut = useCallback((listing: Listing) => {
    return (e: L.LeafletMouseEvent) => {
      if (!clickedRef.current.has(listing.id)) {
        // Debounce the close so the user can move their mouse to the popup
        const timer = setTimeout(() => {
          closeTimerRef.current.delete(listing.id);
          // Check if the mouse is now over the popup element
          const popupEl = popupElRef.current.get(listing.id);
          if (popupEl && popupEl.matches(':hover')) return;
          e.target.closePopup();
        }, 250);
        closeTimerRef.current.set(listing.id, timer);
      }
    };
  }, []);

  const handleClick = useCallback((listing: Listing) => {
    return (e: L.LeafletMouseEvent) => {
      console.log(`[popup] marker CLICK #${listing.id} — opening popup`);
      clickedRef.current.add(listing.id);
      e.target.openPopup();
      onMarkerClick(listing.id);
    };
  }, [onMarkerClick]);

  const handlePopupClose = useCallback((listing: Listing) => {
    return () => {
      console.log(`[popup] popupclose #${listing.id} — cleaning up refs`);
      clickedRef.current.delete(listing.id);
      // No need to reset data-delegated — the delegated click/touchend listener
      // on the container works regardless of child re-rendering.
      popupElRef.current.delete(listing.id);
      const timer = closeTimerRef.current.get(listing.id);
      if (timer) {
        clearTimeout(timer);
        closeTimerRef.current.delete(listing.id);
      }
    };
  }, []);

  const legendItems = [
    { color: '#38bdf8', label: 'Manhattan' },
    { color: '#4ade80', label: 'Brooklyn' },
  ];

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ height: '100%', width: '100%', background: '#0f1117' }}
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <InvalidateSize visible={visible} />
        <InjectPopupStyles />
        <FlyToSelected listing={selectedListing} suppressBoundsRef={suppressBoundsRef} />
        {onBoundsChange && <BoundsWatcher onBoundsChange={onBoundsChange} onMapMove={onMapMove} suppressBoundsRef={suppressBoundsRef} />}
        {validListings.map((listing) => {
          const color = TAG_COLORS[listing.search_tag] ?? '#8b949e';
          const isSelected = listing.id === selectedId;
          return (
            <CircleMarker
              key={listing.id}
              center={[listing.lat, listing.lon]}
              radius={isSelected ? 18 : 14}
              pathOptions={{
                color: isSelected ? '#ffffff' : color,
                fillColor: color,
                fillOpacity: 0.85,
                weight: isSelected ? 3 : 1.5,
              }}
              eventHandlers={{
                click: handleClick(listing),
                mouseover: handleMouseOver(listing),
                mouseout: handleMouseOut(listing),
                popupclose: handlePopupClose(listing),
                popupopen: handlePopupOpen(listing),
              }}
            >
              <Popup className="dark-popup">
                <div dangerouslySetInnerHTML={{ __html: buildPopupContent(listing, favoritedIds.has(listing.id), wouldLiveIds.has(listing.id), commuteInfoMap?.get(listing.id)) }} />
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {/* Legend overlay */}
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          right: 12,
          zIndex: 1000,
          background: '#1c2028',
          border: '1px solid #2d333b',
          borderRadius: 8,
          padding: '12px 16px',
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase' as const,
            color: '#8b949e',
            marginBottom: 8,
          }}
        >
          Search
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {legendItems.map((item) => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: item.color,
                  flexShrink: 0,
                  display: 'inline-block',
                }}
              />
              <span style={{ fontSize: 12, color: '#e1e4e8' }}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
