"use client";

import { useEffect } from "react";

// Registers the no-op service worker that lives at /sw.js. Required for the
// browser to consider Dwelligence installable as a PWA — Chrome's install
// criteria need a service worker with a fetch handler at minimum.
//
// Skipped in development to avoid stale-cache headaches on the dev server.
// Vercel previews and production both run as NODE_ENV=production so they will
// register normally.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    // Fire-and-forget. A registration failure here would only mean the user
    // can't install the PWA — the rest of the site still works fine.
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Intentionally swallow — see comment above.
    });
  }, []);

  return null;
}
