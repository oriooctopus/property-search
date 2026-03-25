import type { Database } from "@/lib/types";

type FavoriteRow = Database["public"]["Tables"]["favorites"]["Row"];

/** No favorites data in visual tests */
export const MOCK_FAVORITES: FavoriteRow[] = [];
