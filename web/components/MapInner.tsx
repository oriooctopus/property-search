'use client';

import { useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Database } from '@/lib/types';

type Listing = Database['public']['Tables']['listings']['Row'];

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

const TAG_COLORS: Record<string, string> = {
  fulton: '#f97316',
  ltrain: '#a78bfa',
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

function InvalidateSize() {
  const map = useMap();
  useEffect(() => {
    // Small delay to let the container finish its CSS transition
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 100);
    // Also handle resize
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
    });
    observer.observe(map.getContainer());
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [map]);
  return null;
}

function FlyToSelected({ listing }: { listing: Listing | undefined }) {
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
        map.flyTo([lat, lon], 15, { duration: 0.8 });
      }
    }
  }, [listing, map]);

  return null;
}

interface MapProps {
  listings: Listing[];
  selectedId: number | null;
  onMarkerClick: (id: number) => void;
  onSelectDetail: (listing: Listing) => void;
  favoritedIds: Set<number>;
  wouldLiveIds: Set<number>;
  onToggleFavorite: (id: number) => void;
  onToggleWouldLive: (id: number) => void;
}

/* ------------------------------------------------------------------ */
/*  Rich popup content builder                                         */
/* ------------------------------------------------------------------ */
function buildPopupContent(listing: Listing, isFavorited: boolean, isWouldLive: boolean): string {
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
  const favoriteColor = isFavorited ? '#fbbf24' : '#8b949e';

  const actionsHtml = `
    <div style="display: flex; gap: 8px; margin-top: 6px;">
      <button
        data-action="would-live"
        data-listing-id="${listing.id}"
        title="I would live there"
        style="
          background: none;
          border: none;
          cursor: pointer;
          padding: 2px;
          color: ${wouldLiveColor};
          display: flex;
          align-items: center;
        "
      ><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1L1 7h2v6h4v-4h2v4h4V7h2L8 1z"/></svg></button>
      <button
        data-action="favorite"
        data-listing-id="${listing.id}"
        title="Save to favorites"
        style="
          background: none;
          border: none;
          cursor: pointer;
          padding: 2px;
          color: ${favoriteColor};
          display: flex;
          align-items: center;
        "
      ><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0l2.5 5 5.5.8-4 3.9.9 5.3L8 12.5 3.1 15l.9-5.3-4-3.9L5.5 5z"/></svg></button>
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
        ">$${listing.beds > 0 ? Math.round(listing.price / listing.beds).toLocaleString() : '–'}/bed · ${listing.beds} bd / ${listing.baths} ba</div>
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

export default function MapInner({ listings, selectedId, onMarkerClick, onSelectDetail, favoritedIds, wouldLiveIds, onToggleFavorite, onToggleWouldLive }: MapProps) {
  // Supabase returns numeric columns as strings — coerce to numbers
  const validListings = listings
    .map((l) => ({ ...l, lat: Number(l.lat), lon: Number(l.lon) }))
    .filter((l) => !isNaN(l.lat) && !isNaN(l.lon));

  const selectedListing = validListings.find((l) => l.id === selectedId);

  const center: [number, number] = validListings.length > 0
    ? [
        validListings.reduce((s, l) => s + l.lat, 0) / validListings.length,
        validListings.reduce((s, l) => s + l.lon, 0) / validListings.length,
      ]
    : [40.7128, -74.006];

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
      if (!container) return;

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

      // React hasn't rendered the dangerouslySetInnerHTML content yet when
      // Leaflet fires popupopen. Defer handler wiring until the next frame
      // so the DOM is populated.
      requestAnimationFrame(() => {
        wirePopupHandlers(container);
      });
    };
  }, []);

  const wirePopupHandlers = useCallback((container: HTMLElement) => {
      // Prevent clicks inside the popup from propagating to the map
      // (which would trigger Leaflet's closeOnClick and close the popup
      // before our detail handler runs).
      const contentWrapper = container.querySelector('.leaflet-popup-content') as HTMLElement | null;
      if (contentWrapper) {
        L.DomEvent.disableClickPropagation(contentWrapper);
      }

      // Wire up action buttons
      const wouldLiveBtn = container.querySelector('[data-action="would-live"]') as HTMLElement | null;
      const favoriteBtn = container.querySelector('[data-action="favorite"]') as HTMLElement | null;

      if (wouldLiveBtn) {
        wouldLiveBtn.onclick = (ev) => {
          ev.stopPropagation();
          const id = Number(wouldLiveBtn.getAttribute('data-listing-id'));
          onToggleWouldLiveRef.current(id);
        };
      }
      if (favoriteBtn) {
        favoriteBtn.onclick = (ev) => {
          ev.stopPropagation();
          const id = Number(favoriteBtn.getAttribute('data-listing-id'));
          onToggleFavoriteRef.current(id);
        };
      }

      // Wire up photo prev/next arrows
      const photoPrev = container.querySelector('[data-action="photo-prev"]') as HTMLElement | null;
      const photoNext = container.querySelector('[data-action="photo-next"]') as HTMLElement | null;
      const photoImg = container.querySelector('[data-photo-img]') as HTMLImageElement | null;
      const photoCounter = container.querySelector('[data-photo-counter]') as HTMLElement | null;

      if (photoImg && (photoPrev || photoNext)) {
        let urls: string[] = [];
        try { urls = JSON.parse(photoImg.getAttribute('data-photo-urls') || '[]'); } catch { /* ignore */ }
        let idx = Number(photoImg.getAttribute('data-photo-index') || '0');
        const total = urls.length;

        const updatePhoto = () => {
          photoImg.src = urls[idx];
          photoImg.setAttribute('data-photo-index', String(idx));
          if (photoCounter) photoCounter.textContent = `${idx + 1}/${total}`;
        };

        if (photoPrev) {
          photoPrev.onclick = (ev) => {
            ev.stopPropagation();
            idx = (idx - 1 + total) % total;
            updatePhoto();
          };
        }
        if (photoNext) {
          photoNext.onclick = (ev) => {
            ev.stopPropagation();
            idx = (idx + 1) % total;
            updatePhoto();
          };
        }
      }

      // Wire up clickable card -> open detail
      const detailCard = container.querySelector('[data-action="open-detail"]') as HTMLElement | null;
      if (detailCard) {
        const openDetail = (ev: MouseEvent | TouchEvent) => {
          // Don't open detail if clicking buttons inside
          const target = ev.target as HTMLElement;
          if (target.closest('[data-action="would-live"]') || target.closest('[data-action="favorite"]') || target.closest('[data-action="photo-prev"]') || target.closest('[data-action="photo-next"]') || target.closest('[data-action="open-detail-btn"]')) return;
          const id = Number(detailCard.getAttribute('data-listing-id'));
          const listing = listingsMapRef.current.get(id);
          if (listing) onSelectDetailRef.current(listing);
        };
        detailCard.onclick = openDetail;
        // Ensure touch taps work reliably on mobile
        detailCard.addEventListener('touchend', (ev) => {
          const target = ev.target as HTMLElement;
          if (target.closest('[data-action="would-live"]') || target.closest('[data-action="favorite"]') || target.closest('[data-action="photo-prev"]') || target.closest('[data-action="photo-next"]') || target.closest('[data-action="open-detail-btn"]')) return;
          ev.preventDefault();
          const id = Number(detailCard.getAttribute('data-listing-id'));
          const listing = listingsMapRef.current.get(id);
          if (listing) onSelectDetailRef.current(listing);
        });
      }

      // Wire up the explicit "View details" button
      const detailBtn = container.querySelector('[data-action="open-detail-btn"]') as HTMLElement | null;
      if (detailBtn) {
        const openFromBtn = () => {
          const id = Number(detailBtn.getAttribute('data-listing-id'));
          const listing = listingsMapRef.current.get(id);
          if (listing) onSelectDetailRef.current(listing);
        };
        detailBtn.onclick = (ev) => { ev.stopPropagation(); openFromBtn(); };
        detailBtn.addEventListener('touchend', (ev) => { ev.preventDefault(); ev.stopPropagation(); openFromBtn(); });
      }
  }, []);

  const handleMouseOver = useCallback((listing: Listing) => {
    return (e: L.LeafletMouseEvent) => {
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
      clickedRef.current.add(listing.id);
      e.target.openPopup();
      onMarkerClick(listing.id);
    };
  }, [onMarkerClick]);

  const handlePopupClose = useCallback((listing: Listing) => {
    return () => {
      clickedRef.current.delete(listing.id);
      popupElRef.current.delete(listing.id);
      const timer = closeTimerRef.current.get(listing.id);
      if (timer) {
        clearTimeout(timer);
        closeTimerRef.current.delete(listing.id);
      }
    };
  }, []);

  const legendItems = [
    { color: '#f97316', label: 'Fulton St' },
    { color: '#a78bfa', label: 'L Train' },
    { color: '#38bdf8', label: 'Manhattan' },
    { color: '#4ade80', label: 'Brooklyn 14th' },
  ];

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <MapContainer
        center={center}
        zoom={13}
        style={{ height: '100%', width: '100%', background: '#0f1117' }}
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <InvalidateSize />
        <InjectPopupStyles />
        <FlyToSelected listing={selectedListing} />
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
                <div dangerouslySetInnerHTML={{ __html: buildPopupContent(listing, favoritedIds.has(listing.id), wouldLiveIds.has(listing.id)) }} />
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
