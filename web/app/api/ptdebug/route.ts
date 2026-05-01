import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";

// ---------------------------------------------------------------------------
// /api/ptdebug — pointer-event capture endpoint for iOS Safari diagnosis.
//
// The client (PointerDebugger.tsx, mounted only when ?ptdebug=1 is in the
// URL) batches pointer/touch events from a real device and POSTs them here.
// We persist to ptdebug_sessions so we can later compare real-iOS event
// streams against the synthetic CDP streams our verify agents produce.
//
// GET ?session=<id> returns the stored events for that session. No auth —
// the table is small and ephemeral; if abuse becomes a concern, gate behind
// an env-var-based shared secret.
// ---------------------------------------------------------------------------

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("ptdebug: missing supabase env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  }
  return createClient<Database>(url, key);
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "expected object body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const sessionId = typeof b.sessionId === "string" ? b.sessionId : null;
  const userAgent = typeof b.userAgent === "string" ? b.userAgent : null;
  const events = Array.isArray(b.events) ? b.events : null;
  const viewportW = typeof b.viewportW === "number" ? b.viewportW : null;
  const viewportH = typeof b.viewportH === "number" ? b.viewportH : null;
  const note = typeof b.note === "string" ? b.note.slice(0, 500) : null;

  if (!sessionId || !events || events.length === 0) {
    return NextResponse.json({ error: "sessionId + events[] required" }, { status: 400 });
  }
  if (events.length > 5000) {
    return NextResponse.json({ error: "too many events in single batch (max 5000)" }, { status: 413 });
  }

  try {
    const sb = client();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (sb.from("ptdebug_sessions") as any).insert({
      session_id: sessionId,
      user_agent: userAgent,
      viewport_w: viewportW,
      viewport_h: viewportH,
      events,
      note,
    });
    if (error) {
      return NextResponse.json(
        { error: error.message, hint: "apply web/supabase/migrations/ptdebug_sessions.sql" },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, sessionId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 500);

  try {
    const sb = client();
    if (sessionId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (sb.from("ptdebug_sessions") as any)
        .select("id, session_id, created_at, user_agent, viewport_w, viewport_h, events, note")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ sessionId, batches: data ?? [] });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (sb.from("ptdebug_sessions") as any)
      .select("id, session_id, created_at, user_agent, viewport_w, viewport_h, note")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ recent: data ?? [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
