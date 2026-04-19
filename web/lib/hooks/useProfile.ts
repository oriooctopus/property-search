import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase-browser";
import type { Database } from "@/lib/types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export const PROFILE_QUERY_KEY = ["profile"] as const;

export function useProfile(userId: string | null) {
  const supabase = createClient();

  return useQuery<Profile | null>({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: async () => {
      if (!userId) return null;
      // Selective columns: only `avatar_url` is consumed by Navbar; `id` is kept
      // for row identity / truthy checks (page.tsx gates tour UI on `profile`).
      // `has_completed_tour` is NOT read on the client — it's only written via
      // an update mutation, which doesn't need it pre-fetched.
      const { data } = await supabase
        .from("profiles")
        .select("id, avatar_url")
        .eq("id", userId)
        .single<Profile>();
      return data ?? null;
    },
    enabled: !!userId,
  });
}
