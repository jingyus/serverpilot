// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { useChatStore } from './chat';

vi.mock('@/api/client', () => ({
  apiRequest: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock('@/api/sse', () => ({
  createSSEConnection: vi.fn(() => ({
    abort: vi.fn(),
    controller: new AbortController(),
  })),
}));

import { apiRequest } from '@/api/client';
import { setActiveHandle } from './chat-execution';
import { SESSIONS_PAGE_SIZE } from './chat-sessions';

describe('chat-sessions (via useChatStore)', () => {
  beforeEach(() => {
    useChatStore.setState({
      serverId: null,
      sessionId: null,
      messages: [],
      sessions: [],
      sessionsTotal: 0,
      isLoadingMore: false,
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
    });
    setActiveHandle(null);
    vi.clearAllMocks();
  });

  describe('fetchSessions', () => {
    it('fetches first page and stores sessions with total', async () => {
      const sessions = [
        { id: 'sess-1', serverId: 'srv-1', messageCount: 3, createdAt: '2025-01-01', updatedAt: '2025-01-01' },
      ];
      (apiRequest as Mock).mockResolvedValueOnce({ sessions, total: 120 });

      await useChatStore.getState().fetchSessions('srv-1');

      const state = useChatStore.getState();
      expect(state.sessions).toEqual(sessions);
      expect(state.sessionsTotal).toBe(120);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('sends limit and offset=0 as query params', async () => {
      (apiRequest as Mock).mockResolvedValueOnce({ sessions: [], total: 0 });

      await useChatStore.getState().fetchSessions('srv-1');

      expect(apiRequest).toHaveBeenCalledWith(
        `/chat/srv-1/sessions?limit=${SESSIONS_PAGE_SIZE}&offset=0`,
      );
    });

    it('sets isLoading while fetching', async () => {
      let resolveRequest: (v: unknown) => void;
      (apiRequest as Mock).mockReturnValueOnce(
        new Promise((r) => { resolveRequest = r; }),
      );

      const promise = useChatStore.getState().fetchSessions('srv-1');
      expect(useChatStore.getState().isLoading).toBe(true);

      resolveRequest!({ sessions: [], total: 0 });
      await promise;
      expect(useChatStore.getState().isLoading).toBe(false);
    });

    it('handles ApiError with its message', async () => {
      const { ApiError } = await import('@/api/client');
      (apiRequest as Mock).mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'Server error'));

      await useChatStore.getState().fetchSessions('srv-1');

      expect(useChatStore.getState().error).toBe('Server error');
    });

    it('handles generic error with default message', async () => {
      (apiRequest as Mock).mockRejectedValueOnce(new Error('Network error'));

      await useChatStore.getState().fetchSessions('srv-1');

      expect(useChatStore.getState().error).toBe('Failed to load sessions');
    });
  });

  describe('loadSession', () => {
    it('loads session messages and resets plan state', async () => {
      const messages = [
        { id: '1', role: 'user', content: 'hi', timestamp: '2025-01-01' },
        { id: '2', role: 'assistant', content: 'hello', timestamp: '2025-01-01' },
      ];
      (apiRequest as Mock).mockResolvedValueOnce({
        session: { id: 'sess-1', messages },
      });

      await useChatStore.getState().loadSession('srv-1', 'sess-1');

      const state = useChatStore.getState();
      expect(state.sessionId).toBe('sess-1');
      expect(state.messages).toEqual(messages);
      expect(state.isLoading).toBe(false);
      expect(state.currentPlan).toBeNull();
      expect(state.planStatus).toBe('none');
    });

    it('resets all execution and agentic state on load', async () => {
      // Simulate dirty state from a previous session
      useChatStore.setState({
        execution: {
          activeStepId: 'step-1',
          outputs: { 'step-1': 'some output' },
          completedSteps: { 'step-1': { exitCode: 0, duration: 100 } },
          success: true,
          operationId: 'op-1',
          startTime: Date.now(),
          cancelled: false,
        },
        executionMode: 'log',
        pendingConfirm: { stepId: 's1', command: 'rm -rf /', description: 'danger', riskLevel: 'critical' },
        agenticConfirm: { confirmId: 'c1', command: 'apt install', description: 'install', riskLevel: 'medium' },
        toolCalls: [{ id: 't1', tool: 'execute_command', status: 'running', output: '' }],
        isAgenticMode: true,
        isStreaming: true,
        streamingContent: 'partial response...',
        sseParseErrors: 3,
      });

      (apiRequest as Mock).mockResolvedValueOnce({
        session: { id: 'sess-2', messages: [{ id: '1', role: 'user', content: 'hello', timestamp: '2025-01-01' }] },
      });

      await useChatStore.getState().loadSession('srv-1', 'sess-2');

      const state = useChatStore.getState();
      expect(state.sessionId).toBe('sess-2');
      expect(state.execution).toEqual({
        activeStepId: null,
        outputs: {},
        completedSteps: {},
        success: null,
        operationId: null,
        startTime: null,
        cancelled: false,
      });
      expect(state.executionMode).toBe('none');
      expect(state.pendingConfirm).toBeNull();
      expect(state.agenticConfirm).toBeNull();
      expect(state.toolCalls).toEqual([]);
      expect(state.isAgenticMode).toBe(false);
      expect(state.isStreaming).toBe(false);
      expect(state.streamingContent).toBe('');
      expect(state.sseParseErrors).toBe(0);
    });

    it('aborts active SSE connection before loading', async () => {
      const mockAbort = vi.fn();
      setActiveHandle({ abort: mockAbort, controller: new AbortController() });

      (apiRequest as Mock).mockResolvedValueOnce({
        session: { id: 'sess-2', messages: [] },
      });

      await useChatStore.getState().loadSession('srv-1', 'sess-2');

      expect(mockAbort).toHaveBeenCalledOnce();
    });

    it('sets error on failure', async () => {
      (apiRequest as Mock).mockRejectedValueOnce(new Error('fail'));

      await useChatStore.getState().loadSession('srv-1', 'sess-1');

      expect(useChatStore.getState().error).toBe('Failed to load session');
      expect(useChatStore.getState().isLoading).toBe(false);
    });
  });

  describe('deleteSession', () => {
    it('removes session from list', async () => {
      useChatStore.setState({
        sessions: [
          { id: 'sess-1', serverId: 'srv-1', messageCount: 1, createdAt: '', updatedAt: '' },
          { id: 'sess-2', serverId: 'srv-1', messageCount: 2, createdAt: '', updatedAt: '' },
        ],
      });
      (apiRequest as Mock).mockResolvedValueOnce({});

      await useChatStore.getState().deleteSession('srv-1', 'sess-1');

      const state = useChatStore.getState();
      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0].id).toBe('sess-2');
    });

    it('clears active session if it is the one deleted', async () => {
      useChatStore.setState({
        sessionId: 'sess-1',
        messages: [{ id: '1', role: 'user', content: 'hi', timestamp: '' }],
        sessions: [
          { id: 'sess-1', serverId: 'srv-1', messageCount: 1, createdAt: '', updatedAt: '' },
        ],
      });
      (apiRequest as Mock).mockResolvedValueOnce({});

      await useChatStore.getState().deleteSession('srv-1', 'sess-1');

      const state = useChatStore.getState();
      expect(state.sessionId).toBeNull();
      expect(state.messages).toHaveLength(0);
    });

    it('does not clear session if deleting a different session', async () => {
      useChatStore.setState({
        sessionId: 'sess-2',
        messages: [{ id: '1', role: 'user', content: 'hi', timestamp: '' }],
        sessions: [
          { id: 'sess-1', serverId: 'srv-1', messageCount: 1, createdAt: '', updatedAt: '' },
          { id: 'sess-2', serverId: 'srv-1', messageCount: 2, createdAt: '', updatedAt: '' },
        ],
      });
      (apiRequest as Mock).mockResolvedValueOnce({});

      await useChatStore.getState().deleteSession('srv-1', 'sess-1');

      const state = useChatStore.getState();
      expect(state.sessionId).toBe('sess-2');
      expect(state.messages).toHaveLength(1);
    });

    it('sets error on failure', async () => {
      (apiRequest as Mock).mockRejectedValueOnce(new Error('delete failed'));

      await useChatStore.getState().deleteSession('srv-1', 'sess-1');

      expect(useChatStore.getState().error).toBe('Failed to delete session');
    });
  });

  describe('renameSession', () => {
    it('updates session name in the list', async () => {
      useChatStore.setState({
        sessions: [
          { id: 'sess-1', serverId: 'srv-1', messageCount: 1, createdAt: '', updatedAt: '' },
          { id: 'sess-2', serverId: 'srv-1', messageCount: 2, createdAt: '', updatedAt: '' },
        ],
      });
      (apiRequest as Mock).mockResolvedValueOnce({ success: true });

      await useChatStore.getState().renameSession('srv-1', 'sess-1', 'My Session');

      const state = useChatStore.getState();
      expect(state.sessions[0].name).toBe('My Session');
      expect(state.sessions[1].name).toBeUndefined();
      expect(apiRequest).toHaveBeenCalledWith(
        '/chat/srv-1/sessions/sess-1',
        { method: 'PATCH', body: JSON.stringify({ name: 'My Session' }) },
      );
    });

    it('sets error on failure', async () => {
      (apiRequest as Mock).mockRejectedValueOnce(new Error('rename failed'));

      await useChatStore.getState().renameSession('srv-1', 'sess-1', 'New Name');

      expect(useChatStore.getState().error).toBe('Failed to rename session');
    });

    it('handles ApiError with its message', async () => {
      const { ApiError } = await import('@/api/client');
      (apiRequest as Mock).mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', 'Session not found'));

      await useChatStore.getState().renameSession('srv-1', 'sess-1', 'New Name');

      expect(useChatStore.getState().error).toBe('Session not found');
    });
  });

  describe('loadMoreSessions', () => {
    it('appends next page of sessions', async () => {
      const existing = [
        { id: 'sess-1', serverId: 'srv-1', messageCount: 1, createdAt: '2025-01-01', updatedAt: '2025-01-01' },
      ];
      useChatStore.setState({ sessions: existing, sessionsTotal: 3 });

      const nextPage = [
        { id: 'sess-2', serverId: 'srv-1', messageCount: 2, createdAt: '2025-01-02', updatedAt: '2025-01-02' },
        { id: 'sess-3', serverId: 'srv-1', messageCount: 1, createdAt: '2025-01-03', updatedAt: '2025-01-03' },
      ];
      (apiRequest as Mock).mockResolvedValueOnce({ sessions: nextPage, total: 3 });

      await useChatStore.getState().loadMoreSessions('srv-1');

      const state = useChatStore.getState();
      expect(state.sessions).toHaveLength(3);
      expect(state.sessions[0].id).toBe('sess-1');
      expect(state.sessions[1].id).toBe('sess-2');
      expect(state.sessions[2].id).toBe('sess-3');
      expect(state.sessionsTotal).toBe(3);
      expect(state.isLoadingMore).toBe(false);
    });

    it('sends correct offset based on current sessions count', async () => {
      const existing = Array.from({ length: 50 }, (_, i) => ({
        id: `sess-${i}`, serverId: 'srv-1', messageCount: 1, createdAt: '2025-01-01', updatedAt: '2025-01-01',
      }));
      useChatStore.setState({ sessions: existing, sessionsTotal: 120 });

      (apiRequest as Mock).mockResolvedValueOnce({ sessions: [], total: 120 });

      await useChatStore.getState().loadMoreSessions('srv-1');

      expect(apiRequest).toHaveBeenCalledWith(
        `/chat/srv-1/sessions?limit=${SESSIONS_PAGE_SIZE}&offset=50`,
      );
    });

    it('sets isLoadingMore while fetching', async () => {
      useChatStore.setState({
        sessions: [{ id: 'sess-1', serverId: 'srv-1', messageCount: 1, createdAt: '', updatedAt: '' }],
        sessionsTotal: 10,
      });

      let resolveRequest: (v: unknown) => void;
      (apiRequest as Mock).mockReturnValueOnce(
        new Promise((r) => { resolveRequest = r; }),
      );

      const promise = useChatStore.getState().loadMoreSessions('srv-1');
      expect(useChatStore.getState().isLoadingMore).toBe(true);

      resolveRequest!({ sessions: [], total: 10 });
      await promise;
      expect(useChatStore.getState().isLoadingMore).toBe(false);
    });

    it('skips fetch if already loading more', async () => {
      useChatStore.setState({
        sessions: [{ id: 'sess-1', serverId: 'srv-1', messageCount: 1, createdAt: '', updatedAt: '' }],
        sessionsTotal: 10,
        isLoadingMore: true,
      });

      await useChatStore.getState().loadMoreSessions('srv-1');

      expect(apiRequest).not.toHaveBeenCalled();
    });

    it('skips fetch if all sessions are loaded', async () => {
      const sessions = [
        { id: 'sess-1', serverId: 'srv-1', messageCount: 1, createdAt: '', updatedAt: '' },
        { id: 'sess-2', serverId: 'srv-1', messageCount: 1, createdAt: '', updatedAt: '' },
      ];
      useChatStore.setState({ sessions, sessionsTotal: 2 });

      await useChatStore.getState().loadMoreSessions('srv-1');

      expect(apiRequest).not.toHaveBeenCalled();
    });

    it('sets error on failure', async () => {
      useChatStore.setState({
        sessions: [{ id: 'sess-1', serverId: 'srv-1', messageCount: 1, createdAt: '', updatedAt: '' }],
        sessionsTotal: 10,
      });
      (apiRequest as Mock).mockRejectedValueOnce(new Error('network'));

      await useChatStore.getState().loadMoreSessions('srv-1');

      const state = useChatStore.getState();
      expect(state.error).toBe('Failed to load more sessions');
      expect(state.isLoadingMore).toBe(false);
    });

    it('handles ApiError with its message', async () => {
      const { ApiError } = await import('@/api/client');
      useChatStore.setState({
        sessions: [{ id: 'sess-1', serverId: 'srv-1', messageCount: 1, createdAt: '', updatedAt: '' }],
        sessionsTotal: 10,
      });
      (apiRequest as Mock).mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'DB error'));

      await useChatStore.getState().loadMoreSessions('srv-1');

      expect(useChatStore.getState().error).toBe('DB error');
    });
  });
});
