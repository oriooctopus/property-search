'use client';

interface SwipeOnboardingProps {
  /** Tapping "Got it" or the backdrop outside the modal calls this. The
   *  parent also auto-dismisses when the user starts their first gesture
   *  (gesture flows through everywhere except the modal card itself). */
  onDismiss?: () => void;
}

const ROWS: Array<{ glyph: string; label: string; sub: string }> = [
  { glyph: '←', label: 'Skip', sub: 'Not for me' },
  { glyph: '→', label: 'Like', sub: 'Save to wishlist' },
  { glyph: '↑', label: 'Would live here', sub: 'Top match' },
  { glyph: '↓', label: 'Back of queue', sub: 'Maybe later' },
];

export default function SwipeOnboarding({ onDismiss }: SwipeOnboardingProps) {
  return (
    <div
      className="absolute inset-0 flex items-end justify-center pb-20"
      style={{ zIndex: 1300, backgroundColor: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }}
    >
      <div
        className="relative w-[88%] max-w-[340px] rounded-2xl"
        style={{
          backgroundColor: '#1c2028',
          border: '1px solid #2d333b',
          padding: '16px 18px 14px',
          pointerEvents: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
        }}
      >
        {/* Header row: title + close button */}
        <div className="flex items-center justify-between mb-3">
          <div
            className="text-[11px] font-semibold tracking-wider uppercase"
            style={{ color: '#58a6ff' }}
          >
            How swiping works
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="flex items-center justify-center rounded-full transition-colors"
            style={{
              width: 24,
              height: 24,
              color: '#8b949e',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#e1e4e8'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#8b949e'; }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        </div>

        {/* Direction rows */}
        <div className="flex flex-col gap-1.5 mb-3">
          {ROWS.map((row) => (
            <div key={row.label} className="flex items-center gap-3">
              <div
                className="flex items-center justify-center rounded-full text-[15px] font-bold"
                style={{
                  width: 28,
                  height: 28,
                  backgroundColor: 'rgba(88, 166, 255, 0.10)',
                  border: '1px solid rgba(88, 166, 255, 0.35)',
                  color: '#58a6ff',
                  flexShrink: 0,
                }}
              >
                {row.glyph}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold leading-tight" style={{ color: '#e1e4e8' }}>
                  {row.label}
                </div>
                <div className="text-[11px] leading-tight" style={{ color: '#8b949e' }}>
                  {row.sub}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Got it button */}
        <button
          type="button"
          onClick={onDismiss}
          className="w-full rounded-md text-[13px] font-semibold transition-colors"
          style={{
            height: 36,
            backgroundColor: '#58a6ff',
            color: '#0f1117',
            border: 'none',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#79b8ff'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#58a6ff'; }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}
