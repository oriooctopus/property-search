import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase-browser';

const LOCAL_STORAGE_KEY = 'dwelligence_hidden_listings';

export function useHiddenListings(userId: string | null) {
  const supabase = createClient();

  return useQuery<Set<number>>({
    queryKey: ['hidden-listings', userId],
    queryFn: async () => {
      if (!userId) {
        // localStorage fallback for unauthenticated users
        try {
          const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
          return stored ? new Set(JSON.parse(stored) as number[]) : new Set<number>();
        } catch {
          return new Set<number>();
        }
      }
      const { data, error } = await supabase
        .from('hidden_listings')
        .select('listing_id')
        .eq('user_id', userId);
      if (error) throw error;
      return new Set((data ?? []).map(r => r.listing_id));
    },
    staleTime: 30_000,
  });
}

export function useHiddenMutations(userId: string | null) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['hidden-listings', userId] });

  const hide = useMutation({
    mutationFn: async (listingId: number) => {
      if (!userId) {
        try {
          const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
          const ids: number[] = stored ? JSON.parse(stored) : [];
          if (!ids.includes(listingId)) ids.push(listingId);
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(ids));
        } catch { /* ignore storage errors */ }
        return;
      }
      const { error } = await supabase
        .from('hidden_listings')
        .upsert({ user_id: userId, listing_id: listingId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const unhide = useMutation({
    mutationFn: async (listingId: number) => {
      if (!userId) {
        try {
          const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
          const ids: number[] = stored ? JSON.parse(stored) : [];
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(ids.filter(id => id !== listingId)));
        } catch { /* ignore storage errors */ }
        return;
      }
      const { error } = await supabase
        .from('hidden_listings')
        .delete()
        .eq('user_id', userId)
        .eq('listing_id', listingId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const clearAll = useMutation({
    mutationFn: async () => {
      if (!userId) {
        try {
          localStorage.removeItem(LOCAL_STORAGE_KEY);
        } catch { /* ignore storage errors */ }
        return;
      }
      const { error } = await supabase
        .from('hidden_listings')
        .delete()
        .eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { hide, unhide, clearAll };
}
