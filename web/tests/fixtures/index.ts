import type { Database } from "@/lib/types";
import { MOCK_LISTINGS } from "./mock-listings";
import { MOCK_PROFILES } from "./mock-profiles";
import { MOCK_FAVORITES } from "./mock-favorites";
import { MOCK_WOULD_LIVE_THERE } from "./mock-would-live";

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
  favorites: MOCK_FAVORITES,
  would_live_there: MOCK_WOULD_LIVE_THERE,
  saved_searches: [],
  conversations: [],
  conversation_messages: [],
  pricing_tiers: [],
  user_tiers: [],
  search_queries: [],
};

export { MOCK_LISTINGS } from "./mock-listings";
export {
  MOCK_PROFILES,
  MOCK_PROFILE_LOGGED_IN,
  MOCK_PROFILES_LOGGED_OUT,
} from "./mock-profiles";
export { MOCK_FAVORITES } from "./mock-favorites";
export { MOCK_WOULD_LIVE_THERE } from "./mock-would-live";
