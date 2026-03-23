import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { data: sessionData } =
      await supabase.auth.exchangeCodeForSession(code);

    // Check if user has a complete profile (display_name at minimum)
    if (sessionData?.user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", sessionData.user.id)
        .single();

      if (!profile?.display_name) {
        return NextResponse.redirect(`${origin}/profile?setup=true`);
      }
    }
  }

  return NextResponse.redirect(origin);
}
