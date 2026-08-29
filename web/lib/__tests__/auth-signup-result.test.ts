import { describe, it, expect } from "vitest";
import { classifySignupResult } from "../auth-signup-result";

describe("classifySignupResult", () => {
  it("returns already-registered when identities is empty (Supabase's repeated-signup signal)", () => {
    // Shape observed live against the Supabase project on 2026-08-29 for
    // rullman1357@gmail.com, an address with an existing confirmed account.
    const result = classifySignupResult({
      error: null,
      data: {
        session: null,
        user: {
          id: "4eb0969c-a28e-479a-ac28-a2d257b49c3e",
          email: "rullman1357@gmail.com",
          identities: [],
        } as unknown as { identities?: unknown[] | null },
      },
    });

    expect(result).toEqual({ kind: "already-registered" });
  });

  it("returns confirm-email for a genuine new signup (non-empty identities, no session)", () => {
    const result = classifySignupResult({
      error: null,
      data: {
        session: null,
        user: {
          id: "new-user-id",
          email: "brand-new@example.com",
          identities: [{ id: "identity-1", provider: "email" }],
        } as unknown as { identities?: unknown[] | null },
      },
    });

    expect(result).toEqual({ kind: "confirm-email" });
  });

  it("returns success-session when auto-confirm is on and a session comes back immediately", () => {
    const result = classifySignupResult({
      error: null,
      data: {
        session: { access_token: "token" },
        user: {
          id: "new-user-id",
          email: "brand-new@example.com",
          identities: [{ id: "identity-1", provider: "email" }],
        } as unknown as { identities?: unknown[] | null },
      },
    });

    expect(result).toEqual({ kind: "success-session" });
  });

  it("returns error when supabase returns an error, regardless of data", () => {
    const result = classifySignupResult({
      error: { message: "Password should be at least 6 characters" },
      data: { session: null, user: null },
    });

    expect(result).toEqual({
      kind: "error",
      message: "Password should be at least 6 characters",
    });
  });

  it("treats already-registered before confirm-email even without a user object present at all", () => {
    // Defensive case: no user object should never crash the classifier —
    // falls through to confirm-email rather than throwing, since there's
    // nothing that positively signals "already registered" here.
    const result = classifySignupResult({
      error: null,
      data: { session: null, user: null },
    });

    expect(result).toEqual({ kind: "confirm-email" });
  });
});
