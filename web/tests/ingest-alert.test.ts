/**
 * Tests for the Craigslist discovery-floor alert DECISION
 * (lib/ingest/strategies.ts's craigslistDiscoveryAlertReason) and the
 * per-subject alert COOLDOWN (lib/ingest/alert.ts's sendIngestAlert /
 * shouldSendAlert).
 *
 * Incident this guards against (2026-08-28): the old floor compared
 * `discovered` against a fraction of sapi.craigslist.org's totalResultCount.
 * Craigslist has no working pagination post-redesign (see the comment in
 * lib/sources/craigslist.ts's SEARCH_ONLY_PAGE_FUNCTION), so a single search
 * page can never reach even 50% of sapi's FULL live result count once that
 * count exceeds ~2x a healthy page — this fired on a completely normal run
 * (258 discovered vs. a computed floor of 1404) and would have emailed every
 * single day. Two independent fixes, each tested in isolation:
 *   1. The floor decision no longer depends on sapi's total at all.
 *   2. Even if a decision function were wrong again, sendIngestAlert's own
 *      24h cooldown (rules/alerting.md MANDATORY "one message per problem")
 *      caps the damage to one email per subject per day.
 *
 * Run with: npx vitest run tests/ingest-alert.test.ts
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { craigslistDiscoveryAlertReason } from "../lib/ingest/strategies";
import { sendIngestAlert } from "../lib/ingest/alert";

function tmpStatePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "alert-state-test-"));
  return join(dir, "alert-state.json");
}

const tmpDirs: string[] = [];
afterEach(() => {
  // Best-effort cleanup — not load-bearing for correctness, just tidy.
  for (const p of tmpDirs.splice(0)) {
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

// ===========================================================================
// craigslistDiscoveryAlertReason — the floor DECISION, no network/browser.
// ===========================================================================
describe("craigslistDiscoveryAlertReason", () => {
  it("258 discovered, not blocked, no variant miss => null (healthy day, no alert)", () => {
    expect(
      craigslistDiscoveryAlertReason({ discovered: 258, blocked: false, staticVariantMissing: false }),
    ).toBeNull();
  });

  it("0 discovered => a reason (floor breach)", () => {
    const reason = craigslistDiscoveryAlertReason({
      discovered: 0,
      blocked: false,
      staticVariantMissing: false,
    });
    expect(reason).not.toBeNull();
    expect(typeof reason).toBe("string");
  });

  it("blocked:true => a reason, regardless of discovered count", () => {
    const reason = craigslistDiscoveryAlertReason({
      discovered: 999,
      blocked: true,
      staticVariantMissing: false,
    });
    expect(reason).not.toBeNull();
  });

  it("staticVariantMissing:true => a reason, regardless of discovered count", () => {
    const reason = craigslistDiscoveryAlertReason({
      discovered: 999,
      blocked: false,
      staticVariantMissing: true,
    });
    expect(reason).not.toBeNull();
  });

  it("THE INCIDENT: 258 discovered with a large sapi totalResultCount must NOT influence the decision — the function doesn't even accept that field", () => {
    // sapiTotalResultCount=2809 would have produced a computed floor of 1404
    // under the old ratio logic (2809 * 0.5), which 258 fails badly. The
    // fixed function's parameter type doesn't even have a slot for this
    // field — passing extra properties (TS structural typing) proves it's
    // genuinely unused, not just untested.
    const res = {
      discovered: 258,
      blocked: false,
      staticVariantMissing: false,
      sapiTotalResultCount: 2809,
    };
    expect(craigslistDiscoveryAlertReason(res)).toBeNull();
  });
});

// ===========================================================================
// sendIngestAlert — 24h per-subject cooldown, transport stubbed via opts.send
// so this NEVER hits the real Resend API or needs RESEND_API_KEY.
// ===========================================================================
describe("sendIngestAlert — 24h per-subject cooldown", () => {
  it("first call sends; second call within 24h is suppressed; a 25h-old timestamp sends again", async () => {
    const statePath = tmpStatePath();
    tmpDirs.push(join(statePath, ".."));
    const sent: string[] = [];
    const stubSend = async (subject: string, _body: string) => {
      sent.push(subject);
    };

    const t0 = Date.now();

    // First call — nothing in the state file yet, so it sends.
    await sendIngestAlert("[Test] subject A", "body 1", { statePath, now: t0, send: stubSend });
    expect(sent).toEqual(["[Test] subject A"]);

    // Second call, same subject, 1 hour later — well within the 24h cooldown
    // — must be suppressed (stubSend not called again).
    await sendIngestAlert("[Test] subject A", "body 2", {
      statePath,
      now: t0 + 60 * 60 * 1000,
      send: stubSend,
    });
    expect(sent).toEqual(["[Test] subject A"]); // unchanged

    // A DIFFERENT subject at the same moment must NOT be suppressed by
    // subject A's cooldown — cooldown is keyed per-subject, not global.
    await sendIngestAlert("[Test] subject B", "body", {
      statePath,
      now: t0 + 60 * 60 * 1000,
      send: stubSend,
    });
    expect(sent).toEqual(["[Test] subject A", "[Test] subject B"]);

    // Simulate the recorded timestamp being 25h old (outside the 24h
    // cooldown) — the next call for subject A must send again.
    writeFileSync(
      statePath,
      JSON.stringify({
        "[Test] subject A": t0 - 25 * 60 * 60 * 1000,
        "[Test] subject B": t0 + 60 * 60 * 1000,
      }),
    );
    await sendIngestAlert("[Test] subject A", "body 3", {
      statePath,
      now: t0 + 2 * 60 * 60 * 1000,
      send: stubSend,
    });
    expect(sent).toEqual(["[Test] subject A", "[Test] subject B", "[Test] subject A"]);
  });
});
