// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect } from 'vitest';
import { parseAnsi, stripAnsi } from './ansi';

describe('parseAnsi', () => {
  it('returns plain text with no classes when no ANSI codes', () => {
    const result = parseAnsi('hello world');
    expect(result).toEqual([{ text: 'hello world' }]);
  });

  it('returns empty array for empty string', () => {
    expect(parseAnsi('')).toEqual([]);
  });

  it('parses red text', () => {
    const result = parseAnsi('\x1b[31mError\x1b[0m');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ text: 'Error', className: 'text-red-500' });
  });

  it('parses green text', () => {
    const result = parseAnsi('\x1b[32mOK\x1b[0m done');
    expect(result[0]).toEqual({ text: 'OK', className: 'text-green-400' });
    expect(result[1]).toEqual({ text: ' done' });
  });

  it('parses bold + color', () => {
    const result = parseAnsi('\x1b[1;33mWarning\x1b[0m');
    expect(result[0].text).toBe('Warning');
    expect(result[0].className).toContain('font-bold');
    expect(result[0].className).toContain('text-yellow-400');
  });

  it('handles multiple colors in sequence', () => {
    const result = parseAnsi('\x1b[31mred\x1b[32mgreen\x1b[0m');
    expect(result[0]).toEqual({ text: 'red', className: 'text-red-500' });
    expect(result[1]).toEqual({ text: 'green', className: 'text-green-400' });
  });

  it('parses underline', () => {
    const result = parseAnsi('\x1b[4munderlined\x1b[0m');
    expect(result[0]).toEqual({ text: 'underlined', className: 'underline' });
  });

  it('parses dim text', () => {
    const result = parseAnsi('\x1b[2mdim\x1b[0m');
    expect(result[0]).toEqual({ text: 'dim', className: 'opacity-60' });
  });

  it('parses bright colors', () => {
    const result = parseAnsi('\x1b[91mbright red\x1b[0m');
    expect(result[0]).toEqual({ text: 'bright red', className: 'text-red-400' });
  });

  it('strips unknown codes gracefully', () => {
    const result = parseAnsi('\x1b[48;5;1mtext\x1b[0m');
    // 48 is bg color (unsupported), should still produce text
    expect(result[0].text).toBe('text');
  });

  it('handles text before and after ANSI', () => {
    const result = parseAnsi('start \x1b[31mred\x1b[0m end');
    expect(result[0]).toEqual({ text: 'start ' });
    expect(result[1]).toEqual({ text: 'red', className: 'text-red-500' });
    expect(result[2]).toEqual({ text: ' end' });
  });
});

describe('stripAnsi', () => {
  it('strips ANSI codes from text', () => {
    expect(stripAnsi('\x1b[31mError\x1b[0m: something failed')).toBe(
      'Error: something failed'
    );
  });

  it('returns plain text unchanged', () => {
    expect(stripAnsi('no colors here')).toBe('no colors here');
  });

  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('strips multiple ANSI sequences', () => {
    expect(stripAnsi('\x1b[1;32mOK\x1b[0m \x1b[31mERR\x1b[0m')).toBe('OK ERR');
  });
});
