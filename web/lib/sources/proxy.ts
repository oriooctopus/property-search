/**
 * Shared Apify residential proxy fetch helper.
 *
 * Both the StreetEasy full-bisection crawler and the verifier pipeline route
 * their requests through Apify's residential proxy (SE 403s any direct
 * request). This module centralizes that plumbing so both callers construct
 * the HttpsProxyAgent + https.request wrapper the same way.
 */

import https from "https";
import { HttpsProxyAgent } from "https-proxy-agent";

/**
 * Resolve an Apify proxy URL. Apify exposes the proxy as a full URL of the
 * form `http://<username>:<password>@proxy.apify.com:8000` where the password
 * is the *proxy password* (distinct from the Apify API token). We do NOT try
 * to construct this from APIFY_TOKEN — the two credentials are different.
 *
 * Resolution order:
 *   1. `explicitUrl` argument (a full proxy URL, if caller already has one)
 *   2. process.env.APIFY_PROXY_URL
 *
 * Returns null if neither is set — callers should treat that as "proxy
 * unavailable" rather than throwing.
 */
export function resolveApifyProxyUrl(explicitUrl?: string): string | null {
  if (explicitUrl && explicitUrl.startsWith("http")) return explicitUrl;
  if (process.env.APIFY_PROXY_URL) return process.env.APIFY_PROXY_URL;
  return null;
}

/**
 * Rewrite an Apify proxy URL to force a US residential group with a fresh
 * session id. Each call returns a URL bound to a brand-new upstream IP, which
 * is what we need to slip past PerimeterX on streeteasy.com HTML pages (the
 * default `auto` username is sticky and gets flagged fast).
 */
export function withRotatingSession(baseUrl: string, sessionSeed?: string): string {
  try {
    const u = new URL(baseUrl);
    const password = u.password;
    if (!password) return baseUrl;
    const session = sessionSeed ?? `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const username = `groups-RESIDENTIAL,country-US,session-${session}`;
    return `http://${username}:${password}@${u.host}`;
  } catch {
    return baseUrl;
  }
}

/**
 * Build a fetch-compatible function that routes every request through an
 * Apify residential proxy via HttpsProxyAgent. Follows redirects up to
 * `maxRedirects` times (fetch's native redirect handling doesn't carry the
 * agent across hops).
 */
export function makeProxyFetch(
  apifyProxyUrl: string,
  opts: { maxRedirects?: number } = {},
): typeof fetch {
  const agent = new HttpsProxyAgent(apifyProxyUrl);
  const maxRedirects = opts.maxRedirects ?? 5;

  const doFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;

      const bodyStr = init?.body as string | undefined;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      let redirectsLeft = maxRedirects;
      let currentUrl = url;

      // Settle the promise exactly once. Without this guard, an `'error'`
      // event after a partial response (e.g. proxy drops the socket mid-stream)
      // would race with `'end'` and double-call resolve/reject — or worse,
      // never call either if the response stream's `'error'` event has no
      // listener and `'end'` never fires. Either way the awaiter would hang
      // forever, the underlying socket would close, and Node would silently
      // exit 0 once enough orphaned promises accumulated.
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const request = (target: string) => {
        const req = https.request(
          target,
          { method: init?.method ?? "GET", headers, agent },
          (res) => {
            const statusCode = res.statusCode ?? 200;
            // Manual redirect handling so HttpsProxyAgent is reused.
            if (
              [301, 302, 303, 307, 308].includes(statusCode) &&
              res.headers.location &&
              redirectsLeft > 0
            ) {
              redirectsLeft--;
              const nextUrl = new URL(res.headers.location, currentUrl).href;
              currentUrl = nextUrl;
              res.resume();
              request(nextUrl);
              return;
            }
            let data = "";
            res.on("data", (c: Buffer) => (data += c));
            res.on("end", () => {
              settle(() => {
                const response = new Response(data, {
                  status: statusCode,
                  headers: res.headers as HeadersInit,
                });
                // Expose the final URL after redirects via a non-standard prop;
                // callers that need it should read it off the wrapper instead
                // of Response.url (which is read-only).
                (response as unknown as { __finalUrl: string }).__finalUrl =
                  currentUrl;
                resolve(response);
              });
            });
            // Critical: when a proxy drops the socket mid-response (very common
            // on residential proxies under load), Node emits `'error'` and
            // `'close'` on the IncomingMessage but NOT `'end'`. Without these
            // listeners the awaiter would hang forever on a promise that never
            // settles, the socket would close (releasing its handle), and the
            // process would silently exit 0 the moment all in-flight requests
            // ended up in this state. Reject loud + once via `settle`.
            res.on("error", (err) =>
              settle(() => reject(err instanceof Error ? err : new Error(String(err)))),
            );
            res.on("close", () => {
              if (!settled) {
                settle(() =>
                  reject(
                    new Error(
                      `proxy response closed before end (status=${statusCode}, bytes=${data.length})`,
                    ),
                  ),
                );
              }
            });
          },
        );
        req.on("error", (err) =>
          settle(() => reject(err instanceof Error ? err : new Error(String(err)))),
        );
        // Belt-and-suspenders: if the request socket is destroyed without
        // emitting 'error' or 'response', the promise would still hang.
        req.on("close", () => {
          if (!settled) {
            settle(() =>
              reject(new Error("proxy request socket closed before response")),
            );
          }
        });
        if (bodyStr) req.write(bodyStr);
        req.end();
      };

      request(currentUrl);
    })) as typeof fetch;

  return doFetch;
}
