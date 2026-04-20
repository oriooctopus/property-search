'use client';

/**
 * Compact inline stats row: `🛏 4  🛁 2  ⊞ 900` — used in the list ListingCard
 * and the mobile SwipeCard. Matches the muted-grey icon+number treatment so
 * both cards share the same visual language.
 */
interface CompactStatsProps {
  beds: number;
  baths: number | null;
  sqft: number | null;
  className?: string;
}

export function CompactStats({ beds, baths, sqft, className }: CompactStatsProps) {
  return (
    <div
      className={`flex items-center gap-3 text-xs ${className ?? ''}`}
      style={{ color: '#8b949e' }}
    >
      <span className="flex items-center gap-1">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v-2a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        {beds === 0 ? 'Studio' : beds}
      </span>
      {baths != null && Number(baths) > 0 && (
        <span className="flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h16a1 1 0 0 1 1 1v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-3a1 1 0 0 1 1-1z"/><path d="M6 12V5a2 2 0 0 1 2-2h1"/><circle cx="12" cy="8" r="2"/></svg>
          {baths}
        </span>
      )}
      {sqft != null && Number(sqft) > 0 && (
        <span className="flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 3v18"/></svg>
          {sqft.toLocaleString()}
        </span>
      )}
    </div>
  );
}
