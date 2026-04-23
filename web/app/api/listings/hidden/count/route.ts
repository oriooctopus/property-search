import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { resolveHiddenMatchingFilters, type SearchFilters } from "../shared";
import type { CommuteRule } from "@/components/Filters";

// ---------------------------------------------------------------------------
// GET/POST /api/listings/hidden/count
//
// Returns:
//   { total: number, matching: number | null }
//
// `total`    — count of all rows in `hidden_listings` for the current user.
// `matching` — count of those rows whose listing_id ALSO matches the supplied
//              filter set (price/beds/sources/etc). Computed only when a
//              `filters` payload is sent; otherwise null.
//
// Used by the empty-state "Reset" dropdown to decide whether to show the
// CTA at all (total > 0) and to label the "Unhide matching this filter"
// option with an accurate count.
// ---------------------------------------------------------------------------

interface RequestBody {
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

export async function GET() {
  return handle(null);
}

export async function POST(request: NextRequest) {
  let body: RequestBody | null = null;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    body = null;
  }
  return handle(body);
}

async function handle(body: RequestBody | null) {
  const cookieStore = await cookies();
  const supabase = createSupabase(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Total count of hidden listings for this user.
  const { data: hiddenRows, error: hiddenErr } = await supabase
    .from("hidden_listings")
    .select("listing_id")
    .eq("user_id", user.id);

  if (hiddenErr) {
    return NextResponse.json(
      { error: "Failed to count hidden listings", details: hiddenErr.message },
      { status: 500 },
    );
  }

  const hiddenIds = (hiddenRows ?? []).map((r) => r.listing_id);
  const total = hiddenIds.length;

  if (total === 0 || !body || !body.filters) {
    return NextResponse.json({ total, matching: null });
  }

  const matchingIds = await resolveHiddenMatchingFilters({
    hiddenIds,
    filters: body.filters,
    commuteRules: body.commuteRules ?? null,
  });

  if (matchingIds === null) {
    return NextResponse.json({ total, matching: null });
  }

  return NextResponse.json({ total, matching: matchingIds.length });
}
