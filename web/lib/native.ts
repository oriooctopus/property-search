/**
 * Thin wrapper around Capacitor native plugins.
 *
 * The web app at dwelligence.vercel.app is loaded both as a regular web page
 * AND inside a Capacitor WebView (iOS/mobile shell). These helpers detect the
 * runtime and conditionally invoke native plugins when available, falling back
 * to browser equivalents (or silent no-ops) on the web.
 *
 * All plugin imports are dynamic so they tree-shake out of web bundles when
 * the calls are never made, and so a missing plugin at runtime (e.g. web
 * deploy without the shell) never throws.
 */

export type HapticStyle = 'light' | 'medium' | 'heavy' | 'selection';
export type StatusBarStyle = 'light' | 'dark';

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

interface WindowWithCapacitor extends Window {
  Capacitor?: CapacitorGlobal;
}

/** True when the app is running inside a Capacitor native shell. */
export function isNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as WindowWithCapacitor).Capacitor;
  try {
    return Boolean(cap?.isNativePlatform?.());
  } catch {
    return false;
  }
}

/**
 * Fire a native haptic. No-op on web (or if the plugin fails to load). Safe
 * to call from any event handler — never throws.
 */
export async function triggerHaptic(style: HapticStyle): Promise<void> {
  if (!isNative()) return;
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    if (style === 'selection') {
      await Haptics.selectionStart();
      await Haptics.selectionEnd();
      return;
    }
    const impact =
      style === 'light'
        ? ImpactStyle.Light
        : style === 'medium'
          ? ImpactStyle.Medium
          : ImpactStyle.Heavy;
    await Haptics.impact({ style: impact });
  } catch {
    // Plugin not available or call failed — silently no-op.
  }
}

export interface ShareListingPayload {
  title: string;
  text: string;
  url: string;
}

/**
 * Share a listing. On native, uses the iOS share sheet. On web, falls back to
 * `navigator.share` if available (mobile browsers support it), otherwise
 * copies the URL to clipboard. Returns a tag describing what actually happened
 * so callers can show UI feedback (e.g. a "Link copied" toast).
 */
export async function shareListing(
  payload: ShareListingPayload,
): Promise<'native' | 'web-share' | 'clipboard' | 'failed'> {
  if (isNative()) {
    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({
        title: payload.title,
        text: payload.text,
        url: payload.url,
        dialogTitle: payload.title,
      });
      return 'native';
    } catch {
      // fall through to web fallback
    }
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: payload.title,
        text: payload.text,
        url: payload.url,
      });
      return 'web-share';
    } catch {
      // user cancelled or share failed — fall through to clipboard
    }
  }

  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(payload.url);
      return 'clipboard';
    } catch {
      return 'failed';
    }
  }

  return 'failed';
}

/**
 * Set the iOS status-bar content style. No-op on web.
 * - 'light' = light content (for dark app backgrounds)
 * - 'dark'  = dark content (for light app backgrounds)
 */
export async function setStatusBarStyle(style: StatusBarStyle): Promise<void> {
  if (!isNative()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({
      style: style === 'light' ? Style.Light : Style.Dark,
    });
  } catch {
    // Plugin not available — no-op.
  }
}
