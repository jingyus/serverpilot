// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors

/**
 * Chat session CRUD logic: fetch, load, delete sessions.
 * Extracted from chat.ts to keep each module under 500 lines.
 */

import { apiRequest, ApiError } from '@/api/client';
import type { ChatMessage, SessionSummary } from '@/types/chat';
import type { ChatState } from './chat-types.js';
import { INITIAL_EXECUTION } from './chat-types.js';
import { getActiveHandle, setActiveHandle } from './chat-execution.js';

type SetFn = (
  partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>),
) => void;
type GetFn = () => ChatState;

export const SESSIONS_PAGE_SIZE = 50;

export function createFetchSessions(set: SetFn, _get: GetFn) {
  return async (serverId: string): Promise<void> => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiRequest<{ sessions: SessionSummary[]; total: number }>(
        `/chat/${serverId}/sessions?limit=${SESSIONS_PAGE_SIZE}&offset=0`,
      );
      set({
        sessions: data.sessions,
        sessionsTotal: data.total,
        isLoading: false,
      });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to load sessions';
      set({ error: message, isLoading: false });
    }
  };
}

export function createLoadMoreSessions(set: SetFn, get: GetFn) {
  return async (serverId: string): Promise<void> => {
    const { sessions, sessionsTotal, isLoadingMore } = get();
    if (isLoadingMore || sessions.length >= sessionsTotal) return;

    set({ isLoadingMore: true });
    try {
      const data = await apiRequest<{ sessions: SessionSummary[]; total: number }>(
        `/chat/${serverId}/sessions?limit=${SESSIONS_PAGE_SIZE}&offset=${sessions.length}`,
      );
      set((state) => ({
        sessions: [...state.sessions, ...data.sessions],
        sessionsTotal: data.total,
        isLoadingMore: false,
      }));
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to load more sessions';
      set({ error: message, isLoadingMore: false });
    }
  };
}

export function createLoadSession(set: SetFn, _get: GetFn) {
  return async (serverId: string, sessionId: string): Promise<void> => {
    set({ isLoading: true, error: null });
    try {
      getActiveHandle()?.abort();
      setActiveHandle(null);
      const data = await apiRequest<{
        session: { id: string; messages: ChatMessage[] };
      }>(`/chat/${serverId}/sessions/${sessionId}`);
      set({
        sessionId: data.session.id,
        messages: data.session.messages,
        isLoading: false,
        currentPlan: null,
        planStatus: 'none',
        execution: { ...INITIAL_EXECUTION },
        executionMode: 'none',
        pendingConfirm: null,
        agenticConfirm: null,
        toolCalls: [],
        isAgenticMode: false,
        isStreaming: false,
        streamingContent: '',
        sseParseErrors: 0,
      });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to load session';
      set({ error: message, isLoading: false });
    }
  };
}

export function createRenameSession(set: SetFn, _get: GetFn) {
  return async (serverId: string, sessionId: string, name: string): Promise<void> => {
    try {
      await apiRequest(`/chat/${serverId}/sessions/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, name } : s,
        ),
      }));
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to rename session';
      set({ error: message });
    }
  };
}

export function createDeleteSession(set: SetFn, _get: GetFn) {
  return async (serverId: string, sessionId: string): Promise<void> => {
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
  };
}
