import { NextRequest, NextResponse } from "next/server";
import {
  getTransitDuration,
  type DirectionsMode,
  type GoogleDirectionsStep,
} from "@/lib/google-directions";
import { getOrFetchCommute } from "@/lib/commute-cache";

const OTP_BASE_URL = process.env.OTP_BASE_URL ?? "http://localhost:9090";

// ---------------------------------------------------------------------------
// Public response types (kept identical to the prior OTP-based API so the
// client doesn't need to change).
// ---------------------------------------------------------------------------

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
// Mode normalization
// ---------------------------------------------------------------------------

/**
 * Accepts both the legacy OTP-style mode strings used by existing callers
 * (`WALK`, `TRANSIT,WALK`, `BICYCLE`, `CAR`) and the new lowercase Google-
 * style strings (`walking`, `transit`, `bicycling`, `driving`).
 */
function normalizeMode(raw: string | null): DirectionsMode {
  if (!raw) return "transit";
  const upper = raw.toUpperCase();
  if (upper === "WALK" || upper === "WALKING") return "walking";
  if (upper === "BICYCLE" || upper === "BICYCLING" || upper === "BIKE")
    return "bicycling";
  if (upper === "CAR" || upper === "DRIVING") return "driving";
  return "transit";
}

// ---------------------------------------------------------------------------
// Google steps → TripLeg[] transformer
// ---------------------------------------------------------------------------

function stripHtml(s: string | undefined): string {
  if (!s) return "";
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function transformGoogleSteps(
  steps: GoogleDirectionsStep[] | undefined,
  totalMinutes: number,
  mode: DirectionsMode,
): TripLeg[] {
  if (!steps || steps.length === 0) {
    return [
      {
        type: mode === "transit" ? "transit" : "walk",
        duration: totalMinutes,
        from: "Start",
        to: "Destination",
      },
    ];
  }

  const legs: TripLeg[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const minutes = Math.max(1, Math.round((s.duration?.value ?? 0) / 60));
    const distanceMeters = s.distance?.value;

    if (s.travel_mode === "WALKING") {
      const prevIsTransit =
        i > 0 && steps[i - 1].travel_mode === "TRANSIT";
      const nextIsTransit =
        i < steps.length - 1 && steps[i + 1].travel_mode === "TRANSIT";
      const isTransfer = prevIsTransit && nextIsTransit;
      legs.push({
        type: isTransfer ? "transfer" : "walk",
        duration: minutes,
        from: stripHtml(s.html_instructions) || "Walk",
        to: "",
        distance: distanceMeters,
      });
    } else if (s.travel_mode === "TRANSIT") {
      const td = s.transit_details;
      const route = td?.line?.short_name ?? td?.line?.name ?? undefined;
      const routeColor = td?.line?.color ?? undefined;
      legs.push({
        type: "transit",
        duration: minutes,
        from: td?.departure_stop?.name ?? "Stop",
        to: td?.arrival_stop?.name ?? "Stop",
        route,
        routeColor,
        stops: td?.num_stops ? Array(td.num_stops).fill("") : [],
        distance: distanceMeters,
      });
    } else {
      // Driving / Bicycling — represent as a single timed leg.
      legs.push({
        type: "walk",
        duration: minutes,
        from: stripHtml(s.html_instructions) || "Travel",
        to: "",
        distance: distanceMeters,
      });
    }
  }
  return legs;
}

// ---------------------------------------------------------------------------
// OTP fallback (only used if Google fails completely)
// ---------------------------------------------------------------------------

interface OTPLeg {
  mode: string;
  from: { name: string; lat: number; lon: number };
  to: { name: string; lat: number; lon: number };
  duration: number;
  route?: string;
  routeShortName?: string;
  routeLongName?: string;
  routeColor?: string;
  intermediateStops?: Array<{ name: string; lat: number; lon: number }>;
  startTime: number;
  endTime: number;
  distance?: number;
}
interface OTPItinerary {
  duration: number;
  legs: OTPLeg[];
}
interface OTPResponse {
  plan?: { itineraries: OTPItinerary[] };
  error?: { message: string };
}

function nextWeekday(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

function googleModeToOtp(mode: DirectionsMode): string {
  switch (mode) {
    case "walking":
      return "WALK";
    case "bicycling":
      return "BICYCLE";
    case "driving":
      return "CAR";
    case "transit":
    default:
      return "TRANSIT,WALK";
  }
}

function transformOtpItinerary(otp: OTPItinerary): TripItinerary {
  const legs: TripLeg[] = [];
  for (let i = 0; i < otp.legs.length; i++) {
    const leg = otp.legs[i];
    let type: TripLeg["type"] = leg.mode === "WALK" ? "walk" : "transit";
    if (
      type === "walk" &&
      i > 0 &&
      i < otp.legs.length - 1 &&
      otp.legs[i - 1].mode !== "WALK" &&
      otp.legs[i + 1].mode !== "WALK"
    ) {
      type = "transfer";
    }
    legs.push({
      type,
      duration: Math.round(leg.duration / 60),
      from: leg.from.name || "Current location",
      to: leg.to.name || "Destination",
      route: leg.routeShortName || leg.route || undefined,
      routeColor: leg.routeColor ? `#${leg.routeColor}` : undefined,
      stops: leg.intermediateStops?.map((s) => s.name) ?? [],
      distance: leg.distance ? Math.round(leg.distance) : undefined,
    });
  }
  return { totalDuration: Math.round(otp.duration / 60), legs };
}

async function tryOtpFallback(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  mode: DirectionsMode,
): Promise<TripItinerary | null> {
  const date = nextWeekday();
  // walkSpeed=2.5 calibrates OTP transit estimates against Google ground truth
  // for NYC routes (see commute-resolver.ts comment + otp-tuning report).
  const otpMode = googleModeToOtp(mode);
  const calibratedWalkSpeed = otpMode.includes("TRANSIT") ? "&walkSpeed=2.5" : "";
  const url =
    `${OTP_BASE_URL}/otp/routers/default/plan` +
    `?fromPlace=${fromLat},${fromLon}` +
    `&toPlace=${toLat},${toLon}` +
    `&mode=${encodeURIComponent(otpMode)}` +
    `&date=${date}` +
    `&time=09:00:00` +
    `&arriveBy=false` +
    `&numItineraries=3` +
    calibratedWalkSpeed;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data: OTPResponse = await res.json();
    const itins = data.plan?.itineraries ?? [];
    if (itins.length === 0) return null;
    const transit = itins.filter((it) =>
      it.legs.some((l) => l.mode !== "WALK"),
    );
    const best = transit.length > 0 ? transit[0] : itins[0];
    return transformOtpItinerary(best);
  } catch (err) {
    console.error(
      `[trip-plan] OTP fallback failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const fromLatRaw = params.get("fromLat");
  const fromLonRaw = params.get("fromLon");
  const toLatRaw = params.get("toLat");
  const toLonRaw = params.get("toLon");
  const listingIdRaw = params.get("listingId");
  const mode = normalizeMode(params.get("mode"));

  if (!fromLatRaw || !fromLonRaw || !toLatRaw || !toLonRaw) {
    return NextResponse.json(
      { error: "Missing required parameters: fromLat, fromLon, toLat, toLon" },
      { status: 400 },
    );
  }
  const fromLat = Number(fromLatRaw);
  const fromLon = Number(fromLonRaw);
  const toLat = Number(toLatRaw);
  const toLon = Number(toLonRaw);
  const listingId = listingIdRaw ? Number(listingIdRaw) : null;
  if (
    !Number.isFinite(fromLat) ||
    !Number.isFinite(fromLon) ||
    !Number.isFinite(toLat) ||
    !Number.isFinite(toLon)
  ) {
    return NextResponse.json(
      { error: "Invalid coordinate values" },
      { status: 400 },
    );
  }

  // Path A: cached lookup. Only used when caller passes ?summary=1&listingId=N
  // (useDestinationCommutes only needs totalDuration, so it opts in to keep
  // cache hits high). Returns a synthetic single-leg itinerary.
  const summaryOnly = params.get("summary") === "1";
  if (summaryOnly && listingId != null) {
    try {
      const cached = await getOrFetchCommute({
        listingId,
        listingLat: fromLat,
        listingLon: fromLon,
        destLat: toLat,
        destLon: toLon,
        mode,
      });
      if (cached) {
        const itinerary: TripItinerary = {
          totalDuration: cached.minutes,
          legs: [
            {
              type: mode === "transit" ? "transit" : "walk",
              duration: cached.minutes,
              from: "",
              to: "",
            },
          ],
        };
        return NextResponse.json(itinerary, {
          headers: {
            "Cache-Control":
              "public, s-maxage=300, stale-while-revalidate=600",
            "X-Commute-Source": cached.fromCache ? "cache" : "google",
          },
        });
      }
      // fall through to OTP if Google + cache both failed
    } catch (err) {
      console.error(
        `[trip-plan] cache path failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  } else {
    // Path B: full itinerary from Google for the rich CommuteItinerary UI.
    const result = await getTransitDuration({
      origin: { lat: fromLat, lon: fromLon },
      destination: { lat: toLat, lon: toLon },
      mode,
    });

    if (result) {
      const itinerary: TripItinerary = {
        totalDuration: result.minutes,
        legs: transformGoogleSteps(result.steps, result.minutes, mode),
      };

      // Best-effort: if listingId supplied, also populate the cache.
      if (listingId != null) {
        getOrFetchCommute({
          listingId,
          listingLat: fromLat,
          listingLon: fromLon,
          destLat: toLat,
          destLon: toLon,
          mode,
        }).catch(() => {
          /* noop */
        });
      }

      return NextResponse.json(itinerary, {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
          "X-Commute-Source": "google",
        },
      });
    }
  }

  // Path C: OTP fallback (defensive — should rarely trigger now).
  const otp = await tryOtpFallback(fromLat, fromLon, toLat, toLon, mode);
  if (otp) {
    return NextResponse.json(otp, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        "X-Commute-Source": "otp-fallback",
      },
    });
  }

  return NextResponse.json(
    { error: "Trip planning unavailable" },
    { status: 502 },
  );
}
