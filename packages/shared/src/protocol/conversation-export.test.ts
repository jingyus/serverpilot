// SPDX-License-Identifier: MIT
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Unit tests for conversation export schema validation.
 *
 * @module protocol/conversation-export.test
 */

import { describe, it, expect } from 'vitest';
import {
  ExportFormatSchema,
  ExportFormat,
  ExportToolCallSchema,
  ExportMessageSchema,
  ConversationExportSchema,
} from './conversation-export.js';

// ============================================================================
// Helpers
// ============================================================================

const NOW = '2026-02-13T10:00:00.000Z';

function createValidToolCall() {
  return {
    name: 'execute_command',
    input: { command: 'uname -a', timeout: 30000 },
    result: 'Linux server1 5.15.0',
  };
}

function createValidMessage(overrides?: Record<string, unknown>) {
  return {
    role: 'user' as const,
    content: 'How do I restart nginx?',
    timestamp: NOW,
    ...overrides,
  };
}

function createValidExport(overrides?: Record<string, unknown>) {
  return {
    id: 'sess-001',
    title: 'Nginx troubleshooting',
    serverId: 'srv-abc',
    createdAt: NOW,
    exportedAt: NOW,
    format: 'json' as const,
    messages: [
      createValidMessage(),
      createValidMessage({
        role: 'assistant',
        content: 'You can restart nginx with: sudo systemctl restart nginx',
        toolCalls: [createValidToolCall()],
      }),
    ],
    ...overrides,
  };
}

// ============================================================================
// ExportFormatSchema
// ============================================================================

describe('ExportFormatSchema', () => {
  it('accepts all valid formats', () => {
    expect(ExportFormatSchema.parse('json')).toBe('json');
    expect(ExportFormatSchema.parse('markdown')).toBe('markdown');
    expect(ExportFormatSchema.parse('text')).toBe('text');
  });

  it('rejects invalid format', () => {
    expect(() => ExportFormatSchema.parse('pdf')).toThrow();
    expect(() => ExportFormatSchema.parse('')).toThrow();
  });

  it('ExportFormat constants match schema values', () => {
    expect(ExportFormat.JSON).toBe('json');
    expect(ExportFormat.MARKDOWN).toBe('markdown');
    expect(ExportFormat.TEXT).toBe('text');
  });
});

// ============================================================================
// ExportToolCallSchema
// ============================================================================

describe('ExportToolCallSchema', () => {
  it('parses valid tool call with result', () => {
    const tc = createValidToolCall();
    const parsed = ExportToolCallSchema.parse(tc);
    expect(parsed.name).toBe('execute_command');
    expect(parsed.input).toEqual({ command: 'uname -a', timeout: 30000 });
    expect(parsed.result).toBe('Linux server1 5.15.0');
  });

  it('allows omitted result', () => {
    const { result: _, ...tc } = createValidToolCall();
    const parsed = ExportToolCallSchema.parse(tc);
    expect(parsed.result).toBeUndefined();
  });

  it('rejects missing name', () => {
    const { name: _, ...tc } = createValidToolCall();
    expect(() => ExportToolCallSchema.parse(tc)).toThrow();
  });

  it('rejects missing input', () => {
    const { input: _, ...tc } = createValidToolCall();
    expect(() => ExportToolCallSchema.parse(tc)).toThrow();
  });
});

// ============================================================================
// ExportMessageSchema
// ============================================================================

describe('ExportMessageSchema', () => {
  it('parses valid user message', () => {
    const msg = createValidMessage();
    const parsed = ExportMessageSchema.parse(msg);
    expect(parsed.role).toBe('user');
    expect(parsed.content).toBe('How do I restart nginx?');
    expect(parsed.timestamp).toBe(NOW);
    expect(parsed.toolCalls).toBeUndefined();
  });

  it('parses assistant message with tool calls', () => {
    const msg = createValidMessage({
      role: 'assistant',
      content: 'Running command...',
      toolCalls: [createValidToolCall()],
    });
    const parsed = ExportMessageSchema.parse(msg);
    expect(parsed.role).toBe('assistant');
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.toolCalls![0].name).toBe('execute_command');
  });

  it('parses system message', () => {
    const msg = createValidMessage({ role: 'system', content: 'You are a server admin assistant.' });
    const parsed = ExportMessageSchema.parse(msg);
    expect(parsed.role).toBe('system');
  });

  it('rejects invalid role', () => {
    const msg = createValidMessage({ role: 'tool' });
    expect(() => ExportMessageSchema.parse(msg)).toThrow();
  });

  it('rejects invalid timestamp format', () => {
    const msg = createValidMessage({ timestamp: 'not-a-date' });
    expect(() => ExportMessageSchema.parse(msg)).toThrow();
  });

  it('rejects missing content', () => {
    const { content: _, ...msg } = createValidMessage();
    expect(() => ExportMessageSchema.parse(msg)).toThrow();
  });
});

// ============================================================================
// ConversationExportSchema
// ============================================================================

describe('ConversationExportSchema', () => {
  it('parses a valid full export', () => {
    const data = createValidExport();
    const parsed = ConversationExportSchema.parse(data);
    expect(parsed.id).toBe('sess-001');
    expect(parsed.title).toBe('Nginx troubleshooting');
    expect(parsed.serverId).toBe('srv-abc');
    expect(parsed.format).toBe('json');
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[1].toolCalls).toHaveLength(1);
  });

  it('accepts empty messages array', () => {
    const data = createValidExport({ messages: [] });
    const parsed = ConversationExportSchema.parse(data);
    expect(parsed.messages).toHaveLength(0);
  });

  it('accepts all export formats', () => {
    for (const fmt of ['json', 'markdown', 'text'] as const) {
      const data = createValidExport({ format: fmt });
      const parsed = ConversationExportSchema.parse(data);
      expect(parsed.format).toBe(fmt);
    }
  });

  it('rejects missing required fields', () => {
    const required = ['id', 'title', 'serverId', 'createdAt', 'exportedAt', 'format', 'messages'] as const;
    for (const field of required) {
      const data = createValidExport();
      delete (data as Record<string, unknown>)[field];
      expect(() => ConversationExportSchema.parse(data), `should reject missing ${field}`).toThrow();
    }
  });

  it('rejects invalid createdAt format', () => {
    const data = createValidExport({ createdAt: '2026-02-13' });
    expect(() => ConversationExportSchema.parse(data)).toThrow();
  });

  it('rejects invalid format value', () => {
    const data = createValidExport({ format: 'csv' });
    expect(() => ConversationExportSchema.parse(data)).toThrow();
  });

  it('safeParse returns success for valid data', () => {
    const result = ConversationExportSchema.safeParse(createValidExport());
    expect(result.success).toBe(true);
  });

  it('safeParse returns error for invalid data', () => {
    const result = ConversationExportSchema.safeParse({ id: 123 });
    expect(result.success).toBe(false);
  });
});
