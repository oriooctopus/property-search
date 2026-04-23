'use client';

export default function RadarLoader() {
  // 5 orbiting dots at different radii, speeds, and starting angles
  const dots = [
    { radius: 38, duration: 1.1, delay: 0, size: 4, opacity: 0.9 },
    { radius: 50, duration: 1.4, delay: 0.15, size: 3.5, opacity: 0.7 },
    { radius: 62, duration: 1.8, delay: 0.4, size: 3, opacity: 0.55 },
    { radius: 44, duration: 1.2, delay: 0.7, size: 3, opacity: 0.65 },
    { radius: 56, duration: 2.0, delay: 0.3, size: 2.5, opacity: 0.45 },
  ];

  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{ height: 'calc(100vh - 60px)', backgroundColor: '#0f1117' }}
    >
      {/* Radar animation container */}
      <div style={{ position: 'relative', width: 160, height: 160 }}>
        {/* Static rounded square outlines (logo shape) */}
        <svg
          width="160"
          height="160"
          viewBox="0 0 160 160"
          fill="none"
          style={{ position: 'absolute', top: 0, left: 0 }}
        >
          <rect
            x="10"
            y="10"
            width="140"
            height="140"
            rx="28"
            stroke="#e1e4e8"
            strokeWidth="1.5"
            fill="none"
            opacity="0.15"
          />
          <rect
            x="30"
            y="30"
            width="100"
            height="100"
            rx="18"
            stroke="#e1e4e8"
            strokeWidth="1"
            fill="none"
            opacity="0.1"
          />
        </svg>

        {/* Orbiting dots */}
        {dots.map((dot, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: 0,
              height: 0,
              animation: `orbitSpin${i} ${dot.duration}s linear ${dot.delay}s infinite`,
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: -dot.radius - dot.size / 2,
                left: -dot.size / 2,
                width: dot.size,
                height: dot.size,
                borderRadius: '50%',
                backgroundColor: '#e1e4e8',
                opacity: dot.opacity,
                boxShadow: `0 0 ${dot.size * 2}px rgba(225,228,232,${dot.opacity * 0.6})`,
              }}
            />
          </div>
        ))}

        {/* House icon in center */}
        <svg
          width="36"
          height="36"
          viewBox="0 0 36 36"
          fill="none"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            marginTop: -18,
            marginLeft: -18,
            zIndex: 1,
          }}
        >
          {/* Roof (triangle) */}
          <path d="M18 4 L4 18 L32 18 Z" fill="#e1e4e8" opacity="0.9" />
          {/* Body (rectangle) */}
          <rect x="8" y="18" width="20" height="14" fill="#e1e4e8" opacity="0.9" rx="1" />
          {/* Door */}
          <rect x="15" y="22" width="6" height="10" fill="#0f1117" rx="1" />
          {/* Window left */}
          <rect x="10" y="21" width="4" height="4" fill="#0f1117" rx="0.5" />
          {/* Window right */}
          <rect x="22" y="21" width="4" height="4" fill="#0f1117" rx="0.5" />
        </svg>
      </div>

      {/* Pulsing text */}
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

      {/* Keyframes */}
      <style>{`
        ${dots
          .map(
            (dot, i) => `
        @keyframes orbitSpin${i} {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }`
          )
          .join('\n')}
        @keyframes radarTextPulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
