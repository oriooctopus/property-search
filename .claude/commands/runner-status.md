---
description: Check the local-runner scraper — is it alive, last cycle, recent activity
---

Check the local self-hosted scraper runner installed via launchd.

Run these in parallel via Bash:

1. `launchctl list | grep dwelligence` — confirms loaded; non-empty = launchctl knows about it.
2. `ps -ef | grep "local-runner.ts" | grep -v grep` — confirms a process is actually running (PID, elapsed time, RSS).
3. `tail -25 ~/Library/Logs/dwelligence/local-runner.log` — last 25 log lines.
4. `stat -f "%Sm %z bytes" ~/Library/Logs/dwelligence/local-runner.log` — log mtime + size as a freshness sanity check.

Report a 4-line verdict:

```
loaded: yes/no
process: PID <id>, alive <elapsed>
last cycle: <iso timestamp> kind=<fetch|verify> outcome=<one-line summary>
log freshness: <minutes ago>
```

If the launchctl entry exists but no process is running, OR the log mtime is >5 min stale, flag it as "POSSIBLY STALLED — recommend `/runner-restart`."

If everything looks healthy, say so in one line.

Reference: `web/scripts/README-local-runner.md` for the full setup.
