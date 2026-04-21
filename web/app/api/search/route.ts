import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import type { ListingSource } from "@/lib/sources/types";

export const maxDuration = 60;

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

  // 4. Query listings from Supabase instead of calling scrapers
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  );

  let query = adminClient
    .from("listings")
    .select("*")
    .is("delisted_at", null)
    .neq("source", "facebook-marketplace")
    .order("last_update_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(500);

  // Filter by area name matching the city (case-insensitive).
  query = query.ilike("area", `%${city}%`);

  if (bedsMin != null) {
    query = query.gte("beds", bedsMin);
  }
  if (bathsMin != null) {
    query = query.gte("baths", bathsMin);
  }
  if (priceMax != null) {
    query = query.lte("price", priceMax);
  }
  if (priceMin != null) {
    query = query.gte("price", priceMin);
  }

  const { data: dbListings, error: queryError } = await query;

  if (queryError) {
    return NextResponse.json(
      { error: "Failed to query listings", details: queryError.message },
      { status: 502 },
    );
  }

  const rows = dbListings ?? [];

  // Normalize DB rows into the RawListing shape the frontend expects
  const listings = rows.map((row) => ({
    address: row.address ?? "",
    area: row.area ?? "",
    price: Number(row.price) || 0,
    beds: Number(row.beds) || 0,
    baths: Number(row.baths) || 0,
    sqft: row.sqft != null ? Number(row.sqft) : null,
    lat: Number(row.lat) || 0,
    lon: Number(row.lon) || 0,
    photos: Number(row.photos) || 0,
    photo_urls: row.photo_urls ?? [],
    url: row.url ?? "",
    list_date: row.list_date ?? null,
    last_update_date: row.last_update_date ?? null,
    availability_date: row.availability_date ?? null,
    source: row.source as ListingSource,
    sources: (row.sources ?? [row.source]) as ListingSource[],
    source_urls: row.source_urls ?? (row.source && row.url ? { [row.source]: row.url } : {}),
  }));

  // Apply maxCostPerBed filter (can't do this math in Supabase easily)
  const filtered = maxCostPerBed
    ? listings.filter(
        (l) => l.beds > 0 && Math.round(l.price / l.beds) <= maxCostPerBed,
      )
    : listings;

  // Build totals by source
  const totals: Record<string, number> = { merged: filtered.length, deduplicated: 0 };
  for (const l of filtered) {
    totals[l.source] = (totals[l.source] ?? 0) + 1;
  }

  // Build a simple quality summary from DB results
  const qualitySummary = {
    totalProcessed: filtered.length,
    totalValid: filtered.length,
    totalDropped: 0,
    fieldCoverage: {
      beds: filtered.filter((l) => l.beds > 0).length,
      baths: filtered.filter((l) => l.baths > 0).length,
      price: filtered.filter((l) => l.price > 0).length,
      geo: filtered.filter((l) => l.lat !== 0 && l.lon !== 0).length,
      photos: filtered.filter((l) => l.photos > 0).length,
    },
    sourceBreakdown: Object.entries(totals)
      .filter(([k]) => k !== "merged" && k !== "deduplicated")
      .map(([source, count]) => ({
        source,
        total: count,
        valid: count,
        dropped: 0,
      })),
  };

  // 5. Log the query
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
    sourceErrors: [],
    queryUsage: { used: newUsed, limit, tier: tierId },
    qualitySummary,
  });
}
