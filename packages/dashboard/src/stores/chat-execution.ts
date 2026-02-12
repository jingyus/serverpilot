// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors

/**
 * Chat execution logic: plan confirmation, step decisions, agentic confirms, emergency stop.
 * Extracted from chat.ts to keep each module under 500 lines.
 */

import { createSSEConnection } from '@/api/sse';
import type { SSEConnectionHandle, SSECallbacks } from '@/api/sse';
import { apiRequest } from '@/api/client';
import type { ChatMessage, ExecutionPlan } from '@/types/chat';
import {
  ExecutionPlanSchema,
  StepOutputSchema,
  StepCompleteSchema,
  ExecutionCompleteSchema,
} from '@/types/chat';
import type { ToolCallEntry, ExecutionMode, ChatState } from './chat-types.js';
import {
  INITIAL_EXECUTION, generateId, stripJsonPlan,
  PendingConfirmSchema, StepDecisionTimeoutSchema, StepStartSchema,
  ToolCallEventSchema, ToolExecutingEventSchema, ToolOutputEventSchema, ToolResultEventSchema,
  ConfirmRequiredEventSchema, ConfirmIdEventSchema,
  MessageEventSchema, RetryEventSchema,
} from './chat-types.js';

/** Log SSE JSON parse failures to console.warn and bump counter. */
function warnParseFail(set: SetFn, event: string, raw: string, err: unknown): void {
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
                  [parsed.stepId]: (s.execution.outputs[parsed.stepId] ?? '') + parsed.content,
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

/**
 * Build SSE callbacks for the sendMessage streaming flow.
 * Handles all SSE events: message, plan, auto_execute, execution steps, agentic tool calls.
 */
export function buildStreamingCallbacks(set: SetFn, get: GetFn): SSECallbacks {
  return {
    onMessage: (data) => {
      try {
        const parsed = MessageEventSchema.parse(JSON.parse(data));
        if (parsed.sessionId) {
          set({ sessionId: parsed.sessionId });
        }
        if (parsed.content) {
          set((state) => ({
            streamingContent: state.streamingContent + parsed.content,
          }));
        }
      } catch {
        set((state) => ({
          streamingContent: state.streamingContent + data,
        }));
      }
    },

    onRetry: (data) => {
      try {
        const parsed = RetryEventSchema.parse(JSON.parse(data));
        const content = parsed.isFallback
          ? `Switching to backup AI provider (${parsed.fallbackProvider ?? 'unknown'})...`
          : `AI request failed (${parsed.errorCategory}), retrying (${parsed.attempt}/${parsed.maxAttempts})...`;
        set((state) => ({
          streamingContent: state.streamingContent
            ? state.streamingContent + `\n\n_${content}_\n\n`
            : `_${content}_\n\n`,
        }));
      } catch (e) { warnParseFail(set, 'retry', data, e); }
    },

    onPlan: (data) => {
      try {
        const plan = ExecutionPlanSchema.parse(JSON.parse(data));
        set({ currentPlan: plan, planStatus: 'preview' });
      } catch {
        set({ error: 'Failed to parse execution plan' });
      }
    },

    onAutoExecute: (data) => {
      let plan: ExecutionPlan | null = get().currentPlan;
      let mode: ExecutionMode = 'log';

      try {
        const parsed: Record<string, unknown> = JSON.parse(data);
        if (parsed['plan']) {
          plan = ExecutionPlanSchema.parse(parsed['plan']);
          mode = 'inline';
        }
      } catch (e) { warnParseFail(set, 'auto_execute', data, e); }

      const { streamingContent } = get();
      const cleanText = stripJsonPlan(streamingContent);
      const freshExec = { ...INITIAL_EXECUTION, startTime: Date.now() };

      if (mode === 'inline') {
        set({
          streamingContent: cleanText ? cleanText + '\n\n' : '',
          currentPlan: plan,
          planStatus: 'executing',
          executionMode: 'inline',
          execution: freshExec,
        });
      } else {
        const msgs: ChatMessage[] = [];
        if (cleanText) {
          msgs.push({
            id: generateId(),
            role: 'assistant',
            content: cleanText,
            timestamp: new Date().toISOString(),
          });
        }
        set((state) => ({
          messages: [...state.messages, ...msgs],
          streamingContent: '',
          currentPlan: plan,
          planStatus: 'executing' as const,
          executionMode: 'log' as const,
          execution: freshExec,
        }));
      }
    },

    onStepStart: (data) => {
      try {
        const parsed = StepStartSchema.parse(JSON.parse(data));
        set((state) => ({
          execution: { ...state.execution, activeStepId: parsed.stepId },
        }));
      } catch (e) { warnParseFail(set, 'step_start', data, e); }
    },

    onOutput: (data) => {
      try {
        const parsed = StepOutputSchema.parse(JSON.parse(data));
        const { executionMode } = get();
        if (executionMode === 'inline') {
          set((state) => ({
            streamingContent: state.streamingContent + parsed.content,
          }));
        } else {
          set((state) => ({
            execution: {
              ...state.execution,
              outputs: {
                ...state.execution.outputs,
                [parsed.stepId]:
                  (state.execution.outputs[parsed.stepId] ?? '') + parsed.content,
              },
            },
          }));
        }
      } catch (e) { warnParseFail(set, 'output', data, e); }
    },

    onStepComplete: (data) => {
      try {
        const parsed = StepCompleteSchema.parse(JSON.parse(data));
        const { executionMode } = get();
        if (executionMode === 'inline') {
          set((state) => ({
            streamingContent: state.streamingContent + '\n',
            execution: {
              ...state.execution,
              completedSteps: {
                ...state.execution.completedSteps,
                [parsed.stepId]: { exitCode: parsed.exitCode, duration: parsed.duration },
              },
            },
          }));
        } else {
          set((state) => ({
            execution: {
              ...state.execution,
              completedSteps: {
                ...state.execution.completedSteps,
                [parsed.stepId]: { exitCode: parsed.exitCode, duration: parsed.duration },
              },
            },
          }));
        }
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

    onDiagnosis: () => {
      // Diagnosis events stored in session by server
    },

    onComplete: (data) => {
      const { planStatus, executionMode, streamingContent } = get();

      if (planStatus === 'executing') {
        if (executionMode === 'inline') {
          let success: boolean | null = null;
          try {
            const parsed = ExecutionCompleteSchema.parse(JSON.parse(data));
            success = parsed.success;
          } catch (e) { warnParseFail(set, 'complete(inline)', data, e); }

          const content = stripJsonPlan(streamingContent).trim();
          if (content) {
            const msg: ChatMessage = {
              id: generateId(),
              role: 'assistant',
              content,
              timestamp: new Date().toISOString(),
            };
            set((state) => ({
              messages: [...state.messages, msg],
              streamingContent: '',
              isStreaming: false,
              planStatus: 'completed' as const,
              executionMode: 'none' as const,
              pendingConfirm: null,
              agenticConfirm: null,
              isAgenticMode: false,
              toolCalls: [],
              execution: { ...state.execution, success, activeStepId: null },
            }));
          } else {
            set((state) => ({
              isStreaming: false,
              planStatus: 'completed' as const,
              executionMode: 'none' as const,
              pendingConfirm: null,
              agenticConfirm: null,
              isAgenticMode: false,
              toolCalls: [],
              execution: { ...state.execution, success, activeStepId: null },
            }));
          }
        } else {
          try {
            const parsed = ExecutionCompleteSchema.parse(JSON.parse(data));
            set((state) => ({
              planStatus: 'completed' as const,
              isStreaming: false,
              pendingConfirm: null,
              agenticConfirm: null,
              isAgenticMode: false,
              toolCalls: [],
              execution: {
                ...state.execution,
                success: parsed.success,
                operationId: parsed.operationId ?? null,
                activeStepId: null,
                cancelled: parsed.cancelled ?? false,
              },
            }));
          } catch (e) {
            warnParseFail(set, 'complete(log)', data, e);
            set({
              planStatus: 'completed',
              isStreaming: false,
              pendingConfirm: null,
              agenticConfirm: null,
              isAgenticMode: false,
              toolCalls: [],
            });
          }
        }
      } else {
        const cleanText = stripJsonPlan(streamingContent);
        const { currentPlan } = get();
        if (cleanText) {
          const msg: ChatMessage = {
            id: generateId(),
            role: 'assistant',
            content: cleanText,
            timestamp: new Date().toISOString(),
            plan: currentPlan ?? undefined,
          };
          set((state) => ({
            messages: [...state.messages, msg],
            streamingContent: '',
            isStreaming: false,
            agenticConfirm: null,
            isAgenticMode: false,
            toolCalls: [],
          }));
        } else {
          set({
            isStreaming: false,
            streamingContent: '',
            agenticConfirm: null,
            isAgenticMode: false,
            toolCalls: [],
          });
        }
      }
    },

    // ====== Agentic mode event handlers ======

    onToolCall: (data) => {
      try {
        const parsed = ToolCallEventSchema.parse(JSON.parse(data));
        set((state) => ({
          isAgenticMode: true,
          toolCalls: [...state.toolCalls, {
            id: parsed.id,
            tool: parsed.tool,
            status: 'running' as const,
            output: '',
          }],
        }));
      } catch (e) { warnParseFail(set, 'tool_call', data, e); }
    },

    onToolExecuting: (data) => {
      try {
        const parsed = ToolExecutingEventSchema.parse(JSON.parse(data));
        set((state) => ({
          streamingContent: state.streamingContent + `\n\`\`\`bash\n$ ${parsed.command}\n`,
          toolCalls: state.toolCalls.map((tc) =>
            tc.id === parsed.id ? { ...tc, command: parsed.command } : tc,
          ),
        }));
      } catch (e) { warnParseFail(set, 'tool_executing', data, e); }
    },

    onToolOutput: (data) => {
      try {
        const parsed = ToolOutputEventSchema.parse(JSON.parse(data));
        set((state) => ({
          streamingContent: state.streamingContent + parsed.content,
          toolCalls: state.toolCalls.map((tc) =>
            tc.id === parsed.id ? { ...tc, output: tc.output + parsed.content } : tc,
          ),
        }));
      } catch (e) { warnParseFail(set, 'tool_output', data, e); }
    },

    onToolResult: (data) => {
      try {
        const parsed = ToolResultEventSchema.parse(JSON.parse(data));
        set((state) => {
          const extra = parsed.output ?? '';
          const closingMark = '\n```\n';
          return {
            streamingContent: state.streamingContent + extra + closingMark,
            toolCalls: state.toolCalls.map((tc) =>
              tc.id === parsed.id
                ? { ...tc, status: parsed.status, exitCode: parsed.exitCode, duration: parsed.duration, output: tc.output + extra }
                : tc,
            ),
          };
        });
      } catch (e) { warnParseFail(set, 'tool_result', data, e); }
    },

    onConfirmRequired: (data) => {
      try {
        const parsed = ConfirmRequiredEventSchema.parse(JSON.parse(data));
        set({
          agenticConfirm: {
            confirmId: parsed.confirmId,
            command: parsed.command,
            description: parsed.description,
            riskLevel: parsed.riskLevel,
          },
        });
      } catch (e) { warnParseFail(set, 'confirm_required', data, e); }
    },

    onConfirmId: (data) => {
      try {
        const parsed = ConfirmIdEventSchema.parse(JSON.parse(data));
        set((state) => ({
          agenticConfirm: state.agenticConfirm
            ? { ...state.agenticConfirm, confirmId: parsed.confirmId }
            : null,
        }));
      } catch (e) { warnParseFail(set, 'confirm_id', data, e); }
    },

    onReconnecting: () => {
      set({ isReconnecting: true, error: null });
    },

    onReconnected: () => {
      set({ isReconnecting: false });
    },

    onError: (error) => {
      const { streamingContent } = get();
      if (streamingContent) {
        const partialMsg: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: streamingContent + '\n\n[Connection lost]',
          timestamp: new Date().toISOString(),
        };
        set((state) => ({
          messages: [...state.messages, partialMsg],
          error: error.message,
          isStreaming: false,
          isReconnecting: false,
          streamingContent: '',
          executionMode: 'none' as const,
          pendingConfirm: null,
          agenticConfirm: null,
        }));
      } else {
        set({
          error: error.message,
          isStreaming: false,
          isReconnecting: false,
          streamingContent: '',
          executionMode: 'none' as const,
          pendingConfirm: null,
          agenticConfirm: null,
        });
      }
    },
  };
}
