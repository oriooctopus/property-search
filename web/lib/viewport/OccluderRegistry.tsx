'use client';

/**
 * Occluder registry — tiny React context that lets any UI chrome
 * component register itself as a viewport occluder. The mobile pin
 * visibility model (`isPinVisible` in ./occlusion.ts) reads from this
 * registry to decide whether the active map pin is actually visible.
 *
 * Usage:
 *   1. Mount <OccluderProvider> at the page root (web/app/page.tsx).
 *   2. In each occluding chrome component, hold a ref to the DOM node
 *      and call `useRegisterOccluder('id', () => ref.current?.getBoundingClientRect() ?? null)`.
 *   3. Consumers call `useOccluders()` to get the live list (returned
 *      via stable ref so this hook doesn't trigger re-renders on every
 *      registration churn).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import type { Occluder } from './occlusion';

interface OccluderRegistryRef {
  /** Returns a snapshot of currently-registered occluders. Stable identity. */
  getAll: () => Occluder[];
  /** Subscribe to registration changes (rarely needed; debug overlay uses it). */
  subscribe: (cb: () => void) => () => void;
}

interface OccluderContextValue {
  registry: OccluderRegistryRef;
  register: (id: string, getRect: () => DOMRect | null) => () => void;
}

const OccluderContext = createContext<OccluderContextValue | null>(null);

export function OccluderProvider({ children }: { children: ReactNode }) {
  // Stable storage: a Map keyed by id. We store getRect refs, not rects —
  // the rect is sampled on demand by the occlusion model.
  const occludersRef = useRef<Map<string, () => DOMRect | null>>(new Map());
  const subscribersRef = useRef<Set<() => void>>(new Set());

  const notify = useCallback(() => {
    for (const cb of subscribersRef.current) cb();
  }, []);

  const register = useCallback((id: string, getRect: () => DOMRect | null) => {
    occludersRef.current.set(id, getRect);
    notify();
    return () => {
      occludersRef.current.delete(id);
      notify();
    };
  }, [notify]);

  const registry = useMemo<OccluderRegistryRef>(
    () => ({
      getAll: () => {
        const out: Occluder[] = [];
        for (const [id, getRect] of occludersRef.current) {
          out.push({ id, getRect });
        }
        return out;
      },
      subscribe: (cb) => {
        subscribersRef.current.add(cb);
        return () => {
          subscribersRef.current.delete(cb);
        };
      },
    }),
    [],
  );

  const value = useMemo<OccluderContextValue>(
    () => ({ registry, register }),
    [registry, register],
  );

  return <OccluderContext.Provider value={value}>{children}</OccluderContext.Provider>;
}

/**
 * Register a DOM element as an occluder for the lifetime of the calling
 * component. `id` must be unique; later registrations with the same id
 * silently overwrite (last-mounted wins) — caller responsibility.
 *
 * `getRectRef` is invoked synchronously by the occlusion model — keep it
 * cheap (a single `getBoundingClientRect()` is fine).
 */
export function useRegisterOccluder(
  id: string,
  getRectRef: () => DOMRect | null,
  enabled: boolean = true,
) {
  const ctx = useContext(OccluderContext);
  // Capture the latest getRect in a ref so we don't unregister/re-register
  // every render just because the function identity changed.
  const latestGetRectRef = useRef(getRectRef);
  useEffect(() => {
    latestGetRectRef.current = getRectRef;
  }, [getRectRef]);

  useEffect(() => {
    if (!ctx || !enabled) return;
    return ctx.register(id, () => latestGetRectRef.current());
  }, [ctx, id, enabled]);
}

/**
 * Returns the registry handle. The handle's `getAll()` is stable; call
 * it inside your computation (e.g. inside a useEffect or a frame loop)
 * to get a fresh snapshot. This hook does NOT cause re-renders when the
 * underlying set changes — subscribe via `registry.subscribe` if you
 * need that (debug overlay only).
 */
export function useOccluders(): OccluderRegistryRef | null {
  const ctx = useContext(OccluderContext);
  return ctx?.registry ?? null;
}
