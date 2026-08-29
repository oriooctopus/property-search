/**
 * Unified ingest orchestrator CLI.
 *
 * This is the single ingest entry point. The old per-source scripts
 * (refresh-sources, refresh-se-daily, populate-sources, refresh-cl-fb,
 * populate-se-manhattan) were deleted in PR 2 of the ingest cleanup —
 * see git history if you need to resurrect any of them.
 *
 * Usage:
 *   npx tsx scripts/ingest.ts --fetch-strategy=staleness-gated
 *   npx tsx scripts/ingest.ts --fetch-strategy=full-bisection --sources=craigslist
 *   npx tsx scripts/ingest.ts --only-phase=enrich-year-built,enrich-isochrones
 *   npx tsx scripts/ingest.ts --dry-run --sources=streeteasy
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Fail loud on async-leaked errors. Without these handlers a Promise that
// rejected after its awaiter was abandoned (or never awaited) would either
// silently terminate the process with code 0 once the event loop emptied
// (the verify-stale-2026-04-28 incident: 1000-row run "completed" in 9s with
// no progress logs and exit 0), or be swallowed by the lib's `--unhandled-
// rejections=warn` default in older Nodes. Either way: invisible breakage.
process.on("unhandledRejection", (reason) => {
  console.error("FATAL: unhandledRejection", reason);
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  console.error("FATAL: uncaughtException", err);
  process.exit(1);
});
// `beforeExit` fires when the event loop is idle and we're about to exit
// naturally. If it fires before main() resolved (and called process.exit(0)
// itself), something silently abandoned a promise — fail loud rather than
// declaring success.
let mainResolved = false;
process.on("beforeExit", (code) => {
  if (!mainResolved) {
    console.error(
      `FATAL: event loop emptied before main() finished (exit code would be ${code}). ` +
        `This usually means an awaited Promise was abandoned (e.g. a fetch that never resolves).`,
    );
    process.exit(1);
  }
});

import { runOrchestrator } from "../lib/ingest/orchestrator";
import {
  FullBisectionFetch,
  StalenessGatedFetch,
} from "../lib/ingest/strategies";
import type { FetchStrategy } from "../lib/ingest/types";

// ---------------------------------------------------------------------------
// Load .env.local
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

// ---------------------------------------------------------------------------
// Arg parsing (no deps) — lives in lib/ingest/cli-args.ts so it can be
// imported by tests without pulling in this file's main()/process handlers.
// ---------------------------------------------------------------------------

import { parseArgs } from "../lib/ingest/cli-args";

function buildStrategy(name: string): FetchStrategy {
  switch (name) {
    case "staleness-gated":
      return new StalenessGatedFetch();
    case "full-bisection":
      return new FullBisectionFetch();
    default:
      throw new Error(
        `Unknown fetch strategy: ${name} (expected staleness-gated | full-bisection)`,
      );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing Supabase credentials (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)",
    );
  }
  const supabase = createClient(supabaseUrl, supabaseKey);
  const strategy = buildStrategy(args.fetchStrategy);

  console.log(
    `=== ingest.ts run (strategy=${strategy.name} sources=${args.sources.join(",")} dryRun=${args.dryRun}) ===`,
  );

  // Default budget: $10 for full-bisection, $1 for daily
  const budgetUsd =
    args.budgetUsd ?? (args.fetchStrategy === "full-bisection" ? 10.0 : 1.0);

  const report = await runOrchestrator({
    supabase,
    fetchStrategy: strategy,
    sources: args.sources,
    dryRun: args.dryRun,
    skipPhases: args.skipPhases,
    onlyPhases: args.onlyPhases,
    since: args.since,
    budgetUsd,
    maxAgeHours: args.maxAgeHours,
    maxDelistFrac: args.maxDelistFrac,
  });

  console.log(`\n=== done (runId=${report.runId}) ===`);
  mainResolved = true;
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
