import type { Database } from "@/lib/types";
import { MOCK_LISTINGS } from "./mock-listings";
import { MOCK_PROFILES } from "./mock-profiles";
import { MOCK_WISHLIST_ITEMS } from "./mock-favorites";
import { MOCK_WISHLISTS } from "./mock-would-live";

type Tables = Database["public"]["Tables"];

/**
 * Type-safe mock registry.
 * If a new table is added to the Database type, this will fail to compile
 * until a corresponding mock entry is added here.
 */
type MockRegistry = {
  [K in keyof Tables]: Tables[K]["Row"][];
};

export const MOCKS: MockRegistry = {
  listings: MOCK_LISTINGS,
  profiles: MOCK_PROFILES,
  wishlists: MOCK_WISHLISTS,
  wishlist_items: MOCK_WISHLIST_ITEMS,
  wishlist_shares: [],
  saved_searches: [],
  conversations: [],
  conversation_messages: [],
  pricing_tiers: [],
  user_tiers: [],
  search_queries: [],
  isochrones: [],
  listing_isochrones: [],
  hidden_listings: [],
  commute_cache: [],
};

export { MOCK_LISTINGS } from "./mock-listings";
export {
  MOCK_PROFILES,
  MOCK_PROFILE_LOGGED_IN,
  MOCK_PROFILES_LOGGED_OUT,
} from "./mock-profiles";
export { MOCK_WISHLIST_ITEMS } from "./mock-favorites";
export { MOCK_WISHLISTS } from "./mock-would-live";
