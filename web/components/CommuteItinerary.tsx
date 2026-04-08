'use client';

import { useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Types (matches API response from /api/trip-plan)
// ---------------------------------------------------------------------------

interface TripLeg {
  type: 'walk' | 'transit' | 'transfer';
  duration: number;
  from: string;
  to: string;
  route?: string;
  routeColor?: string;
  stops?: string[];
  distance?: number;
}

interface TripItinerary {
  totalDuration: number;
  legs: TripLeg[];
}

// ---------------------------------------------------------------------------
// NYC subway line colors
// ---------------------------------------------------------------------------

const SUBWAY_COLORS: Record<string, string> = {
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

function getRouteColor(leg: TripLeg): string {
  if (leg.routeColor && leg.routeColor !== '#000000') return leg.routeColor;
  if (leg.route) {
    const key = leg.route.toUpperCase();
    if (SUBWAY_COLORS[key]) return SUBWAY_COLORS[key];
  }
  return '#58a6ff';
}

function isLightColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160;
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function WalkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="2" />
      <path d="M10 22l2-7 3 3v6" />
      <path d="M10 13l-1 6" />
      <path d="M15 10l-3 3-2-2-3 4" />
    </svg>
  );
}

function TransferIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f0a500" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function SubwayBullet({ route, color }: { route: string; color: string }) {
  const textColor = isLightColor(color) ? '#000' : '#fff';
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-xs font-black shrink-0"
      style={{
        width: 22,
        height: 22,
        backgroundColor: color,
        color: textColor,
        fontSize: 12,
      }}
    >
      {route}
    </span>
  );
}

function DestinationIcon() {
  return (
    <span
      className="inline-block rounded-full shrink-0"
      style={{
        width: 14,
        height: 14,
        backgroundColor: '#7ee787',
        border: '2px solid #1c2028',
        marginTop: 3,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function Skeleton() {
  return (
    <div className="animate-pulse" style={{ padding: 16 }}>
      <div className="flex items-center gap-3 mb-4">
        <div className="rounded-full" style={{ width: 12, height: 12, backgroundColor: '#2d333b' }} />
        <div className="rounded" style={{ width: '60%', height: 14, backgroundColor: '#2d333b' }} />
      </div>
      <div className="flex items-center gap-3 mb-4">
        <div className="rounded-full" style={{ width: 12, height: 12, backgroundColor: '#2d333b' }} />
        <div className="rounded" style={{ width: '80%', height: 14, backgroundColor: '#2d333b' }} />
      </div>
      <div className="flex items-center gap-3 mb-4">
        <div className="rounded-full" style={{ width: 12, height: 12, backgroundColor: '#2d333b' }} />
        <div className="rounded" style={{ width: '50%', height: 14, backgroundColor: '#2d333b' }} />
      </div>
      <div className="flex items-center gap-3">
        <div className="rounded-full" style={{ width: 14, height: 14, backgroundColor: '#2d333b' }} />
        <div className="rounded" style={{ width: '40%', height: 14, backgroundColor: '#2d333b' }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leg row component
// ---------------------------------------------------------------------------

function LegRow({ leg, isLast }: { leg: TripLeg; isLast: boolean }) {
  const [stopsOpen, setStopsOpen] = useState(false);
  const color = leg.type === 'transit' ? getRouteColor(leg) : undefined;
  const hasStops = leg.type === 'transit' && leg.stops && leg.stops.length > 0;

  // Spine styles
  const dotStyle: React.CSSProperties = {
    width: 12,
    height: 12,
    borderRadius: '50%',
    border: '2px solid #1c2028',
    flexShrink: 0,
    zIndex: 1,
    marginTop: 3,
    backgroundColor:
      leg.type === 'transit' ? (color ?? '#58a6ff') :
      leg.type === 'transfer' ? '#f0a500' :
      '#8b949e',
  };

  const lineStyle: React.CSSProperties = {
    width: 2,
    flex: 1,
    minHeight: 20,
    margin: '2px 0',
    ...(leg.type === 'walk'
      ? {
          background: `repeating-linear-gradient(to bottom, #8b949e 0px, #8b949e 4px, transparent 4px, transparent 8px)`,
        }
      : leg.type === 'transfer'
        ? {
            background: `repeating-linear-gradient(to bottom, #f0a500 0px, #f0a500 4px, transparent 4px, transparent 8px)`,
          }
        : {
            backgroundColor: color ?? '#58a6ff',
          }),
  };

  return (
    <div className="flex gap-3 relative">
      {/* Spine */}
      <div className="flex flex-col items-center shrink-0" style={{ width: 28 }}>
        <div style={dotStyle} />
        {!isLast && <div style={lineStyle} />}
      </div>

      {/* Content */}
      <div className="flex-1" style={{ paddingBottom: isLast ? 0 : 18 }}>
        <div className="flex items-start gap-2">
          {/* Icon */}
          <div className="shrink-0 mt-0.5">
            {leg.type === 'walk' && <WalkIcon />}
            {leg.type === 'transfer' && <TransferIcon />}
            {leg.type === 'transit' && leg.route && (
              <SubwayBullet route={leg.route} color={color!} />
            )}
          </div>

          {/* Label + sub info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold flex-1" style={{ color: '#e1e4e8' }}>
                {leg.type === 'walk' && `Walk to ${leg.to}`}
                {leg.type === 'transfer' && `Transfer at ${leg.from}`}
                {leg.type === 'transit' && (
                  <>
                    {leg.route ? `${leg.route} train` : 'Transit'} to {leg.to}
                  </>
                )}
              </span>

              {/* Duration */}
              <span className="text-xs whitespace-nowrap" style={{ color: '#8b949e' }}>
                {leg.duration} min
              </span>
            </div>

            {/* Sub info */}
            {leg.type === 'walk' && leg.distance != null && (
              <div className="text-xs mt-0.5" style={{ color: '#8b949e' }}>
                {leg.distance < 1000
                  ? `${leg.distance} m`
                  : `${(leg.distance / 1000).toFixed(1)} km`}
              </div>
            )}

            {leg.type === 'transit' && (
              <div className="text-xs mt-0.5" style={{ color: '#8b949e' }}>
                From {leg.from}
              </div>
            )}
            {/* Collapsible stops */}
            {hasStops && (
              <>
                <button
                  onClick={() => setStopsOpen(!stopsOpen)}
                  className="flex items-center gap-1 text-xs mt-1 hover:opacity-80"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#58a6ff',
                    cursor: 'pointer',
                    padding: 0,
                    fontFamily: 'inherit',
                  }}
                >
                  <span
                    className="inline-block text-[10px] transition-transform duration-200"
                    style={{ transform: stopsOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  >
                    ▼
                  </span>
                  {stopsOpen ? 'Hide' : 'Show'} {leg.stops!.length} stop{leg.stops!.length !== 1 ? 's' : ''}
                </button>

                {stopsOpen && (
                  <div className="flex flex-col gap-1 mt-1.5">
                    {leg.stops!.map((stop, i) => (
                      <div
                        key={i}
                        className="text-xs py-0.5 px-2.5"
                        style={{
                          color: '#8b949e',
                          borderLeft: `2px solid ${color ?? '#58a6ff'}`,
                        }}
                      >
                        {stop}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface CommuteItineraryProps {
  listingLat: number;
  listingLon: number;
  destinationLat: number;
  destinationLon: number;
  destinationName: string;
  destinationLines?: string[]; // If destination is a subway station, the line(s) it serves
  mode?: string;              // OTP mode string — e.g. "WALK", "BICYCLE", "TRANSIT,WALK"
}

export default function CommuteItinerary({
  listingLat,
  listingLon,
  destinationLat,
  destinationLon,
  destinationName,
  destinationLines,
  mode,
}: CommuteItineraryProps) {
  const [itinerary, setItinerary] = useState<TripItinerary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchTrip() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          fromLat: String(listingLat),
          fromLon: String(listingLon),
          toLat: String(destinationLat),
          toLon: String(destinationLon),
          ...(mode ? { mode } : {}),
        });

        const res = await fetch(`/api/trip-plan?${params}`);
        if (cancelled) return;

        if (!res.ok) {
          setError('Commute details unavailable');
          setLoading(false);
          return;
        }

        const data = await res.json();
        if (cancelled) return;

        if (data.error) {
          setError('Commute details unavailable');
        } else {
          setItinerary(data);
        }
      } catch {
        if (!cancelled) {
          setError('Commute details unavailable');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchTrip();
    return () => { cancelled = true; };
  }, [listingLat, listingLon, destinationLat, destinationLon, mode]);

  return (
    <div className="mb-6">
      <div className="text-xs font-medium mb-2" style={{ color: '#8b949e' }}>
        Commute
      </div>
      <div
        className="rounded-lg overflow-hidden"
        style={{ backgroundColor: '#0f1117', border: '1px solid #2d333b' }}
      >
        {loading && <Skeleton />}

        {!loading && error && (
          <div className="p-4 text-sm" style={{ color: '#8b949e' }}>
            {error}
          </div>
        )}

        {!loading && !error && itinerary && destinationLines && destinationLines.length > 0 && itinerary.legs.every(l => l.type === 'walk') && (
          <div className="p-4 flex items-center gap-3">
            <WalkIcon />
            <span className="text-sm" style={{ color: '#e1e4e8' }}>
              <span className="font-semibold">{itinerary.totalDuration}-minute walk</span>
              {' '}from{' '}
              <span className="font-semibold">{destinationName}</span>
            </span>
            <div className="flex items-center gap-1 ml-auto">
              {destinationLines.map((line) => {
                const color = SUBWAY_COLORS[line.toUpperCase()] ?? '#58a6ff';
                return <SubwayBullet key={line} route={line} color={color} />;
              })}
            </div>
          </div>
        )}

        {!loading && !error && itinerary && !(destinationLines && destinationLines.length > 0 && itinerary.legs.every(l => l.type === 'walk')) && (
          <>
            {/* Timeline */}
            <div className="p-4 flex flex-col gap-0">
              {itinerary.legs.map((leg, i) => (
                <LegRow
                  key={i}
                  leg={leg}
                  isLast={i === itinerary.legs.length - 1}
                />
              ))}

              {/* Destination marker */}
              <div className="flex gap-3 mt-0 relative">
                <div className="flex flex-col items-center shrink-0" style={{ width: 28 }}>
                  <DestinationIcon />
                </div>
                <div className="flex-1">
                  <span className="text-sm font-semibold" style={{ color: '#7ee787' }}>
                    {destinationName}
                  </span>
                </div>
              </div>
            </div>

            {/* Total row */}
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderTop: '1px solid #2d333b' }}
            >
              <span className="text-xs" style={{ color: '#8b949e' }}>
                Total travel time
              </span>
              <span className="text-base font-bold" style={{ color: '#58a6ff' }}>
                {itinerary.totalDuration} min
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
