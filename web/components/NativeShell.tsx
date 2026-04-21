'use client';

/**
 * Client-only component that runs Capacitor native-shell initialization:
 * - Sets the iOS status bar style to match Dwelligence's dark theme.
 * - Wires up the Keyboard plugin so inputs scroll into view above the
 *   software keyboard.
 *
 * Renders nothing. Safe to include in any layout — every call is guarded by
 * `isNative()` and wrapped in try/catch, so it's a pure no-op on the web.
 */

import { useEffect } from 'react';
import { isNative, setStatusBarStyle } from '@/lib/native';

export default function NativeShell() {
  useEffect(() => {
    if (!isNative()) return;

    // Match the app's dark chrome (#0f1117 background).
    void setStatusBarStyle('light');

    // Keyboard handling — scroll focused input into view on iOS.
    let cleanupKeyboard: (() => void) | null = null;
    (async () => {
      try {
        const { Keyboard, KeyboardResize } = await import('@capacitor/keyboard');
        await Keyboard.setResizeMode({ mode: KeyboardResize.Native });
        await Keyboard.setScroll({ isDisabled: false });

        const onShow = () => {
          const el = document.activeElement as HTMLElement | null;
          if (el && typeof el.scrollIntoView === 'function') {
            setTimeout(() => {
              el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }, 100);
          }
        };
        const handle = await Keyboard.addListener('keyboardDidShow', onShow);
        cleanupKeyboard = () => {
          void handle.remove();
        };
      } catch {
        // Plugin not available — skip.
      }
    })();

    return () => {
      cleanupKeyboard?.();
    };
  }, []);

  return null;
}
