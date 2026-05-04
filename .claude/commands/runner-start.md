---
description: Start the local-runner scraper (after a /runner-stop)
---

Start the self-hosted scraper. Use after `/runner-stop` or after a fresh clone.

If never installed:

```bash
cp web/scripts/com.dwelligence.local-runner.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.dwelligence.local-runner.plist
```

If previously installed:

```bash
launchctl load ~/Library/LaunchAgents/com.dwelligence.local-runner.plist
```

Then wait 10s and verify cycle 1 fired:

```bash
sleep 10
launchctl list | grep dwelligence
tail -10 ~/Library/Logs/dwelligence/local-runner.log
```

If launchctl returns "Operation already in progress" or "service already loaded", that's fine — runner is already running.

Report a one-line confirmation including the latest cycle timestamp.
