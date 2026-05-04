---
description: Check Apify monthly spend + limit
---

Pull current Apify usage cycle stats. Useful for:
- Confirming the local-runner is actually saving money.
- Spotting a sudden spike.
- Deciding when to pause the Vercel cron.

Read the token from `~/.claude/tokens.env`:

```bash
TOKEN=$(grep '^APIFY_TOKEN=' ~/.claude/tokens.env | cut -d= -f2)
```

Then hit the limits + monthly endpoints:

```bash
curl -s "https://api.apify.com/v2/users/me/limits" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import json,sys; d=json.load(sys.stdin)['data']; \
    print(f'cycle: {d[\"monthlyUsageCycle\"][\"startAt\"][:10]} → {d[\"monthlyUsageCycle\"][\"endAt\"][:10]}'); \
    used=d['current']['monthlyUsageUsd']; cap=d['limits']['maxMonthlyUsageUsd']; \
    print(f'spend: \${used:.2f} of \${cap:.0f} ({100*used/cap:.0f}%)'); \
    print(f'residential proxy: {d[\"current\"][\"monthlyResidentialProxyGbytes\"]:.2f} GB')"
```

Then breakdown by service (top 5):

```bash
curl -s "https://api.apify.com/v2/users/me/usage/monthly" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import json,sys; d=json.load(sys.stdin)['data']['monthlyServiceUsage']; \
    items=sorted([(v.get('amountAfterVolumeDiscountUsd',0),k,v.get('quantity',0)) for k,v in d.items()],reverse=True); \
    [print(f'\${u:>6.2f}  {k}  qty={q:.3f}') for u,k,q in items[:5]]"
```

Report:
- Total spend this cycle vs cap (% used).
- Top 3 cost buckets.
- One-line judgment: "on track" / "running hot" / "near cap" based on days-into-cycle vs % used.

Reference: cycle is monthly Apr 25 → May 24. At 33% through the cycle, expect ~33% used at steady-state.
