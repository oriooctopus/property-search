'use client';

import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// PointerDebugger — captures real-device pointer/touch event streams.
//
// Mounted only when `?ptdebug=1` is in the URL. Attaches global capture-phase
// listeners on document so it sees every event before any other handler can
// stopPropagation. Buffers events in memory and POSTs to /api/ptdebug in
// batches.
//
// Usage:
//   1. Apply web/supabase/migrations/ptdebug_sessions.sql once.
//   2. Open the app on a real iPhone:
//        https://dwelligence.vercel.app/?ptdebug=1
//   3. Note the session ID shown in the floating overlay.
//   4. Perform the failing gesture (e.g. swipe-from-photo).
//   5. Tap "End session" in the overlay (or just navigate away — events
//      auto-flush every 2s and on visibilitychange).
//   6. Read the events:
//        curl https://dwelligence.vercel.app/api/ptdebug?session=<id> | jq
//      Or query the ptdebug_sessions table directly.
//
// What we capture (the WHOLE point — to compare against synthetic CDP):
//   - pointerdown / pointermove / pointerup / pointercancel
//   - touchstart / touchmove / touchend / touchcancel
//   - gesturestart / gesturechange / gestureend (iOS-specific)
//   - scroll (so we can correlate "browser claimed it" with our gesture loss)
// ---------------------------------------------------------------------------

const POINTER_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const;
const TOUCH_EVENTS = ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const;
const IOS_GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'] as const;

interface CapturedEvent {
  t: number; // timeStamp relative to session start
  type: string;
  // Pointer event fields
  pointerId?: number;
  pointerType?: string;
  isPrimary?: boolean;
  x?: number;
  y?: number;
  pressure?: number;
  // Touch event fields
  touches?: number; // count
  changedTouches?: number;
  // Target element selector
  target?: string;
  // Whether the event was cancelable (preventable)
  cancelable?: boolean;
  // Whether default was prevented
  defaultPrevented?: boolean;
}

function describeTarget(el: EventTarget | null): string {
  if (!(el instanceof Element)) return '?';
  const id = el.id ? `#${el.id}` : '';
  const cls = el.className && typeof el.className === 'string'
    ? '.' + el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')
    : '';
  const testId = (el as HTMLElement).dataset?.testid;
  const testIdPart = testId ? `[data-testid="${testId}"]` : '';
  return `${el.tagName.toLowerCase()}${id}${testIdPart}${cls}`.slice(0, 120);
}

function makeSessionId(): string {
  return (
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 8)
  );
}

export default function PointerDebugger() {
  const [enabled, setEnabled] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const [flushedCount, setFlushedCount] = useState(0);
  const [flushError, setFlushError] = useState<string | null>(null);
  const bufferRef = useRef<CapturedEvent[]>([]);
  const startTimeRef = useRef<number>(0);
  const flushingRef = useRef(false);

  // Decide whether to enable on mount based on URL search param
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('ptdebug') === '1') {
      setEnabled(true);
      setSessionId(makeSessionId());
      startTimeRef.current = performance.now();
    }
  }, []);

  // Attach capture-phase listeners + periodic flush
  useEffect(() => {
    if (!enabled || !sessionId) return;

    const push = (type: string, ev: Event) => {
      const e: CapturedEvent = {
        t: performance.now() - startTimeRef.current,
        type,
        target: describeTarget(ev.target),
        cancelable: ev.cancelable,
        defaultPrevented: ev.defaultPrevented,
      };
      // PointerEvent fields
      const pe = ev as PointerEvent;
      if (typeof pe.pointerId === 'number') {
        e.pointerId = pe.pointerId;
        e.pointerType = pe.pointerType;
        e.isPrimary = pe.isPrimary;
        e.x = pe.clientX;
        e.y = pe.clientY;
        e.pressure = pe.pressure;
      }
      // TouchEvent fields
      const te = ev as TouchEvent;
      if (te.touches !== undefined && te.changedTouches !== undefined) {
        e.touches = te.touches.length;
        e.changedTouches = te.changedTouches.length;
        const t0 = te.changedTouches[0];
        if (t0) {
          e.x = e.x ?? t0.clientX;
          e.y = e.y ?? t0.clientY;
        }
      }
      bufferRef.current.push(e);
      setEventCount(bufferRef.current.length);
    };

    const handlers: Array<[string, EventListener]> = [];
    for (const t of [...POINTER_EVENTS, ...TOUCH_EVENTS, ...IOS_GESTURE_EVENTS]) {
      const h: EventListener = (ev) => push(t, ev);
      handlers.push([t, h]);
      // Capture phase + passive so we don't accidentally affect the page's behavior
      document.addEventListener(t, h, { capture: true, passive: true });
    }
    // Scroll on document so we can correlate when the browser claims the gesture
    const scrollHandler: EventListener = (ev) => push('scroll', ev);
    handlers.push(['scroll', scrollHandler]);
    document.addEventListener('scroll', scrollHandler, { capture: true, passive: true });

    return () => {
      for (const [t, h] of handlers) {
        document.removeEventListener(t, h, { capture: true } as EventListenerOptions);
      }
    };
  }, [enabled, sessionId]);

  // Flush buffer to API every 2s and on visibilitychange
  useEffect(() => {
    if (!enabled || !sessionId) return;

    const flush = async () => {
      if (flushingRef.current) return;
      const events = bufferRef.current.splice(0);
      if (events.length === 0) return;
      flushingRef.current = true;
      try {
        const res = await fetch('/api/ptdebug', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            userAgent: navigator.userAgent,
            viewportW: window.innerWidth,
            viewportH: window.innerHeight,
            events,
          }),
          // Use keepalive so the request can survive page unload
          keepalive: true,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          setFlushError(`HTTP ${res.status}: ${text.slice(0, 120)}`);
          // Re-queue so we don't lose data
          bufferRef.current.unshift(...events);
        } else {
          setFlushedCount((c) => c + events.length);
          setFlushError(null);
        }
      } catch (e) {
        setFlushError(e instanceof Error ? e.message : 'flush failed');
        bufferRef.current.unshift(...events);
      } finally {
        flushingRef.current = false;
        setEventCount(bufferRef.current.length);
      }
    };

    const interval = window.setInterval(flush, 2000);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      // One last flush on unmount
      flush();
    };
  }, [enabled, sessionId]);

  if (!enabled || !sessionId) return null;

  const totalCaptured = eventCount + flushedCount;

  return (
    <div
      style={{
        position: 'fixed',
        top: 'env(safe-area-inset-top, 0px)',
        right: 8,
        zIndex: 99999,
        backgroundColor: 'rgba(15, 17, 23, 0.92)',
        color: '#e6edf3',
        border: '1px solid #58a6ff',
        borderRadius: 8,
        padding: '6px 10px',
        fontSize: 11,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        maxWidth: 220,
        pointerEvents: 'auto',
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
      }}
    >
      <div style={{ color: '#58a6ff', fontWeight: 700, marginBottom: 2 }}>ptdebug</div>
      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, color: '#7d8590', wordBreak: 'break-all' }}>
        {sessionId}
      </div>
      <div style={{ marginTop: 4, color: '#7ee787' }}>
        captured: {totalCaptured} (flushed: {flushedCount}, queued: {eventCount})
      </div>
      {flushError && (
        <div style={{ marginTop: 4, color: '#f85149', fontSize: 10 }}>
          err: {flushError}
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          // Manual flush + log session id prominently
          // eslint-disable-next-line no-alert
          window.prompt('Session ID (copy this):', sessionId);
        }}
        style={{
          marginTop: 6,
          width: '100%',
          padding: '4px 0',
          fontSize: 11,
          fontWeight: 600,
          borderRadius: 4,
          border: 'none',
          backgroundColor: '#58a6ff',
          color: '#0f1117',
          cursor: 'pointer',
        }}
      >
        Show session ID
      </button>
    </div>
  );
}
