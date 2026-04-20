'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { SubwayMarker } from './DetailMap';

const LINE_COLORS: Record<string, string> = {
  '1': '#EE352E', '2': '#EE352E', '3': '#EE352E',
  '4': '#00933C', '5': '#00933C', '6': '#00933C',
  '7': '#B933AD',
  A: '#0039A6', C: '#0039A6', E: '#0039A6',
  B: '#FF6319', D: '#FF6319', F: '#FF6319', M: '#FF6319',
  G: '#6CBE45',
  J: '#996633', Z: '#996633',
  L: '#A7A9AC',
  N: '#FCCC0A', Q: '#FCCC0A', R: '#FCCC0A', W: '#FCCC0A',
  S: '#808183',
};

function makeSubwayBulletIcon(lines: string[]): L.DivIcon {
  const bullets = lines
    .slice(0, 3)
    .map((l) => {
      const bg = LINE_COLORS[l] ?? '#555';
      const yellowLines = ['N', 'Q', 'R', 'W'];
      const color = yellowLines.includes(l) ? '#000' : '#fff';
      return `<span style="
        display:inline-flex;align-items:center;justify-content:center;
        width:18px;height:18px;border-radius:50%;
        background:${bg};color:${color};
        font-size:10px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,sans-serif;
        border:2px solid #1c2028;
        box-shadow:0 1px 3px rgba(0,0,0,0.5);
      ">${l}</span>`;
    })
    .join('');
  const width = Math.max(22, lines.slice(0, 3).length * 16 + 8);
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;align-items:center;gap:0;">${bullets}</div>`,
    iconSize: [width, 22],
    iconAnchor: [width / 2, 11],
  });
}

interface FitBoundsProps {
  listingLat: number;
  listingLon: number;
  subway: SubwayMarker | null;
}

function FitBounds({ listingLat, listingLon, subway }: FitBoundsProps) {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
      if (subway) {
        const bounds = L.latLngBounds(
          [listingLat, listingLon],
          [subway.lat, subway.lon],
        );
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      } else {
        map.setView([listingLat, listingLon], 15);
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [map, listingLat, listingLon, subway]);
  return null;
}

interface DetailMapInnerProps {
  lat: number;
  lon: number;
  subway: SubwayMarker | null;
}

export default function DetailMapInner({ lat, lon, subway }: DetailMapInnerProps) {
  return (
    <MapContainer
      center={[lat, lon]}
      zoom={15}
      attributionControl={false}
      style={{
        height: 200,
        width: '100%',
        borderRadius: 8,
        border: '1px solid #2d333b',
      }}
    >
      <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
      <CircleMarker
        center={[lat, lon]}
        radius={8}
        pathOptions={{
          color: '#58a6ff',
          fillColor: '#58a6ff',
          fillOpacity: 0.8,
          weight: 2,
        }}
      />
      {subway && (
        <Marker
          position={[subway.lat, subway.lon]}
          icon={makeSubwayBulletIcon(subway.lines)}
          interactive={false}
        />
      )}
      <FitBounds listingLat={lat} listingLon={lon} subway={subway} />
    </MapContainer>
  );
}
