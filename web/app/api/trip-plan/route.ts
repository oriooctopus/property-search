import { NextRequest, NextResponse } from "next/server";

const OTP_BASE_URL = process.env.OTP_BASE_URL ?? "http://localhost:9090";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OTPLeg {
  mode: string;
  from: { name: string; lat: number; lon: number };
  to: { name: string; lat: number; lon: number };
  duration: number; // seconds
  route?: string;
  routeShortName?: string;
  routeLongName?: string;
  routeColor?: string;
  intermediateStops?: Array<{ name: string; lat: number; lon: number }>;
  startTime: number;
  endTime: number;
  distance?: number; // meters
}

interface OTPItinerary {
  duration: number; // seconds
  legs: OTPLeg[];
}

interface OTPResponse {
  plan?: {
    itineraries: OTPItinerary[];
  };
  error?: { message: string };
}

export interface TripLeg {
  type: "walk" | "transit" | "transfer";
  duration: number; // minutes
  from: string;
  to: string;
  route?: string;
  routeColor?: string;
  stops?: string[];
  distance?: number; // meters
}

export interface TripItinerary {
  totalDuration: number; // minutes
  legs: TripLeg[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the next weekday date string (YYYY-MM-DD). */
function nextWeekday(): string {
  const d = new Date();
  // Move to tomorrow first, then skip weekends
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

function classifyLeg(otp: OTPLeg): TripLeg["type"] {
  if (otp.mode === "WALK") return "walk";
  // OTP marks short walks between transit legs — if distance < 200m and
  // between two transit legs we could call it transfer, but the caller
  // doesn't give us context. We'll handle that in the transform.
  return "transit";
}

function transformItinerary(otp: OTPItinerary): TripItinerary {
  const legs: TripLeg[] = [];

  for (let i = 0; i < otp.legs.length; i++) {
    const leg = otp.legs[i];
    const legType = classifyLeg(leg);

    // Mark short walks between transit legs as transfers
    let finalType = legType;
    if (
      legType === "walk" &&
      i > 0 &&
      i < otp.legs.length - 1 &&
      classifyLeg(otp.legs[i - 1]) === "transit" &&
      classifyLeg(otp.legs[i + 1]) === "transit"
    ) {
      finalType = "transfer";
    }

    legs.push({
      type: finalType,
      duration: Math.round(leg.duration / 60),
      from: leg.from.name || "Current location",
      to: leg.to.name || "Destination",
      route: leg.routeShortName || leg.route || undefined,
      routeColor: leg.routeColor ? `#${leg.routeColor}` : undefined,
      stops: leg.intermediateStops?.map((s) => s.name) ?? [],
      distance: leg.distance ? Math.round(leg.distance) : undefined,
    });
  }

  return {
    totalDuration: Math.round(otp.duration / 60),
    legs,
  };
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const fromLat = params.get("fromLat");
  const fromLon = params.get("fromLon");
  const toLat = params.get("toLat");
  const toLon = params.get("toLon");
  const mode = params.get("mode") || "TRANSIT,WALK";

  if (!fromLat || !fromLon || !toLat || !toLon) {
    return NextResponse.json(
      { error: "Missing required parameters: fromLat, fromLon, toLat, toLon" },
      { status: 400 },
    );
  }

  const date = nextWeekday();
  const url =
    `${OTP_BASE_URL}/otp/routers/default/plan` +
    `?fromPlace=${fromLat},${fromLon}` +
    `&toPlace=${toLat},${toLon}` +
    `&mode=${encodeURIComponent(mode)}` +
    `&date=${date}` +
    `&time=09:00:00` +
    `&arriveBy=false` +
    `&numItineraries=3`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) {
      const body = await response.text().catch(() => "(no body)");
      console.error(`[trip-plan] OTP returned ${response.status}: ${body}`);
      return NextResponse.json(
        { error: "Trip planning service unavailable" },
        { status: 502 },
      );
    }

    const data: OTPResponse = await response.json();

    // OTP sometimes returns both an error (e.g. TOO_CLOSE) AND valid itineraries.
    // Only treat it as a hard failure if there are no itineraries at all.
    if (data.error && (!data.plan?.itineraries || data.plan.itineraries.length === 0)) {
      console.error("[trip-plan] OTP error:", data.error.message);
      return NextResponse.json(
        { error: data.error.message },
        { status: 502 },
      );
    }

    if (!data.plan || !data.plan.itineraries || data.plan.itineraries.length === 0) {
      return NextResponse.json(
        { error: "No itineraries found" },
        { status: 404 },
      );
    }

    // Prefer transit itineraries over walk-only ones
    const transitItineraries = data.plan.itineraries.filter((it) =>
      it.legs.some((l) => l.mode !== "WALK"),
    );
    const best =
      transitItineraries.length > 0
        ? transitItineraries[0]
        : data.plan.itineraries[0];

    const itinerary = transformItinerary(best);

    return NextResponse.json(itinerary, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("aborted") || msg.includes("AbortError")) {
      console.error("[trip-plan] OTP request timed out");
      return NextResponse.json({ error: "Trip planning request timed out" }, { status: 504 });
    }
    console.error("[trip-plan] Error:", msg);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
