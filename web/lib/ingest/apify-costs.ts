/**
 * Apify cost-tracking helper.
 *
 * Pure HTTP calls against the Apify v2 REST API — no SDK dependency.
 * Returns per-run cost data and month-to-date spend.
 */

const APIFY_BASE = "https://api.apify.com/v2";

/**
 * Known actor IDs → source name mapping.
 * If a run's actId isn't in this map, it gets bucketed under "unknown".
 */
const ACTOR_ID_TO_SOURCE: Record<string, string> = {
  U5DUNxhH3qKt5PnCf: "facebook-marketplace",
  owuUx043cdcXvJ6fa: "craigslist",
  ptsXZUXADV3OKZ5kd: "streeteasy",
};

export interface ApifyRunCost {
  actorId: string;
  runId: string;
  usd: number;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  source: string;
}

export interface ApifyRunCostsResult {
  runs: ApifyRunCost[];
  totalUsd: number;
}

/**
 * Fetch all Apify actor runs that started within a time window.
 * Paginates through all runs in the window (100 per page).
 */
export async function getApifyRunCosts(opts: {
  token: string;
  since: Date;
  until: Date;
}): Promise<ApifyRunCostsResult> {
  const { token, since, until } = opts;
  const runs: ApifyRunCost[] = [];
  let offset = 0;
  const limit = 100;

  // Paginate backwards (desc=true) until we pass the `since` boundary
  while (true) {
    const url = `${APIFY_BASE}/actor-runs?token=${token}&limit=${limit}&offset=${offset}&desc=true`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Apify actor-runs API returned ${res.status}: ${await res.text().catch(() => "")}`);
    }
    const body = (await res.json()) as {
      data: {
        items: Array<{
          id: string;
          actId: string;
          startedAt: string;
          finishedAt: string | null;
          status: string;
          usageTotalUsd: number;
        }>;
        total: number;
      };
    };

    const items = body.data.items;
    if (items.length === 0) break;

    for (const item of items) {
      const started = new Date(item.startedAt);
      // Past our window — stop paginating
      if (started < since) {
        return { runs, totalUsd: runs.reduce((s, r) => s + r.usd, 0) };
      }
      // Within window
      if (started <= until) {
        runs.push({
          actorId: item.actId,
          runId: item.id,
          usd: item.usageTotalUsd ?? 0,
          startedAt: item.startedAt,
          finishedAt: item.finishedAt,
          status: item.status,
          source: ACTOR_ID_TO_SOURCE[item.actId] ?? "unknown",
        });
      }
    }

    offset += limit;
    if (offset >= body.data.total) break;
  }

  return { runs, totalUsd: runs.reduce((s, r) => s + r.usd, 0) };
}

/**
 * Fetch month-to-date total spend from the Apify billing API.
 */
export async function getApifyMonthToDate(token: string): Promise<number> {
  const url = `${APIFY_BASE}/users/me/usage/monthly?token=${token}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Apify monthly usage API returned ${res.status}`);
  }
  const body = (await res.json()) as {
    data: {
      totalUsageCreditsUsdAfterVolumeDiscount: number;
    };
  };
  return body.data.totalUsageCreditsUsdAfterVolumeDiscount ?? 0;
}
