import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase-browser';

export type WishlistItem = { listing_id: number };
export type WishlistShare = { id?: number; shared_with_email: string; permission: string };

export interface Wishlist {
  id: string;
  name: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  wishlist_items: WishlistItem[];
  wishlist_shares: WishlistShare[];
  /** Email address of the wishlist owner (only populated for shared-with-me wishlists). */
  owner_email?: string | null;
}

/**
 * Returns wishlists the current user OWNS. Shared-with-me wishlists are fetched
 * separately via useSharedWishlists because they live in a different query space.
 */
export function useWishlists(userId: string | null) {
  const supabase = createClient();

  return useQuery<Wishlist[]>({
    queryKey: ['wishlists', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('wishlists')
        .select('id, name, user_id, created_at, updated_at, wishlist_items(listing_id), wishlist_shares(id, shared_with_email, permission)')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Wishlist[];
    },
    enabled: !!userId,
  });
}

/**
 * Fetches wishlists that have been shared with the given email (i.e. owned by someone else).
 * Requires an RLS policy that allows SELECT on wishlists where a wishlist_shares row
 * exists matching the current user's email.
 */
export function useSharedWishlists(userEmail: string | null) {
  const supabase = createClient();

  return useQuery<Wishlist[]>({
    queryKey: ['wishlists-shared', userEmail],
    queryFn: async () => {
      if (!userEmail) return [];
      // First find share rows that target this user, then fetch the parent wishlists.
      const { data: shareRows, error: shareErr } = await supabase
        .from('wishlist_shares')
        .select('wishlist_id, permission')
        .eq('shared_with_email', userEmail);
      if (shareErr) throw shareErr;
      const shareList = (shareRows ?? []) as Array<{ wishlist_id: string; permission: string }>;
      const wishlistIds = shareList.map((r) => r.wishlist_id);
      if (wishlistIds.length === 0) return [];

      const { data: wls, error: wlErr } = await supabase
        .from('wishlists')
        .select('id, name, user_id, created_at, updated_at, wishlist_items(listing_id), wishlist_shares(id, shared_with_email, permission)')
        .in('id', wishlistIds);
      if (wlErr) throw wlErr;
      const rows = (wls ?? []) as unknown as Wishlist[];

      // Owner email lookup: profiles has no email column, so we can't reliably
      // render "from user@..." yet. Fall back to display_name if present.
      const ownerIds = Array.from(new Set(rows.map((w) => w.user_id).filter(Boolean)));
      const nameById = new Map<string, string>();
      if (ownerIds.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, display_name')
          .in('id', ownerIds);
        for (const p of (profs ?? []) as Array<{ id: string; display_name: string | null }>) {
          if (p.display_name) nameById.set(p.id, p.display_name);
        }
      }
      return rows.map((w) => ({ ...w, owner_email: nameById.get(w.user_id) ?? null }));
    },
    enabled: !!userEmail,
  });
}

/**
 * Combined view: wishlists the user owns + wishlists shared with them,
 * split into `mine` and `shared` groups. Also exposes `all` (owned ∪ shared)
 * sorted by created_at for legacy callers.
 */
export function useWishlistsSplit(userId: string | null, userEmail: string | null) {
  const mineQ = useWishlists(userId);
  const sharedQ = useSharedWishlists(userEmail);

  return useMemo(() => {
    const mine = mineQ.data ?? [];
    const shared = sharedQ.data ?? [];
    // Deduplicate: a wishlist that you own AND also appears in sharedQ (shouldn't
    // happen in practice) is kept in `mine`.
    const mineIds = new Set(mine.map((w) => w.id));
    const sharedOnly = shared.filter((w) => !mineIds.has(w.id));
    const all = [...mine, ...sharedOnly].sort((a, b) =>
      (a.created_at ?? '').localeCompare(b.created_at ?? ''),
    );
    return {
      mine,
      shared: sharedOnly,
      all,
      isLoading: mineQ.isLoading || sharedQ.isLoading,
    };
  }, [mineQ.data, sharedQ.data, mineQ.isLoading, sharedQ.isLoading]);
}

export function useWishlistMutations(userId: string | null) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['wishlists', userId] });
    queryClient.invalidateQueries({ queryKey: ['wishlists-shared'] });
  };

  const addToWishlist = useMutation({
    mutationFn: async ({ wishlistId, listingId }: { wishlistId: string; listingId: number }) => {
      const { error } = await supabase
        .from('wishlist_items')
        .upsert({ wishlist_id: wishlistId, listing_id: listingId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const removeFromWishlist = useMutation({
    mutationFn: async ({ wishlistId, listingId }: { wishlistId: string; listingId: number }) => {
      const { error } = await supabase
        .from('wishlist_items')
        .delete()
        .eq('wishlist_id', wishlistId)
        .eq('listing_id', listingId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const createWishlist = useMutation({
    mutationFn: async (name: string) => {
      if (!userId) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('wishlists')
        .insert({ name, user_id: userId })
        .select()
        .single();
      if (error) throw error;
      return data as { id: string; name: string };
    },
    onSuccess: invalidate,
  });

  const deleteWishlist = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('wishlists')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const renameWishlist = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase
        .from('wishlists')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const addShare = useMutation({
    mutationFn: async ({ wishlistId, email, permission }: { wishlistId: string; email: string; permission: 'viewer' | 'editor' }) => {
      const { error } = await supabase
        .from('wishlist_shares')
        .insert({ wishlist_id: wishlistId, shared_with_email: email, permission });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const removeShare = useMutation({
    mutationFn: async ({ shareId }: { shareId: number }) => {
      const { error } = await supabase
        .from('wishlist_shares')
        .delete()
        .eq('id', shareId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const updateSharePermission = useMutation({
    mutationFn: async ({ shareId, permission }: { shareId: number; permission: 'viewer' | 'editor' }) => {
      const { error } = await supabase
        .from('wishlist_shares')
        .update({ permission })
        .eq('id', shareId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const leaveSharedWishlist = useMutation({
    mutationFn: async ({ wishlistId, email }: { wishlistId: string; email: string }) => {
      const { error } = await supabase
        .from('wishlist_shares')
        .delete()
        .eq('wishlist_id', wishlistId)
        .eq('shared_with_email', email);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    addToWishlist,
    removeFromWishlist,
    createWishlist,
    deleteWishlist,
    renameWishlist,
    addShare,
    removeShare,
    updateSharePermission,
    leaveSharedWishlist,
  };
}

export function useWishlistedListingIds(userId: string | null): Set<number> {
  const { data: wishlists } = useWishlists(userId);
  return useMemo(() => {
    if (!wishlists) return new Set<number>();
    const ids = new Set<number>();
    for (const wl of wishlists) {
      for (const item of wl.wishlist_items) ids.add(item.listing_id);
    }
    return ids;
  }, [wishlists]);
}
