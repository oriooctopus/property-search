import type { Database } from "@/lib/types";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

/** Logged-in test user profile */
export const MOCK_PROFILE_LOGGED_IN: ProfileRow = {
  id: "00000000-0000-0000-0000-000000000001",
  display_name: "Test User",
  bio: null,
  avatar_url: null,
  phone: null,
  created_at: "2026-01-01T00:00:00Z",
};

/** Logged-out state: no profiles returned */
export const MOCK_PROFILES_LOGGED_OUT: ProfileRow[] = [];

/** Default for visual tests (logged-out) */
export const MOCK_PROFILES: ProfileRow[] = MOCK_PROFILES_LOGGED_OUT;
