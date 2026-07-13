import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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

  const numericId = Number(id);
  if (!Number.isFinite(numericId)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const { error } = await supabase
    .from("saved_searches")
    .delete()
    .eq("id", numericId)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json(
      { error: "Failed to delete saved search", details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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

  const numericId = Number(id);
  if (!Number.isFinite(numericId)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const body = await request.json();
  const { name, filters, is_default } = body;

  // PATCH supports renaming (name), updating the filter snapshot (filters),
  // and/or setting the default flag (is_default), in any combination.
  // Reject the request if none are present so we don't issue an empty UPDATE.
  const hasName = typeof name === "string" && name.trim().length > 0;
  const hasFilters =
    filters !== undefined && filters !== null && typeof filters === "object";
  const hasIsDefault = typeof is_default === "boolean";
  if (!hasName && !hasFilters && !hasIsDefault) {
    return NextResponse.json(
      { error: "Provide name, filters, and/or is_default" },
      { status: 400 },
    );
  }

  // Setting is_default = true must first clear any existing default for this
  // user — the partial unique index on (user_id) where is_default rejects
  // two true rows existing simultaneously, even transiently, so the clear
  // has to land in its own statement before the target row is set true.
  if (hasIsDefault && is_default) {
    const { error: clearError } = await supabase
      .from("saved_searches")
      .update({ is_default: false })
      .eq("user_id", user.id)
      .eq("is_default", true);

    if (clearError) {
      return NextResponse.json(
        {
          error: "Failed to clear previous default saved search",
          details: clearError.message,
        },
        { status: 500 },
      );
    }
  }

  const updatePayload: {
    name?: string;
    filters?: Record<string, unknown>;
    is_default?: boolean;
  } = {};
  if (hasName) updatePayload.name = name.trim();
  if (hasFilters) updatePayload.filters = filters as Record<string, unknown>;
  if (hasIsDefault) updatePayload.is_default = is_default;

  const { error } = await supabase
    .from("saved_searches")
    .update(updatePayload)
    .eq("id", numericId)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json(
      { error: "Failed to update saved search", details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
