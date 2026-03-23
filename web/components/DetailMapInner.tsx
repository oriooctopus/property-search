'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

function InvalidateSize() {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 100);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
}

interface DetailMapInnerProps {
  lat: number;
  lon: number;
}

export default function DetailMapInner({ lat, lon }: DetailMapInnerProps) {
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
      <InvalidateSize />
    </MapContainer>
  );
}
