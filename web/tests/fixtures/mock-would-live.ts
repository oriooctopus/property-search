import type { Database } from "@/lib/types";

type WishlistRow = Database["public"]["Tables"]["wishlists"]["Row"];

/** No wishlist data in visual tests */
export const MOCK_WISHLISTS: WishlistRow[] = [];
