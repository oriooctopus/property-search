import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { resolveHiddenMatchingFilters, type SearchFilters } from "../shared";
import type { CommuteRule } from "@/components/Filters";

// ---------------------------------------------------------------------------
// POST /api/listings/hidden/unhide
//
// Bulk-unhide listings for the current user. Two scopes:
//
//   { scope: 'all' }
//     Deletes every row in `hidden_listings` for this user.
//
//   { scope: 'matching', filters, commuteRules? }
//     Deletes only the rows whose listing_id matches the supplied filter set
//     (i.e. the listings that, once unhidden, would actually show up in the
//     current search). Mirrors the count endpoint's "matching" computation.
//
// Returns:
//   { unhidden: number }
//
// Used by the empty-state "Reset" dropdown CTA.
// ---------------------------------------------------------------------------

interface RequestBody {
  scope: "all" | "matching";
  filters?: SearchFilters;
  commuteRules?: CommuteRule[] | null;
}

function createSupabase(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return createServerClient(
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
}

export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.scope !== "all" && body.scope !== "matching") {
    return NextResponse.json(
      { error: "scope must be 'all' or 'matching'" },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const supabase = createSupabase(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (body.scope === "all") {
    // Count first so the response can report how many were removed.
    const { data: existing, error: countErr } = await supabase
      .from("hidden_listings")
      .select("listing_id")
      .eq("user_id", user.id);

    if (countErr) {
      return NextResponse.json(
        { error: "Failed to read hidden listings", details: countErr.message },
        { status: 500 },
      );
    }

    const total = (existing ?? []).length;

    if (total === 0) {
      return NextResponse.json({ unhidden: 0 });
    }

    const { error: delErr } = await supabase
      .from("hidden_listings")
      .delete()
      .eq("user_id", user.id);

    if (delErr) {
      return NextResponse.json(
        { error: "Failed to unhide all", details: delErr.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ unhidden: total });
  }

  // scope === "matching"
  const filters = body.filters ?? {};
  const commuteRules = body.commuteRules ?? null;

  const { data: existing, error: hiddenErr } = await supabase
    .from("hidden_listings")
    .select("listing_id")
    .eq("user_id", user.id);

  if (hiddenErr) {
    return NextResponse.json(
      { error: "Failed to read hidden listings", details: hiddenErr.message },
      { status: 500 },
    );
  }

  const hiddenIds = (existing ?? []).map((r) => r.listing_id);
  if (hiddenIds.length === 0) {
    return NextResponse.json({ unhidden: 0 });
  }

  let matchingIds: number[];
  try {
    const resolved = await resolveHiddenMatchingFilters({
      hiddenIds,
      filters,
      commuteRules,
    });
    // `null` means "no filters applied" → fall back to all hidden IDs so the
    // caller can't accidentally use scope='matching' as a sneaky no-op.
    matchingIds = resolved ?? hiddenIds;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to compute matching set", details: msg },
      { status: 500 },
    );
  }

  if (matchingIds.length === 0) {
    return NextResponse.json({ unhidden: 0 });
  }

  // Delete in chunks to avoid huge IN() URLs.
  const CHUNK = 500;
  let deleted = 0;
  for (let i = 0; i < matchingIds.length; i += CHUNK) {
    const chunk = matchingIds.slice(i, i + CHUNK);
    const { error: delErr } = await supabase
      .from("hidden_listings")
      .delete()
      .eq("user_id", user.id)
      .in("listing_id", chunk);
    if (delErr) {
      return NextResponse.json(
        { error: "Failed to unhide matching", details: delErr.message },
        { status: 500 },
      );
    }
    deleted += chunk.length;
  }

  return NextResponse.json({ unhidden: deleted });
}
