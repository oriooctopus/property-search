import type { Database } from "@/lib/types";

type WishlistItemRow = Database["public"]["Tables"]["wishlist_items"]["Row"];

/** No wishlist item data in visual tests */
export const MOCK_WISHLIST_ITEMS: WishlistItemRow[] = [];
