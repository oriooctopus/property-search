import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase-browser';

export type WishlistItem = { listing_id: number };
export type WishlistShare = { shared_with_email: string; permission: string };

export interface Wishlist {
  id: string;
  name: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  wishlist_items: WishlistItem[];
  wishlist_shares: WishlistShare[];
}

export function useWishlists(userId: string | null) {
  const supabase = createClient();

  return useQuery<Wishlist[]>({
    queryKey: ['wishlists', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('wishlists')
        .select('*, wishlist_items(listing_id), wishlist_shares(shared_with_email, permission)')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Wishlist[];
    },
    enabled: !!userId,
  });
}

export function useWishlistMutations(userId: string | null) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['wishlists', userId] });

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
      const { error } = await supabase
        .from('wishlists')
        .insert({ name, user_id: userId });
      if (error) throw error;
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

  return { addToWishlist, removeFromWishlist, createWishlist, deleteWishlist, renameWishlist };
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
