import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import {
  MAX_RECENT_SEARCHES,
  validateRecentSearchInput,
  type RecentSearch,
  type RecentSearchKind,
} from "@/lib/recent-searches";
import type { Database } from "@/lib/types";

// Row shape as selected from the DB (every route below selects exactly these
// columns, omitting user_id) — mapped to the camelCase `RecentSearch` API
// contract below. `kind` is typed as `string` in the generated Database type
// (Supabase doesn't model the CHECK constraint's literal union), so it's
// narrowed in toApiShape — the DB CHECK constraint is what actually
// guarantees only these two values exist.
type Row = Pick<
  Database["public"]["Tables"]["recent_searches"]["Row"],
  "id" | "label" | "sublabel" | "lat" | "lon" | "kind" | "created_at"
>;

function toApiShape(row: Row): RecentSearch {
  return {
    id: row.id,
    label: row.label,
    sublabel: row.sublabel,
    lat: row.lat,
    lon: row.lon,
    kind: row.kind as RecentSearchKind,
    createdAt: row.created_at,
  };
}

/**
 * GET /api/recent-searches
 *
 * The search box is shown to signed-out users too, so "no session" is not an
 * error here — it must resolve the same way an empty list does (200, empty
 * array), never 401. The UI has no branch for "recents endpoint errored".
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ recents: [] });
  }

  const { data, error } = await supabase
    .from("recent_searches")
    .select("id, label, sublabel, lat, lon, kind, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(MAX_RECENT_SEARCHES);

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch recent searches", details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ recents: (data ?? []).map(toApiShape) });
}

/**
 * POST /api/recent-searches
 *
 * Upserts on (user_id, label) so re-searching the same place bumps it to the
 * top instead of creating a duplicate row — `created_at` is set explicitly in
 * the payload because the column's `default now()` only fires on INSERT, not
 * on the UPDATE half of an upsert.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Same "don't error on signed-out" contract as GET: no write, no 401.
    return NextResponse.json({ recent: null });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validated = validateRecentSearchInput(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const { label, sublabel, lat, lon, kind } = validated.value;

  const { data, error } = await supabase
    .from("recent_searches")
    .upsert(
      {
        user_id: user.id,
        label,
        sublabel,
        lat,
        lon,
        kind,
        created_at: new Date().toISOString(),
      },
      { onConflict: "user_id,label" },
    )
    .select("id, label, sublabel, lat, lon, kind, created_at")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to save recent search", details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ recent: toApiShape(data) });
}

/**
 * DELETE /api/recent-searches?id=<uuid>
 *
 * Scoped by both `id` and `user_id` in the query — RLS already enforces this
 * server-side, but the explicit `.eq("user_id", ...)` keeps the intent
 * readable and means the query returns 0 rows (not an RLS error) for someone
 * else's id, which is indistinguishable from a not-found id — both are
 * correctly reported back as `{ ok: true }`.
 */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: true });
  }

  const id = request.nextUrl.searchParams.get("id");
  // A malformed id can never match a row (uuid column), but without this
  // check Postgres rejects the query with "invalid input syntax for uuid"
  // and the route would leak that as an opaque 500 instead of a clean 400.
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });
  }

  const { error } = await supabase
    .from("recent_searches")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json(
      { error: "Failed to delete recent search", details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
