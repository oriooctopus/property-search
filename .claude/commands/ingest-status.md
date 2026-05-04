---
description: Show recent GH Actions ingest run results (status, duration, conclusion)
---

Pull the latest ingest run history from GitHub Actions. Useful for:
- Confirming the daily cron isn't cancelling at 60min anymore.
- Spotting a regression in run duration.
- Seeing which jobs (fetch / verify-stale) succeeded vs failed in the split-workflow architecture.

Run:

```bash
gh run list --workflow=ingest.yml --repo oriooctopus/property-search --limit 8 \
  --json databaseId,status,conclusion,createdAt,startedAt,updatedAt,headSha \
  | python3 -c "
import json, sys, datetime
runs = json.load(sys.stdin)
print(f'{\"ID\":>11} {\"STATUS\":12} {\"CONCLUSION\":10} {\"DURATION\":>9} {\"SHA\":7} {\"CREATED\":20}')
for r in runs:
    if r['startedAt'] and r['updatedAt']:
        s = datetime.datetime.fromisoformat(r['startedAt'].replace('Z','+00:00'))
        u = datetime.datetime.fromisoformat(r['updatedAt'].replace('Z','+00:00'))
        dur = str(u - s).split('.')[0]
    else:
        dur = '—'
    print(f'{r[\"databaseId\"]:>11} {r[\"status\"]:12} {r.get(\"conclusion\",\"\") or \"—\":10} {dur:>9} {r[\"headSha\"][:7]} {r[\"createdAt\"][:19]}')"
```

For the latest run, also show per-job timing (fetch + verify-stale split):

```bash
LATEST=$(gh run list --workflow=ingest.yml --repo oriooctopus/property-search --limit 1 --json databaseId | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['databaseId'])")
gh run view "$LATEST" --repo oriooctopus/property-search --json jobs \
  | python3 -c "
import json, sys, datetime
jobs = json.load(sys.stdin)['jobs']
for j in jobs:
    s = j.get('startedAt'); c = j.get('completedAt')
    if s and c:
        d = (datetime.datetime.fromisoformat(c.replace('Z','+00:00')) - datetime.datetime.fromisoformat(s.replace('Z','+00:00')))
        print(f'  {j[\"name\"]:20} {j[\"status\"]:12} {j.get(\"conclusion\",\"—\") or \"—\":10} {str(d).split(\".\")[0]}')"
```

Report:
- Last 5-8 runs with status/conclusion/duration.
- Latest run's per-job breakdown.
- One-line verdict: are runs completing under 60min cleanly? Any cancellations in the last 48h?
