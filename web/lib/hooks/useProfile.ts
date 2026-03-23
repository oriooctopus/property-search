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
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single<Profile>();
      return data ?? null;
    },
    enabled: !!userId,
  });
}
