import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
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

  const { data: conversations, error } = await supabase
    .from("conversations")
    .select("id, name, filters, is_saved, created_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch conversations", details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ conversations });
}

export async function POST(request: NextRequest) {
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

  let body: { name?: string; filters?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const { data: conversation, error } = await supabase
    .from("conversations")
    .insert({
      user_id: user.id,
      name: body.name ?? null,
      filters: body.filters ?? {},
    })
    .select("id, name, filters, is_saved, created_at, updated_at")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to create conversation", details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ conversation }, { status: 201 });
}
