// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { create } from 'zustand';

import { createSSEConnection } from '@/api/sse';
import type { SSEConnectionHandle } from '@/api/sse';
import { apiRequest, ApiError } from '@/api/client';
import {
  ExecutionPlanSchema,
  StepOutputSchema,
  StepCompleteSchema,
  ExecutionCompleteSchema,
} from '@/types/chat';
import type {
  ChatMessage,
  ExecutionPlan,
  StepOutput,
  StepComplete,
  SessionSummary,
} from '@/types/chat';

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

interface ExecutionState {
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
}

/** Agentic mode: tracks a tool call in progress or completed */
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

/** Agentic mode: pending confirmation for a risky command */
export interface AgenticConfirm {
  confirmId: string;
  command: string;
  description: string;
  riskLevel: string;
}

/**
 * Execution mode determines how command output is displayed:
 * - 'inline': GREEN auto-execute — output streams directly into chat text (like Claude Code)
 * - 'log': non-GREEN step-confirm — output shown in ExecutionLog component
 * - 'none': no execution in progress
 */
export type ExecutionMode = 'none' | 'inline' | 'log';

interface ChatState {
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
  // Agentic mode state
  toolCalls: ToolCallEntry[];
  agenticConfirm: AgenticConfirm | null;
  isAgenticMode: boolean;

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

let activeHandle: SSEConnectionHandle | null = null;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useChatStore = create<ChatState>((set, get) => ({
  serverId: null,
  sessionId: null,
  messages: [],
  sessions: [],
  isLoading: false,
  isStreaming: false,
  isReconnecting: false,
  streamingContent: '',
  error: null,
  currentPlan: null,
  planStatus: 'none',
  execution: {
    activeStepId: null,
    outputs: {},
    completedSteps: {},
    success: null,
    operationId: null,
    startTime: null,
    cancelled: false,
  },
  executionMode: 'none',
  pendingConfirm: null,
  toolCalls: [],
  agenticConfirm: null,
  isAgenticMode: false,

  setServerId: (id) => set({ serverId: id }),

  sendMessage: (message) => {
    const { serverId, sessionId } = get();
    if (!serverId) {
      set({ error: 'No server selected' });
      return;
    }

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };

    set((state) => ({
      messages: [...state.messages, userMsg],
      isStreaming: true,
      isReconnecting: false,
      streamingContent: '',
      error: null,
      currentPlan: null,
      planStatus: 'none',
      executionMode: 'none',
      pendingConfirm: null,
      toolCalls: [],
      agenticConfirm: null,
      isAgenticMode: false,
    }));

    activeHandle?.abort();
    activeHandle = createSSEConnection(
      `/chat/${serverId}`,
      { message, sessionId: sessionId ?? undefined },
      {
        onMessage: (data) => {
          try {
            const parsed = JSON.parse(data) as { content?: string; sessionId?: string };
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
            const parsed = JSON.parse(data) as {
              attempt: number;
              maxAttempts: number;
              errorCategory: string;
              isFallback: boolean;
              fallbackProvider?: string;
            };
            const content = parsed.isFallback
              ? `Switching to backup AI provider (${parsed.fallbackProvider ?? 'unknown'})...`
              : `AI request failed (${parsed.errorCategory}), retrying (${parsed.attempt}/${parsed.maxAttempts})...`;
            set((state) => ({
              streamingContent: state.streamingContent
                ? state.streamingContent + `\n\n_${content}_\n\n`
                : `_${content}_\n\n`,
            }));
          } catch { /* ignore */ }
        },

        onPlan: (data) => {
          // Plan event only sent for non-GREEN plans (YELLOW/RED/CRITICAL) or agent-offline
          try {
            const plan = ExecutionPlanSchema.parse(JSON.parse(data));
            set({ currentPlan: plan, planStatus: 'preview' });
          } catch {
            set({ error: 'Failed to parse execution plan' });
          }
        },

        onAutoExecute: (data) => {
          // Determine execution mode: GREEN = inline, non-GREEN = log
          let plan: ExecutionPlan | null = get().currentPlan;
          let mode: ExecutionMode = 'log';

          try {
            const parsed = JSON.parse(data) as { plan?: unknown };
            if (parsed.plan) {
              // Plan embedded in auto_execute → GREEN auto-execute → inline mode
              plan = ExecutionPlanSchema.parse(parsed.plan);
              mode = 'inline';
            }
          } catch { /* use existing currentPlan, log mode */ }

          // For inline mode: strip json-plan from AI text, keep streaming open
          // For log mode: commit AI text as message, switch to ExecutionLog UI
          const { streamingContent } = get();
          const cleanText = stripJsonPlan(streamingContent);

          if (mode === 'inline') {
            // Inline: keep isStreaming=true, output will append to streamingContent
            set((state) => ({
              streamingContent: cleanText ? cleanText + '\n\n' : '',
              currentPlan: plan,
              planStatus: 'executing',
              executionMode: 'inline',
              execution: {
                activeStepId: null,
                outputs: {},
                completedSteps: {},
                success: null,
                operationId: null,
                startTime: Date.now(),
                cancelled: false,
              },
            }));
          } else {
            // Log mode: commit text, show ExecutionLog
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
              planStatus: 'executing',
              executionMode: 'log',
              execution: {
                activeStepId: null,
                outputs: {},
                completedSteps: {},
                success: null,
                operationId: null,
                startTime: Date.now(),
                cancelled: false,
              },
            }));
          }
        },

        // --- Execution event handlers (mode-aware) ---

        onStepStart: (data) => {
          try {
            const parsed = JSON.parse(data) as { stepId: string; command?: string };
            const { executionMode } = get();
            if (executionMode === 'inline') {
              // Inline: just track active step. The server sends "$ command\n" as an output event next.
              set((state) => ({
                execution: { ...state.execution, activeStepId: parsed.stepId },
              }));
            } else {
              set((state) => ({
                execution: { ...state.execution, activeStepId: parsed.stepId },
              }));
            }
          } catch { /* ignore */ }
        },

        onOutput: (data) => {
          try {
            const parsed = StepOutputSchema.parse(JSON.parse(data));
            const { executionMode } = get();
            if (executionMode === 'inline') {
              // Inline: append output directly to streaming text
              set((state) => ({
                streamingContent: state.streamingContent + parsed.content,
              }));
            } else {
              // Log mode: update execution state for ExecutionLog
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
          } catch { /* ignore */ }
        },

        onStepComplete: (data) => {
          try {
            const parsed = StepCompleteSchema.parse(JSON.parse(data));
            const { executionMode } = get();
            if (executionMode === 'inline') {
              // Inline: add separator between steps
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
          } catch { /* ignore */ }
        },

        onStepConfirm: (data) => {
          try {
            const parsed = JSON.parse(data) as PendingConfirm;
            set(() => ({ pendingConfirm: parsed }));
          } catch { /* ignore */ }
        },

        onDiagnosis: () => {
          // Diagnosis events stored in session by server
        },

        onComplete: (data) => {
          const { planStatus, executionMode, streamingContent } = get();

          if (planStatus === 'executing') {
            if (executionMode === 'inline') {
              // Inline execution done — commit everything as one assistant message
              let success: boolean | null = null;
              try {
                const parsed = ExecutionCompleteSchema.parse(JSON.parse(data));
                success = parsed.success;
              } catch { /* ignore */ }

              // Strip any json-plan blocks that leaked from AI summary
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
                  planStatus: 'completed',
                  executionMode: 'none',
                  pendingConfirm: null,
                  execution: { ...state.execution, success, activeStepId: null },
                }));
              } else {
                set((state) => ({
                  isStreaming: false,
                  planStatus: 'completed',
                  executionMode: 'none',
                  pendingConfirm: null,
                  execution: { ...state.execution, success, activeStepId: null },
                }));
              }
            } else {
              // Log mode — update execution state
              try {
                const parsed = ExecutionCompleteSchema.parse(JSON.parse(data));
                set((state) => ({
                  planStatus: 'completed',
                  isStreaming: false,
                  pendingConfirm: null,
                  execution: {
                    ...state.execution,
                    success: parsed.success,
                    operationId: parsed.operationId ?? null,
                    activeStepId: null,
                    cancelled: parsed.cancelled ?? false,
                  },
                }));
              } catch {
                set({ planStatus: 'completed', isStreaming: false, pendingConfirm: null });
              }
            }
          } else {
            // Normal chat completion (no execution)
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
              }));
            } else {
              set({ isStreaming: false, streamingContent: '' });
            }
          }
        },

        // ====== Agentic mode event handlers ======

        onToolCall: (data) => {
          try {
            const parsed = JSON.parse(data) as { id: string; tool: string; status: string };
            set((state) => ({
              isAgenticMode: true,
              toolCalls: [...state.toolCalls, {
                id: parsed.id,
                tool: parsed.tool,
                status: 'running' as const,
                output: '',
              }],
            }));
          } catch { /* ignore */ }
        },

        onToolExecuting: (data) => {
          try {
            const parsed = JSON.parse(data) as { id: string; tool: string; command: string };
            // Show the command being executed in streaming content
            set((state) => ({
              streamingContent: state.streamingContent + `\n\`\`\`bash\n$ ${parsed.command}\n`,
              toolCalls: state.toolCalls.map((tc) =>
                tc.id === parsed.id ? { ...tc, command: parsed.command } : tc,
              ),
            }));
          } catch { /* ignore */ }
        },

        onToolOutput: (data) => {
          try {
            const parsed = JSON.parse(data) as { id: string; content: string };
            // Stream output directly into chat text
            set((state) => ({
              streamingContent: state.streamingContent + parsed.content,
              toolCalls: state.toolCalls.map((tc) =>
                tc.id === parsed.id ? { ...tc, output: tc.output + parsed.content } : tc,
              ),
            }));
          } catch { /* ignore */ }
        },

        onToolResult: (data) => {
          try {
            const parsed = JSON.parse(data) as {
              id: string; tool: string; status: string;
              exitCode?: number; output?: string; duration?: number; error?: string;
            };
            // Close the code block and update tool call status
            const status = parsed.status as ToolCallEntry['status'];
            set((state) => {
              // If there was non-streamed output, append it
              let extra = '';
              if (parsed.output) {
                extra = parsed.output;
              }
              const closingMark = '\n```\n';
              return {
                streamingContent: state.streamingContent + extra + closingMark,
                toolCalls: state.toolCalls.map((tc) =>
                  tc.id === parsed.id
                    ? { ...tc, status, exitCode: parsed.exitCode, duration: parsed.duration, output: tc.output + (extra || '') }
                    : tc,
                ),
              };
            });
          } catch { /* ignore */ }
        },

        onConfirmRequired: (data) => {
          try {
            const parsed = JSON.parse(data) as {
              id: string; command: string; description: string; riskLevel: string;
            };
            set({
              agenticConfirm: {
                confirmId: '', // Will be set by confirm_id event
                command: parsed.command,
                description: parsed.description,
                riskLevel: parsed.riskLevel,
              },
            });
          } catch { /* ignore */ }
        },

        onConfirmId: (data) => {
          try {
            const parsed = JSON.parse(data) as { confirmId: string };
            set((state) => ({
              agenticConfirm: state.agenticConfirm
                ? { ...state.agenticConfirm, confirmId: parsed.confirmId }
                : null,
            }));
          } catch { /* ignore */ }
        },

        onReconnecting: (attempt) => {
          set({ isReconnecting: true, error: null });
        },

        onReconnected: () => {
          set({ isReconnecting: false });
        },

        onError: (error) => {
          // Preserve streamingContent so partial responses aren't lost
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
              executionMode: 'none',
              pendingConfirm: null,
              agenticConfirm: null,
            }));
          } else {
            set({
              error: error.message,
              isStreaming: false,
              isReconnecting: false,
              streamingContent: '',
              executionMode: 'none',
              pendingConfirm: null,
              agenticConfirm: null,
            });
          }
        },
      }
    );
  },

  confirmPlan: () => {
    const { serverId, sessionId, currentPlan } = get();
    if (!serverId || !sessionId || !currentPlan) return;

    set({
      planStatus: 'executing',
      executionMode: 'log',
      execution: {
        activeStepId: null,
        outputs: {},
        completedSteps: {},
        success: null,
        operationId: null,
        startTime: Date.now(),
        cancelled: false,
      },
    });

    activeHandle?.abort();
    activeHandle = createSSEConnection(
      `/chat/${serverId}/execute`,
      { planId: currentPlan.planId, sessionId },
      {
        onStepStart: (data) => {
          try {
            const parsed = JSON.parse(data) as { stepId: string };
            set((state) => ({
              execution: { ...state.execution, activeStepId: parsed.stepId },
            }));
          } catch { /* ignore */ }
        },

        onOutput: (data) => {
          try {
            const parsed = StepOutputSchema.parse(JSON.parse(data));
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
          } catch { /* ignore */ }
        },

        onStepComplete: (data) => {
          try {
            const parsed = StepCompleteSchema.parse(JSON.parse(data));
            set((state) => ({
              execution: {
                ...state.execution,
                completedSteps: {
                  ...state.execution.completedSteps,
                  [parsed.stepId]: { exitCode: parsed.exitCode, duration: parsed.duration },
                },
              },
            }));
          } catch { /* ignore */ }
        },

        onStepConfirm: (data) => {
          try {
            const parsed = JSON.parse(data) as PendingConfirm;
            set(() => ({ pendingConfirm: parsed }));
          } catch { /* ignore */ }
        },

        onComplete: (data) => {
          try {
            const parsed = ExecutionCompleteSchema.parse(JSON.parse(data));
            set((state) => ({
              planStatus: 'completed',
              isStreaming: false,
              pendingConfirm: null,
              execution: {
                ...state.execution,
                success: parsed.success,
                operationId: parsed.operationId ?? null,
                activeStepId: null,
                cancelled: parsed.cancelled ?? false,
              },
            }));
          } catch {
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
      }
    );
  },

  respondToStep: async (decision) => {
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
      // If the decision API fails, the server timeout will auto-reject
    }

    if (decision === 'reject') {
      set((state) => ({
        planStatus: 'completed',
        execution: {
          ...state.execution,
          success: false,
          activeStepId: null,
          cancelled: true,
        },
      }));
    }
  },

  respondToAgenticConfirm: async (approved) => {
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
      // If confirm API fails, server timeout will auto-reject
    }
  },

  emergencyStop: async () => {
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

    set((state) => ({
      planStatus: 'completed',
      executionMode: 'none',
      pendingConfirm: null,
      execution: {
        ...state.execution,
        success: false,
        activeStepId: null,
        cancelled: true,
      },
    }));
  },

  rejectPlan: () => {
    set({ currentPlan: null, planStatus: 'none', executionMode: 'none', pendingConfirm: null });
    const systemMsg: ChatMessage = {
      id: generateId(),
      role: 'system',
      content: 'Plan was rejected. You can send a new message to try again.',
      timestamp: new Date().toISOString(),
    };
    set((state) => ({ messages: [...state.messages, systemMsg] }));
  },

  fetchSessions: async (serverId) => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiRequest<{ sessions: SessionSummary[] }>(
        `/chat/${serverId}/sessions`
      );
      set({ sessions: data.sessions, isLoading: false });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to load sessions';
      set({ error: message, isLoading: false });
    }
  },

  loadSession: async (serverId, sessionId) => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiRequest<{
        session: { id: string; messages: ChatMessage[] };
      }>(`/chat/${serverId}/sessions/${sessionId}`);
      set({
        sessionId: data.session.id,
        messages: data.session.messages,
        isLoading: false,
        currentPlan: null,
        planStatus: 'none',
      });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to load session';
      set({ error: message, isLoading: false });
    }
  },

  deleteSession: async (serverId, sessionId) => {
    try {
      await apiRequest(`/chat/${serverId}/sessions/${sessionId}`, {
        method: 'DELETE',
      });
      set((state) => ({
        sessions: state.sessions.filter((s) => s.id !== sessionId),
        ...(state.sessionId === sessionId
          ? { sessionId: null, messages: [], currentPlan: null, planStatus: 'none' as const }
          : {}),
      }));
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to delete session';
      set({ error: message });
    }
  },

  newSession: () => {
    activeHandle?.abort();
    set({
      sessionId: null,
      messages: [],
      currentPlan: null,
      planStatus: 'none',
      isStreaming: false,
      isReconnecting: false,
      streamingContent: '',
      error: null,
      executionMode: 'none',
      pendingConfirm: null,
      toolCalls: [],
      agenticConfirm: null,
      isAgenticMode: false,
      execution: {
        activeStepId: null,
        outputs: {},
        completedSteps: {},
        success: null,
        operationId: null,
        startTime: null,
        cancelled: false,
      },
    });
  },

  cancelStream: () => {
    activeHandle?.abort();
    activeHandle = null;
    const { streamingContent } = get();
    if (streamingContent) {
      const partialMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: streamingContent + '\n\n[Cancelled]',
        timestamp: new Date().toISOString(),
      };
      set((state) => ({
        messages: [...state.messages, partialMsg],
        isStreaming: false,
        streamingContent: '',
      }));
    } else {
      set({ isStreaming: false, streamingContent: '' });
    }
  },

  cleanup: () => {
    activeHandle?.abort();
    activeHandle = null;
    set({
      isStreaming: false,
      isReconnecting: false,
      streamingContent: '',
      executionMode: 'none',
      pendingConfirm: null,
      agenticConfirm: null,
    });
  },

  clearError: () => set({ error: null }),
}));
