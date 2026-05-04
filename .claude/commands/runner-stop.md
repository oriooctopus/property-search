---
description: Stop the local-runner scraper (use before going offline / debugging)
---

Cleanly stop the self-hosted scraper. Use when:
- Going offline / traveling.
- Debugging the runner code itself.
- Pausing during a known maintenance window.

Run:

```bash
launchctl unload ~/Library/LaunchAgents/com.dwelligence.local-runner.plist
```

Then verify it's gone:

```bash
launchctl list | grep dwelligence || echo "stopped cleanly"
ps -ef | grep "local-runner.ts" | grep -v grep || echo "no process"
```

Report a one-line confirmation.

To resume later: `/runner-start` (or just `launchctl load ~/Library/LaunchAgents/com.dwelligence.local-runner.plist`).

While stopped, the Vercel daily cron at 16:00 UTC keeps the data flowing. Don't worry about gaps under a few days.
