// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * SkillRunner tools — AI tool definitions and utility functions.
 *
 * Extracted from runner.ts to keep file sizes manageable.
 * Contains:
 * - Tool definition builders (shell, read_file, write_file, notify, http, store)
 * - Timeout parser
 * - Risk level comparison
 *
 * @module core/skill/runner-tools
 */

import type { SkillToolType } from '@aiinstaller/shared';
import type { ToolDefinition } from '../../ai/providers/base.js';

// ============================================================================
// Timeout Parser
// ============================================================================

/**
 * Parse a timeout string into milliseconds.
 *
 * Supports: "30s" → 30000, "5m" → 300000, "1h" → 3600000
 *
 * @throws Error if format is invalid
 */
export function parseTimeout(timeout: string): number {
  const match = timeout.match(/^(\d+)([smh])$/);
  if (!match) {
    throw new Error(`Invalid timeout format: "${timeout}" (expected "30s", "5m", or "1h")`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    default: throw new Error(`Unknown timeout unit: ${unit}`);
  }
}

// ============================================================================
// Risk Level Comparison
// ============================================================================

/** Map risk level strings to numeric order for comparison. */
const RISK_ORDER: Record<string, number> = {
  green: 0,
  yellow: 1,
  red: 2,
  critical: 3,
  forbidden: 4,
};

/**
 * Check if a command's risk level exceeds the skill's maximum allowed level.
 *
 * @returns true if the command should be REJECTED (risk too high)
 */
export function exceedsRiskLimit(commandRisk: string, maxAllowed: string): boolean {
  const cmdOrder = RISK_ORDER[commandRisk] ?? 4;
  const maxOrder = RISK_ORDER[maxAllowed] ?? 1;
  return cmdOrder > maxOrder;
}

// ============================================================================
// Tool Definitions
// ============================================================================

/** Build AI tool definitions based on which tools the skill declares. */
export function buildToolDefinitions(tools: SkillToolType[]): ToolDefinition[] {
  const definitions: ToolDefinition[] = [];
  const toolSet = new Set(tools);

  if (toolSet.has('shell')) {
    definitions.push({
      name: 'shell',
      description: 'Execute a shell command on the target server. Returns stdout, stderr, and exit code.',
      input_schema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute',
          },
          description: {
            type: 'string',
            description: 'Brief description of what this command does',
          },
        },
        required: ['command'],
      },
    });
  }

  if (toolSet.has('read_file')) {
    definitions.push({
      name: 'read_file',
      description: 'Read the contents of a file on the target server.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute path of the file to read',
          },
        },
        required: ['path'],
      },
    });
  }

  if (toolSet.has('write_file')) {
    definitions.push({
      name: 'write_file',
      description: 'Write content to a file on the target server.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute path of the file to write',
          },
          content: {
            type: 'string',
            description: 'File content to write',
          },
        },
        required: ['path', 'content'],
      },
    });
  }

  if (toolSet.has('notify')) {
    definitions.push({
      name: 'notify',
      description: 'Send a notification via the webhook system.',
      input_schema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Notification title',
          },
          message: {
            type: 'string',
            description: 'Notification body',
          },
          level: {
            type: 'string',
            enum: ['info', 'warning', 'error'],
            description: 'Notification severity level',
          },
        },
        required: ['title', 'message'],
      },
    });
  }

  if (toolSet.has('http')) {
    definitions.push({
      name: 'http',
      description: 'Make an HTTP request (limited to allowed domains).',
      input_schema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to request',
          },
          method: {
            type: 'string',
            enum: ['GET', 'POST', 'PUT', 'DELETE'],
            description: 'HTTP method',
          },
          body: {
            type: 'string',
            description: 'Request body (for POST/PUT)',
          },
          headers: {
            type: 'object',
            description: 'Additional HTTP headers',
          },
        },
        required: ['url'],
      },
    });
  }

  if (toolSet.has('store')) {
    definitions.push({
      name: 'store',
      description: 'Read or write key-value data in the skill\'s persistent store.',
      input_schema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['get', 'set', 'delete'],
            description: 'Store operation',
          },
          key: {
            type: 'string',
            description: 'Storage key',
          },
          value: {
            type: 'string',
            description: 'Value to store (for set action)',
          },
        },
        required: ['action', 'key'],
      },
    });
  }

  return definitions;
}
