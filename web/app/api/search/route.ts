import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const RAPIDAPI_HOST = "realty-in-us.p.rapidapi.com";

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

  // 4. Call Realtor.com API
  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
  if (!RAPIDAPI_KEY) {
    return NextResponse.json(
      { error: "RAPIDAPI_KEY not configured" },
      { status: 500 },
    );
  }

  const apiBody: Record<string, unknown> = {
    limit: 200,
    offset: 0,
    city,
    state_code: stateCode,
    status: ["for_sale"],
    sort: { direction: "desc", field: "list_date" },
  };

  if (bedsMin != null) apiBody.beds = { min: bedsMin };
  if (bathsMin != null) apiBody.baths = { min: bathsMin };
  if (priceMax != null || priceMin != null) {
    const price: Record<string, number> = {};
    if (priceMin != null) price.min = priceMin;
    if (priceMax != null) price.max = priceMax;
    apiBody.list_price = price;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let apiResults: any[];
  let total: number;

  try {
    const res = await fetch(`https://${RAPIDAPI_HOST}/properties/v3/list`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-RapidAPI-Key": RAPIDAPI_KEY,
        "X-RapidAPI-Host": RAPIDAPI_HOST,
      },
      body: JSON.stringify(apiBody),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Realtor API error: ${res.status}`, details: text },
        { status: 502 },
      );
    }

    const data = await res.json();
    apiResults = data?.data?.home_search?.results ?? [];
    total = data?.data?.home_search?.total ?? 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to fetch from Realtor API", details: err.message },
      { status: 502 },
    );
  }

  // 5. Map to listing format
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listings = apiResults.map((r: any) => {
    const loc = r.location?.address ?? {};
    const desc = r.description ?? {};
    const coord = loc.coordinate ?? {};
    const href = r.href
      ? r.href.startsWith("http")
        ? r.href
        : `https://www.realtor.com${r.href}`
      : "";

    return {
      address: loc.line ?? "",
      area: `${loc.city ?? city}, ${loc.state_code ?? stateCode}`,
      price: r.list_price ?? 0,
      beds: desc.beds ?? 0,
      baths: (desc.baths_full ?? 0) + (desc.baths_half ?? 0) * 0.5,
      sqft: desc.sqft ?? null,
      lat: coord.lat ?? 0,
      lon: coord.lon ?? 0,
      photos: r.photo_count ?? 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      photo_urls: (r.photos ?? []).slice(0, 6).map((p: any) => p.href),
      url: href,
      search_tag: `search_${city.toLowerCase().replace(/\s+/g, "_")}`,
      list_date: r.list_date ?? null,
      last_update_date: r.last_update_date ?? null,
      availability_date: r.description?.available_date ?? null,
    };
  });

  // Apply maxCostPerBed filter client-side
  const filtered = maxCostPerBed
    ? listings.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (l: any) => l.beds > 0 && Math.round(l.price / l.beds) <= maxCostPerBed,
      )
    : listings;

  // 6. Upsert into listings table using service role client
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  );

  if (filtered.length > 0) {
    const { error: upsertError } = await adminClient
      .from("listings")
      .upsert(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        filtered.map((l: any) => ({
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
        })),
        { onConflict: "url", ignoreDuplicates: false },
      );

    if (upsertError) {
      console.error("Upsert error:", upsertError);
    }
  }

  // 7. Log the query
  await adminClient.from("search_queries").insert({
    user_id: user.id,
    query_params: { city, stateCode, bedsMin, bathsMin, priceMax, priceMin, maxCostPerBed },
    result_count: filtered.length,
  });

  const newUsed = usedCount + 1;

  return NextResponse.json({
    listings: filtered,
    total,
    queryUsage: { used: newUsed, limit, tier: tierId },
  });
}
