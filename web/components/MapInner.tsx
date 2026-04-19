'use client';

import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Marker, Popup, Tooltip, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from 'geojson';
import type { Database } from '@/lib/types';
import { cn } from '@/lib/cn';
import { ButtonBase } from './ui/ButtonBase';
import type { CommuteInfo } from './ListingCard';
import type { HoveredStation } from './SwipeCard';

type Listing = Database['public']['Tables']['listings']['Row'];

const LINE_COLORS: Record<string, string> = {
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

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/* ------------------------------------------------------------------ */
/*  Subway overlay — translucent MTA-colored lines                     */
/* ------------------------------------------------------------------ */

const SUBWAY_OVERLAY_STORAGE_KEY = 'dwelligence.subwayOverlay';
const SUBWAY_LINES_URL = '/data/subway-lines.geojson';

function getSubwayFeatureColor(feature: Feature | undefined): string {
  const sym = (feature?.properties as { rt_symbol?: string } | undefined)?.rt_symbol;
  if (!sym) return '#8b949e';
  return LINE_COLORS[sym] ?? '#8b949e';
}


/* ------------------------------------------------------------------ */
/*  Coordinate-based manual clustering helpers                         */
/* ------------------------------------------------------------------ */

/** Round a coordinate to N decimal places for same-building grouping. */
function roundCoord(v: number, decimals = 4): number {
  const factor = Math.pow(10, decimals);
  return Math.round(v * factor) / factor;
}

function coordKey(lat: number, lon: number): string {
  return `${roundCoord(lat)},${roundCoord(lon)}`;
}

/** Returns the cluster DivIcon for a given group size and whether any are saved. */
function makeClusterIcon(count: number, hasSaved: boolean): L.DivIcon {
  const size = count <= 3 ? 30 : count <= 9 ? 36 : 44;
  const borderColor = hasSaved ? '#7ee787' : '#8b949e';
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px;
      height:${size}px;
      border-radius:50%;
      background:#1c2028;
      border:2px solid ${borderColor};
      display:flex;
      align-items:center;
      justify-content:center;
      color:#fff;
      font-size:${size <= 30 ? 11 : 13}px;
      font-weight:700;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      box-shadow:0 2px 6px rgba(0,0,0,0.5);
      cursor:pointer;
    ">${count}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

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
  .dark-popup [data-action="hide"] {
    transition: color 150ms, background-color 150ms;
    border-radius: 4px;
  }
  .dark-popup [data-action="hide"]:hover {
    background-color: rgba(248, 81, 73, 0.15) !important;
    color: #f97583 !important;
  }
  .dark-popup [data-action="save"] {
    transition: color 150ms, background-color 150ms;
    border-radius: 4px;
  }
  .dark-popup [data-action="save"]:hover {
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

const STATION_PULSE_STYLES = `
  @keyframes station-pulse {
    0%   { transform: scale(1);   opacity: 0.8; }
    100% { transform: scale(2.5); opacity: 0; }
  }
  .station-pulse-ring {
    animation: station-pulse 1.4s ease-out infinite;
  }
  .station-hover-tooltip {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    padding: 0 !important;
  }
  .station-hover-tooltip::before {
    display: none !important;
  }
`;

function makeStationPulseIcon(color: string): L.DivIcon {
  const size = 40;
  return L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:${size}px;height:${size}px;">
        <div class="station-pulse-ring" style="
          position:absolute;
          inset:0;
          border-radius:50%;
          background:${color};
          opacity:0.8;
          transform-origin:center;
        "></div>
        <div style="
          position:absolute;
          top:50%;left:50%;
          transform:translate(-50%,-50%);
          width:14px;height:14px;
          border-radius:50%;
          background:${color};
          border:2.5px solid #fff;
          box-shadow:0 0 8px 2px ${color};
        "></div>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    tooltipAnchor: [0, -(size / 2) - 4],
  });
}

function InjectPopupStyles() {
  useEffect(() => {
    const id = 'dwelligence-popup-styles';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = POPUP_STYLES + STATION_PULSE_STYLES;
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
  // Coalesce invalidateSize() calls to one per animation frame to avoid
  // stalling the main thread during rapid window drag-resize.
  useEffect(() => {
    let rafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        map.invalidateSize();
      });
    });
    observer.observe(map.getContainer());
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [map]);

  return null;
}

function FlyToSelected({ listing, suppressBoundsRef, panOffset }: { listing: Listing | undefined; suppressBoundsRef: React.MutableRefObject<boolean>; panOffset?: { x: number; y: number } }) {
  const map = useMap();
  const prevId = useRef<number | null>(null);

  useEffect(() => {
    if (listing && listing.id !== prevId.current) {
      prevId.current = listing.id;
      const lat = Number(listing.lat);
      const lon = Number(listing.lon);
      const size = map.getSize();
      if (!isNaN(lat) && !isNaN(lon) && size.x > 0 && size.y > 0) {
        // Only fly if the listing is outside the current visible bounds
        const bounds = map.getBounds();
        if (bounds.contains([lat, lon])) {
          // Listing is already visible — don't move the map
          suppressBoundsRef.current = false;
          return;
        }
        suppressBoundsRef.current = true;
        if (panOffset) {
          const zoom = map.getZoom() || 15;
          const targetPoint = map.project([lat, lon], zoom);
          const offsetCenter = map.unproject(
            [targetPoint.x + panOffset.x, targetPoint.y + panOffset.y],
            zoom,
          );
          map.flyTo(offsetCenter, zoom, { duration: 0.8 });
        } else {
          map.flyTo([lat, lon], 15, { duration: 0.8 });
        }
        // Reset suppress after flyTo animation completes (~1.2s covers 0.8s + buffer)
        setTimeout(() => { suppressBoundsRef.current = false; }, 1200);
      }
    }
  }, [listing, map, suppressBoundsRef, panOffset]);

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
  /** Pixel offset for flyTo — shifts the selected listing's dot away from center */
  panOffset?: { x: number; y: number };
  /** Hovered subway station from SwipeCard — renders a pulsing marker */
  hoveredStation?: HoveredStation | null;
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
      // Skip viewport reload triggered by a programmatic flyTo.
      // Don't reset the flag here — FlyToSelected controls the lifecycle.
      if (suppressBoundsRef.current) {
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

    // Fire once on mount — Leaflet doesn't emit moveend on initial render
    fireBounds();

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
function buildPopupContent(listing: Listing, isFavorited: boolean, _isWouldLive: boolean, commuteInfo?: CommuteInfo): string {
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

  const likeColor = isFavorited ? '#fbbf24' : '#8b949e';

  const actionBtnStyle = `background:none;border:none;cursor:pointer;padding:4px;display:flex;align-items:center;border-radius:4px;`;

  const actionsHtml = `
    <div style="display: flex; gap: 8px; margin-top: 6px;">
      <button
        data-action="hide"
        data-listing-id="${listing.id}"
        title="Hide"
        style="${actionBtnStyle} color: #8b949e;"
      ><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg></button>
      <button
        data-action="save"
        data-listing-id="${listing.id}"
        title="Save"
        style="${actionBtnStyle} color: ${likeColor};"
      ><svg width="16" height="16" viewBox="0 0 24 24" fill="${isFavorited ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></button>
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
        ">${listing.beds === 0 ? 'Studio' : `${listing.beds} bd`} / ${listing.baths} ba</div>
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

/* ------------------------------------------------------------------ */
/*  Subway overlay toggle chip — bottom-left of the map                */
/* ------------------------------------------------------------------ */
interface SubwayOverlayChipProps {
  enabled: boolean;
  onToggle: () => void;
}

function SubwayOverlayChip({ enabled, onToggle }: SubwayOverlayChipProps) {
  const iconColor = enabled ? '#7ee787' : '#ffffff';
  return (
    <div
      style={{
        position: 'absolute',
        // 16px on mobile, 12px on desktop — plus safe-area inset so it clears
        // the home indicator / any bottom nav on iPhones.
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
        left: 16,
        zIndex: 500,
        display: 'flex',
        alignItems: 'center',
        pointerEvents: 'auto',
      }}
      // Prevent map drag/zoom when interacting with the chip
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <ButtonBase
        type="button"
        aria-pressed={enabled}
        aria-label={enabled ? 'Hide subway lines' : 'Show subway lines'}
        onClick={onToggle}
        className={cn(
          // Circular icon-only button — 36px on mobile, 32px on md (laptop+).
          'relative flex items-center justify-center rounded-full',
          'w-9 h-9 md:w-8 md:h-8',
          'border bg-[#1c2028]',
          enabled
            ? 'border-[#7ee787] hover:bg-[#2d333b]'
            : 'border-[#2d333b] hover:bg-[#2d333b] hover:border-[#3d434b]',
        )}
        style={{
          boxShadow: enabled
            ? '0 0 0 2px rgba(126,231,135,0.20), 0 1px 4px rgba(0,0,0,0.4)'
            : '0 1px 4px rgba(0,0,0,0.4)',
          borderWidth: enabled ? 2 : 1.5,
        }}
      >
        {/* Route-with-two-stops glyph: short line with filled dots at endpoints */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden
          style={{ color: iconColor, display: 'block' }}
        >
          <line
            x1="4"
            y1="9"
            x2="14"
            y2="9"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
          <circle cx="4" cy="9" r="2.25" fill="currentColor" />
          <circle cx="14" cy="9" r="2.25" fill="currentColor" />
        </svg>
        {enabled && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: -1,
              right: -1,
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: '#7ee787',
              border: '1.5px solid #1c2028',
            }}
          />
        )}
      </ButtonBase>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Subway lines GeoJSON layer — lazy-loads on first enable            */
/* ------------------------------------------------------------------ */
interface SubwayLinesLayerProps {
  enabled: boolean;
}

// Module-level cache so the geojson is only fetched once per page load,
// even if the SubwayLinesLayer component re-mounts or re-renders.
let subwayLinesCache: FeatureCollection<Geometry, GeoJsonProperties> | null = null;
let subwayLinesPromise: Promise<FeatureCollection<Geometry, GeoJsonProperties>> | null = null;

function loadSubwayLines(): Promise<FeatureCollection<Geometry, GeoJsonProperties>> {
  if (subwayLinesCache) return Promise.resolve(subwayLinesCache);
  if (subwayLinesPromise) return subwayLinesPromise;
  subwayLinesPromise = fetch(SUBWAY_LINES_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load subway lines: ${res.status}`);
      return res.json();
    })
    .then((json: FeatureCollection<Geometry, GeoJsonProperties>) => {
      subwayLinesCache = json;
      return json;
    })
    .catch((err) => {
      // Reset so a later toggle can retry.
      subwayLinesPromise = null;
      throw err;
    });
  return subwayLinesPromise;
}

function SubwayLinesLayer({ enabled }: SubwayLinesLayerProps) {
  const [data, setData] = useState<FeatureCollection<Geometry, GeoJsonProperties> | null>(
    subwayLinesCache,
  );
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (data) return;
    if (subwayLinesCache) {
      setData(subwayLinesCache);
      return;
    }
    loadSubwayLines()
      .then((json) => {
        if (mountedRef.current) setData(json);
      })
      .catch((err) => {
        console.warn('[subway-overlay] failed to load geojson', err);
      });
  }, [enabled, data]);

  if (!enabled || !data) return null;

  return (
    <GeoJSON
      key="subway-lines"
      data={data}
      // Non-interactive so clicks/hovers pass through to listings underneath
      interactive={false}
      style={(feature) => ({
        color: getSubwayFeatureColor(feature),
        weight: 2.5,
        opacity: 0.65,
        fillOpacity: 0,
      })}
      eventHandlers={{
        add: (e) => {
          // Keep the overlay below marker panes (under listing dots).
          const layer = e.target as L.GeoJSON;
          layer.bringToBack();
        },
      }}
    />
  );
}

export default function MapInner({ listings, selectedId, onMarkerClick, onSelectDetail, favoritedIds, wouldLiveIds, onToggleFavorite, onToggleWouldLive, onHideListing, onBoundsChange, onMapMove, suppressBoundsRef: suppressBoundsRefProp, initialCenter, initialZoom, visible = true, commuteInfoMap, panOffset, hoveredStation }: MapProps) {
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

  // Subway overlay toggle — persisted in localStorage (default on).
  // Lazy-init so SSR doesn't touch window.
  const [subwayOverlayEnabled, setSubwayOverlayEnabled] = useState<boolean>(true);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(SUBWAY_OVERLAY_STORAGE_KEY);
      if (raw === '0' || raw === 'false') setSubwayOverlayEnabled(false);
    } catch {
      // localStorage may be unavailable (e.g. private mode) — fail silent.
    }
  }, []);
  const toggleSubwayOverlay = useCallback(() => {
    setSubwayOverlayEnabled((prev) => {
      const next = !prev;
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(SUBWAY_OVERLAY_STORAGE_KEY, next ? '1' : '0');
        }
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

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
            case 'save':
              onToggleFavoriteRef.current(id);
              break;
            case 'hide':
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
      console.log(`[popup] marker CLICK #${listing.id} — opening detail view`);
      onMarkerClick(listing.id);
      onSelectDetailRef.current(listing);
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

  /* ------------------------------------------------------------------ */
  /*  Manual coordinate-based clustering                                 */
  /* ------------------------------------------------------------------ */

  // Group validListings by rounded coordinate key.
  const coordGroups = useMemo(() => {
    const groups = new Map<string, typeof validListings>();
    for (const listing of validListings) {
      const key = coordKey(listing.lat, listing.lon);
      const existing = groups.get(key);
      if (existing) {
        existing.push(listing);
      } else {
        groups.set(key, [listing]);
      }
    }
    return groups;
  }, [validListings]);

  // Build the set of groups to render. If the selected listing is in a cluster,
  // split that cluster so the selected dot always shows individually.
  const renderGroups = useMemo(() => {
    const result: Array<{ key: string; listings: typeof validListings; isCluster: boolean }> = [];

    for (const [key, group] of coordGroups.entries()) {
      if (group.length === 1) {
        result.push({ key, listings: group, isCluster: false });
        continue;
      }

      const hasSelected = group.some((l) => l.id === selectedId);
      if (hasSelected) {
        // Render each listing individually so the selected dot is visible
        for (const listing of group) {
          result.push({ key: `${key}__${listing.id}`, listings: [listing], isCluster: false });
        }
      } else {
        result.push({ key, listings: group, isCluster: true });
      }
    }

    return result;
  }, [coordGroups, selectedId]);

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ height: '100%', width: '100%', background: '#0f1117' }}
        zoomControl={false}
        keyboard={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <SubwayLinesLayer enabled={subwayOverlayEnabled} />
        <InvalidateSize visible={visible} />
        <InjectPopupStyles />
        <FlyToSelected listing={selectedListing} suppressBoundsRef={suppressBoundsRef} panOffset={panOffset} />
        {onBoundsChange && <BoundsWatcher onBoundsChange={onBoundsChange} onMapMove={onMapMove} suppressBoundsRef={suppressBoundsRef} />}

        {renderGroups.map(({ key, listings: groupListings, isCluster }) => {
          if (isCluster) {
            // Multi-listing cluster at same coordinates
            const rep = groupListings[0];
            const hasSaved = groupListings.some((l) => favoritedIds.has(l.id));
            const icon = makeClusterIcon(groupListings.length, hasSaved);

            // Build a simple popup listing the addresses
            const clusterPopupHtml = `
              <div style="
                padding:10px 14px;
                min-width:180px;
                color:#e1e4e8;
                font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
              ">
                <div style="font-size:11px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">
                  ${groupListings.length} listings at this address
                </div>
                ${groupListings.map((l) => {
                  const isSaved = favoritedIds.has(l.id);
                  return `<div
                    data-action="open-detail"
                    data-listing-id="${l.id}"
                    style="
                      display:flex;
                      align-items:center;
                      gap:8px;
                      padding:5px 4px;
                      border-radius:6px;
                      cursor:pointer;
                      font-size:12px;
                    "
                  >
                    ${isSaved ? `<span style="color:#7ee787;flex-shrink:0;">&#9733;</span>` : `<span style="color:#8b949e;flex-shrink:0;font-size:10px;">&#9675;</span>`}
                    <span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(l.address)}</span>
                    <span style="color:#3fb950;font-weight:700;flex-shrink:0;">$${l.price.toLocaleString()}</span>
                  </div>`;
                }).join('')}
              </div>
            `;

            return (
              <Marker
                key={key}
                position={[rep.lat, rep.lon]}
                icon={icon}
                eventHandlers={{
                  click: (e) => {
                    // Stop propagation so the map doesn't also receive the click
                    L.DomEvent.stopPropagation(e);
                    // The popup will open; wire delegation after popupopen
                  },
                  popupopen: (e) => {
                    const popup = (e as unknown as { popup: L.Popup }).popup;
                    const container = popup?.getElement?.();
                    if (!container || container.getAttribute('data-cluster-delegated')) return;
                    container.setAttribute('data-cluster-delegated', '1');
                    L.DomEvent.disableClickPropagation(container);
                    container.addEventListener('click', (ev) => {
                      const target = ev.target as HTMLElement;
                      const actionEl = target.closest('[data-action="open-detail"]') as HTMLElement | null;
                      if (!actionEl) return;
                      ev.stopPropagation();
                      const id = Number(actionEl.getAttribute('data-listing-id') || '0');
                      onMarkerClick(id);
                      const found = listingsMapRef.current.get(id);
                      if (found) onSelectDetailRef.current(found);
                    });
                  },
                }}
              >
                <Popup className="dark-popup" autoClose={false} closeOnClick={false}>
                  <div dangerouslySetInnerHTML={{ __html: clusterPopupHtml }} />
                </Popup>
              </Marker>
            );
          }

          // Single listing — render as before
          const listing = groupListings[0];
          const isSaved = favoritedIds.has(listing.id);
          const color = isSaved ? '#7ee787' : '#8b949e';
          const isSelected = listing.id === selectedId;
          return (
            <CircleMarker
              key={key}
              center={[listing.lat, listing.lon]}
              radius={isSelected ? 18 : isSaved ? 10 : 14}
              pathOptions={{
                color: isSelected ? '#ffffff' : color,
                fillColor: color,
                fillOpacity: isSaved ? 1 : 0.85,
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
              <Popup className="dark-popup" autoClose={false} closeOnClick={false}>
                <div dangerouslySetInnerHTML={{ __html: buildPopupContent(listing, favoritedIds.has(listing.id), wouldLiveIds.has(listing.id), commuteInfoMap?.get(listing.id)) }} />
              </Popup>
            </CircleMarker>
          );
        })}
        {hoveredStation && (() => {
          const primaryLine = hoveredStation.lines[0] ?? '';
          const markerColor = LINE_COLORS[primaryLine] ?? '#ffffff';
          const icon = makeStationPulseIcon(markerColor);
          return (
            <Marker
              key={`hovered-station-${hoveredStation.lat}-${hoveredStation.lon}`}
              position={[hoveredStation.lat, hoveredStation.lon]}
              icon={icon}
              interactive={false}
              zIndexOffset={1000}
            >
              <Tooltip
                permanent
                direction="top"
                offset={[0, -24]}
                className="station-hover-tooltip"
              >
                <span style={{
                  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#e1e4e8',
                  backgroundColor: '#1c2028',
                  border: '1px solid #2d333b',
                  borderRadius: 6,
                  padding: '3px 8px',
                  whiteSpace: 'nowrap',
                  display: 'block',
                }}>
                  {hoveredStation.name}
                </span>
              </Tooltip>
            </Marker>
          );
        })()}
      </MapContainer>
      <SubwayOverlayChip enabled={subwayOverlayEnabled} onToggle={toggleSubwayOverlay} />
    </div>
  );
}
