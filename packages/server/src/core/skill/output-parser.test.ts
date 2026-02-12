// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for output-parser — JSON extraction, type coercion, and output validation.
 */

import { describe, it, expect } from 'vitest';

import {
  extractJsonFromText,
  coerceValue,
  parseSkillOutputs,
  buildOutputInstructions,
} from './output-parser.js';
import type { SkillOutput } from '@aiinstaller/shared';

// ============================================================================
// extractJsonFromText
// ============================================================================

describe('extractJsonFromText', () => {
  it('extracts from ```json fenced block', () => {
    const text = 'Some text before\n```json\n{"report": "ok", "count": 5}\n```\nSome text after';
    const result = extractJsonFromText(text);
    expect(result).toEqual({ report: 'ok', count: 5 });
  });

  it('extracts from plain ``` fenced block containing JSON', () => {
    const text = 'Result:\n```\n{"status": "healthy"}\n```';
    const result = extractJsonFromText(text);
    expect(result).toEqual({ status: 'healthy' });
  });

  it('extracts bare JSON object from text', () => {
    const text = 'The result is {"success": true, "value": 42} as expected.';
    const result = extractJsonFromText(text);
    expect(result).toEqual({ success: true, value: 42 });
  });

  it('returns null when no JSON is present', () => {
    const text = 'This is just plain text with no JSON at all.';
    expect(extractJsonFromText(text)).toBeNull();
  });

  it('returns null for arrays (only objects accepted)', () => {
    const text = '```json\n[1, 2, 3]\n```';
    expect(extractJsonFromText(text)).toBeNull();
  });

  it('handles nested JSON objects', () => {
    const text = '```json\n{"report": {"cpu": 85, "memory": 60}, "healthy": true}\n```';
    const result = extractJsonFromText(text);
    expect(result).toEqual({ report: { cpu: 85, memory: 60 }, healthy: true });
  });

  it('prefers json-fenced block over bare JSON', () => {
    const text = 'Found {"wrong": true} in text.\n```json\n{"correct": true}\n```';
    const result = extractJsonFromText(text);
    expect(result).toEqual({ correct: true });
  });

  it('handles multiple fenced blocks (returns first valid)', () => {
    const text = '```json\n{"first": 1}\n```\n\n```json\n{"second": 2}\n```';
    const result = extractJsonFromText(text);
    expect(result).toEqual({ first: 1 });
  });

  it('handles malformed JSON in fenced block (falls through)', () => {
    const text = '```json\n{broken json}\n```\n{"fallback": true}';
    const result = extractJsonFromText(text);
    expect(result).toEqual({ fallback: true });
  });

  it('handles empty string', () => {
    expect(extractJsonFromText('')).toBeNull();
  });

  it('extracts JSON with whitespace in fenced block', () => {
    const text = '```json\n  {\n    "key": "value"\n  }\n```';
    const result = extractJsonFromText(text);
    expect(result).toEqual({ key: 'value' });
  });
});

// ============================================================================
// coerceValue
// ============================================================================

describe('coerceValue', () => {
  // string
  it('accepts string as string', () => {
    expect(coerceValue('hello', 'string')).toEqual({ value: 'hello', ok: true });
  });

  it('coerces number to string', () => {
    expect(coerceValue(42, 'string')).toEqual({ value: '42', ok: true });
  });

  it('coerces boolean to string', () => {
    expect(coerceValue(true, 'string')).toEqual({ value: 'true', ok: true });
  });

  it('rejects object as string', () => {
    expect(coerceValue({ a: 1 }, 'string')).toEqual({ value: null, ok: false });
  });

  // number
  it('accepts number as number', () => {
    expect(coerceValue(3.14, 'number')).toEqual({ value: 3.14, ok: true });
  });

  it('coerces numeric string to number', () => {
    expect(coerceValue('42', 'number')).toEqual({ value: 42, ok: true });
  });

  it('rejects non-numeric string as number', () => {
    expect(coerceValue('hello', 'number')).toEqual({ value: null, ok: false });
  });

  it('rejects NaN as number', () => {
    expect(coerceValue(NaN, 'number')).toEqual({ value: null, ok: false });
  });

  // boolean
  it('accepts boolean as boolean', () => {
    expect(coerceValue(false, 'boolean')).toEqual({ value: false, ok: true });
  });

  it('coerces "true" string to boolean', () => {
    expect(coerceValue('true', 'boolean')).toEqual({ value: true, ok: true });
  });

  it('coerces "false" string to boolean', () => {
    expect(coerceValue('false', 'boolean')).toEqual({ value: false, ok: true });
  });

  it('rejects arbitrary string as boolean', () => {
    expect(coerceValue('yes', 'boolean')).toEqual({ value: null, ok: false });
  });

  // object
  it('accepts object as object', () => {
    const obj = { cpu: 85 };
    expect(coerceValue(obj, 'object')).toEqual({ value: obj, ok: true });
  });

  it('rejects array as object', () => {
    expect(coerceValue([1, 2], 'object')).toEqual({ value: null, ok: false });
  });

  it('coerces JSON string to object', () => {
    const result = coerceValue('{"key": "val"}', 'object');
    expect(result).toEqual({ value: { key: 'val' }, ok: true });
  });

  it('rejects invalid JSON string as object', () => {
    expect(coerceValue('not json', 'object')).toEqual({ value: null, ok: false });
  });

  // null / undefined
  it('rejects null for any type', () => {
    expect(coerceValue(null, 'string')).toEqual({ value: null, ok: false });
  });

  it('rejects undefined for any type', () => {
    expect(coerceValue(undefined, 'number')).toEqual({ value: null, ok: false });
  });
});

// ============================================================================
// parseSkillOutputs
// ============================================================================

describe('parseSkillOutputs', () => {
  const outputs: SkillOutput[] = [
    { name: 'report', type: 'string', description: 'Summary report' },
    { name: 'count', type: 'number', description: 'Item count' },
    { name: 'healthy', type: 'boolean', description: 'Health status' },
  ];

  it('parses all declared outputs from JSON block', () => {
    const text = 'Done.\n```json\n{"report": "All good", "count": 5, "healthy": true}\n```';
    const result = parseSkillOutputs(text, outputs);

    expect(result.values).toEqual({
      report: 'All good',
      count: 5,
      healthy: true,
    });
    expect(result.warnings).toHaveLength(0);
  });

  it('warns on missing outputs', () => {
    const text = '```json\n{"report": "Partial"}\n```';
    const result = parseSkillOutputs(text, outputs);

    expect(result.values).toEqual({ report: 'Partial' });
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain('Missing output "count"');
    expect(result.warnings[1]).toContain('Missing output "healthy"');
  });

  it('warns on type mismatch', () => {
    const text = '```json\n{"report": "ok", "count": "not-a-number", "healthy": true}\n```';
    const result = parseSkillOutputs(text, outputs);

    expect(result.values.report).toBe('ok');
    expect(result.values.count).toBeUndefined();
    expect(result.values.healthy).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('"count"');
    expect(result.warnings[0]).toContain('expected number');
  });

  it('coerces compatible types', () => {
    const text = '```json\n{"report": 42, "count": "10", "healthy": "true"}\n```';
    const result = parseSkillOutputs(text, outputs);

    expect(result.values).toEqual({
      report: '42',
      count: 10,
      healthy: true,
    });
    expect(result.warnings).toHaveLength(0);
  });

  it('returns empty with warning when no JSON found', () => {
    const text = 'Just plain text, no JSON here.';
    const result = parseSkillOutputs(text, outputs);

    expect(result.values).toEqual({});
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('No JSON object found');
  });

  it('returns empty values and warnings for empty declarations', () => {
    const result = parseSkillOutputs('any text', []);
    expect(result.values).toEqual({});
    expect(result.warnings).toHaveLength(0);
  });

  it('handles object type outputs', () => {
    const objectOutputs: SkillOutput[] = [
      { name: 'details', type: 'object', description: 'Detailed metrics' },
    ];
    const text = '```json\n{"details": {"cpu": 85, "memory": 60}}\n```';
    const result = parseSkillOutputs(text, objectOutputs);

    expect(result.values.details).toEqual({ cpu: 85, memory: 60 });
    expect(result.warnings).toHaveLength(0);
  });

  it('handles extra fields in JSON (only validates declared outputs)', () => {
    const singleOutput: SkillOutput[] = [
      { name: 'status', type: 'string', description: 'Status' },
    ];
    const text = '```json\n{"status": "ok", "extra": 123}\n```';
    const result = parseSkillOutputs(text, singleOutput);

    expect(result.values).toEqual({ status: 'ok' });
    expect(result.warnings).toHaveLength(0);
  });
});

// ============================================================================
// buildOutputInstructions
// ============================================================================

describe('buildOutputInstructions', () => {
  it('returns empty string for no outputs', () => {
    expect(buildOutputInstructions([])).toBe('');
  });

  it('builds instructions with field descriptions', () => {
    const outputs: SkillOutput[] = [
      { name: 'report', type: 'string', description: 'Summary report' },
      { name: 'count', type: 'number', description: 'Item count' },
    ];
    const result = buildOutputInstructions(outputs);

    expect(result).toContain('```json');
    expect(result).toContain('"report"');
    expect(result).toContain('<string>');
    expect(result).toContain('Summary report');
    expect(result).toContain('"count"');
    expect(result).toContain('<number>');
    expect(result).toContain('Item count');
    expect(result).toContain('IMPORTANT');
  });

  it('builds instructions for single output', () => {
    const outputs: SkillOutput[] = [
      { name: 'healthy', type: 'boolean', description: 'Is healthy' },
    ];
    const result = buildOutputInstructions(outputs);

    expect(result).toContain('"healthy"');
    expect(result).toContain('<boolean>');
  });
});
