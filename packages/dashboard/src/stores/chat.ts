// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { create } from 'zustand';

import { createSSEConnection } from '@/api/sse';
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

interface ExecutionState {
  activeStepId: string | null;
  outputs: Record<string, string>;
  completedSteps: Record<string, { exitCode: number; duration: number }>;
  success: boolean | null;
  operationId: string | null;
  startTime: number | null;
  cancelled: boolean;
}

interface ChatState {
  serverId: string | null;
  sessionId: string | null;
  messages: ChatMessage[];
  sessions: SessionSummary[];
  isLoading: boolean;
  isStreaming: boolean;
  streamingContent: string;
  error: string | null;
  currentPlan: ExecutionPlan | null;
  planStatus: 'none' | 'preview' | 'confirmed' | 'executing' | 'completed';
  execution: ExecutionState;

  setServerId: (id: string | null) => void;
  sendMessage: (message: string) => void;
  confirmPlan: () => void;
  rejectPlan: () => void;
  emergencyStop: () => Promise<void>;
  fetchSessions: (serverId: string) => Promise<void>;
  loadSession: (serverId: string, sessionId: string) => Promise<void>;
  deleteSession: (serverId: string, sessionId: string) => Promise<void>;
  newSession: () => void;
  cancelStream: () => void;
  clearError: () => void;
}

let activeController: AbortController | null = null;

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
      streamingContent: '',
      error: null,
      currentPlan: null,
      planStatus: 'none',
    }));

    activeController?.abort();
    activeController = createSSEConnection(
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

        onPlan: (data) => {
          try {
            const plan = ExecutionPlanSchema.parse(JSON.parse(data));
            set({ currentPlan: plan, planStatus: 'preview' });
          } catch {
            set({ error: 'Failed to parse execution plan' });
          }
        },

        onComplete: () => {
          const { streamingContent, currentPlan } = get();
          if (streamingContent) {
            const assistantMsg: ChatMessage = {
              id: generateId(),
              role: 'assistant',
              content: streamingContent,
              timestamp: new Date().toISOString(),
              plan: currentPlan ?? undefined,
            };
            set((state) => ({
              messages: [...state.messages, assistantMsg],
              streamingContent: '',
              isStreaming: false,
            }));
          } else {
            set({ isStreaming: false });
          }
        },

        onError: (error) => {
          set({
            error: error.message,
            isStreaming: false,
            streamingContent: '',
          });
        },
      }
    );
  },

  confirmPlan: () => {
    const { serverId, sessionId, currentPlan } = get();
    if (!serverId || !sessionId || !currentPlan) return;

    set({
      planStatus: 'executing',
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

    activeController?.abort();
    activeController = createSSEConnection(
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
                    (state.execution.outputs[parsed.stepId] ?? '') +
                    parsed.content,
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
                  [parsed.stepId]: {
                    exitCode: parsed.exitCode,
                    duration: parsed.duration,
                  },
                },
              },
            }));
          } catch { /* ignore */ }
        },

        onComplete: (data) => {
          try {
            const parsed = ExecutionCompleteSchema.parse(JSON.parse(data));
            set((state) => ({
              planStatus: 'completed',
              execution: {
                ...state.execution,
                success: parsed.success,
                operationId: parsed.operationId ?? null,
                activeStepId: null,
                cancelled: parsed.cancelled ?? false,
              },
            }));
          } catch {
            set({ planStatus: 'completed' });
          }
        },

        onError: (error) => {
          set({
            error: error.message,
            planStatus: 'preview',
          });
        },
      }
    );
  },

  emergencyStop: async () => {
    const { serverId, sessionId, currentPlan } = get();
    if (!serverId || !sessionId || !currentPlan) return;

    // Abort the SSE connection first
    activeController?.abort();
    activeController = null;

    try {
      await apiRequest(`/chat/${serverId}/execute/cancel`, {
        method: 'POST',
        body: JSON.stringify({
          planId: currentPlan.planId,
          sessionId,
        }),
      });
    } catch {
      // Cancel API may fail if execution already completed — that's OK
    }

    set((state) => ({
      planStatus: 'completed',
      execution: {
        ...state.execution,
        success: false,
        activeStepId: null,
        cancelled: true,
      },
    }));
  },

  rejectPlan: () => {
    set({ currentPlan: null, planStatus: 'none' });
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
    activeController?.abort();
    set({
      sessionId: null,
      messages: [],
      currentPlan: null,
      planStatus: 'none',
      isStreaming: false,
      streamingContent: '',
      error: null,
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
    activeController?.abort();
    activeController = null;
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

  clearError: () => set({ error: null }),
}));
