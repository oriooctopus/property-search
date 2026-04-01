import { useCallback, useEffect, useState } from 'react';
import type { FiltersState } from '@/components/Filters';

export interface SavedSearch {
  id: number;
  name: string;
  filters: Record<string, unknown>;
  notify_sms: boolean;
  created_at: string;
}

export function useSavedSearches(userId: string | null) {
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(false);

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
        setSavedSearches(data.savedSearches ?? []);
      }
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
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
          const saved = data.savedSearch as SavedSearch;
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

  return { savedSearches, loading, saveSearch, deleteSearch, updateSearch, refetch: fetchSavedSearches };
}
