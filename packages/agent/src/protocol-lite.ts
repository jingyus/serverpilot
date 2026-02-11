// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Lightweight protocol message utilities for the agent binary.
 *
 * Provides the same MessageType constants, createMessage helper, and
 * message parsing as @aiinstaller/shared but WITHOUT depending on Zod.
 * This avoids bundling the Zod library into the compiled binary,
 * reducing binary size by ~8-10 MB (keeping it under the 50 MB target).
 *
 * The agent trusts the server for message structure; only basic type
 * checks are performed on incoming data.
 */

// Re-define MessageType locally to avoid importing from @aiinstaller/shared
// (which would pull in Zod via barrel exports).

/** All valid message type strings (mirrored from @aiinstaller/shared) */
export const MessageType = {
  AUTH_REQUEST: 'auth.request',
  AUTH_RESPONSE: 'auth.response',
  SESSION_CREATE: 'session.create',
  ENV_REPORT: 'env.report',
  PLAN_RECEIVE: 'plan.receive',
  STEP_EXECUTE: 'step.execute',
  STEP_OUTPUT: 'step.output',
  STEP_COMPLETE: 'step.complete',
  ERROR_OCCURRED: 'error.occurred',
  FIX_SUGGEST: 'fix.suggest',
  SESSION_COMPLETE: 'session.complete',
  AI_STREAM_START: 'ai.stream.start',
  AI_STREAM_TOKEN: 'ai.stream.token',
  AI_STREAM_COMPLETE: 'ai.stream.complete',
  AI_STREAM_ERROR: 'ai.stream.error',
  SNAPSHOT_REQUEST: 'snapshot.request',
  SNAPSHOT_RESPONSE: 'snapshot.response',
  ROLLBACK_REQUEST: 'rollback.request',
  ROLLBACK_RESPONSE: 'rollback.response',
  METRICS_REPORT: 'metrics.report',
} as const;

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

// Use the shared types (type-only imports are erased at compile time, no Zod bundled)
import type { Message } from '@aiinstaller/shared';
export type { Message };

/**
 * Lightweight safe-parse for incoming WebSocket messages.
 * Performs basic structural validation without Zod.
 */
export function safeParseMessageLite(data: unknown): { success: true; data: Message } | { success: false; error: Error } {
  if (data === null || data === undefined || typeof data !== 'object') {
    return { success: false, error: new Error('Message must be a non-null object') };
  }

  const msg = data as Record<string, unknown>;

  if (typeof msg.type !== 'string') {
    return { success: false, error: new Error('Message must have a string "type" field') };
  }

  const validTypes = Object.values(MessageType) as string[];
  if (!validTypes.includes(msg.type)) {
    return { success: false, error: new Error(`Unknown message type: ${msg.type}`) };
  }

  if (typeof msg.timestamp !== 'number') {
    return { success: false, error: new Error('Message must have a numeric "timestamp" field') };
  }

  return { success: true, data: data as Message };
}

/**
 * Create a protocol message with the current timestamp.
 * Lightweight replacement for createMessage from @aiinstaller/shared.
 */
export function createMessageLite<T extends Message['type']>(
  type: T,
  payload: Extract<Message, { type: T }>['payload'],
  requestId?: string,
): Extract<Message, { type: T }> {
  return {
    type,
    payload,
    timestamp: Date.now(),
    ...(requestId !== undefined ? { requestId } : {}),
  } as Extract<Message, { type: T }>;
}
