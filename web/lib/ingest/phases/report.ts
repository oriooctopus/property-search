/**
 * report phase: build a markdown summary, print it, insert into ingest_runs.
 *
 * Soft-warn thresholds only. We add `[WARN]` lines to stdout + push into the
 * IntegrityReport.warnings array. We never set a non-zero exit code here.
 */

import { phaseLogger } from "../logger";
import { sendIngestAlert } from "../alert";
import type {
  IntegrityReport,
  OrchestratorDeps,
  PerSourceFetchResult,
  PhaseResult,
} from "../types";

interface ReportInput {
  report: IntegrityReport;
  perSourceResults: PerSourceFetchResult[];
  totalListingsInDb: number;
}

export async function runReportPhase(
  input: ReportInput,
  deps: OrchestratorDeps,
): Promise<PhaseResult<void>> {
  const log = phaseLogger("report");
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const r = input.report;
  const softWarnings: string[] = [];

  // Threshold checks
  const total = input.totalListingsInDb || 1;
  const nullYbPct = (r.totals.nullYearBuilt / total) * 100;
  if (nullYbPct > 10) {
    softWarnings.push(
      `nullYearBuilt ${r.totals.nullYearBuilt}/${total} (${nullYbPct.toFixed(1)}%) > 10% threshold`,
    );
  }
  const missingIsoPct = (r.totals.missingIsochrones / total) * 100;
  if (missingIsoPct > 2) {
    softWarnings.push(
      `missingIsochrones ${r.totals.missingIsochrones}/${total} (${missingIsoPct.toFixed(1)}%) > 2% threshold`,
    );
  }
  if (r.totals.rowsUpserted > 0) {
    const failedPct = (r.totals.rowsFailed / r.totals.rowsUpserted) * 100;
    if (failedPct > 5) {
      softWarnings.push(
        `rowsFailed ${r.totals.rowsFailed} > 5% of rowsUpserted ${r.totals.rowsUpserted}`,
      );
    }
  }
  for (const ps of input.perSourceResults) {
    if (!ps.ok) softWarnings.push(`source ${ps.source} failed: ${ps.error}`);
  }

  for (const w of softWarnings) {
    log.warn(`[WARN] ${w}`);
    r.warnings.push(w);
  }

  // Send email alert if any sources failed
  const failedSources = input.perSourceResults.filter((ps) => !ps.ok);
  if (failedSources.length > 0) {
    const subject = `[Dwelligence] Ingest alert: ${failedSources.length} source(s) failed`;
    const body = [
      `Ingest run ${r.runId} completed with failures.`,
      `Strategy: ${r.fetchStrategy}`,
      `Started: ${r.startedAt}`,
      "",
      "Failed sources:",
      ...failedSources.map(
        (fs) => `  - ${fs.source}: ${fs.error ?? "unknown error"}`,
      ),
      "",
      "All warnings:",
      ...softWarnings.map((w) => `  - ${w}`),
    ].join("\n");
    // Fire-and-forget — don't block the report phase on email delivery
    sendIngestAlert(subject, body).catch(() => {});
  }

  // Markdown summary
  const lines: string[] = [];
  lines.push("");
  lines.push("# Ingest Run Summary");
  lines.push("");
  lines.push(`- runId: \`${r.runId}\``);
  lines.push(`- strategy: ${r.fetchStrategy}`);
  lines.push(`- sources: ${r.sources.join(", ")}`);
  lines.push(`- startedAt: ${r.startedAt}`);
  lines.push(`- finishedAt: ${r.finishedAt}`);
  lines.push("");
  lines.push("| Phase | ok | duration | warnings | errors |");
  lines.push("|-------|----|----------|----------|--------|");
  for (const p of r.phases) {
    lines.push(
      `| ${p.phase} | ${p.ok ? "✓" : "✗"} | ${p.durationMs}ms | ${p.warnings.length} | ${p.errors.length} |`,
    );
  }
  lines.push("");
  lines.push("| Totals | |");
  lines.push("|---|---|");
  for (const [k, v] of Object.entries(r.totals)) lines.push(`| ${k} | ${v} |`);
  lines.push("");
  console.log(lines.join("\n"));

  // Persist to ingest_runs (skip in dry-run)
  if (!deps.dryRun) {
    const { error: insErr } = await deps.supabase.from("ingest_runs").insert({
      id: r.runId,
      started_at: r.startedAt,
      finished_at: r.finishedAt,
      fetch_strategy: r.fetchStrategy,
      sources: r.sources,
      phase_results: r.phases as unknown as object,
      totals: r.totals as unknown as object,
      warnings: r.warnings,
      exit_code: r.exitCode,
    });
    if (insErr) {
      log.warn(`failed to insert ingest_runs row: ${insErr.message}`);
    }
  } else {
    log.info(`dry-run: skipping ingest_runs insert`);
  }

  return {
    phase: "report",
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    ok: true,
    warnings: softWarnings,
    errors: [],
    metrics: { softWarnings: softWarnings.length },
  };
}
