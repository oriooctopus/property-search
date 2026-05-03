# Local Scraper Runner

Self-hosted continuously-running scraper that runs on your home machine
(residential ISP IP). Replaces the heavy daily Vercel cron with a steady drip
of small fetch + verify cycles. Apify proxy stays in place as a 403 fallback
only.

## How it works

`web/scripts/local-runner.ts` loops forever, alternating between two cycle
kinds:

1. **fetch** — fetches the ~10 newest StreetEasy listings for one borough
   (Manhattan / Brooklyn rotate each cycle), runs them through the same
   `validateAndNormalize` + `upsertListings` pipeline as the daily ingest.
   Direct fetch first; falls back to Apify residential proxy ONLY on 403.

2. **verify** — picks 3 stale listings (last_seen_at > 7d ago) for one source
   (streeteasy / craigslist rotate), runs the source's verifier, and writes
   back `last_seen_at` (active) or `delisted_at` (delisted). Same row-update
   semantics as `verify-stale.ts` (delisted updates are gated on
   `last_seen_at < phaseCutoff` so a parallel fetch wins the race).

Each cycle logs one line to stdout, e.g.

```
[2026-05-03T01:23:45.000Z] cycle=12 kind=fetch fetched=10 upserted=3 ms=842 detail="Manhattan"
[2026-05-03T01:24:46.000Z] cycle=13 kind=verify a=2 d=1 u=0 e=0 ms=1531 detail="streeteasy"
```

## Install (Mac, launchd)

```bash
# Symlink the plist into LaunchAgents (or copy if you prefer immutable)
ln -s "$PWD/web/scripts/com.dwelligence.local-runner.plist" \
  ~/Library/LaunchAgents/com.dwelligence.local-runner.plist

# Make sure the log directory exists
mkdir -p ~/Library/Logs/dwelligence

# Load it
launchctl load ~/Library/LaunchAgents/com.dwelligence.local-runner.plist
```

## Check it's running

```bash
launchctl list | grep dwelligence
# com.dwelligence.local-runner    -    (PID-or-status)

# Tail the log
tail -f ~/Library/Logs/dwelligence/local-runner.log
```

## Stop / unload

```bash
launchctl unload ~/Library/LaunchAgents/com.dwelligence.local-runner.plist
```

## Run manually (foreground, for debugging)

```bash
cd /Users/oliverullman/Documents/coding/property-search
bun run web/scripts/local-runner.ts
# Ctrl-C exits cleanly after the current cycle finishes.
```

## Config (env vars)

All read from `web/.env.local` automatically (same loader as `scripts/ingest.ts`).

| Var | Default | Purpose |
|-----|---------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | — | Required. Supabase URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Required. Service-role key for upserts. |
| `APIFY_PROXY_URL`           | — | Optional. 403 fallback proxy. Off → no fallback. |
| `LOCAL_RUNNER_CADENCE_MS`   | `60000` | Sleep between cycles. |
| `LOCAL_RUNNER_STALE_DAYS`   | `7` | Verify candidates older than this. |
| `LOCAL_RUNNER_FETCH_PER_PAGE` | `10` | Listings per fetch cycle. |
| `LOCAL_RUNNER_VERIFY_LIMIT` | `3` | Listings per verify cycle. |
| `HEALTHCHECKS_URL`          | — | Optional GET each cycle for liveness. |

## Coexistence with the Vercel daily cron

The daily cron stays in place as a safety net for full nights when the laptop
is closed. The runner just makes its job lighter — most listings will already
be fresh by the time the cron fires. We can deprecate the cron once we have
several weeks of evidence that the runner keeps coverage healthy.
