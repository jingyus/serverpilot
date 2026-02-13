// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for runner-tools — tool definition builders and utility functions.
 *
 * Covers: parseTimeout, exceedsRiskLimit, buildToolDefinitions
 * Security-critical: exceedsRiskLimit determines command rejection.
 */

import { describe, it, expect } from 'vitest';

import { parseTimeout, exceedsRiskLimit, buildToolDefinitions } from './runner-tools.js';
import type { SkillToolType } from '@aiinstaller/shared';

// ============================================================================
// parseTimeout
// ============================================================================

describe('parseTimeout', () => {
  it('parses seconds correctly', () => {
    expect(parseTimeout('30s')).toBe(30_000);
  });

  it('parses minutes correctly', () => {
    expect(parseTimeout('5m')).toBe(300_000);
  });

  it('parses hours correctly', () => {
    expect(parseTimeout('1h')).toBe(3_600_000);
  });

  it('parses zero seconds', () => {
    expect(parseTimeout('0s')).toBe(0);
  });

  it('parses large hour values', () => {
    expect(parseTimeout('999h')).toBe(999 * 60 * 60 * 1000);
  });

  it('throws on unknown unit suffix', () => {
    expect(() => parseTimeout('5x')).toThrow('Invalid timeout format');
  });

  it('throws on letters-only input', () => {
    expect(() => parseTimeout('abc')).toThrow('Invalid timeout format');
  });

  it('throws on empty string', () => {
    expect(() => parseTimeout('')).toThrow('Invalid timeout format');
  });

  it('throws on number without unit', () => {
    expect(() => parseTimeout('5')).toThrow('Invalid timeout format');
  });

  it('throws on unit before number', () => {
    expect(() => parseTimeout('m5')).toThrow('Invalid timeout format');
  });
});

// ============================================================================
// exceedsRiskLimit
// ============================================================================

describe('exceedsRiskLimit', () => {
  it('green does not exceed green', () => {
    expect(exceedsRiskLimit('green', 'green')).toBe(false);
  });

  it('green does not exceed yellow', () => {
    expect(exceedsRiskLimit('green', 'yellow')).toBe(false);
  });

  it('yellow exceeds green', () => {
    expect(exceedsRiskLimit('yellow', 'green')).toBe(true);
  });

  it('yellow does not exceed yellow', () => {
    expect(exceedsRiskLimit('yellow', 'yellow')).toBe(false);
  });

  it('red exceeds yellow', () => {
    expect(exceedsRiskLimit('red', 'yellow')).toBe(true);
  });

  it('critical exceeds red', () => {
    expect(exceedsRiskLimit('critical', 'red')).toBe(true);
  });

  it('forbidden always exceeds anything below forbidden', () => {
    expect(exceedsRiskLimit('forbidden', 'critical')).toBe(true);
    expect(exceedsRiskLimit('forbidden', 'red')).toBe(true);
    expect(exceedsRiskLimit('forbidden', 'yellow')).toBe(true);
    expect(exceedsRiskLimit('forbidden', 'green')).toBe(true);
  });

  it('forbidden does not exceed forbidden', () => {
    expect(exceedsRiskLimit('forbidden', 'forbidden')).toBe(false);
  });

  it('unknown command risk defaults to forbidden (4)', () => {
    // Unknown command risk → 4 (forbidden), exceeds any limit below forbidden
    expect(exceedsRiskLimit('unknown', 'critical')).toBe(true);
  });

  it('unknown max allowed defaults to yellow (1)', () => {
    // Unknown max → 1 (yellow), so green (0) does not exceed
    expect(exceedsRiskLimit('green', 'unknown')).toBe(false);
    // But yellow (1) does not exceed either (equal)
    expect(exceedsRiskLimit('yellow', 'unknown')).toBe(false);
    // Red (2) exceeds yellow (1)
    expect(exceedsRiskLimit('red', 'unknown')).toBe(true);
  });
});

// ============================================================================
// buildToolDefinitions
// ============================================================================

describe('buildToolDefinitions', () => {
  it('returns empty array for no tools', () => {
    expect(buildToolDefinitions([])).toEqual([]);
  });

  it('builds shell tool definition', () => {
    const defs = buildToolDefinitions(['shell']);
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('shell');
    expect(defs[0].description).toBeTruthy();
    expect(defs[0].input_schema).toMatchObject({
      type: 'object',
      properties: {
        command: { type: 'string' },
      },
      required: ['command'],
    });
  });

  it('builds read_file tool definition', () => {
    const defs = buildToolDefinitions(['read_file']);
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('read_file');
    expect(defs[0].input_schema).toMatchObject({
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
    });
  });

  it('builds write_file tool definition', () => {
    const defs = buildToolDefinitions(['write_file']);
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('write_file');
    expect(defs[0].input_schema).toMatchObject({
      type: 'object',
      required: ['path', 'content'],
    });
  });

  it('builds notify tool definition', () => {
    const defs = buildToolDefinitions(['notify']);
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('notify');
    expect(defs[0].input_schema).toMatchObject({
      type: 'object',
      required: ['title', 'message'],
    });
  });

  it('builds http tool definition', () => {
    const defs = buildToolDefinitions(['http']);
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('http');
    expect(defs[0].input_schema).toMatchObject({
      type: 'object',
      required: ['url'],
    });
  });

  it('builds store tool definition', () => {
    const defs = buildToolDefinitions(['store']);
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('store');
    expect(defs[0].input_schema).toMatchObject({
      type: 'object',
      required: ['action'],
    });
    // Verify enum values for action
    const actionProp = (defs[0].input_schema as Record<string, Record<string, unknown>>)
      .properties['action'] as Record<string, unknown>;
    expect(actionProp.enum).toEqual(['get', 'set', 'delete', 'list', 'clear']);
  });

  it('builds multiple tool definitions preserving order', () => {
    const tools: SkillToolType[] = ['shell', 'read_file', 'store'];
    const defs = buildToolDefinitions(tools);
    expect(defs).toHaveLength(3);
    expect(defs.map(d => d.name)).toEqual(['shell', 'read_file', 'store']);
  });

  it('builds all 6 tool definitions', () => {
    const allTools: SkillToolType[] = ['shell', 'read_file', 'write_file', 'notify', 'http', 'store'];
    const defs = buildToolDefinitions(allTools);
    expect(defs).toHaveLength(6);
    expect(defs.map(d => d.name)).toEqual(allTools);
    // Every definition has required fields
    for (const def of defs) {
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.input_schema).toBeDefined();
      expect(def.input_schema['type']).toBe('object');
      expect(def.input_schema['properties']).toBeDefined();
      expect(def.input_schema['required']).toBeDefined();
    }
  });

  it('deduplicates when same tool appears twice', () => {
    // buildToolDefinitions uses a Set internally so duplicates are ignored
    const defs = buildToolDefinitions(['shell', 'shell'] as SkillToolType[]);
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('shell');
  });
});
