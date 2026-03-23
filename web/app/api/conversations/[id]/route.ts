import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

async function getSupabaseClient() {
  const cookieStore = await cookies();
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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await getSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch conversation (RLS ensures only owner can access)
  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .select("id, name, filters, is_saved, created_at, updated_at")
    .eq("id", id)
    .single();

  if (convError || !conversation) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 },
    );
  }

  // Fetch messages
  const { data: messages, error: msgError } = await supabase
    .from("conversation_messages")
    .select("id, role, content, parsed_filters, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  if (msgError) {
    return NextResponse.json(
      { error: "Failed to fetch messages", details: msgError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ conversation, messages: messages ?? [] });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await getSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { name?: string; is_saved?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (body.name !== undefined) updates.name = body.name;
  if (body.is_saved !== undefined) updates.is_saved = body.is_saved;

  const { data: conversation, error } = await supabase
    .from("conversations")
    .update(updates)
    .eq("id", id)
    .select("id, name, filters, is_saved, created_at, updated_at")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to update conversation", details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ conversation });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await getSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("conversations")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json(
      { error: "Failed to delete conversation", details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
