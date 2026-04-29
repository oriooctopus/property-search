/**
 * Formats a date string as a short date (e.g., "Mar 15" or "Mar 15, 2025").
 */
export function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const month = date.toLocaleString('en-US', { month: 'short' });
  const day = date.getDate();
  const year = date.getFullYear();
  return year === now.getFullYear()
    ? `${month} ${day}`
    : `${month} ${day}, ${year}`;
}

/**
 * Formats a date string as relative time (e.g., "Listed 3 days ago")
 * or as a short date for older listings (e.g., "Listed Mar 15").
 */
export function formatListedDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);
  const diffWeeks = Math.floor(diffDays / 7);

  if (diffMins < 1) return 'Listed just now';
  if (diffMins < 60) return `Listed ${diffMins}m ago`;
  if (diffHours < 24) return `Listed ${diffHours}h ago`;
  if (diffDays === 1) return 'Listed yesterday';
  if (diffDays < 7) return `Listed ${diffDays}d ago`;
  if (diffWeeks < 5) return `Listed ${diffWeeks}w ago`;

  return `Listed ${formatShortDate(dateStr)}`;
}

/**
 * Formats an availability / move-in date.
 *   - null / unparseable → "Move-in unknown"
 *   - on-or-before today → "Available now"
 *   - future → "Available Mar 15" (current year) or "Available Mar 15, 2026"
 *
 * UTC-compared so an ISO date string like "2026-04-15" isn't pushed a day
 * earlier by local-midnight parsing.
 */
export function formatAvailabilityDate(
  dateStr: string | null | undefined,
): string {
  if (!dateStr) return 'Move-in unknown';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 'Move-in unknown';
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);
  if (d.getTime() <= todayUtc.getTime()) return 'Available now';
  return `Available ${formatShortDate(dateStr)}`;
}

/**
 * Compact availability for icon+number tile (e.g. "Now", "5/31", or null
 * when unknown so the caller can omit the tile entirely).
 *   - null / unparseable → null
 *   - on-or-before today → "Now"
 *   - future → "M/D" (e.g. "5/31")
 *
 * UTC-compared like formatAvailabilityDate.
 */
export function formatAvailabilityCompact(
  dateStr: string | null | undefined,
): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);
  if (d.getTime() <= todayUtc.getTime()) return 'Now';
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
