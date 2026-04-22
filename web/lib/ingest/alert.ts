/**
 * Ingest alert utility — sends email notifications via Resend when sources fail.
 *
 * Requires RESEND_API_KEY in env. If missing, logs a warning and skips.
 * Free tier: 100 emails/day, single API key, no OAuth.
 */

// Resend requires a verified sender domain. dwelligence.ai isn't verified yet,
// so fall back to Resend's universal onboarding sender when ALERT_FROM isn't
// set. Override via INGEST_ALERT_FROM once the domain is verified.
const ALERT_FROM =
  process.env.INGEST_ALERT_FROM ??
  "Dwelligence Ingest <onboarding@resend.dev>";

export async function sendIngestAlert(
  subject: string,
  body: string,
): Promise<void> {
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
