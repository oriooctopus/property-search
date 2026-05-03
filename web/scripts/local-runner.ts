/**
 * Self-hosted local scraper runner.
 *
 * Loops forever on a residential ISP IP doing tiny units of work — alternating
 * between fetching a few newest StreetEasy listings and verifying a handful of
 * stale rows. Direct fetch first; falls back to Apify proxy ONLY on 403.
 *
 * Designed to coexist with the daily Vercel cron — the runner just makes the
 * cron's job lighter. Run via launchd (see com.dwelligence.local-runner.plist).
 *
 * Env (read from web/.env.local automatically):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (required)
 *   APIFY_PROXY_URL                  (optional; used as 403 fallback)
 *   LOCAL_RUNNER_CADENCE_MS          (default 60000)
 *   LOCAL_RUNNER_STALE_DAYS          (default 7)
 *   LOCAL_RUNNER_FETCH_PER_PAGE      (default 10)
 *   LOCAL_RUNNER_VERIFY_LIMIT        (default 3)
 *   HEALTHCHECKS_URL                 (optional; pinged each cycle for liveness)
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Load .env.local (mirrors scripts/ingest.ts behavior)
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, "..", ".env.local");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const val = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // env file optional
}

import { nodesToListings, type SENode } from "../lib/sources/streeteasy";
import { makeProxyFetch, withRotatingSession } from "../lib/sources/proxy";
import { validateAndNormalize } from "../lib/sources/pipeline";
import { toListingRow } from "../lib/sources/row";
import { upsertListings } from "../lib/sources/upsert";
import { verifiers } from "../lib/sources/verify/registry";
import type { ListingSource } from "../lib/sources/types";
import type { VerifyResult } from "../lib/sources/verify/types";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CADENCE_MS = Number(process.env.LOCAL_RUNNER_CADENCE_MS) || 60_000;
const STALE_DAYS = Number(process.env.LOCAL_RUNNER_STALE_DAYS) || 7;
const FETCH_PER_PAGE = Number(process.env.LOCAL_RUNNER_FETCH_PER_PAGE) || 10;
const VERIFY_LIMIT = Number(process.env.LOCAL_RUNNER_VERIFY_LIMIT) || 3;
const HEALTHCHECKS_URL = process.env.HEALTHCHECKS_URL ?? "";

const SE_API_URL = "https://api-v6.streeteasy.com/";
const SE_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  Origin: "https://streeteasy.com",
  Referer: "https://streeteasy.com/",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Safari/605.1.15",
  "apollographql-client-name": "srp-frontend-service",
  "apollographql-client-version":
    "version 859d2a117b87b956a057dd24110186eabfccc4eb",
  "app-version": "1.0.0",
  os: "web",
};
const SE_QUERY = `query GetListingRental($input: SearchRentalsInput!) {
  searchRentals(input: $input) {
    totalCount
    edges {
      ... on OrganicRentalEdge {
        node {
          id
          areaName
          bedroomCount
          buildingType
          fullBathroomCount
          halfBathroomCount
          geoPoint { latitude longitude }
          leadMedia { photo { key } }
          photos { key }
          livingAreaSize
          availableAt
          price
          sourceGroupLabel
          status
          street
          unit
          urlPath
          noFee
          monthsFree
          netEffectivePrice
        }
      }
    }
  }
}`;

// Boroughs: rotate so we hit each over time.
const BOROUGHS: { name: string; areas: number[] }[] = [
  { name: "Manhattan", areas: [100] },
  { name: "Brooklyn", areas: [300] },
];

// Verify sources we sample from. Matches verify-stale registry exclusions
// (facebook-marketplace verifier is blocked).
const VERIFY_SOURCES: ListingSource[] = ["streeteasy", "craigslist"];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface CycleStats {
  cycleNum: number;
  kind: "fetch" | "verify";
  fetched?: number;
  upserted?: number;
  active?: number;
  delisted?: number;
  unknown?: number;
  errors?: number;
  apifyFallback?: boolean;
  three?: number; // 403 count
  durationMs: number;
  detail?: string;
}

let shouldExit = false;

// ---------------------------------------------------------------------------
// Tiny SE fetch (a few newest listings, single page, single HTTP call)
// ---------------------------------------------------------------------------

async function tinySEFetch(
  areas: number[],
  perPage: number,
  fetchFn: typeof fetch,
): Promise<{ status: number; nodes: SENode[] }> {
  const res = await fetchFn(SE_API_URL, {
    method: "POST",
    headers: SE_HEADERS,
    body: JSON.stringify({
      query: SE_QUERY,
      variables: {
        input: {
          filters: { rentalStatus: "ACTIVE", areas },
          page: 1,
          perPage,
          sorting: { attribute: "LISTED_AT", direction: "DESCENDING" },
          userSearchToken: crypto.randomUUID(),
          adStrategy: "NONE",
        },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) return { status: res.status, nodes: [] };

  const data = (await res.json()) as {
    data?: { searchRentals?: { edges?: { node?: SENode }[] } };
    errors?: { message: string }[];
  };
  if (data.errors?.length) {
    throw new Error(`SE GraphQL error: ${data.errors[0].message}`);
  }
  const nodes: SENode[] = [];
  for (const edge of data.data?.searchRentals?.edges ?? []) {
    if (edge.node) nodes.push(edge.node);
  }
  return { status: 200, nodes };
}

async function runFetchCycle(
  supabase: SupabaseClient,
  cycleNum: number,
): Promise<CycleStats> {
  const t0 = Date.now();
  const borough = BOROUGHS[cycleNum % BOROUGHS.length];
  let apifyFallback = false;
  let four03 = 0;

  let fetchResult = await tinySEFetch(borough.areas, FETCH_PER_PAGE, fetch);
  if (fetchResult.status === 403) {
    four03++;
    const proxyUrl = process.env.APIFY_PROXY_URL ?? "";
    if (proxyUrl) {
      apifyFallback = true;
      const proxyFetch = makeProxyFetch(withRotatingSession(proxyUrl));
      try {
        fetchResult = await tinySEFetch(borough.areas, FETCH_PER_PAGE, proxyFetch);
      } catch (err) {
        return {
          cycleNum,
          kind: "fetch",
          fetched: 0,
          upserted: 0,
          three: four03,
          apifyFallback,
          durationMs: Date.now() - t0,
          detail: `proxy fallback failed: ${(err as Error).message}`,
        };
      }
    }
  }

  if (fetchResult.status !== 200) {
    return {
      cycleNum,
      kind: "fetch",
      fetched: 0,
      upserted: 0,
      three: four03,
      apifyFallback,
      durationMs: Date.now() - t0,
      detail: `direct status=${fetchResult.status}`,
    };
  }

  const adapterOutputs = nodesToListings(fetchResult.nodes, borough.name);
  const { listings: validated } = validateAndNormalize(adapterOutputs);
  const rows = validated.map(toListingRow);

  let upsertedCount = 0;
  if (rows.length > 0) {
    const result = await upsertListings(supabase, rows, { batchSize: 50 });
    upsertedCount = result.succeeded;
  }

  return {
    cycleNum,
    kind: "fetch",
    fetched: adapterOutputs.length,
    upserted: upsertedCount,
    three: four03,
    apifyFallback,
    durationMs: Date.now() - t0,
    detail: borough.name,
  };
}

// ---------------------------------------------------------------------------
// Verify cycle: pick a handful of stale rows from one source, verify, write back.
// ---------------------------------------------------------------------------

interface Candidate {
  id: number;
  url: string;
  source: string;
  external_id: string | null;
}

async function loadStaleSample(
  supabase: SupabaseClient,
  source: ListingSource,
  limit: number,
): Promise<Candidate[]> {
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("listings")
    .select("id, url, source, external_id")
    .eq("source", source)
    .is("delisted_at", null)
    .lt("last_seen_at", cutoff)
    .limit(limit);
  if (error) throw new Error(`stale load failed for ${source}: ${error.message}`);
  return (data ?? []) as Candidate[];
}

async function applyVerifyResult(
  supabase: SupabaseClient,
  candidate: Candidate,
  result: VerifyResult,
  phaseCutoff: string,
): Promise<"active" | "delisted" | "unknown" | "error"> {
  if (result.status === "unknown") return "unknown";

  if (result.status === "active") {
    const { error } = await supabase
      .from("listings")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", candidate.id);
    return error ? "error" : "active";
  }

  // delisted — gate on last_seen_at < phaseCutoff so a parallel fetch that
  // bumped the row to fresh wins the race (matches verify-stale semantics).
  const { error } = await supabase
    .from("listings")
    .update({ delisted_at: new Date().toISOString() })
    .eq("id", candidate.id)
    .lt("last_seen_at", phaseCutoff);
  return error ? "error" : "delisted";
}

async function runVerifyCycle(
  supabase: SupabaseClient,
  cycleNum: number,
): Promise<CycleStats> {
  const t0 = Date.now();
  const phaseCutoff = new Date().toISOString();
  // Rotate which source we sample.
  const source = VERIFY_SOURCES[cycleNum % VERIFY_SOURCES.length];

  let candidates: Candidate[] = [];
  try {
    candidates = await loadStaleSample(supabase, source, VERIFY_LIMIT);
  } catch (err) {
    return {
      cycleNum,
      kind: "verify",
      durationMs: Date.now() - t0,
      detail: `${source}: load failed: ${(err as Error).message}`,
    };
  }

  if (candidates.length === 0) {
    return {
      cycleNum,
      kind: "verify",
      active: 0,
      delisted: 0,
      unknown: 0,
      errors: 0,
      durationMs: Date.now() - t0,
      detail: `${source}: no stale candidates`,
    };
  }

  const verifier = verifiers[source];
  const verifyDeps = {
    apifyToken: process.env.APIFY_TOKEN ?? process.env.APIFY_PROXY_URL ?? "",
  };

  let active = 0;
  let delisted = 0;
  let unknown = 0;
  let errors = 0;

  // Sequential within a verify cycle — keeps the unit small.
  for (const candidate of candidates) {
    let result: VerifyResult;
    try {
      result = await verifier(candidate.url, verifyDeps);
    } catch (err) {
      result = { status: "unknown", reason: `exception: ${(err as Error).message}` };
    }
    const outcome = await applyVerifyResult(supabase, candidate, result, phaseCutoff);
    if (outcome === "active") active++;
    else if (outcome === "delisted") delisted++;
    else if (outcome === "unknown") unknown++;
    else errors++;
  }

  return {
    cycleNum,
    kind: "verify",
    active,
    delisted,
    unknown,
    errors,
    durationMs: Date.now() - t0,
    detail: source,
  };
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function logCycle(stats: CycleStats): void {
  const ts = new Date().toISOString();
  const parts: string[] = [
    `[${ts}]`,
    `cycle=${stats.cycleNum}`,
    `kind=${stats.kind}`,
  ];
  if (stats.kind === "fetch") {
    parts.push(`fetched=${stats.fetched ?? 0}`);
    parts.push(`upserted=${stats.upserted ?? 0}`);
    if (stats.three) parts.push(`403=${stats.three}`);
    if (stats.apifyFallback) parts.push(`apify=1`);
  } else {
    parts.push(`a=${stats.active ?? 0}`);
    parts.push(`d=${stats.delisted ?? 0}`);
    parts.push(`u=${stats.unknown ?? 0}`);
    parts.push(`e=${stats.errors ?? 0}`);
  }
  parts.push(`ms=${stats.durationMs}`);
  if (stats.detail) parts.push(`detail="${stats.detail}"`);
  console.log(parts.join(" "));
}

async function pingHealthchecks(): Promise<void> {
  if (!HEALTHCHECKS_URL) return;
  try {
    await fetch(HEALTHCHECKS_URL, { signal: AbortSignal.timeout(5000) });
  } catch {
    // Liveness ping is best-effort.
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing Supabase credentials (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)",
    );
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log(
    `[local-runner] starting: cadence=${CADENCE_MS}ms staleDays=${STALE_DAYS} ` +
      `fetchPerPage=${FETCH_PER_PAGE} verifyLimit=${VERIFY_LIMIT} ` +
      `apifyFallback=${process.env.APIFY_PROXY_URL ? "on" : "off"} ` +
      `healthchecks=${HEALTHCHECKS_URL ? "on" : "off"}`,
  );

  process.on("SIGINT", () => {
    console.log("[local-runner] SIGINT received — finishing current cycle then exiting");
    shouldExit = true;
  });
  process.on("SIGTERM", () => {
    console.log("[local-runner] SIGTERM received — finishing current cycle then exiting");
    shouldExit = true;
  });

  let cycleNum = 0;
  while (!shouldExit) {
    cycleNum++;
    // Alternate: odd=fetch, even=verify.
    const kind: "fetch" | "verify" = cycleNum % 2 === 1 ? "fetch" : "verify";
    try {
      const stats =
        kind === "fetch"
          ? await runFetchCycle(supabase, cycleNum)
          : await runVerifyCycle(supabase, cycleNum);
      logCycle(stats);
    } catch (err) {
      console.error(
        `[local-runner] cycle=${cycleNum} kind=${kind} unexpected error: ${(err as Error).message}`,
      );
    }
    await pingHealthchecks();

    if (shouldExit) break;
    // Sleep with periodic shouldExit checks so SIGINT exits faster.
    const waitUntil = Date.now() + CADENCE_MS;
    while (!shouldExit && Date.now() < waitUntil) {
      await sleep(Math.min(500, waitUntil - Date.now()));
    }
  }

  console.log("[local-runner] shut down cleanly");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("[local-runner] fatal:", err);
    process.exit(1);
  },
);
