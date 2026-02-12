// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors

/**
 * Shared types for the chat store modules (chat.ts, chat-execution.ts, chat-sessions.ts).
 */

import { z } from 'zod';
import type { ChatMessage, ExecutionPlan, SessionSummary } from '@/types/chat';

export interface ExecutionState {
  activeStepId: string | null;
  outputs: Record<string, string>;
  completedSteps: Record<string, { exitCode: number; duration: number }>;
  success: boolean | null;
  operationId: string | null;
  startTime: number | null;
  cancelled: boolean;
}

export interface PendingConfirm {
  stepId: string;
  command: string;
  description: string;
  riskLevel: string;
  /** Server-provided timeout duration in ms (for countdown display). */
  timeoutMs?: number;
}

export interface ToolCallEntry {
  id: string;
  tool: string;
  command?: string;
  description?: string;
  status: 'running' | 'completed' | 'failed' | 'blocked' | 'rejected';
  output: string;
  exitCode?: number;
  duration?: number;
}

export interface AgenticConfirm {
  confirmId: string;
  command: string;
  description: string;
  riskLevel: string;
}

// ── Zod schemas for runtime validation of SSE event payloads ──

export const PendingConfirmSchema = z.object({
  stepId: z.string().min(1),
  command: z.string(),
  description: z.string(),
  riskLevel: z.string(),
  timeoutMs: z.number().optional(),
});

export const StepDecisionTimeoutSchema = z.object({
  stepId: z.string().min(1),
  timeoutMs: z.number(),
});

const ToolCallStatusSchema = z.enum(['running', 'completed', 'failed', 'blocked', 'rejected']);

export const StepStartSchema = z.object({ stepId: z.string().min(1) });

export const ToolCallEventSchema = z.object({
  id: z.string().min(1),
  tool: z.string(),
  status: z.string().optional(),
});

export const ToolExecutingEventSchema = z.object({
  id: z.string().min(1),
  tool: z.string().optional(),
  command: z.string(),
});

export const ToolOutputEventSchema = z.object({
  id: z.string().min(1),
  content: z.string(),
});

export const ToolResultEventSchema = z.object({
  id: z.string().min(1),
  tool: z.string().optional(),
  status: ToolCallStatusSchema,
  exitCode: z.number().optional(),
  output: z.string().optional(),
  duration: z.number().optional(),
  error: z.string().optional(),
});

export const ConfirmRequiredEventSchema = z.object({
  id: z.string().optional(),
  command: z.string(),
  description: z.string(),
  riskLevel: z.string(),
  confirmId: z.string().min(1),
});

export const ConfirmIdEventSchema = z.object({
  confirmId: z.string().min(1),
});

export const MessageEventSchema = z.object({
  content: z.string().optional(),
  sessionId: z.string().optional(),
});

export const RetryEventSchema = z.object({
  attempt: z.number(),
  maxAttempts: z.number(),
  errorCategory: z.string(),
  isFallback: z.boolean(),
  fallbackProvider: z.string().optional(),
});

/**
 * Execution mode determines how command output is displayed:
 * - 'inline': GREEN auto-execute — output streams directly into chat text
 * - 'log': non-GREEN step-confirm — output shown in ExecutionLog component
 * - 'none': no execution in progress
 */
export type ExecutionMode = 'none' | 'inline' | 'log';

export interface ChatState {
  serverId: string | null;
  sessionId: string | null;
  messages: ChatMessage[];
  sessions: SessionSummary[];
  isLoading: boolean;
  isStreaming: boolean;
  isReconnecting: boolean;
  streamingContent: string;
  error: string | null;
  currentPlan: ExecutionPlan | null;
  planStatus: 'none' | 'preview' | 'confirmed' | 'executing' | 'completed';
  execution: ExecutionState;
  executionMode: ExecutionMode;
  pendingConfirm: PendingConfirm | null;
  toolCalls: ToolCallEntry[];
  agenticConfirm: AgenticConfirm | null;
  isAgenticMode: boolean;
  sseParseErrors: number;

  setServerId: (id: string | null) => void;
  sendMessage: (message: string) => void;
  confirmPlan: () => void;
  rejectPlan: () => void;
  respondToStep: (decision: 'allow' | 'allow_all' | 'reject') => Promise<void>;
  respondToAgenticConfirm: (approved: boolean) => Promise<void>;
  emergencyStop: () => Promise<void>;
  fetchSessions: (serverId: string) => Promise<void>;
  loadSession: (serverId: string, sessionId: string) => Promise<void>;
  deleteSession: (serverId: string, sessionId: string) => Promise<void>;
  newSession: () => void;
  cancelStream: () => void;
  cleanup: () => void;
  clearError: () => void;
}

export const INITIAL_EXECUTION: ExecutionState = {
  activeStepId: null,
  outputs: {},
  completedSteps: {},
  success: null,
  operationId: null,
  startTime: null,
  cancelled: false,
};

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Strip json-plan blocks and any raw JSON plan objects from AI text so users never see them. */
export function stripJsonPlan(text: string): string {
  let clean = text;
  // Complete ```json-plan ... ``` blocks
  clean = clean.replace(/```json-plan\s*\n[\s\S]*?```/g, '');
  // Incomplete ```json-plan (no closing ```) — strip to end
  clean = clean.replace(/```json-plan[\s\S]*$/g, '');
  // Complete ```json ... ``` blocks that contain "steps" (likely a plan)
  clean = clean.replace(/```json\s*\n\s*\{[\s\S]*?"steps"\s*:[\s\S]*?```/g, '');
  // Incomplete ```json with "steps" — strip to end
  clean = clean.replace(/```json\s*\n\s*\{[\s\S]*?"steps"\s*:[\s\S]*$/g, '');
  // Collapse excessive newlines
  return clean.replace(/\n{3,}/g, '\n\n').trim();
}
