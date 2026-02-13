// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  VerboseLogger,
  createVerboseLogger,
  formatTimestamp,
  formatMs,
} from './verbose.js';
import type { VerboseCategory } from './verbose.js';

// ============================================================================
// formatTimestamp
// ============================================================================

describe('formatTimestamp', () => {
  it('formats a date into HH:MM:SS.mmm', () => {
    const date = new Date(2026, 0, 15, 14, 5, 9, 42);
    expect(formatTimestamp(date)).toBe('14:05:09.042');
  });

  it('pads single-digit values with zeros', () => {
    const date = new Date(2026, 0, 1, 1, 2, 3, 7);
    expect(formatTimestamp(date)).toBe('01:02:03.007');
  });

  it('handles midnight correctly', () => {
    const date = new Date(2026, 0, 1, 0, 0, 0, 0);
    expect(formatTimestamp(date)).toBe('00:00:00.000');
  });

  it('handles end of day correctly', () => {
    const date = new Date(2026, 0, 1, 23, 59, 59, 999);
    expect(formatTimestamp(date)).toBe('23:59:59.999');
  });
});

// ============================================================================
// formatMs
// ============================================================================

describe('formatMs', () => {
  it('formats sub-second durations in milliseconds', () => {
    expect(formatMs(0)).toBe('0ms');
    expect(formatMs(150)).toBe('150ms');
    expect(formatMs(999)).toBe('999ms');
  });

  it('formats durations >= 1 second in seconds with one decimal', () => {
    expect(formatMs(1000)).toBe('1.0s');
    expect(formatMs(1500)).toBe('1.5s');
    expect(formatMs(3200)).toBe('3.2s');
    expect(formatMs(12345)).toBe('12.3s');
  });
});

// ============================================================================
// VerboseLogger - disabled mode
// ============================================================================

describe('VerboseLogger (disabled)', () => {
  let writer: ReturnType<typeof vi.fn>;
  let logger: VerboseLogger;

  beforeEach(() => {
    writer = vi.fn();
    logger = new VerboseLogger({ enabled: false, writer });
  });

  it('has enabled = false', () => {
    expect(logger.enabled).toBe(false);
  });

  it('log() does not call writer', () => {
    logger.log('general', 'test message');
    expect(writer).not.toHaveBeenCalled();
  });

  it('logData() does not call writer', () => {
    logger.logData('env', 'test', { key: 'value' });
    expect(writer).not.toHaveBeenCalled();
  });

  it('logTiming() does not call writer', () => {
    logger.logTiming('step', 'test', 1000);
    expect(writer).not.toHaveBeenCalled();
  });

  it('logCommand() does not call writer', () => {
    logger.logCommand('npm', ['install']);
    expect(writer).not.toHaveBeenCalled();
  });

  it('logStep() does not call writer', () => {
    logger.logStep(0, 5, 'Install dependencies');
    expect(writer).not.toHaveBeenCalled();
  });
});

// ============================================================================
// VerboseLogger - enabled mode (no timestamps)
// ============================================================================

describe('VerboseLogger (enabled, no timestamps)', () => {
  let writer: ReturnType<typeof vi.fn>;
  let logger: VerboseLogger;

  beforeEach(() => {
    writer = vi.fn();
    logger = new VerboseLogger({ enabled: true, writer, timestamps: false });
  });

  it('has enabled = true', () => {
    expect(logger.enabled).toBe(true);
  });

  it('log() outputs category tag and message', () => {
    logger.log('general', 'hello world');
    expect(writer).toHaveBeenCalledTimes(1);
    const output = writer.mock.calls[0][0] as string;
    expect(output).toContain('[VERBOSE]');
    expect(output).toContain('hello world');
  });

  it('log() uses correct category labels', () => {
    const categories: Array<[VerboseCategory, string]> = [
      ['env', 'ENV'],
      ['server', 'SERVER'],
      ['ws', 'WS'],
      ['step', 'STEP'],
      ['sandbox', 'SANDBOX'],
      ['exec', 'EXEC'],
      ['plan', 'PLAN'],
      ['error', 'ERROR'],
      ['general', 'VERBOSE'],
    ];

    for (const [category, label] of categories) {
      writer.mockClear();
      logger.log(category, 'test');
      const output = writer.mock.calls[0][0] as string;
      expect(output).toContain(`[${label}]`);
    }
  });

  it('logData() outputs label and key-value pairs', () => {
    logger.logData('env', 'Environment', { os: 'darwin', arch: 'arm64' });
    expect(writer).toHaveBeenCalledTimes(3); // label line + 2 keys
    const calls = writer.mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toContain('Environment:');
    expect(calls[1]).toContain('os: darwin');
    expect(calls[2]).toContain('arch: arm64');
  });

  it('logData() serializes objects as JSON', () => {
    logger.logData('general', 'Data', { nested: { a: 1 } });
    const calls = writer.mock.calls.map((c) => c[0] as string);
    expect(calls[1]).toContain('nested: {"a":1}');
  });

  it('logTiming() outputs label and formatted duration', () => {
    logger.logTiming('step', 'Install pnpm', 3200);
    expect(writer).toHaveBeenCalledTimes(1);
    const output = writer.mock.calls[0][0] as string;
    expect(output).toContain('[STEP]');
    expect(output).toContain('Install pnpm completed in 3.2s');
  });

  it('logTiming() formats sub-second durations in ms', () => {
    logger.logTiming('exec', 'Quick check', 150);
    const output = writer.mock.calls[0][0] as string;
    expect(output).toContain('Quick check completed in 150ms');
  });

  it('logCommand() outputs command with args', () => {
    logger.logCommand('npm', ['install', '-g', 'pnpm']);
    expect(writer).toHaveBeenCalledTimes(1);
    const output = writer.mock.calls[0][0] as string;
    expect(output).toContain('[EXEC]');
    expect(output).toContain('Executing: npm install -g pnpm');
  });

  it('logCommand() handles command with no args', () => {
    logger.logCommand('node', []);
    const output = writer.mock.calls[0][0] as string;
    expect(output).toContain('Executing: node');
  });

  it('logStep() outputs step index and description', () => {
    logger.logStep(2, 5, 'Install OpenClaw');
    expect(writer).toHaveBeenCalledTimes(1);
    const output = writer.mock.calls[0][0] as string;
    expect(output).toContain('[STEP]');
    expect(output).toContain('[3/5]');
    expect(output).toContain('Starting: Install OpenClaw');
  });

  it('logStep() handles first step', () => {
    logger.logStep(0, 3, 'Check Node.js');
    const output = writer.mock.calls[0][0] as string;
    expect(output).toContain('[1/3]');
    expect(output).toContain('Starting: Check Node.js');
  });

  it('logStep() handles last step', () => {
    logger.logStep(4, 5, 'Verify installation');
    const output = writer.mock.calls[0][0] as string;
    expect(output).toContain('[5/5]');
  });
});

// ============================================================================
// VerboseLogger - enabled mode (with timestamps)
// ============================================================================

describe('VerboseLogger (enabled, with timestamps)', () => {
  let writer: ReturnType<typeof vi.fn>;
  let logger: VerboseLogger;

  beforeEach(() => {
    writer = vi.fn();
    logger = new VerboseLogger({ enabled: true, writer, timestamps: true });
  });

  it('includes timestamp in output', () => {
    logger.log('general', 'with time');
    const output = writer.mock.calls[0][0] as string;
    // Should contain a time pattern like HH:MM:SS.mmm
    expect(output).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
    expect(output).toContain('[VERBOSE]');
    expect(output).toContain('with time');
  });

  it('default timestamps option is true', () => {
    const defaultLogger = new VerboseLogger({ enabled: true, writer });
    defaultLogger.log('general', 'test');
    const output = writer.mock.calls[0][0] as string;
    expect(output).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
  });
});

// ============================================================================
// VerboseLogger - default writer
// ============================================================================

describe('VerboseLogger (default writer)', () => {
  it('uses console.error by default', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = new VerboseLogger({ enabled: true, timestamps: false });
    logger.log('general', 'default writer test');
    expect(spy).toHaveBeenCalledTimes(1);
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain('default writer test');
    spy.mockRestore();
  });
});

// ============================================================================
// createVerboseLogger factory
// ============================================================================

describe('createVerboseLogger', () => {
  it('creates a disabled logger when enabled=false', () => {
    const logger = createVerboseLogger(false);
    expect(logger.enabled).toBe(false);
  });

  it('creates an enabled logger when enabled=true', () => {
    const writer = vi.fn();
    const logger = createVerboseLogger(true, { writer });
    expect(logger.enabled).toBe(true);
    logger.log('general', 'test');
    expect(writer).toHaveBeenCalled();
  });

  it('passes through additional options', () => {
    const writer = vi.fn();
    const logger = createVerboseLogger(true, { writer, timestamps: false });
    logger.log('general', 'no ts');
    const output = writer.mock.calls[0][0] as string;
    // Should not contain timestamp pattern
    expect(output).not.toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}/);
  });
});
