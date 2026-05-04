---
description: Restart the local-runner scraper cleanly (unload + reload launchd)
---

Restart the self-hosted scraper. Use when `/runner-status` flags STALLED, or after pulling new code that changes the runner.

Run sequentially:

1. `launchctl unload ~/Library/LaunchAgents/com.dwelligence.local-runner.plist` — graceful stop. Process will get SIGTERM, finish current cycle, and exit (handler in `web/scripts/local-runner.ts`).
2. `sleep 2` — give it a beat.
3. `cp web/scripts/com.dwelligence.local-runner.plist ~/Library/LaunchAgents/` — refresh the plist in case it changed in the repo.
4. `launchctl load ~/Library/LaunchAgents/com.dwelligence.local-runner.plist`
5. `sleep 8` — let cycle 1 fire.
6. `launchctl list | grep dwelligence && tail -10 ~/Library/Logs/dwelligence/local-runner.log`

Report whether cycle 1 fired cleanly. If it didn't (no new log lines, or process not in launchctl list), surface the error from the log.

DO NOT do this if the user hasn't explicitly asked or if `/runner-status` shows a healthy runner — restarting drops the current cycle.
