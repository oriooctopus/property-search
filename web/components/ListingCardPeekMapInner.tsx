'use client';

/**
 * Inner Leaflet implementation for the per-card peek mini-map.
 *
 * Loaded only when a card is peeked (dynamic import in
 * ListingCardPeekMap.tsx) so the leaflet bundle never reaches a non-peeked
 * card. Uses the same CARTO dark tiles + react-leaflet stack as MapInner /
 * MiniMapInner — no new map library introduced.
 */

import { useEffect, useMemo } from 'react';
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  useMap,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { SubwayStation } from '@/lib/isochrone/types';

interface NearbyPin {
  id: number;
  lat: number;
  lon: number;
}

interface ListingCardPeekMapInnerProps {
  lat: number;
  lon: number;
  price: number;
  nearby: NearbyPin[];
  station: SubwayStation | null;
}

const LINE_COLORS: Record<string, string> = {
  '1': '#EE352E',
  '2': '#EE352E',
  '3': '#EE352E',
  '4': '#00933C',
  '5': '#00933C',
  '6': '#00933C',
  '7': '#B933AD',
  A: '#0039A6',
  C: '#0039A6',
  E: '#0039A6',
  B: '#FF6319',
  D: '#FF6319',
  F: '#FF6319',
  M: '#FF6319',
  G: '#6CBE45',
  J: '#996633',
  Z: '#996633',
  L: '#A7A9AC',
  N: '#FCCC0A',
  Q: '#FCCC0A',
  R: '#FCCC0A',
  W: '#FCCC0A',
  S: '#808183',
};

function PeekMapController({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lon], 15, { animate: false });
    // Disable interactions — peek is read-only context, not a full map.
    map.dragging.disable();
    map.touchZoom.disable();
    map.doubleClickZoom.disable();
    map.scrollWheelZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();
    // The container has just been mounted at a new size; recalc tile grid
    // so we don't get a single-tile flash in the corner.
    map.invalidateSize();
  }, [map, lat, lon]);
  return null;
}

export default function ListingCardPeekMapInner({
  lat,
  lon,
  price,
  nearby,
  station,
}: ListingCardPeekMapInnerProps) {
  const stationColor = useMemo(() => {
    if (!station) return null;
    return LINE_COLORS[station.lines[0] ?? ''] ?? '#ffffff';
  }, [station]);

  const priceLabel = `$${(price / 1000).toFixed(price % 1000 === 0 ? 1 : 1)}k`;

  return (
    <MapContainer
      center={[lat, lon]}
      zoom={15}
      zoomControl={false}
      attributionControl={false}
      style={{
        height: '100%',
        width: '100%',
        background: '#111820',
      }}
    >
      <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />

      {/* Dimmed surrounding listing pins — render BEHIND the primary pin */}
      {nearby.map((p) => (
        <CircleMarker
          key={p.id}
          center={[p.lat, p.lon]}
          radius={4}
          pathOptions={{
            color: '#8b949e',
            fillColor: '#8b949e',
            fillOpacity: 0.4,
            weight: 1,
            opacity: 0.4,
          }}
        />
      ))}

      {/* Subway station dot — colored by first line */}
      {station && stationColor && (
        <CircleMarker
          center={[station.lat, station.lon]}
          radius={5}
          pathOptions={{
            color: '#ffffff',
            fillColor: stationColor,
            fillOpacity: 1,
            weight: 1.5,
          }}
        >
          <Tooltip
            direction="bottom"
            offset={[0, 6]}
            opacity={1}
            permanent
            className="peek-station-tooltip"
          >
            {station.name}
          </Tooltip>
        </CircleMarker>
      )}

      {/* Primary pin — listing's location, blue, with price callout */}
      <CircleMarker
        center={[lat, lon]}
        radius={9}
        pathOptions={{
          color: '#ffffff',
          fillColor: '#58a6ff',
          fillOpacity: 1,
          weight: 2,
        }}
      >
        <Tooltip
          direction="top"
          offset={[0, -10]}
          opacity={1}
          permanent
          className="peek-price-tooltip"
        >
          {priceLabel}/mo
        </Tooltip>
      </CircleMarker>

      <PeekMapController lat={lat} lon={lon} />
    </MapContainer>
  );
}
