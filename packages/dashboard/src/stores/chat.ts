// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { create } from 'zustand';

import { createSSEConnection } from '@/api/sse';
import type { ChatMessage } from '@/types/chat';

// Re-export shared types so existing imports from '@/stores/chat' keep working
export type {
  ExecutionState,
  PendingConfirm,
  ToolCallEntry,
  AgenticConfirm,
  ExecutionMode,
  ChatState,
} from './chat-types.js';
export { generateId, stripJsonPlan } from './chat-types.js';

import type { ChatState } from './chat-types.js';
import { INITIAL_EXECUTION, generateId } from './chat-types.js';

import {
  getActiveHandle,
  setActiveHandle,
  createConfirmPlan,
  createRespondToStep,
  createRespondToAgenticConfirm,
  createEmergencyStop,
  buildStreamingCallbacks,
} from './chat-execution.js';

import {
  createFetchSessions,
  createLoadSession,
  createDeleteSession,
} from './chat-sessions.js';

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
  execution: { ...INITIAL_EXECUTION },
  executionMode: 'none',
  pendingConfirm: null,
  toolCalls: [],
  agenticConfirm: null,
  isAgenticMode: false,
  sseParseErrors: 0,

  setServerId: (id) => set({ serverId: id }),

  sendMessage: (message) => {
    const { serverId, sessionId, isStreaming } = get();
    if (isStreaming) return;
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
      planStatus: 'none' as const,
      executionMode: 'none' as const,
      pendingConfirm: null,
      toolCalls: [],
      agenticConfirm: null,
      isAgenticMode: false,
      sseParseErrors: 0,
    }));

    getActiveHandle()?.abort();
    const handle = createSSEConnection(
      `/chat/${serverId}`,
      { message, sessionId: sessionId ?? undefined },
      buildStreamingCallbacks(set, get),
    );
    setActiveHandle(handle);
  },

  retryMessage: (messageId) => {
    const { messages, isStreaming } = get();
    if (isStreaming) return;
    const msg = messages.find((m) => m.id === messageId);
    if (!msg || msg.role !== 'user') return;
    // Remove the failed message and any subsequent assistant/system error messages
    const idx = messages.indexOf(msg);
    const trimmed = messages.slice(0, idx);
    set({ messages: trimmed, error: null });
    // Re-send the same content
    get().sendMessage(msg.content);
  },

  regenerateLastResponse: () => {
    const { messages, isStreaming } = get();
    if (isStreaming) return;
    // Find the last assistant message
    let lastAssistantIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        lastAssistantIdx = i;
        break;
      }
    }
    if (lastAssistantIdx < 0) return;
    // Find the user message that preceded it
    let userMsg: ChatMessage | null = null;
    for (let i = lastAssistantIdx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userMsg = messages[i];
        break;
      }
    }
    if (!userMsg) return;
    // Remove the assistant message (and anything after it) and re-send
    const trimmed = messages.slice(0, lastAssistantIdx);
    set({ messages: trimmed, error: null });
    get().sendMessage(userMsg.content);
  },

  confirmPlan: createConfirmPlan(set, get),
  respondToStep: createRespondToStep(set, get),
  respondToAgenticConfirm: createRespondToAgenticConfirm(set, get),
  emergencyStop: createEmergencyStop(set, get),

  // BUG FIX: merged two separate set() calls into one
  rejectPlan: () => {
    const systemMsg: ChatMessage = {
      id: generateId(),
      role: 'system',
      content: 'Plan was rejected. You can send a new message to try again.',
      timestamp: new Date().toISOString(),
    };
    set((state) => ({
      currentPlan: null,
      planStatus: 'none' as const,
      executionMode: 'none' as const,
      pendingConfirm: null,
      messages: [...state.messages, systemMsg],
    }));
  },

  fetchSessions: createFetchSessions(set, get),
  loadSession: createLoadSession(set, get),
  deleteSession: createDeleteSession(set, get),

  newSession: () => {
    getActiveHandle()?.abort();
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
      sseParseErrors: 0,
      execution: { ...INITIAL_EXECUTION },
    });
  },

  cancelStream: () => {
    getActiveHandle()?.abort();
    setActiveHandle(null);
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
    getActiveHandle()?.abort();
    setActiveHandle(null);
    set({
      isStreaming: false,
      isReconnecting: false,
      streamingContent: '',
      executionMode: 'none',
      pendingConfirm: null,
      agenticConfirm: null,
    });
  },

  clearError: () => set({ error: null, isReconnecting: false }),
}));
