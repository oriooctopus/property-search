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
});
