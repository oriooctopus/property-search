---
description: Tail the local-runner log live (~20 lines, then stream)
---

Show the last 25 log lines from the local self-hosted scraper, then stream live.

```bash
tail -25 ~/Library/Logs/dwelligence/local-runner.log
```

The format is one line per cycle:

```
[2026-05-03T23:47:57.680Z] cycle=1 kind=fetch fetched=10 upserted=10 ms=1657 detail="Brooklyn"
[2026-05-03T23:49:56.355Z] cycle=2 kind=verify a=1 d=2 u=0 e=0 ms=58672 detail="streeteasy"
```

`a=` active confirmed, `d=` delisted confirmed, `u=` unknown (couldn't determine), `e=` errored.

If the user wants live streaming after seeing the tail, mention they can run `tail -f ~/Library/Logs/dwelligence/local-runner.log` in their own terminal — Claude can't stream open-ended output, but the user can.

If the log is empty or doesn't exist, the runner hasn't fired its first cycle yet. Run `/runner-status` to diagnose.
