import { useCallback, useEffect, useState } from 'react';
import type { FiltersState } from '@/components/Filters';
import { DEFAULT_FILTERS } from '@/lib/hooks/useConversation';

export interface SavedSearch {
  id: number;
  name: string;
  filters: Record<string, unknown>;
  notify_sms: boolean;
  is_default: boolean;
  created_at: string;
}

/**
 * Normalize a saved search's persisted `filters` JSON into a COMPLETE
 * `FiltersState`. Older rows (or any future schema drift) may be missing
 * keys — e.g. `mapPosition` didn't exist when early rows were saved — and
 * a partial object flowing into components that assume a complete
 * `FiltersState` crashes the app (see Filters.tsx `selectedSources.length`).
 * This is a true system boundary (persisted JSON, possibly stale schema),
 * so filling in missing keys with defaults here is not defensive
 * band-aiding — it's normalizing untrusted input at the point it enters
 * the app.
 */
function normalizeFilters(raw: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return { ...DEFAULT_FILTERS, ...(raw ?? {}) };
}

export function useSavedSearches(userId: string | null) {
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(false);
  // Distinct from `loading`: `loading` starts false (no fetch has been
  // *initiated* yet), which lets a consumer's mount effect race ahead and
  // treat "no default search" as final before the first fetch even starts.
  // `hasFetchedOnce` only flips true once an AUTHENTICATED fetch resolves —
  // deliberately NOT for the `!userId` branch below, since `userId` starts
  // null before Supabase auth resolves even for a logged-in user. Flipping
  // it there too let a consumer's mount effect see "fetched, empty" during
  // that pre-auth window and latch a "no default search" conclusion before
  // the real authenticated fetch had even started.
  const [hasFetchedOnce, setHasFetchedOnce] = useState(false);

  const fetchSavedSearches = useCallback(async () => {
    if (!userId) {
      setSavedSearches([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/saved-searches');
      if (res.ok) {
        const data = await res.json();
        const fetched = (data.savedSearches ?? []) as SavedSearch[];
        setSavedSearches(
          fetched.map((s) => ({ ...s, filters: normalizeFilters(s.filters) })),
        );
      }
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
      setHasFetchedOnce(true);
    }
  }, [userId]);

  useEffect(() => {
    fetchSavedSearches();
  }, [fetchSavedSearches]);

  const saveSearch = useCallback(
    async (name: string, filters: FiltersState): Promise<SavedSearch | null> => {
      try {
        const res = await fetch('/api/saved-searches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, filters }),
        });
        if (res.ok) {
          const data = await res.json();
          const saved = {
            ...(data.savedSearch as SavedSearch),
            filters: normalizeFilters((data.savedSearch as SavedSearch).filters),
          };
          setSavedSearches((prev) => [saved, ...prev]);
          return saved;
        }
      } catch {
        // silently ignore
      }
      return null;
    },
    [],
  );

  const deleteSearch = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/saved-searches/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setSavedSearches((prev) => prev.filter((s) => s.id !== id));
      }
    } catch {
      // silently ignore
    }
  }, []);

  const updateSearch = useCallback(async (id: number, name: string) => {
    try {
      const res = await fetch(`/api/saved-searches/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        setSavedSearches((prev) =>
          prev.map((s) => (s.id === id ? { ...s, name } : s)),
        );
      }
    } catch {
      // silently ignore
    }
  }, []);

  /**
   * Replace a saved search's filter snapshot in place. Used by the
   * "Edit saved search" flow — when the user taps the pencil, modifies
   * chips in the filter sheet, and taps "Save changes" the new
   * `FiltersState` is persisted under the same row id (the name is
   * preserved). Returns true on success so the caller can clear the
   * editing state and show a confirmation.
   */
  const updateSearchFilters = useCallback(
    async (id: number, filters: FiltersState): Promise<boolean> => {
      try {
        const res = await fetch(`/api/saved-searches/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filters }),
        });
        if (res.ok) {
          setSavedSearches((prev) =>
            prev.map((s) =>
              s.id === id
                ? { ...s, filters: normalizeFilters(filters as unknown as Record<string, unknown>) }
                : s,
            ),
          );
          return true;
        }
      } catch {
        // silently ignore
      }
      return false;
    },
    [],
  );

  /**
   * Mark (or unmark) a saved search as the default that auto-loads when the
   * app opens. Setting one default clears any other's `is_default` locally
   * to mirror the DB-level exclusivity (a partial unique index enforces
   * only one default per user), so no refetch is needed.
   */
  const setDefaultSearch = useCallback(
    async (id: number, isDefault: boolean): Promise<boolean> => {
      try {
        const res = await fetch(`/api/saved-searches/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_default: isDefault }),
        });
        if (res.ok) {
          setSavedSearches((prev) =>
            prev.map((s) => ({
              ...s,
              is_default: s.id === id ? isDefault : isDefault ? false : s.is_default,
            })),
          );
          return true;
        }
      } catch {
        // silently ignore
      }
      return false;
    },
    [],
  );

  return {
    savedSearches,
    loading,
    hasFetchedOnce,
    saveSearch,
    deleteSearch,
    updateSearch,
    updateSearchFilters,
    setDefaultSearch,
    refetch: fetchSavedSearches,
  };
}
