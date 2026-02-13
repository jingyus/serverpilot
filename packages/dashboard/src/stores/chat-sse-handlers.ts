// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors

/**
 * SSE event handlers for the sendMessage streaming flow.
 * Extracted from chat-execution.ts to keep each module under 500 lines.
 */

import type { SSECallbacks } from '@/api/sse';
import type { ChatMessage, ExecutionPlan } from '@/types/chat';
import {
  ExecutionPlanSchema,
  StepOutputSchema,
  StepCompleteSchema,
  ExecutionCompleteSchema,
} from '@/types/chat';
import type { ExecutionMode, ChatState } from './chat-types.js';
import {
  INITIAL_EXECUTION, generateId, stripJsonPlan,
  PendingConfirmSchema, StepDecisionTimeoutSchema, StepStartSchema,
  ToolCallEventSchema, ToolExecutingEventSchema, ToolOutputEventSchema, ToolResultEventSchema,
  ConfirmRequiredEventSchema, ConfirmIdEventSchema,
  MessageEventSchema, RetryEventSchema,
} from './chat-types.js';
import { appendOutput, warnParseFail } from './chat-execution.js';

type SetFn = (
  partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>),
) => void;
type GetFn = () => ChatState;

/** Common state reset applied when streaming ends (complete/error). */
const STREAM_DONE_RESET = {
  isStreaming: false,
  agenticConfirm: null,
  isAgenticMode: false,
  toolCalls: [] as ChatState['toolCalls'],
} as const;

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
        if (parsed['plan']) { plan = ExecutionPlanSchema.parse(parsed['plan']); mode = 'inline'; }
      } catch (e) { warnParseFail(set, 'auto_execute', data, e); }

      const cleanText = stripJsonPlan(get().streamingContent);
      const freshExec = { ...INITIAL_EXECUTION, startTime: Date.now() };
      const basePatch = { currentPlan: plan, planStatus: 'executing' as const, execution: freshExec };

      if (mode === 'inline') {
        set({ ...basePatch, streamingContent: cleanText ? cleanText + '\n\n' : '', executionMode: 'inline' });
      } else {
        const msgs: ChatMessage[] = cleanText
          ? [{ id: generateId(), role: 'assistant' as const, content: cleanText, timestamp: new Date().toISOString() }]
          : [];
        set((state) => ({ ...basePatch, messages: [...state.messages, ...msgs], streamingContent: '', executionMode: 'log' as const }));
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
                [parsed.stepId]: appendOutput(
                  state.execution.outputs[parsed.stepId] ?? '',
                  parsed.content,
                ),
              },
            },
          }));
        }
      } catch (e) { warnParseFail(set, 'output', data, e); }
    },

    onStepComplete: (data) => {
      try {
        const parsed = StepCompleteSchema.parse(JSON.parse(data));
        const isInline = get().executionMode === 'inline';
        set((state) => ({
          ...(isInline ? { streamingContent: state.streamingContent + '\n' } : {}),
          execution: {
            ...state.execution,
            completedSteps: {
              ...state.execution.completedSteps,
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
          const msgPatch = content
            ? { messages: [...get().messages, { id: generateId(), role: 'assistant' as const, content, timestamp: new Date().toISOString() }], streamingContent: '' }
            : {};
          set((state) => ({
            ...msgPatch,
            ...STREAM_DONE_RESET,
            planStatus: 'completed' as const,
            executionMode: 'none' as const,
            pendingConfirm: null,
            execution: { ...state.execution, success, activeStepId: null },
          }));
        } else {
          try {
            const parsed = ExecutionCompleteSchema.parse(JSON.parse(data));
            set((state) => ({
              ...STREAM_DONE_RESET,
              planStatus: 'completed' as const,
              pendingConfirm: null,
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
            set({ ...STREAM_DONE_RESET, planStatus: 'completed', pendingConfirm: null });
          }
        }
      } else {
        const cleanText = stripJsonPlan(streamingContent);
        if (cleanText) {
          const { currentPlan } = get();
          const msg: ChatMessage = {
            id: generateId(), role: 'assistant', content: cleanText,
            timestamp: new Date().toISOString(), plan: currentPlan ?? undefined,
          };
          set((state) => ({
            messages: [...state.messages, msg],
            streamingContent: '',
            ...STREAM_DONE_RESET,
          }));
        } else {
          set({ streamingContent: '', ...STREAM_DONE_RESET });
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
      const errorBase = {
        error: error.message, isStreaming: false, isReconnecting: false,
        streamingContent: '', executionMode: 'none' as const, pendingConfirm: null, agenticConfirm: null,
      };
      if (streamingContent) {
        const partialMsg: ChatMessage = {
          id: generateId(), role: 'assistant',
          content: streamingContent + '\n\n[Connection lost]', timestamp: new Date().toISOString(),
        };
        set((state) => ({ messages: [...state.messages, partialMsg], ...errorBase }));
      } else {
        set(errorBase);
      }
    },
  };
}
