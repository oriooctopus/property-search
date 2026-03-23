import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { unifiedSearch } from "@/lib/sources";

interface SearchBody {
  city: string;
  stateCode: string;
  bedsMin?: number;
  bathsMin?: number;
  priceMax?: number;
  priceMin?: number;
  maxCostPerBed?: number;
}

export async function POST(request: NextRequest) {
  // 1. Auth — create supabase client with cookies
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // ignored in route handlers
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Check tier & usage
  const { data: userTier } = await supabase
    .from("user_tiers")
    .select("tier_id")
    .eq("user_id", user.id)
    .single();

  const tierId = userTier?.tier_id ?? "free";

  const { data: tier } = await supabase
    .from("pricing_tiers")
    .select("monthly_query_limit")
    .eq("id", tierId)
    .single();

  const limit = tier?.monthly_query_limit ?? 5;

  // Count queries this month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { count: used } = await supabase
    .from("search_queries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", monthStart);

  const usedCount = used ?? 0;

  if (usedCount >= limit) {
    return NextResponse.json(
      { error: "Query limit reached", limit, used: usedCount, tier: tierId },
      { status: 429 },
    );
  }

  // 3. Parse search params
  let body: SearchBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { city, stateCode, bedsMin, bathsMin, priceMax, priceMin, maxCostPerBed } = body;

  if (!city || !stateCode) {
    return NextResponse.json(
      { error: "city and stateCode are required" },
      { status: 400 },
    );
  }

  // 4. Call all data sources via unified search
  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
  if (!RAPIDAPI_KEY) {
    return NextResponse.json(
      { error: "RAPIDAPI_KEY not configured" },
      { status: 500 },
    );
  }

  let result;
  try {
    result = await unifiedSearch(
      { city, stateCode, bedsMin, bathsMin, priceMax, priceMin },
      RAPIDAPI_KEY,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to fetch listings", details: message },
      { status: 502 },
    );
  }

  const { listings, totals, errors: sourceErrors } = result;

  // Apply maxCostPerBed filter client-side
  const filtered = maxCostPerBed
    ? listings.filter(
        (l) => l.beds > 0 && Math.round(l.price / l.beds) <= maxCostPerBed,
      )
    : listings;

  // 5. Upsert into listings table using service role client
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  );

  if (filtered.length > 0) {
    const { error: upsertError } = await adminClient
      .from("listings")
      .upsert(
        filtered.map((l) => ({
          address: l.address,
          area: l.area,
          price: l.price,
          beds: l.beds,
          baths: l.baths,
          sqft: l.sqft,
          lat: l.lat,
          lon: l.lon,
          photos: l.photos,
          photo_urls: l.photo_urls,
          url: l.url,
          search_tag: l.search_tag,
          list_date: l.list_date,
          last_update_date: l.last_update_date,
          availability_date: l.availability_date,
          source: l.source,
        })),
        { onConflict: "url", ignoreDuplicates: false },
      );

    if (upsertError) {
      console.error("Upsert error:", upsertError);
    }
  }

  // 6. Log the query
  await adminClient.from("search_queries").insert({
    user_id: user.id,
    query_params: { city, stateCode, bedsMin, bathsMin, priceMax, priceMin, maxCostPerBed },
    result_count: filtered.length,
  });

  const newUsed = usedCount + 1;

  return NextResponse.json({
    listings: filtered,
    total: totals.merged,
    totals,
    sourceErrors,
    queryUsage: { used: newUsed, limit, tier: tierId },
  });
}
