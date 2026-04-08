/**
 * Tiny per-phase logger that prefixes console output with [phase].
 */

export interface PhaseLogger {
  info: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
  error: (...a: unknown[]) => void;
}

export function phaseLogger(phase: string): PhaseLogger {
  return {
    info: (...a: unknown[]) => console.log(`[${phase}]`, ...a),
    warn: (...a: unknown[]) => console.warn(`[${phase}]`, ...a),
    error: (...a: unknown[]) => console.error(`[${phase}]`, ...a),
  };
}
