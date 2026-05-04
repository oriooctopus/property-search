---
description: Start the dev server on port 8000 (kills anything already on the port)
---

Start the Next.js dev server cleanly on port 8000.

```bash
# kill anything currently bound to 8000
lsof -ti:8000 | xargs kill -9 2>/dev/null
# also kill stale next dev processes that may have detached
pkill -f "next dev" 2>/dev/null

# start in background
cd web && nohup npm run dev > /tmp/dwelligence-dev.log 2>&1 &
```

Then wait for the server to come up and verify:

```bash
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/ | grep -q "200\|307\|308"; then
    echo "ready on port 8000"
    break
  fi
  sleep 2
done
```

Report:
- "Started on http://localhost:8000" + tail of `/tmp/dwelligence-dev.log` if the curl confirms 200/307/308.
- If still not up after ~20s, surface the log error and stop.

NEVER strip `--port 8000` from `web/package.json`. If you ever see the server come up on a different port, that's a bug — kill it and fix the package.json.
