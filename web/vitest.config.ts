import { defineConfig } from "vitest/config";
import path from "path";

// Minimal config: resolves the "@/*" path alias (defined in tsconfig.json)
// so tests can import from files that use it — e.g.
// app/api/listings/search/route.ts imports "@/lib/commute-resolver". Without
// this, vitest (run standalone, not through Next.js's webpack/SWC pipeline)
// can't resolve those imports at all. Everything else is left at vitest's
// defaults; existing tests that don't touch "@/" imports are unaffected.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  // tsconfig.json sets "jsx": "preserve" (Next.js's own SWC pipeline does
  // the JSX transform at build time). Vitest 4 transforms .tsx via oxc,
  // which by default inherits that "preserve" setting from tsconfig and
  // leaves JSX syntax untouched, producing invalid JS the import-analysis
  // step can't parse. Every existing test that imports a real .tsx
  // component (e.g. search-pin-layer.test.ts's SearchPinLayer) happens to
  // import one with no actual JSX in it, so this never surfaced before.
  // Override just for Vitest's own transform; tsconfig.json / Next's build
  // are untouched.
  oxc: {
    jsx: { runtime: "automatic" },
  },
});
