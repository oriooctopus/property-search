import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

interface ChatRequestBody {
  conversationId?: string;
  message: string;
  currentFilters: Record<string, unknown>;
}

const SYSTEM_PROMPT = `You are Dwelligence, an AI assistant that helps users search for rental apartments. Your job is to understand what the user is looking for and translate their preferences into search filters.

Available filters you can set:
- searchTag: one of "all", "fulton", "ltrain", "manhattan", "brooklyn" — these are preset geographic search areas
  - "all": all listings, no location filter
  - "fulton": listings near Fulton St station in Lower Manhattan (within 25-min transit)
  - "ltrain": listings near L train stops from Bedford Ave through DeKalb Ave (within 10-min walk)
  - "manhattan": Manhattan listings between Park Place (Tribeca) and 38th St (Midtown)
  - "brooklyn": Brooklyn listings within 35-min subway ride of 14th St
- minBeds: minimum number of bedrooms (integer, e.g. 1, 2, 3)
- minBaths: minimum number of bathrooms (integer, e.g. 1, 2)
- minRent: minimum monthly rent in dollars (integer)
- maxRent: maximum monthly rent in dollars (integer)
- maxPricePerBed: maximum price per bedroom in dollars (integer)
- sort: one of "pricePerBed", "price", "beds", "listDate"
- maxListingAge: one of "1w", "2w", "1m", "3m", "6m", "1y", or null for no limit — how recently the listing was posted

When the user describes what they want, respond conversationally AND extract any filter updates.

You MUST respond with valid JSON in this exact format:
{
  "reply": "Your conversational response to the user",
  "filterUpdates": { ... only include filters that should change ... },
  "extractedCriteria": [
    { "label": "human-readable description", "filterKey": "the filter key", "filterValue": "the value set" }
  ]
}

Rules:
- Only include filters in filterUpdates that the user explicitly or implicitly mentioned
- If the user says "reset" or "clear", set filterUpdates to have null values for all filters
- Be helpful and confirm what filters you're applying
- If the user's request is ambiguous, ask clarifying questions and don't change filters
- extractedCriteria should list each filter change you're making in a user-friendly way
- Always respond with valid JSON, nothing else`;

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

  // 2. Parse request body
  let body: ChatRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { message, currentFilters } = body;
  let { conversationId } = body;

  if (!message || typeof message !== "string") {
    return NextResponse.json(
      { error: "message is required" },
      { status: 400 },
    );
  }

  if (message.length > 5000) {
    return NextResponse.json(
      { error: "Message too long (max 5000 characters)" },
      { status: 400 },
    );
  }

  // 3. Check for Anthropic API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 },
    );
  }

  // 4. Create conversation if needed
  if (!conversationId) {
    const { data: newConv, error: convError } = await supabase
      .from("conversations")
      .insert({
        user_id: user.id,
        filters: currentFilters ?? {},
      })
      .select("id")
      .single();

    if (convError || !newConv) {
      return NextResponse.json(
        { error: "Failed to create conversation", details: convError?.message },
        { status: 500 },
      );
    }

    conversationId = newConv.id;
  }

  // 5. Fetch conversation history (last 20 messages)
  const { data: history } = await supabase
    .from("conversation_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(20);

  const messages: { role: "user" | "assistant"; content: string }[] = (
    history ?? []
  )
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  // Add the new user message
  messages.push({ role: "user", content: message });

  // 6. Call Claude API
  const anthropic = new Anthropic({ apiKey });

  let assistantContent: string;
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: `${SYSTEM_PROMPT}\n\nThe user's current filters are: ${JSON.stringify(currentFilters ?? {})}`,
      messages,
    });

    const textBlock = response.content.find((block) => block.type === "text");
    assistantContent = textBlock?.text ?? "";
  } catch (err: unknown) {
    const errMsg =
      err instanceof Error ? err.message : "Unknown error calling Claude API";
    return NextResponse.json(
      { error: "Failed to call Claude API", details: errMsg },
      { status: 502 },
    );
  }

  // 7. Parse Claude's response
  let parsed: {
    reply: string;
    filterUpdates: Record<string, unknown>;
    extractedCriteria: { label: string; filterKey: string; filterValue: unknown }[];
  };

  try {
    // Try to extract JSON from the response (handle markdown code blocks)
    let jsonStr = assistantContent;
    const jsonMatch = assistantContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    parsed = JSON.parse(jsonStr);
  } catch {
    // If parsing fails, treat the whole response as a reply with no filter changes
    parsed = {
      reply: assistantContent,
      filterUpdates: {},
      extractedCriteria: [],
    };
  }

  // 8. Save user message and assistant response
  const messagesToInsert = [
    {
      conversation_id: conversationId,
      role: "user",
      content: message,
    },
    {
      conversation_id: conversationId,
      role: "assistant",
      content: parsed.reply,
      parsed_filters: parsed.filterUpdates,
    },
  ];

  const { error: insertError } = await supabase.from("conversation_messages").insert(messagesToInsert);

  if (insertError) {
    return NextResponse.json(
      { error: "Failed to save messages", details: insertError.message },
      { status: 500 },
    );
  }

  // 9. Merge filters and update conversation
  const mergedFilters = { ...(currentFilters ?? {}), ...parsed.filterUpdates };

  // Remove null values from merged filters (null means "clear this filter")
  for (const key of Object.keys(mergedFilters)) {
    if (mergedFilters[key] === null) {
      delete mergedFilters[key];
    }
  }

  const { error: updateError } = await supabase
    .from("conversations")
    .update({
      filters: mergedFilters,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId);

  if (updateError) {
    return NextResponse.json(
      { error: "Failed to update conversation", details: updateError.message },
      { status: 500 },
    );
  }

  // 10. Return response
  return NextResponse.json({
    conversationId,
    reply: parsed.reply,
    filterUpdates: parsed.filterUpdates,
    extractedCriteria: parsed.extractedCriteria,
    mergedFilters,
  });
}
