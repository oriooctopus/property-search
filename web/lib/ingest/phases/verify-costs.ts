/**
 * verify-costs phase: query Apify for actual costs incurred during this run.
 *
 * Runs after `report` — always executes even if earlier phases failed (we
 * still want to know what we spent). Under --dry-run, skips API queries.
 *
 * Adds a CostReport to the IntegrityReport and prints a cost summary table.
 */

import { phaseLogger } from "../logger";
import { getApifyRunCosts, getApifyMonthToDate } from "../apify-costs";
import type {
  CostBreakdown,
  CostReport,
  IntegrityReport,
  OrchestratorDeps,
  PhaseResult,
  VerifyCostsOutput,
} from "../types";

interface VerifyCostsInput {
  report: IntegrityReport;
}

export async function runVerifyCostsPhase(
  input: VerifyCostsInput,
  deps: OrchestratorDeps,
): Promise<PhaseResult<VerifyCostsOutput>> {
  const log = phaseLogger("verify-costs");
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const warnings: string[] = [];
  const errors: string[] = [];

  const budgetUsd = deps.budgetUsd;

  // Under dry-run, report $0 with no API calls
  if (deps.dryRun) {
    log.info("dry-run: skipping Apify cost queries");
    const costReport: CostReport = {
      breakdown: [],
      totalUsd: 0,
      budgetUsd,
      overBudget: false,
      monthToDateUsd: null,
    };
    input.report.costReport = costReport;
    printCostSummary(costReport, log);

    return {
      phase: "verify-costs",
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      ok: true,
      warnings: [],
      errors: [],
      metrics: { totalUsd: 0 },
      output: { costReport },
    };
  }

  const token = process.env.APIFY_TOKEN;
  if (!token) {
    log.warn("APIFY_TOKEN not set — cannot query costs");
    const costReport: CostReport = {
      breakdown: [],
      totalUsd: 0,
      budgetUsd,
      overBudget: false,
      monthToDateUsd: null,
    };
    input.report.costReport = costReport;
    warnings.push("APIFY_TOKEN not set — cost data unavailable");

    return {
      phase: "verify-costs",
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      ok: true,
      warnings,
      errors: [],
      metrics: { totalUsd: 0 },
      output: { costReport },
    };
  }

  // Query Apify for runs within the ingest window
  const since = new Date(input.report.startedAt);
  const until = new Date(); // now — the run is still finishing

  let costReport: CostReport;

  try {
    const [runCosts, monthToDate] = await Promise.allSettled([
      getApifyRunCosts({ token, since, until }),
      getApifyMonthToDate(token),
    ]);

    const runs =
      runCosts.status === "fulfilled" ? runCosts.value.runs : [];
    const totalUsd =
      runCosts.status === "fulfilled" ? runCosts.value.totalUsd : 0;
    const mtdUsd =
      monthToDate.status === "fulfilled" ? monthToDate.value : null;

    if (runCosts.status === "rejected") {
      const msg = `Apify run costs query failed: ${runCosts.reason}`;
      log.warn(msg);
      warnings.push(msg);
    }
    if (monthToDate.status === "rejected") {
      const msg = `Apify month-to-date query failed: ${monthToDate.reason}`;
      log.warn(msg);
      warnings.push(msg);
    }

    // Group by source
    const bySource = new Map<string, { runs: number; usd: number }>();
    for (const run of runs) {
      const entry = bySource.get(run.source) ?? { runs: 0, usd: 0 };
      entry.runs += 1;
      entry.usd += run.usd;
      bySource.set(run.source, entry);
    }

    const breakdown: CostBreakdown[] = Array.from(bySource.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([source, data]) => ({
        source,
        apifyActorRuns: data.runs,
        apifyUsd: Math.round(data.usd * 1000) / 1000,
      }));

    const overBudget = totalUsd > budgetUsd;
    if (overBudget) {
      const msg = `Over budget: $${totalUsd.toFixed(2)} spent vs $${budgetUsd.toFixed(2)} budget`;
      log.warn(`[WARN] ${msg}`);
      warnings.push(msg);
      input.report.warnings.push(msg);
    }

    costReport = {
      breakdown,
      totalUsd: Math.round(totalUsd * 1000) / 1000,
      budgetUsd,
      overBudget,
      monthToDateUsd: mtdUsd !== null ? Math.round(mtdUsd * 100) / 100 : null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Failed to query Apify costs: ${msg}`);
    errors.push(msg);

    costReport = {
      breakdown: [],
      totalUsd: 0,
      budgetUsd,
      overBudget: false,
      monthToDateUsd: null,
    };
  }

  input.report.costReport = costReport;

  // Update ingest_runs row with cost data (if it was already inserted by report phase)
  if (!deps.dryRun && costReport.breakdown.length > 0) {
    try {
      const { error: updErr } = await deps.supabase
        .from("ingest_runs")
        .update({
          totals: {
            ...input.report.totals,
            cost: costReport,
          } as unknown as object,
        })
        .eq("id", input.report.runId);

      if (updErr) {
        log.warn(`Failed to update ingest_runs with cost data: ${updErr.message}`);
      }
    } catch {
      // best-effort
    }
  }

  printCostSummary(costReport, log);

  return {
    phase: "verify-costs",
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    ok: errors.length === 0,
    warnings,
    errors,
    metrics: {
      totalUsd: costReport.totalUsd,
      actorRuns: costReport.breakdown.reduce((s, b) => s + b.apifyActorRuns, 0),
      overBudget: costReport.overBudget ? 1 : 0,
    },
    output: { costReport },
  };
}

function printCostSummary(
  report: CostReport,
  log: { info: (...a: unknown[]) => void },
): void {
  const lines: string[] = [];
  lines.push("");
  lines.push("## Cost");
  lines.push("| Source | Actor Runs | Apify USD | Total |");
  lines.push("|--------|-----------|-----------|-------|");

  for (const b of report.breakdown) {
    const usd = b.apifyUsd > 0 ? `$${b.apifyUsd.toFixed(2)}` : "\u2014";
    lines.push(
      `| ${b.source} | ${b.apifyActorRuns} | ${usd} | ${usd} |`,
    );
  }

  if (report.breakdown.length === 0) {
    lines.push("| (none) | 0 | $0.00 | $0.00 |");
  }

  lines.push(
    `| **Total** | | | **$${report.totalUsd.toFixed(2)}** |`,
  );
  lines.push(
    `Budget: $${report.budgetUsd.toFixed(2)} \u00b7 Status: ${report.overBudget ? "\u26a0\ufe0f over budget" : "\u2713 within budget"}`,
  );
  if (report.monthToDateUsd !== null) {
    lines.push(`Month-to-date: $${report.monthToDateUsd.toFixed(2)}`);
  }

  console.log(lines.join("\n"));
}
