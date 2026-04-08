/**
 * Small retry helper with exponential backoff.
 *
 * Default: 3 tries, 500ms → 1000ms → 2000ms.
 */

export interface RetryOpts {
  tries?: number;
  backoffMs?: number;
  onAttempt?: (attempt: number, err: unknown) => void;
}

export async function withRetries<T>(
  fn: () => Promise<T>,
  opts: RetryOpts = {},
): Promise<T> {
  const tries = opts.tries ?? 3;
  const base = opts.backoffMs ?? 500;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      opts.onAttempt?.(attempt, err);
      if (attempt === tries) break;
      const wait = base * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}
