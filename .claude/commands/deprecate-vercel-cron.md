---
description: Deprecate the Vercel daily-ingest cron once the local-runner is proven (saves ~80% Apify spend)
---

Once the local self-hosted runner has been stable for ~24h on the user's Mac, deprecate the Vercel-side daily ingest cron. The runner replaces 95% of its work; we'll keep a single weekly Vercel run as a safety net for if the laptop is offline for days.

Pre-flight checks before doing anything:

1. `/runner-status` — runner must show healthy, log mtime < 5 min.
2. Check Apify usage: confirm spend hasn't spiked since the runner was installed.
3. Last ingest GH Action run (`/ingest-status`) — confirm we're not mid-run.

Then:

1. Edit `.github/workflows/ingest.yml`. Change the cron from daily to weekly:
   - Find the `schedule:` block (currently `cron: '0 16 * * *'` — every day at 16:00 UTC).
   - Change to `cron: '0 16 * * 0'` — every Sunday at 16:00 UTC.
   - Add a comment explaining the runner is now the primary path.
2. Verify workflow YAML is still valid: `npx yaml validate .github/workflows/ingest.yml` or `actionlint`.
3. Commit + push:

```bash
git add .github/workflows/ingest.yml
git commit -m "ingest: drop daily Vercel cron to weekly safety-net (local-runner is primary)

The local self-hosted scraper at web/scripts/local-runner.ts has been
stable for 24+h on residential IP, fetching + verifying continuously
at 60s cadence. That replaces ~95% of the Vercel cron's work using
free home bandwidth instead of \$8/GB Apify residential proxy.

Keep the cron at weekly (Sunday 16:00 UTC) as a backstop for if the
laptop is offline for days. Re-enable daily by changing the cron
back to '0 16 * * *' if needed.

Expected spend impact: ~80-90% drop in residential proxy GB.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

Report:
- Confirm the cron schedule change.
- Estimated next-fire time of the weekly run.
- Reminder to monitor `/apify-usage` for the next week to confirm the spend drop.
