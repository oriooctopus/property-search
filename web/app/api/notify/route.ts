import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";
import { sendSMS } from "@/lib/twilio";
import { listingMatchesFilters } from "./lib";

type Listing = Database["public"]["Tables"]["listings"]["Row"];
type SavedSearch = Database["public"]["Tables"]["saved_searches"]["Row"];

export async function POST(request: NextRequest) {
  // Basic auth via secret query param
  const secret = request.nextUrl.searchParams.get("secret");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Listings created in the last 24 hours
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: rawListings, error: listingsError } = await supabase
    .from("listings")
    .select("*")
    .is("delisted_at", null)
    .neq("source", "facebook-marketplace")
    .gte("created_at", since);

  if (listingsError) {
    console.error("Failed to fetch new listings:", listingsError);
    return NextResponse.json(
      { error: "Failed to fetch listings" },
      { status: 500 },
    );
  }

  const newListings = (rawListings ?? []) as unknown as Listing[];

  if (newListings.length === 0) {
    return NextResponse.json({
      message: "No new listings in the last 24 hours",
      notified: 0,
    });
  }

  // Fetch all saved searches with SMS notifications enabled
  const { data: rawSearches, error: searchesError } = await supabase
    .from("saved_searches")
    .select("*")
    .eq("notify_sms", true);

  if (searchesError) {
    console.error("Failed to fetch saved searches:", searchesError);
    return NextResponse.json(
      { error: "Failed to fetch saved searches" },
      { status: 500 },
    );
  }

  const savedSearches = (rawSearches ?? []) as unknown as SavedSearch[];

  if (savedSearches.length === 0) {
    return NextResponse.json({
      message: "No saved searches with SMS notifications",
      notified: 0,
    });
  }

  const notifications: Array<{
    userId: string;
    searchName: string;
    matchCount: number;
    smsSent: boolean;
  }> = [];

  // Group saved searches by user to batch phone lookups
  const userIds = [...new Set(savedSearches.map((s) => s.user_id))];

  const { data: rawProfiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, phone")
    .in("id", userIds);

  if (profilesError) {
    console.error("Failed to fetch profiles:", profilesError);
    return NextResponse.json(
      { error: "Failed to fetch profiles" },
      { status: 500 },
    );
  }

  const profiles = (rawProfiles ?? []) as unknown as Array<{
    id: string;
    phone: string | null;
  }>;

  const phoneByUser = new Map<string, string>();
  for (const profile of profiles) {
    if (profile.phone) {
      phoneByUser.set(profile.id, profile.phone);
    }
  }

  const appUrl = process.env.APP_URL ?? "https://localhost:3000";

  for (const search of savedSearches) {
    const matches = newListings.filter((listing) =>
      listingMatchesFilters(listing, search.filters),
    );

    if (matches.length === 0) continue;

    const phone = phoneByUser.get(search.user_id);
    if (!phone) {
      notifications.push({
        userId: search.user_id,
        searchName: search.name,
        matchCount: matches.length,
        smsSent: false,
      });
      console.warn(
        `No phone number for user ${search.user_id}, skipping SMS for "${search.name}"`,
      );
      continue;
    }

    const first = matches[0];
    const moreText =
      matches.length > 1 ? ` and ${matches.length - 1} more` : "";
    const body = `\u{1F3E0} ${matches.length} new listing${matches.length > 1 ? "s" : ""} match '${search.name}'! ${first.address} ($${first.price.toLocaleString()}/mo)${moreText}. Check them out at ${appUrl}`;

    await sendSMS(phone, body);

    notifications.push({
      userId: search.user_id,
      searchName: search.name,
      matchCount: matches.length,
      smsSent: true,
    });
  }

  return NextResponse.json({
    message: `Processed ${savedSearches.length} saved searches`,
    newListingsCount: newListings.length,
    notified: notifications.filter((n) => n.smsSent).length,
    notifications,
  });
}
