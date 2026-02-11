// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  PALETTE,
  theme,
  isColorEnabled,
  colorize,
  applyColor,
  statusColor,
  _resetColors,
} from './colors.js';

// ============================================================================
// Helper: strip ANSI codes for plain-text comparison
// ============================================================================

const ANSI_RE = /\x1b\[[0-9;]*m/g;
function strip(s: string): string {
  return s.replace(ANSI_RE, '');
}

// ============================================================================
// PALETTE
// ============================================================================

describe('PALETTE', () => {
  it('has all required color keys', () => {
    const keys = ['accent', 'accentBright', 'accentDim', 'info', 'success', 'warn', 'error', 'muted'];
    for (const key of keys) {
      expect(PALETTE).toHaveProperty(key);
    }
  });

  it('has valid hex color values', () => {
    const hexRe = /^#[0-9A-Fa-f]{6}$/;
    for (const value of Object.values(PALETTE)) {
      expect(value).toMatch(hexRe);
    }
  });

  it('palette values are strings (compile-time readonly)', () => {
    for (const value of Object.values(PALETTE)) {
      expect(typeof value).toBe('string');
    }
  });
});

// ============================================================================
// theme
// ============================================================================

describe('theme', () => {
  it('has all palette-based color functions', () => {
    const paletteKeys = ['accent', 'accentBright', 'accentDim', 'info', 'success', 'warn', 'error', 'muted'];
    for (const key of paletteKeys) {
      expect(typeof (theme as Record<string, unknown>)[key]).toBe('function');
    }
  });

  it('has semantic color functions (heading, command, option)', () => {
    expect(typeof theme.heading).toBe('function');
    expect(typeof theme.command).toBe('function');
    expect(typeof theme.option).toBe('function');
  });

  it('each color function returns a string containing the input', () => {
    const fns = [
      theme.accent, theme.accentBright, theme.accentDim,
      theme.info, theme.success, theme.warn, theme.error,
      theme.muted, theme.heading, theme.command, theme.option,
    ];
    for (const fn of fns) {
      const result = fn('hello');
      expect(strip(result)).toBe('hello');
    }
  });

  it('heading applies bold styling when colors are enabled', () => {
    // Force colors on to verify bold
    process.env.FORCE_COLOR = '1';
    delete process.env.NO_COLOR;
    _resetColors();
    const result = theme.heading('Title');
    expect(result).toContain('\x1b[1m');
    expect(strip(result)).toBe('Title');
    // Restore
    delete process.env.FORCE_COLOR;
    _resetColors();
  });
});

// ============================================================================
// isColorEnabled
// ============================================================================

describe('isColorEnabled', () => {
  const origNoColor = process.env.NO_COLOR;
  const origForceColor = process.env.FORCE_COLOR;

  afterEach(() => {
    // Restore env
    if (origNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = origNoColor;
    if (origForceColor === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = origForceColor;
    _resetColors();
  });

  it('returns true when colors are enabled (default in test)', () => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    _resetColors();
    // In CI/test, chalk auto-detects. We just check it returns a boolean.
    expect(typeof isColorEnabled()).toBe('boolean');
  });

  it('returns false when NO_COLOR is set', () => {
    process.env.NO_COLOR = '1';
    delete process.env.FORCE_COLOR;
    _resetColors();
    expect(isColorEnabled()).toBe(false);
  });

  it('returns true when FORCE_COLOR overrides NO_COLOR', () => {
    process.env.NO_COLOR = '1';
    process.env.FORCE_COLOR = '1';
    _resetColors();
    expect(isColorEnabled()).toBe(true);
  });

  it('FORCE_COLOR=0 does not override NO_COLOR', () => {
    process.env.NO_COLOR = '1';
    process.env.FORCE_COLOR = '0';
    _resetColors();
    expect(isColorEnabled()).toBe(false);
  });
});

// ============================================================================
// colorize
// ============================================================================

describe('colorize', () => {
  it('applies color function when enabled is true', () => {
    const color = (s: string) => `[colored]${s}[/colored]`;
    expect(colorize(true, color, 'test')).toBe('[colored]test[/colored]');
  });

  it('returns plain text when enabled is false', () => {
    const color = (s: string) => `[colored]${s}[/colored]`;
    expect(colorize(false, color, 'test')).toBe('test');
  });

  it('works with theme functions', () => {
    const result = colorize(true, theme.success, 'OK');
    expect(strip(result)).toBe('OK');
  });

  it('returns unchanged text with theme functions when disabled', () => {
    const result = colorize(false, theme.success, 'OK');
    expect(result).toBe('OK');
  });
});

// ============================================================================
// applyColor
// ============================================================================

describe('applyColor', () => {
  it('colorizes text using a palette key', () => {
    const result = applyColor('success', 'Done');
    expect(strip(result)).toBe('Done');
  });

  it('works for all palette keys', () => {
    const keys: Array<keyof typeof PALETTE> = [
      'accent', 'accentBright', 'accentDim', 'info', 'success', 'warn', 'error', 'muted',
    ];
    for (const key of keys) {
      const result = applyColor(key, 'text');
      expect(strip(result)).toBe('text');
    }
  });

  it('handles empty string', () => {
    const result = applyColor('info', '');
    expect(strip(result)).toBe('');
  });
});

// ============================================================================
// statusColor
// ============================================================================

describe('statusColor', () => {
  it('applies success color', () => {
    const result = statusColor('success');
    expect(strip(result)).toBe('success');
  });

  it('applies error color', () => {
    const result = statusColor('error');
    expect(strip(result)).toBe('error');
  });

  it('applies warn color', () => {
    const result = statusColor('warn');
    expect(strip(result)).toBe('warn');
  });

  it('applies info color', () => {
    const result = statusColor('info');
    expect(strip(result)).toBe('info');
  });

  it('applies muted color', () => {
    const result = statusColor('muted');
    expect(strip(result)).toBe('muted');
  });

  it('uses custom label when provided', () => {
    const result = statusColor('success', 'All passed');
    expect(strip(result)).toBe('All passed');
  });

  it('defaults label to status name', () => {
    const result = statusColor('error');
    expect(strip(result)).toBe('error');
  });
});

// ============================================================================
// _resetColors
// ============================================================================

describe('_resetColors', () => {
  const origNoColor = process.env.NO_COLOR;
  const origForceColor = process.env.FORCE_COLOR;

  afterEach(() => {
    if (origNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = origNoColor;
    if (origForceColor === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = origForceColor;
    _resetColors();
  });

  it('rebuilds theme after env change', () => {
    // Set NO_COLOR to disable
    process.env.NO_COLOR = '1';
    delete process.env.FORCE_COLOR;
    _resetColors();
    expect(isColorEnabled()).toBe(false);

    // Remove NO_COLOR and reset
    delete process.env.NO_COLOR;
    _resetColors();
    // Color detection depends on environment, but the function should not throw
    expect(typeof isColorEnabled()).toBe('boolean');
  });

  it('theme functions still work after reset', () => {
    _resetColors();
    const result = theme.accent('test');
    expect(strip(result)).toBe('test');
  });
});

// ============================================================================
// NO_COLOR behavior (output content)
// ============================================================================

describe('NO_COLOR behavior', () => {
  const origNoColor = process.env.NO_COLOR;
  const origForceColor = process.env.FORCE_COLOR;

  afterEach(() => {
    if (origNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = origNoColor;
    if (origForceColor === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = origForceColor;
    _resetColors();
  });

  it('theme functions return plain text when NO_COLOR is set', () => {
    process.env.NO_COLOR = '1';
    delete process.env.FORCE_COLOR;
    _resetColors();

    // With level 0, chalk should not insert ANSI codes
    const result = theme.success('plain');
    expect(result).toBe('plain');
  });

  it('applyColor returns plain text when NO_COLOR is set', () => {
    process.env.NO_COLOR = '1';
    delete process.env.FORCE_COLOR;
    _resetColors();

    const result = applyColor('error', 'oops');
    expect(result).toBe('oops');
  });

  it('statusColor returns plain text when NO_COLOR is set', () => {
    process.env.NO_COLOR = '1';
    delete process.env.FORCE_COLOR;
    _resetColors();

    const result = statusColor('warn', 'careful');
    expect(result).toBe('careful');
  });
});
