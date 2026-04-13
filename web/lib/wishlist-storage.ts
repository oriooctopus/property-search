const KEY = 'dwelligence_last_wishlist_id';

export function getLastUsedWishlistId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(KEY);
}

export function setLastUsedWishlistId(id: string): void {
  localStorage.setItem(KEY, id);
}
