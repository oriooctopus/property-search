'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { HoveredStation } from './SwipeCard';

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

function MiniMapUpdater({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lon], 14, { animate: false });
  }, [map, lat, lon]);

  // Disable all interactions
  useEffect(() => {
    map.dragging.disable();
    map.touchZoom.disable();
    map.doubleClickZoom.disable();
    map.scrollWheelZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();
    map.invalidateSize();
  }, [map]);

  return null;
}

interface MiniMapInnerProps {
  lat: number;
  lon: number;
  hoveredStation?: HoveredStation | null;
}

export default function MiniMapInner({ lat, lon, hoveredStation }: MiniMapInnerProps) {
  const stationColor = hoveredStation
    ? (LINE_COLORS[hoveredStation.lines[0] ?? ''] ?? '#ffffff')
    : null;

  return (
    <MapContainer
      center={[lat, lon]}
      zoom={14}
      zoomControl={false}
      attributionControl={false}
      style={{
        height: '100%',
        width: '100%',
        background: '#161b24',
      }}
    >
      <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
      <CircleMarker
        center={[lat, lon]}
        radius={6}
        pathOptions={{
          color: '#ffffff',
          fillColor: '#58a6ff',
          fillOpacity: 1,
          weight: 2,
        }}
      />
      {hoveredStation && stationColor && (
        <CircleMarker
          center={[hoveredStation.lat, hoveredStation.lon]}
          radius={5}
          pathOptions={{
            color: '#ffffff',
            fillColor: stationColor,
            fillOpacity: 1,
            weight: 2,
          }}
        />
      )}
      <MiniMapUpdater lat={lat} lon={lon} />
    </MapContainer>
  );
}
