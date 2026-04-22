// Minimal service worker — exists solely to satisfy PWA installability
// criteria (browsers want a fetch handler registered before they show the
// install prompt). Does NOT cache anything: every request is passed straight
// through to the network. Offline support is intentionally out of scope.
//
// If we ever want offline fallbacks or precaching, swap this for a real
// strategy (next-pwa, Workbox, or a hand-rolled one) — but doing nothing here
// keeps the install path simple and avoids stale-cache footguns.

self.addEventListener("install", () => {
  // Activate the new SW immediately on install instead of waiting for all
  // existing tabs to close. Safe because we don't do any caching that would
  // need a coordinated cutover.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of any already-open pages on first activation.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // No-op fetch handler. The presence of *any* fetch handler is what makes
  // Chrome consider the app installable; the default network behavior runs
  // when we don't call event.respondWith().
});
