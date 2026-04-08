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
// Allow-list of sources
// ---------------------------------------------------------------------------

const ALL_SOURCES = [
  "realtor",
  "apartments",
  "craigslist",
  "renthop",
  "streeteasy",
  "zillow",
  "facebook",
];

// ---------------------------------------------------------------------------
// Arg parsing (no deps)
// ---------------------------------------------------------------------------

interface ParsedArgs {
  fetchStrategy: string;
  sources: string[];
  skipPhases: Set<string>;
  onlyPhases: Set<string> | null;
  dryRun: boolean;
  since?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  let fetchStrategy = "staleness-gated";
  let sources = ALL_SOURCES.slice();
  const skipPhases = new Set<string>();
  let onlyPhases: Set<string> | null = null;
  let dryRun = false;
  let since: string | undefined;

  for (const arg of argv.slice(2)) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("--fetch-strategy=")) {
      fetchStrategy = arg.slice("--fetch-strategy=".length);
    } else if (arg.startsWith("--sources=")) {
      sources = arg
        .slice("--sources=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg.startsWith("--skip-phase=")) {
      for (const p of arg.slice("--skip-phase=".length).split(",")) {
        skipPhases.add(p.trim());
      }
    } else if (arg.startsWith("--only-phase=")) {
      onlyPhases = new Set(
        arg
          .slice("--only-phase=".length)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } else if (arg.startsWith("--since=")) {
      since = arg.slice("--since=".length);
    }
  }

  if (skipPhases.size > 0 && onlyPhases) {
    throw new Error("--skip-phase and --only-phase are mutually exclusive");
  }

  for (const s of sources) {
    if (!ALL_SOURCES.includes(s)) {
      throw new Error(`Unknown source: ${s} (allow-list: ${ALL_SOURCES.join(",")})`);
    }
  }

  return { fetchStrategy, sources, skipPhases, onlyPhases, dryRun, since };
}

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

  const report = await runOrchestrator({
    supabase,
    fetchStrategy: strategy,
    sources: args.sources,
    dryRun: args.dryRun,
    skipPhases: args.skipPhases,
    onlyPhases: args.onlyPhases,
    since: args.since,
  });

  console.log(`\n=== done (runId=${report.runId}) ===`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
