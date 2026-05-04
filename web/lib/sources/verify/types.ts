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
  /**
   * When true, sources that normally proxy-only (SE, FB) try direct fetch
   * first and fall back to proxy on 403 / captcha. Set by the local-runner
   * when running on a residential ISP. Vercel cron leaves this unset
   * because direct fetches from datacenter IPs always 403.
   */
  preferDirect?: boolean;
}

export type Verifier = (url: string, deps: VerifyDeps) => Promise<VerifyResult>;
