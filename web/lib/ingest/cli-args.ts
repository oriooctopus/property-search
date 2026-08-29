/**
 * scripts/ingest.ts CLI argument parsing, split out into its own
 * side-effect-free module so tests can import `parseArgs` directly.
 *
 * scripts/ingest.ts itself can't be imported from a test: it registers
 * process-wide `unhandledRejection`/`uncaughtException`/`beforeExit` handlers
 * and unconditionally calls `main().catch(...)` at module scope (which loads
 * .env.local, requires real Supabase credentials, and calls `process.exit`)
 * — importing it would run all of that inside the test process. Keeping
 * parseArgs here, with zero side effects on import, avoids that entirely.
 */

import { ALL_SOURCES as ACTIVE_LISTING_SOURCES } from "../sources/types";
import { DEFAULT_MAX_AGE_HOURS, DEFAULT_MAX_DELIST_FRAC } from "./phases/delist-unseen";

export const ALL_SOURCES = [...ACTIVE_LISTING_SOURCES];

export interface ParsedArgs {
  fetchStrategy: string;
  sources: string[];
  skipPhases: Set<string>;
  onlyPhases: Set<string> | null;
  dryRun: boolean;
  since?: string;
  budgetUsd?: number;
  maxAgeHours?: number;
  maxDelistFrac?: number;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let fetchStrategy = "staleness-gated";
  // Typed as string[] (not ListingSource[], which ALL_SOURCES.slice() would
  // otherwise infer) because the --sources= branch below reassigns it from
  // raw CLI text before the ALL_SOURCES.includes() validation loop runs —
  // validity is enforced there at runtime, not by the static type.
  let sources: string[] = ALL_SOURCES.slice();
  const skipPhases = new Set<string>();
  let onlyPhases: Set<string> | null = null;
  let dryRun = false;
  let since: string | undefined;
  let budgetUsd: number | undefined;
  let maxAgeHours: number | undefined;
  let maxDelistFrac: number | undefined;

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
    } else if (arg.startsWith("--budget=")) {
      budgetUsd = parseFloat(arg.slice("--budget=".length));
      if (isNaN(budgetUsd) || budgetUsd <= 0) {
        throw new Error(`Invalid --budget value: ${arg.slice("--budget=".length)}`);
      }
    } else if (arg.startsWith("--max-age-hours=")) {
      const raw = arg.slice("--max-age-hours=".length);
      maxAgeHours = Number(raw);
      // Loud, not coerced: an invalid value here (0, negative, NaN) would
      // otherwise silently produce a cutoff in the future/now, making every
      // active row look "stale" and risking a mass-delist — see
      // lib/ingest/phases/delist-unseen.ts's maxDelistFrac guard, which this
      // validation is the first line of defense in front of.
      if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
        throw new Error(`Invalid --max-age-hours value: ${raw} (must be a number > 0)`);
      }
    } else if (arg.startsWith("--max-delist-frac=")) {
      const raw = arg.slice("--max-delist-frac=".length);
      maxDelistFrac = Number(raw);
      // (0, 1]: 0 would refuse to delist anything ever (silently defeats the
      // phase's purpose, easy to typo into); >1 is nonsensical as a fraction.
      if (!Number.isFinite(maxDelistFrac) || maxDelistFrac <= 0 || maxDelistFrac > 1) {
        throw new Error(
          `Invalid --max-delist-frac value: ${raw} (must be a number in (0, 1])`,
        );
      }
    }
  }

  if (skipPhases.size > 0 && onlyPhases) {
    throw new Error("--skip-phase and --only-phase are mutually exclusive");
  }

  for (const s of sources) {
    // Widen to string[] for the check: `s` is raw CLI text (string), and
    // this IS the runtime validation that makes it safe to treat as
    // ListingSource afterward — same reasoning as the `sources` declaration
    // above.
    if (!(ALL_SOURCES as readonly string[]).includes(s)) {
      throw new Error(`Unknown source: ${s} (allow-list: ${ALL_SOURCES.join(",")})`);
    }
  }

  return {
    fetchStrategy,
    sources,
    skipPhases,
    onlyPhases,
    dryRun,
    since,
    budgetUsd,
    maxAgeHours,
    maxDelistFrac,
  };
}

// Re-exported so a caller that only needs the defaults (e.g. to log what
// will be used) doesn't have to reach into the phase module directly.
export { DEFAULT_MAX_AGE_HOURS, DEFAULT_MAX_DELIST_FRAC };
