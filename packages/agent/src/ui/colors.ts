/**
 * Unified color scheme module for AI Installer agent.
 *
 * Integrates openclaw-modules/terminal/palette.ts to provide a consistent
 * color palette across all terminal UI output. Respects NO_COLOR and
 * FORCE_COLOR environment variables.
 *
 * @module ui/colors
 */

import chalk, { Chalk, type ChalkInstance } from 'chalk';

// ============================================================================
// Palette tokens
// ============================================================================

/**
 * AI Installer palette tokens, inspired by the Lobster palette
 * from openclaw-modules/terminal/palette.ts.
 */
export const PALETTE = {
  accent: '#FF5A2D',
  accentBright: '#FF7A3D',
  accentDim: '#D14A22',
  info: '#FF8A5B',
  success: '#2FBF71',
  warn: '#FFB020',
  error: '#E23D2D',
  muted: '#8B7F77',
} as const;

export type PaletteKey = keyof typeof PALETTE;

// ============================================================================
// Chalk instance
// ============================================================================

/**
 * Determine whether color output is forced via FORCE_COLOR env var.
 */
function hasForceColor(): boolean {
  const val = process.env.FORCE_COLOR;
  return typeof val === 'string' && val.trim().length > 0 && val.trim() !== '0';
}

/**
 * Create the base Chalk instance respecting NO_COLOR / FORCE_COLOR.
 */
function createBaseChalk(): ChalkInstance {
  if (process.env.NO_COLOR && !hasForceColor()) {
    return new Chalk({ level: 0 });
  }
  if (hasForceColor()) {
    return new Chalk({ level: 3 });
  }
  return chalk;
}

let baseChalk = createBaseChalk();

// ============================================================================
// Theme
// ============================================================================

function buildTheme(c: ChalkInstance) {
  const hex = (value: string) => c.hex(value);
  return {
    /** Primary accent color */
    accent: hex(PALETTE.accent),
    /** Brighter accent for highlights */
    accentBright: hex(PALETTE.accentBright),
    /** Dimmer accent for secondary elements */
    accentDim: hex(PALETTE.accentDim),
    /** Informational messages */
    info: hex(PALETTE.info),
    /** Success indicators */
    success: hex(PALETTE.success),
    /** Warning indicators */
    warn: hex(PALETTE.warn),
    /** Error messages */
    error: hex(PALETTE.error),
    /** Muted/secondary text */
    muted: hex(PALETTE.muted),
    /** Bold accent for headings */
    heading: c.bold.hex(PALETTE.accent),
    /** Commands displayed in bright accent */
    command: hex(PALETTE.accentBright),
    /** Options/flags displayed in warn color */
    option: hex(PALETTE.warn),
  } as const;
}

/**
 * Pre-built theme object mapping semantic roles to chalk colorizers.
 *
 * Each property is a function `(text: string) => string` that wraps
 * the input in the appropriate ANSI color codes.
 *
 * @example
 * ```ts
 * import { theme } from './colors.js';
 * console.log(theme.success('All tests passed'));
 * console.log(theme.error('Something went wrong'));
 * ```
 */
export let theme = buildTheme(baseChalk);

export type Theme = typeof theme;

// ============================================================================
// Utility functions
// ============================================================================

/**
 * Check whether color output is currently enabled.
 *
 * Returns false when NO_COLOR is set (and FORCE_COLOR is not),
 * or when the chalk level has been set to 0.
 */
export function isColorEnabled(): boolean {
  return baseChalk.level > 0;
}

/**
 * Conditionally apply a color function.
 *
 * When `enabled` is true, applies the color function to the value.
 * When false, returns the value unchanged.
 *
 * @param enabled - Whether to apply color
 * @param color - The chalk color function to apply
 * @param value - The text to colorize
 * @returns The colorized or plain text
 *
 * @example
 * ```ts
 * const text = colorize(isColorEnabled(), theme.success, 'OK');
 * ```
 */
export function colorize(
  enabled: boolean,
  color: (value: string) => string,
  value: string,
): string {
  return enabled ? color(value) : value;
}

/**
 * Apply a palette color by key name.
 *
 * @param key - A key from the PALETTE object
 * @param text - The text to colorize
 * @returns The colorized text
 *
 * @example
 * ```ts
 * const msg = applyColor('success', 'Done!');
 * ```
 */
export function applyColor(key: PaletteKey, text: string): string {
  return baseChalk.hex(PALETTE[key])(text);
}

/**
 * Format a status label with appropriate color.
 *
 * @param status - The status type
 * @param label - The text to display (defaults to the status name)
 * @returns Formatted status string
 */
export function statusColor(
  status: 'success' | 'error' | 'warn' | 'info' | 'muted',
  label?: string,
): string {
  const text = label ?? status;
  return theme[status](text);
}

// ============================================================================
// Reset (for testing)
// ============================================================================

/**
 * Rebuild the chalk instance and theme from current environment variables.
 * Exposed for testing only.
 * @internal
 */
export function _resetColors(): void {
  baseChalk = createBaseChalk();
  theme = buildTheme(baseChalk);
}
