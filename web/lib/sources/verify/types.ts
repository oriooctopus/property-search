/**
 * Types for the listing stale-detection system.
 *
 * A verifier is a pure function that takes a listing URL and returns a
 * discriminated VerifyResult. The verify-stale phase dispatches per-source
 * via the registry and never branches on source internally.
 */

export type VerifyResult =
  | { status: "active" }
  | { status: "delisted"; delistedAt: Date | null; reason: string }
  | { status: "unknown"; reason: string };

export interface VerifyDeps {
  /** Apify proxy token — required for sources that need residential proxy (SE, FB). */
  apifyToken?: string;
  /** Per-request timeout in ms. Defaults to 15_000. */
  fetchTimeout?: number;
}

export type Verifier = (url: string, deps: VerifyDeps) => Promise<VerifyResult>;
