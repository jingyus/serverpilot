// SPDX-License-Identifier: MIT
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Conversation export schema definitions.
 *
 * Provides Zod schemas and TypeScript types for exporting AI chat conversations.
 * Used by both the server (export API) and dashboard (export UI).
 *
 * @module protocol/conversation-export
 */

import { z } from 'zod';

// ============================================================================
// Export Format
// ============================================================================

/** Supported export file formats */
export const ExportFormat = {
  JSON: 'json',
  MARKDOWN: 'markdown',
  TEXT: 'text',
} as const;

export type ExportFormat = (typeof ExportFormat)[keyof typeof ExportFormat];

export const ExportFormatSchema = z.enum(['json', 'markdown', 'text']);

// ============================================================================
// Tool Call Schema
// ============================================================================

/** A tool call made by the AI assistant during the conversation */
export const ExportToolCallSchema = z.object({
  /** Tool name (e.g. "execute_command", "read_file") */
  name: z.string(),
  /** Tool input parameters */
  input: z.record(z.unknown()),
  /** Tool execution result (if available) */
  result: z.string().optional(),
});

export type ExportToolCall = z.infer<typeof ExportToolCallSchema>;

// ============================================================================
// Message Schema
// ============================================================================

/** A single message in an exported conversation */
export const ExportMessageSchema = z.object({
  /** Message role */
  role: z.enum(['user', 'assistant', 'system']),
  /** Message text content */
  content: z.string(),
  /** Message timestamp (ISO 8601) */
  timestamp: z.string().datetime(),
  /** Tool calls made in this message (assistant only) */
  toolCalls: z.array(ExportToolCallSchema).optional(),
});

export type ExportMessage = z.infer<typeof ExportMessageSchema>;

// ============================================================================
// Conversation Export Schema
// ============================================================================

/** Full exported conversation with metadata and messages */
export const ConversationExportSchema = z.object({
  /** Conversation session ID */
  id: z.string(),
  /** Conversation title / topic */
  title: z.string(),
  /** Server ID this conversation belongs to */
  serverId: z.string(),
  /** Conversation creation timestamp (ISO 8601) */
  createdAt: z.string().datetime(),
  /** Export timestamp (ISO 8601) */
  exportedAt: z.string().datetime(),
  /** Export format used */
  format: ExportFormatSchema,
  /** Ordered list of messages */
  messages: z.array(ExportMessageSchema),
});

export type ConversationExport = z.infer<typeof ConversationExportSchema>;
