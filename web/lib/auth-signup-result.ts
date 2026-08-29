// Classifies the outcome of supabase.auth.signUp() into the three states the
// signup UI needs to render. Extracted as a pure function (rather than left
// inline in each component) because the signup page and the auth modal both
// call signUp() and both need to react to the SAME three outcomes — without
// a shared classifier the two surfaces silently drift apart, which is exactly
// what happened before this file existed: neither surface handled the
// already-registered case.
//
// The "already registered" case is Supabase's deliberate anti-enumeration
// behavior: signing up with an email that already has a CONFIRMED account
// returns HTTP 200 with a fabricated user object instead of an error, and
// sends no email. The only signal that distinguishes it from a genuine new
// signup is `identities` — Supabase populates it with one entry for a real
// new signup and leaves it empty for the repeated-signup case. Verified
// empirically against the live Supabase project on 2026-08-29: a signup call
// for an address with a confirmed account returned
// `identities: []` (200 OK), containing no `error` and no `session`.
export type SignupResult =
  | { kind: "success-session" } // auto-confirm is on; session is already live
  | { kind: "confirm-email" } // genuine new signup; confirmation email sent
  | { kind: "already-registered" } // address already has a confirmed account; no email sent
  | { kind: "error"; message: string };

// Mirrors the shape of `{ error, data }` returned by
// `supabase.auth.signUp()`. Typed loosely (not imported from the supabase-js
// package) so this module has no dependency on the client and stays trivial
// to unit test with plain object literals.
interface SignupResponse {
  error: { message: string } | null;
  data: {
    session: unknown | null;
    user: { identities?: unknown[] | null } | null;
  };
}

export function classifySignupResult({ error, data }: SignupResponse): SignupResult {
  if (error) {
    return { kind: "error", message: error.message };
  }

  // Empty (but present) identities array = Supabase's silent signal for
  // "this address already has a confirmed account". Checked before the
  // session/confirm-email branches below because a repeated signup for an
  // address that also has no active session would otherwise fall through
  // to "confirm-email" and promise mail that will never arrive.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return { kind: "already-registered" };
  }

  if (data.session) {
    return { kind: "success-session" };
  }

  return { kind: "confirm-email" };
}
