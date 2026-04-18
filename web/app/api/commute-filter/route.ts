import { NextRequest, NextResponse } from "next/server";
import type { CommuteRule } from "@/components/Filters";
import { resolveCommuteRules } from "@/lib/commute-resolver";

// ---------------------------------------------------------------------------
// POST handler — standalone endpoint that returns only commute-match IDs.
// The main listing-search path uses /api/listings/search which applies
// commute filters alongside price/beds/bounds in a single round-trip.
// This endpoint is retained for any caller that wants commute IDs only.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const { commuteRules } = (await request.json()) as {
      commuteRules: CommuteRule[];
    };

    if (!commuteRules || commuteRules.length === 0) {
      return NextResponse.json({ listingIds: null, message: "No commute rules provided" });
    }

    const resolved = await resolveCommuteRules(commuteRules);

    if (resolved.ids === null) {
      return NextResponse.json({
        listingIds: null,
        commuteInfo: null,
        message: resolved.message,
      });
    }

    return NextResponse.json({
      listingIds: [...resolved.ids],
      commuteInfo: resolved.meta,
      message: resolved.message,
    });
  } catch (err) {
    console.error("[commute-filter] Error:", err);
    return NextResponse.json(
      { listingIds: null, message: "Internal error processing commute filter" },
      { status: 500 },
    );
  }
}
