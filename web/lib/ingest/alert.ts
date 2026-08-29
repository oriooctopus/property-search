/**
 * Ingest alert utility — sends email notifications via Resend when sources fail.
 *
 * Requires RESEND_API_KEY in env. If missing, logs a warning and skips.
 * Free tier: 100 emails/day, single API key, no OAuth.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";

// Resend's universal onboarding sender (onboarding@resend.dev) needs no domain
// verification but ONLY delivers to the Resend account owner's address. So
// alerts must go to INGEST_ALERT_EMAIL = that owner address until a domain is
// verified at resend.com/domains. Once verified, set INGEST_ALERT_FROM to an
// address on that domain and INGEST_ALERT_EMAIL can be any recipient.
const ALERT_FROM =
  process.env.INGEST_ALERT_FROM ??
  "Dwelligence Ingest <onboarding@resend.dev>";

// ---------------------------------------------------------------------------
// Cooldown — rules/alerting.md MANDATORY: "one message per problem, never one
// per occurrence." Without this, a recurring condition (e.g. the Craigslist
// discovery-floor check in strategies.ts, which runs on every ingest cycle)
// would re-email on every single run for as long as the condition holds. Real
// incident: 2026-08-28's first local run alerted once and would have kept
// alerting daily forever on a structurally-wrong floor (see
// craigslistDiscoveryAlertReason in strategies.ts) — the cooldown here is
// what stops the NEXT wrongly-tuned alert from becoming a daily page even
// after the floor logic itself is fixed.
//
// Keyed by exact subject string (not by source/condition — callers that want
// finer- or coarser-grained cooldowns control that via how they phrase the
// subject), persisted to a small JSON file so the cooldown survives across
// process restarts (a cron/timer run is a fresh process every time — an
// in-memory Set would reset every run and never suppress anything).
// ---------------------------------------------------------------------------

const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const DEFAULT_ALERT_STATE_PATH = join(
  homedir(),
  ".local",
  "state",
  "dwelligence",
  "alert-state.json",
);

// lockPath-style seam (see lib/sources/craigslist-local.ts's lockPath doc
// comment for the same pattern): defaults to the real production path
// everywhere except tests, which MUST override it (opts.statePath below) so
// a test run's cooldown state can never collide with — or get suppressed
// by — a real production alert history, or vice versa. On GitHub Actions
// runners this file is ephemeral (fresh filesystem per run), which just
// degrades to the pre-cooldown per-run alert behavior there — not a
// regression, since Actions never had cross-run persistence to lose.
function defaultAlertStatePath(): string {
  return process.env.DWELLIGENCE_ALERT_STATE_PATH ?? DEFAULT_ALERT_STATE_PATH;
}

function readAlertState(path: string): Record<string, number> {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    // Corrupt/partial state file — treat as empty rather than crashing the
    // alert path itself (an alert-about-alerting failure loop helps no one).
    return {};
  }
}

function writeAlertState(path: string, state: Record<string, number>): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state));
  } catch (err) {
    console.warn(
      "[alert] failed to persist alert cooldown state (alert will still send this time):",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * True if a message with this exact subject has NOT already been sent within
 * the last ALERT_COOLDOWN_MS (24h) — and, as a side effect, records this
 * moment as the subject's last-sent time when it returns true. Exported
 * separately from sendIngestAlert so a test can assert the decision without
 * exercising the network path at all.
 */
export function shouldSendAlert(
  subject: string,
  opts?: { statePath?: string; now?: number },
): boolean {
  const path = opts?.statePath ?? defaultAlertStatePath();
  const now = opts?.now ?? Date.now();
  const state = readAlertState(path);
  const last = state[subject];
  if (last != null && now - last < ALERT_COOLDOWN_MS) {
    return false;
  }
  state[subject] = now;
  writeAlertState(path, state);
  return true;
}

/** The actual Resend email send — factored out so tests can stub it via opts.send without hitting the network or needing a RESEND_API_KEY. */
async function defaultSend(subject: string, body: string): Promise<void> {
  // Read env vars at call time, not module load time — the ingest script
  // loads .env.local after this module is first imported.
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const alertTo = process.env.INGEST_ALERT_EMAIL ?? "oliverullman@gmail.com";

  if (!apiKey) {
    console.warn(
      "[alert] RESEND_API_KEY not set — skipping email alert. Subject:",
      subject,
    );
    return;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: ALERT_FROM,
        to: [alertTo],
        subject,
        text: body,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[alert] Resend API error ${res.status}: ${text}`);
    } else {
      console.log(`[alert] Email sent: ${subject}`);
    }
  } catch (err) {
    console.error(
      "[alert] Failed to send email:",
      err instanceof Error ? err.message : err,
    );
  }
}

export async function sendIngestAlert(
  subject: string,
  body: string,
  opts?: {
    /** Test-only seam — overrides the cooldown state file path (see defaultAlertStatePath's doc comment). Production callers never pass this. */
    statePath?: string;
    /** Test-only seam — overrides Date.now() for the cooldown check. */
    now?: number;
    /** Test-only seam — stubs the actual transport so tests never hit the real Resend API. Defaults to the real email send. */
    send?: (subject: string, body: string) => Promise<void>;
  },
): Promise<void> {
  if (!shouldSendAlert(subject, { statePath: opts?.statePath, now: opts?.now })) {
    console.log(`[alert] suppressed (cooldown): ${subject}`);
    return;
  }
  const send = opts?.send ?? defaultSend;
  await send(subject, body);
}
