import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import type { CommuteRule } from "@/components/Filters";
import SUBWAY_STATIONS from "@/lib/isochrone/subway-stations";

const OTP_BASE_URL = process.env.OTP_BASE_URL ?? "http://localhost:9090";

// ---------------------------------------------------------------------------
// Supabase admin client (service role for reading isochrones)
// ---------------------------------------------------------------------------

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Use service role key if available, otherwise fall back to anon key
  // (isochrones and listing_isochrones tables have public read RLS policies)
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_ANON_KEY");
  }
  return createClient(url, key);
}

// ---------------------------------------------------------------------------
// Station lookup helpers
// ---------------------------------------------------------------------------

/** Get all station names that serve any of the given lines */
function getStationNamesForLines(lines: string[]): string[] {
  const lineSet = new Set(lines);
  return SUBWAY_STATIONS.filter((s) => s.lines.some((l) => lineSet.has(l))).map(
    (s) => s.name,
  );
}

// ---------------------------------------------------------------------------
// Per-rule resolvers — each returns a Set<number> of matching listing IDs
// ---------------------------------------------------------------------------

async function resolveSubwayLineRule(
  supabase: ReturnType<typeof getClient>,
  rule: CommuteRule,
): Promise<Set<number> | null> {
  // Determine which station names to query
  let stationNames: string[];

  if (rule.stops && rule.stops.length > 0) {
    // User selected specific stops — these are station names
    stationNames = rule.stops;
  } else if (rule.lines && rule.lines.length > 0) {
    // All stations on the selected lines
    stationNames = getStationNamesForLines(rule.lines);
  } else {
    // No lines or stops specified — can't filter
    return null;
  }

  if (stationNames.length === 0) return null;

  // Map travel mode from rule to DB convention
  const travelMode = rule.mode === "walk" ? "walk" : rule.mode === "bike" ? "bicycle" : "transit";

  // Query isochrones table for matching station origins with cutoff <= maxMinutes
  const { data: isoRows, error: isoError } = await supabase
    .from("isochrones")
    .select("id")
    .in("origin_name", stationNames)
    .ilike("travel_mode", travelMode)
    .lte("cutoff_minutes", rule.maxMinutes);

  if (isoError) {
    console.error("[commute-filter] isochrones query failed:", isoError.message);
    return null;
  }

  if (!isoRows || isoRows.length === 0) {
    // No isochrones for this mode/stations — return empty set (no matches)
    return new Set<number>();
  }

  const isochroneIds = isoRows.map((r) => r.id);

  // Get all listing IDs that fall within those isochrones
  const { data: listingRows, error: listingError } = await supabase
    .from("listing_isochrones")
    .select("listing_id")
    .in("isochrone_id", isochroneIds);

  if (listingError) {
    console.error("[commute-filter] listing_isochrones query failed:", listingError.message);
    return null;
  }

  if (!listingRows || listingRows.length === 0) {
    return new Set<number>();
  }

  return new Set(listingRows.map((r) => r.listing_id as number));
}

async function resolveStationRule(
  supabase: ReturnType<typeof getClient>,
  rule: CommuteRule,
): Promise<Set<number> | null> {
  // A station rule works like a subway-line rule but for a single station
  if (!rule.stops || rule.stops.length === 0) return null;

  const travelMode = rule.mode === "walk" ? "walk" : rule.mode === "bike" ? "bicycle" : "transit";

  const { data: isoRows, error: isoError } = await supabase
    .from("isochrones")
    .select("id")
    .in("origin_name", rule.stops)
    .ilike("travel_mode", travelMode)
    .lte("cutoff_minutes", rule.maxMinutes);

  if (isoError) {
    console.error("[commute-filter] station isochrones query failed:", isoError.message);
    return null;
  }

  if (!isoRows || isoRows.length === 0) {
    // No isochrones for this mode/stations — return empty set (no matches)
    return new Set<number>();
  }

  const { data: listingRows, error: listingError } = await supabase
    .from("listing_isochrones")
    .select("listing_id")
    .in("isochrone_id", isoRows.map((r) => r.id));

  if (listingError) {
    console.error("[commute-filter] station listing_isochrones query failed:", listingError.message);
    return null;
  }

  if (!listingRows || listingRows.length === 0) return new Set<number>();

  return new Set(listingRows.map((r) => r.listing_id as number));
}

// ---------------------------------------------------------------------------
// Address rule helpers
// ---------------------------------------------------------------------------

/** Returns the next weekday date string (YYYY-MM-DD) from today. */
function nextWeekday(): string {
  const d = new Date();
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

/** Map CommuteRule mode to OTP mode string. */
function otpMode(mode: string): string {
  switch (mode) {
    case "walk": return "WALK";
    case "transit": return "TRANSIT";
    case "bike": return "BICYCLE";
    default: return "WALK";
  }
}

async function resolveAddressRule(
  supabase: ReturnType<typeof getClient>,
  rule: CommuteRule,
): Promise<Set<number> | null> {
  // Need lat/lon from autocomplete selection
  if (!rule.addressLat || !rule.addressLon) {
    console.log("[commute-filter] Address rule missing lat/lon, skipping");
    return null;
  }

  // Build OTP TravelTime isochrone URL
  const date = nextWeekday();
  const isoTime = `${date}T09:00:00-04:00`;
  const url =
    `${OTP_BASE_URL}/otp/traveltime/isochrone` +
    `?location=${rule.addressLat},${rule.addressLon}` +
    `&modes=${otpMode(rule.mode)}` +
    `&time=${encodeURIComponent(isoTime)}` +
    // Add 15% buffer to transit times — OTP uses worst-case wait times
    // while users expect Google-like optimistic estimates
    `&cutoff=PT${rule.mode === "transit" ? Math.ceil(rule.maxMinutes * 1.15) : rule.maxMinutes}M`;

  // Fetch isochrone polygon from OTP
  let geojson: { type: string; features: Array<{ geometry: object }> };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) {
      const body = await response.text().catch(() => "(no body)");
      console.error(`[commute-filter] OTP returned ${response.status}: ${body}`);
      return null;
    }

    geojson = await response.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
      console.error("[commute-filter] OTP not running, skipping address rule");
    } else {
      console.error("[commute-filter] OTP fetch error:", msg);
    }
    return null;
  }

  if (
    !geojson ||
    geojson.type !== "FeatureCollection" ||
    !Array.isArray(geojson.features) ||
    geojson.features.length === 0
  ) {
    console.log("[commute-filter] OTP returned empty polygon for address rule");
    return new Set<number>();
  }

  // Use the first feature's geometry as the isochrone polygon
  const polygonJson = JSON.stringify(geojson.features[0].geometry);

  // Query listings within the polygon using PostGIS RPC
  const { data, error } = await supabase.rpc("listings_in_polygon", {
    polygon_geojson: polygonJson,
  });

  if (error) {
    console.error("[commute-filter] listings_in_polygon RPC failed:", error.message);
    return null;
  }

  if (!data || data.length === 0) return new Set<number>();

  return new Set((data as Array<{ id: number }>).map((r) => r.id));
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const { commuteRules } = (await request.json()) as {
      commuteRules: CommuteRule[];
    };

    if (!commuteRules || commuteRules.length === 0) {
      return NextResponse.json({ listingIds: null, message: "No commute rules provided" });
    }

    const supabase = getClient();

    // Resolve each rule to a set of matching listing IDs
    const ruleSets: Array<Set<number> | null> = [];

    for (const rule of commuteRules) {
      let result: Set<number> | null = null;

      switch (rule.type) {
        case "subway-line":
          result = await resolveSubwayLineRule(supabase, rule);
          break;

        case "station":
          result = await resolveStationRule(supabase, rule);
          break;

        case "address":
          result = await resolveAddressRule(supabase, rule);
          break;

        case "park":
          // TODO: Park isochrones haven't been generated yet — return null for now
          console.log("[commute-filter] Park rule not yet implemented, skipping");
          result = null;
          break;
      }

      ruleSets.push(result);
    }

    // Filter out null results (rules that couldn't be resolved)
    const validSets = ruleSets.filter((s): s is Set<number> => s !== null);

    if (validSets.length === 0) {
      // Check if any rules were implemented types (subway-line / station)
      const hasImplementedRule = commuteRules.some(
        (r) => r.type === "subway-line" || r.type === "station" || r.type === "address",
      );
      if (hasImplementedRule) {
        // Implemented rules all returned null (shouldn't happen after empty-set fix, but be safe)
        return NextResponse.json({
          listingIds: [],
          message: "No listings match your commute filters",
        });
      }
      // Only unimplemented types (address/park) — pass through
      return NextResponse.json({
        listingIds: null,
        message: "Commute data not available yet — showing all listings",
      });
    }

    // AND logic: intersect all valid sets
    let intersection = validSets[0];
    for (let i = 1; i < validSets.length; i++) {
      const next = validSets[i];
      intersection = new Set([...intersection].filter((id) => next.has(id)));
    }

    return NextResponse.json({
      listingIds: [...intersection],
      message: null,
    });
  } catch (err) {
    console.error("[commute-filter] Error:", err);
    return NextResponse.json(
      { listingIds: null, message: "Internal error processing commute filter" },
      { status: 500 },
    );
  }
}
