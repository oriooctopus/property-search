// Shared commute-rule resolver used by /api/commute-filter and
// /api/listings/search. Resolves a list of CommuteRule objects against the
// `isochrones` + `listing_isochrones` tables (and falls back to OTP-generated
// polygons for address/park rules), returning an intersection of matching
// listing IDs plus per-listing metadata.

import { createClient } from "@supabase/supabase-js";
import type { CommuteRule } from "@/components/Filters";
import SUBWAY_STATIONS from "@/lib/isochrone/subway-stations";
import { PARK_COORDS } from "@/lib/park-coords";

const OTP_BASE_URL = process.env.OTP_BASE_URL ?? "http://localhost:9090";

// Use an untyped client here — we query tables/RPC functions (isochrones,
// listing_isochrones, listings_in_polygon) that aren't always present in the
// generated Database type, so let Supabase infer response shapes loosely.
/* eslint-disable @typescript-eslint/no-explicit-any */
type SupabaseClient = any;

export interface ListingCommuteMeta {
  minutes: number;
  station: string;
  mode: string;
}

export interface RuleResult {
  ids: Set<number>;
  meta: Record<number, ListingCommuteMeta>;
}

export interface ResolvedCommute {
  /** null means "no commute filter applied" (pass through all listings) */
  ids: Set<number> | null;
  meta: Record<number, ListingCommuteMeta>;
  message: string | null;
}

/** Build a service-role or anon Supabase client for server-side use. */
export function getCommuteClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_ANON_KEY");
  }
  return createClient(url, key);
}

/** Get all station names that serve any of the given lines. */
function getStationNamesForLines(lines: string[]): string[] {
  const lineSet = new Set(lines);
  return SUBWAY_STATIONS.filter((s) => s.lines.some((l) => lineSet.has(l))).map(
    (s) => s.name,
  );
}

async function resolveStationNameRule(
  supabase: SupabaseClient,
  stationNames: string[],
  rule: CommuteRule,
): Promise<RuleResult | null> {
  if (stationNames.length === 0) return null;

  const travelMode = rule.mode === "walk" ? "walk" : rule.mode === "bike" ? "bicycle" : "transit";

  const { data: isoRows, error: isoError } = await supabase
    .from("isochrones")
    .select("id, cutoff_minutes, origin_name")
    .in("origin_name", stationNames)
    .ilike("travel_mode", travelMode)
    .lte("cutoff_minutes", rule.maxMinutes);

  if (isoError) {
    console.error("[commute-resolver] isochrones query failed:", isoError.message);
    return null;
  }

  if (!isoRows || isoRows.length === 0) {
    return { ids: new Set<number>(), meta: {} };
  }

  const isoMeta = new Map<number, { cutoff: number; station: string }>();
  for (const r of isoRows) {
    isoMeta.set(r.id as number, {
      cutoff: r.cutoff_minutes as number,
      station: r.origin_name as string,
    });
  }

  const isochroneIds = isoRows.map((r: { id: number }) => r.id as number);

  // Batch through the IN() clause to avoid limit, then page each batch to
  // work around PostgREST's 1000-row cap.
  const allListingIds = new Set<number>();
  const meta: Record<number, ListingCommuteMeta> = {};
  const BATCH_SIZE = 200;
  const PAGE_SIZE = 1000;
  for (let i = 0; i < isochroneIds.length; i += BATCH_SIZE) {
    const batch = isochroneIds.slice(i, i + BATCH_SIZE);
    for (let page = 0; page < 200; page++) {
      const { data: pageRows, error: listingError } = await supabase
        .from("listing_isochrones")
        .select("listing_id, isochrone_id")
        .in("isochrone_id", batch)
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (listingError) {
        console.error("[commute-resolver] listing_isochrones query failed:", listingError.message);
        return null;
      }
      if (!pageRows || pageRows.length === 0) break;
      for (const r of pageRows as Array<{ listing_id: number; isochrone_id: number }>) {
        const listingId = r.listing_id as number;
        const isoId = r.isochrone_id as number;
        allListingIds.add(listingId);
        const isoInfo = isoMeta.get(isoId);
        if (isoInfo) {
          const existing = meta[listingId];
          if (!existing || isoInfo.cutoff < existing.minutes) {
            meta[listingId] = {
              minutes: isoInfo.cutoff,
              station: isoInfo.station,
              mode: rule.mode,
            };
          }
        }
      }
      if (pageRows.length < PAGE_SIZE) break;
    }
  }

  if (allListingIds.size === 0) return { ids: new Set<number>(), meta: {} };
  return { ids: allListingIds, meta };
}

async function resolveSubwayLineRule(
  supabase: SupabaseClient,
  rule: CommuteRule,
): Promise<RuleResult | null> {
  let stationNames: string[];
  if (rule.stops && rule.stops.length > 0) {
    stationNames = rule.stops;
  } else if (rule.lines && rule.lines.length > 0) {
    stationNames = getStationNamesForLines(rule.lines);
  } else {
    return null;
  }
  return resolveStationNameRule(supabase, stationNames, rule);
}

async function resolveStationRule(
  supabase: SupabaseClient,
  rule: CommuteRule,
): Promise<RuleResult | null> {
  const stationNames: string[] = rule.stops && rule.stops.length > 0
    ? rule.stops
    : rule.stationName
      ? [rule.stationName]
      : [];
  return resolveStationNameRule(supabase, stationNames, rule);
}

/** Returns the next weekday date string (YYYY-MM-DD) from today. */
function nextWeekday(): string {
  const d = new Date();
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

function otpMode(mode: string): string {
  switch (mode) {
    case "walk": return "WALK";
    case "transit": return "TRANSIT";
    case "bike": return "BICYCLE";
    default: return "WALK";
  }
}

async function resolveOtpIsochroneRule(
  supabase: SupabaseClient,
  lat: number,
  lon: number,
  rule: CommuteRule,
  destinationLabel: string,
): Promise<RuleResult | null> {
  const date = nextWeekday();
  const isoTime = `${date}T09:00:00-04:00`;
  const url =
    `${OTP_BASE_URL}/otp/traveltime/isochrone` +
    `?location=${lat},${lon}` +
    `&modes=${otpMode(rule.mode)}` +
    `&time=${encodeURIComponent(isoTime)}` +
    `&cutoff=PT${rule.mode === "transit" ? Math.ceil(rule.maxMinutes * 1.15) : rule.maxMinutes}M`;

  let geojson: { type: string; features: Array<{ geometry: object }> };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) {
      const body = await response.text().catch(() => "(no body)");
      console.error(`[commute-resolver] OTP returned ${response.status}: ${body}`);
      return null;
    }

    geojson = await response.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
      console.error("[commute-resolver] OTP not running, skipping rule");
    } else {
      console.error("[commute-resolver] OTP fetch error:", msg);
    }
    return null;
  }

  if (
    !geojson ||
    geojson.type !== "FeatureCollection" ||
    !Array.isArray(geojson.features) ||
    geojson.features.length === 0
  ) {
    return { ids: new Set<number>(), meta: {} };
  }

  const polygonJson = JSON.stringify(geojson.features[0].geometry);

  const { data, error } = await supabase.rpc("listings_in_polygon", {
    polygon_geojson: polygonJson,
  });

  if (error) {
    console.error("[commute-resolver] listings_in_polygon RPC failed:", error.message);
    return null;
  }

  const firstPage = new Set((data as Array<{ id: number }> ?? []).map((r) => r.id));

  if (firstPage.size === 1000) {
    for (let page = 1; page < 20; page++) {
      const { data: moreData, error: moreError } = await supabase.rpc("listings_in_polygon", {
        polygon_geojson: polygonJson,
      }).range(page * 1000, (page + 1) * 1000 - 1);
      if (moreError || !moreData || moreData.length === 0) break;
      for (const r of moreData as Array<{ id: number }>) firstPage.add(r.id);
      if (moreData.length < 1000) break;
    }
  }

  if (firstPage.size === 0) return { ids: new Set<number>(), meta: {} };

  const meta: Record<number, ListingCommuteMeta> = {};
  for (const id of firstPage) {
    meta[id] = { minutes: rule.maxMinutes, station: destinationLabel, mode: rule.mode };
  }

  return { ids: firstPage, meta };
}

async function resolveAddressRule(
  supabase: SupabaseClient,
  rule: CommuteRule,
): Promise<RuleResult | null> {
  if (!rule.addressLat || !rule.addressLon) return null;
  const destination = rule.address ? rule.address.split(",")[0].trim() : "Address";
  return resolveOtpIsochroneRule(supabase, rule.addressLat, rule.addressLon, rule, destination);
}

async function resolveParkRule(
  supabase: SupabaseClient,
  rule: CommuteRule,
): Promise<RuleResult | null> {
  if (!rule.parkName) return null;
  const coords = PARK_COORDS[rule.parkName];
  if (!coords) return null;
  return resolveOtpIsochroneRule(supabase, coords.lat, coords.lon, rule, rule.parkName);
}

/**
 * Resolve commute rules down to a set of matching listing IDs plus per-listing
 * metadata. Returns `{ids: null}` when no rules were provided or only
 * unresolvable rule types were present (pass-through). Returns an empty set
 * when rules were resolved and nothing matched.
 */
export async function resolveCommuteRules(
  commuteRules: CommuteRule[] | null | undefined,
): Promise<ResolvedCommute> {
  if (!commuteRules || commuteRules.length === 0) {
    return { ids: null, meta: {}, message: null };
  }

  const supabase = getCommuteClient();
  const ruleResults: Array<RuleResult | null> = [];

  for (const rule of commuteRules) {
    let result: RuleResult | null = null;
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
        result = await resolveParkRule(supabase, rule);
        break;
    }
    ruleResults.push(result);
  }

  const validResults = ruleResults.filter((r): r is RuleResult => r !== null);

  if (validResults.length === 0) {
    const hasImplementedRule = commuteRules.some(
      (r) => r.type === "subway-line" || r.type === "station" || r.type === "address" || r.type === "park",
    );
    if (hasImplementedRule) {
      return { ids: new Set<number>(), meta: {}, message: "No listings match your commute filters" };
    }
    return { ids: null, meta: {}, message: "Commute data not available yet — showing all listings" };
  }

  let intersection = validResults[0].ids;
  for (let i = 1; i < validResults.length; i++) {
    const next = validResults[i].ids;
    intersection = new Set([...intersection].filter((id) => next.has(id)));
  }

  const mergedMeta: Record<number, ListingCommuteMeta> = {};
  for (const id of intersection) {
    for (const result of validResults) {
      if (result.meta[id]) {
        mergedMeta[id] = result.meta[id];
        break;
      }
    }
  }

  return { ids: intersection, meta: mergedMeta, message: null };
}
