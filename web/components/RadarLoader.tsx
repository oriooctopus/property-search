'use client';

/**
 * Monochromatic subway-schematic loader: four right-angle "subway" paths snake
 * in from the canvas edges toward a central station dot, drawn with an animated
 * stroke-dashoffset. Right-angle bends mimic the real NYC subway diagram, which
 * echoes the rest of the app's map-first aesthetic.
 *
 * Monochromatic (soft white `#e1e4e8` on dark `#0f1117`). 1.3s loop.
 */
export default function RadarLoader() {
  // Each path terminates at the center station (80, 80). Paths use only
  // horizontal/vertical segments so they render at 90° angles like a subway map.
  // pathLength is normalized to 1 so we can drive the dash animation with a
  // single keyframe regardless of actual path length.
  const paths = [
    // NW → center
    { d: 'M 8 24 H 40 V 80 H 80', delay: 0 },
    // NE → center
    { d: 'M 152 40 H 112 V 80 H 80', delay: 0.08 },
    // SE → center
    { d: 'M 152 136 H 104 V 80 H 80', delay: 0.16 },
    // SW → center
    { d: 'M 8 112 H 56 V 80 H 80', delay: 0.24 },
  ];

  const TOTAL = 1.3; // seconds per loop

  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{ height: 'calc(100vh - 60px)', backgroundColor: '#0f1117' }}
    >
      <div style={{ position: 'relative', width: 160, height: 160 }}>
        <svg
          width="160"
          height="160"
          viewBox="0 0 160 160"
          fill="none"
          style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}
        >
          {paths.map((p, i) => (
            <path
              key={i}
              d={p.d}
              stroke="#e1e4e8"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              pathLength={1}
              style={{
                strokeDasharray: 1,
                strokeDashoffset: 1,
                animation: `loaderSnake ${TOTAL}s cubic-bezier(0.65, 0, 0.35, 1) ${p.delay}s infinite`,
              }}
            />
          ))}

          {/* Central station dot (ring + core) — appears after the lines land */}
          <circle
            cx="80"
            cy="80"
            r="7"
            stroke="#e1e4e8"
            strokeWidth="1.5"
            fill="none"
            style={{
              transformOrigin: '80px 80px',
              animation: `loaderStationRing ${TOTAL}s ease-out infinite`,
            }}
          />
          <circle
            cx="80"
            cy="80"
            r="4"
            fill="#e1e4e8"
            style={{
              transformOrigin: '80px 80px',
              animation: `loaderStationCore ${TOTAL}s ease-out infinite`,
            }}
          />
        </svg>
      </div>

      <p
        style={{
          marginTop: 32,
          fontSize: 16,
          color: '#8b949e',
          animation: 'radarTextPulse 2s ease-in-out infinite',
          letterSpacing: '0.02em',
        }}
      >
        Finding your next home...
      </p>

      <style>{`
        @keyframes loaderSnake {
          0%   { stroke-dashoffset: 1;   opacity: 0.9; }
          55%  { stroke-dashoffset: 0;   opacity: 0.9; }
          75%  { stroke-dashoffset: 0;   opacity: 0.9; }
          100% { stroke-dashoffset: -1;  opacity: 0;   }
        }
        @keyframes loaderStationRing {
          0%, 50%  { transform: scale(0.6); opacity: 0; }
          65%      { transform: scale(1);   opacity: 1; }
          80%      { transform: scale(1);   opacity: 1; }
          100%     { transform: scale(1.1); opacity: 0; }
        }
        @keyframes loaderStationCore {
          0%, 50%  { transform: scale(0);   opacity: 0; }
          65%      { transform: scale(1);   opacity: 1; }
          80%      { transform: scale(1);   opacity: 1; }
          100%     { transform: scale(0.9); opacity: 0; }
        }
        @keyframes radarTextPulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
