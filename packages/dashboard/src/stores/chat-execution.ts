// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors

/**
 * Chat execution logic: plan confirmation, step decisions, agentic confirms, emergency stop.
 * Extracted from chat.ts to keep each module under 500 lines.
 *
 * SSE streaming callbacks live in chat-sse-handlers.ts.
 */

import { createSSEConnection } from '@/api/sse';
import type { SSEConnectionHandle } from '@/api/sse';
import { apiRequest } from '@/api/client';
import {
  StepOutputSchema,
  StepCompleteSchema,
  ExecutionCompleteSchema,
} from '@/types/chat';
import type { ChatState } from './chat-types.js';
import {
  INITIAL_EXECUTION,
  PendingConfirmSchema, StepDecisionTimeoutSchema, StepStartSchema,
} from './chat-types.js';

// Re-export buildStreamingCallbacks so chat.ts imports stay unchanged
export { buildStreamingCallbacks } from './chat-sse-handlers.js';

/** Maximum characters kept per step output. Head is truncated to stay within budget. */
export const MAX_OUTPUT_CHARS = 500_000;

const TRUNCATION_NOTICE_PREFIX = '[... 早期输出已截断，共 ';
const TRUNCATION_NOTICE_SUFFIX = ' 字符 ...]\n';

/** Append `content` to existing output, truncating head when over MAX_OUTPUT_CHARS. */
export function appendOutput(existing: string, content: string): string {
  const combined = existing + content;
  if (combined.length <= MAX_OUTPUT_CHARS) return combined;

  const truncatedChars = combined.length - MAX_OUTPUT_CHARS;
  const notice = TRUNCATION_NOTICE_PREFIX + truncatedChars + TRUNCATION_NOTICE_SUFFIX;
  // Keep tail of (MAX_OUTPUT_CHARS - notice.length) chars so total ≤ MAX_OUTPUT_CHARS
  const keepLen = MAX_OUTPUT_CHARS - notice.length;
  return notice + combined.slice(combined.length - keepLen);
}

/** Log SSE JSON parse failures to console.warn and bump counter. */
export function warnParseFail(
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  event: string,
  raw: string,
  err: unknown,
): void {
  console.warn(`[SSE] Failed to parse "${event}" event:`, err, '\nRaw data:', raw);
  set((s) => ({ sseParseErrors: s.sseParseErrors + 1 }));
}

/** Module-level SSE handle shared with chat.ts via getter/setter */
let activeHandle: SSEConnectionHandle | null = null;

export function getActiveHandle(): SSEConnectionHandle | null {
  return activeHandle;
}

export function setActiveHandle(handle: SSEConnectionHandle | null): void {
  activeHandle = handle;
}

type SetFn = (
  partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>),
) => void;
type GetFn = () => ChatState;

export function createConfirmPlan(set: SetFn, get: GetFn) {
  return (): void => {
    const { serverId, sessionId, currentPlan } = get();
    if (!serverId || !sessionId || !currentPlan) return;

    set({
      planStatus: 'executing',
      executionMode: 'log',
      execution: { ...INITIAL_EXECUTION, startTime: Date.now() },
    });

    activeHandle?.abort();
    activeHandle = createSSEConnection(
      `/chat/${serverId}/execute`,
      { planId: currentPlan.planId, sessionId },
      {
        onStepStart: (data) => {
          try {
            const parsed = StepStartSchema.parse(JSON.parse(data));
            set((s) => ({
              execution: { ...s.execution, activeStepId: parsed.stepId },
            }));
          } catch (e) { warnParseFail(set, 'step_start', data, e); }
        },

        onOutput: (data) => {
          try {
            const parsed = StepOutputSchema.parse(JSON.parse(data));
            set((s) => ({
              execution: {
                ...s.execution,
                outputs: {
                  ...s.execution.outputs,
                  [parsed.stepId]: appendOutput(
                    s.execution.outputs[parsed.stepId] ?? '',
                    parsed.content,
                  ),
                },
              },
            }));
          } catch (e) { warnParseFail(set, 'output', data, e); }
        },

        onStepComplete: (data) => {
          try {
            const parsed = StepCompleteSchema.parse(JSON.parse(data));
            set((s) => ({
              execution: {
                ...s.execution,
                completedSteps: {
                  ...s.execution.completedSteps,
                  [parsed.stepId]: { exitCode: parsed.exitCode, duration: parsed.duration },
                },
              },
            }));
          } catch (e) { warnParseFail(set, 'step_complete', data, e); }
        },

        onStepConfirm: (data) => {
          try {
            const parsed = PendingConfirmSchema.parse(JSON.parse(data));
            set({ pendingConfirm: parsed });
          } catch (e) { warnParseFail(set, 'step_confirm', data, e); }
        },

        onStepDecisionTimeout: (data) => {
          try {
            StepDecisionTimeoutSchema.parse(JSON.parse(data));
            set({ pendingConfirm: null, error: 'Step confirmation timed out. The step was automatically rejected.' });
          } catch (e) { warnParseFail(set, 'step_decision_timeout', data, e); }
        },

        onComplete: (data) => {
          try {
            const parsed = ExecutionCompleteSchema.parse(JSON.parse(data));
            set((s) => ({
              planStatus: 'completed' as const,
              isStreaming: false,
              pendingConfirm: null,
              execution: {
                ...s.execution,
                success: parsed.success,
                operationId: parsed.operationId ?? null,
                activeStepId: null,
                cancelled: parsed.cancelled ?? false,
              },
            }));
          } catch (e) {
            warnParseFail(set, 'complete', data, e);
            set({ planStatus: 'completed', isStreaming: false, pendingConfirm: null });
          }
        },

        onReconnecting: () => {
          set({ isReconnecting: true, error: null });
        },

        onReconnected: () => {
          set({ isReconnecting: false });
        },

        onError: (error) => {
          set({
            error: error.message,
            planStatus: 'preview',
            isReconnecting: false,
            pendingConfirm: null,
          });
        },
      },
    );
  };
}

export function createRespondToStep(set: SetFn, get: GetFn) {
  return async (decision: 'allow' | 'allow_all' | 'reject'): Promise<void> => {
    const { serverId, sessionId, currentPlan, pendingConfirm } = get();
    if (!serverId || !sessionId || !currentPlan || !pendingConfirm) return;

    set({ pendingConfirm: null });

    try {
      await apiRequest(`/chat/${serverId}/step-decision`, {
        method: 'POST',
        body: JSON.stringify({
          planId: currentPlan.planId,
          sessionId,
          stepId: pendingConfirm.stepId,
          decision,
        }),
      });
    } catch {
      set({ pendingConfirm, error: 'Failed to send step decision. Please try again.' });
      return;
    }

    if (decision === 'reject') {
      set((s) => ({
        planStatus: 'completed' as const,
        execution: {
          ...s.execution,
          success: false,
          activeStepId: null,
          cancelled: true,
        },
      }));
    }
  };
}

export function createRespondToAgenticConfirm(set: SetFn, get: GetFn) {
  return async (approved: boolean): Promise<void> => {
    const { serverId, agenticConfirm } = get();
    if (!serverId || !agenticConfirm?.confirmId) return;

    set({ agenticConfirm: null });

    try {
      await apiRequest(`/chat/${serverId}/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          confirmId: agenticConfirm.confirmId,
          approved,
        }),
      });
    } catch {
      set({ agenticConfirm, error: 'Failed to send confirmation. Please try again.' });
    }
  };
}

export function createEmergencyStop(set: SetFn, get: GetFn) {
  return async (): Promise<void> => {
    const { serverId, sessionId, currentPlan } = get();
    if (!serverId || !sessionId || !currentPlan) return;

    activeHandle?.abort();
    activeHandle = null;

    try {
      await apiRequest(`/chat/${serverId}/execute/cancel`, {
        method: 'POST',
        body: JSON.stringify({
          planId: currentPlan.planId,
          sessionId,
        }),
      });
    } catch {
      // Cancel API may fail if execution already completed
    }

    set((s) => ({
      planStatus: 'completed' as const,
      executionMode: 'none' as const,
      pendingConfirm: null,
      execution: {
        ...s.execution,
        success: false,
        activeStepId: null,
        cancelled: true,
      },
    }));
  };
}
