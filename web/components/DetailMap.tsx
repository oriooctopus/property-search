'use client';

import dynamic from 'next/dynamic';

const DetailMapInner = dynamic(() => import('./DetailMapInner'), {
  ssr: false,
  loading: () => (
    <div
      className="flex items-center justify-center text-sm"
      style={{
        height: 200,
        width: '100%',
        borderRadius: 8,
        backgroundColor: '#0f1117',
        border: '1px solid #2d333b',
        color: '#8b949e',
      }}
    >
      Loading map...
    </div>
  ),
});

export interface SubwayMarker {
  lat: number;
  lon: number;
  name: string;
  lines: string[];
}

interface DetailMapProps {
  lat: number;
  lon: number;
  subway?: SubwayMarker | null;
}

export default function DetailMap({ lat, lon, subway }: DetailMapProps) {
  const numLat = Number(lat);
  const numLon = Number(lon);

  if (isNaN(numLat) || isNaN(numLon)) {
    return null;
  }

  return <DetailMapInner lat={numLat} lon={numLon} subway={subway ?? null} />;
}
