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
import { createSSEConnection } from '@/api/sse';

describe('useChatStore', () => {
  beforeEach(() => {
    useChatStore.setState({
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
    });
    vi.clearAllMocks();
  });

  describe('setServerId', () => {
    it('sets the server ID', () => {
      useChatStore.getState().setServerId('srv-1');
      expect(useChatStore.getState().serverId).toBe('srv-1');
    });

    it('sets server ID to null', () => {
      useChatStore.getState().setServerId('srv-1');
      useChatStore.getState().setServerId(null);
      expect(useChatStore.getState().serverId).toBeNull();
    });
  });

  describe('sendMessage', () => {
    it('sets error if no server selected', () => {
      useChatStore.getState().sendMessage('hello');
      expect(useChatStore.getState().error).toBe('No server selected');
    });

    it('adds user message and starts streaming', () => {
      useChatStore.setState({ serverId: 'srv-1' });
      useChatStore.getState().sendMessage('install nginx');

      const state = useChatStore.getState();
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].role).toBe('user');
      expect(state.messages[0].content).toBe('install nginx');
      expect(state.isStreaming).toBe(true);
    });

    it('calls createSSEConnection with correct parameters', () => {
      useChatStore.setState({ serverId: 'srv-1', sessionId: 'sess-1' });
      useChatStore.getState().sendMessage('hello');

      expect(createSSEConnection).toHaveBeenCalledWith(
        '/chat/srv-1',
        { message: 'hello', sessionId: 'sess-1' },
        expect.any(Object)
      );
    });

    it('clears previous plan and error on new message', () => {
      useChatStore.setState({
        serverId: 'srv-1',
        error: 'old error',
        currentPlan: {
          planId: 'old',
          description: '',
          steps: [],
          totalRisk: 'green',
          requiresConfirmation: false,
        },
        planStatus: 'preview',
      });
      useChatStore.getState().sendMessage('new message');

      const state = useChatStore.getState();
      expect(state.error).toBeNull();
      expect(state.currentPlan).toBeNull();
      expect(state.planStatus).toBe('none');
    });

    it('is a no-op when isStreaming is true (re-entry guard)', () => {
      useChatStore.setState({ serverId: 'srv-1', isStreaming: true });
      useChatStore.getState().sendMessage('duplicate');

      expect(useChatStore.getState().messages).toHaveLength(0);
      expect(createSSEConnection).not.toHaveBeenCalled();
    });

    it('does not produce duplicate messages on rapid consecutive calls', () => {
      useChatStore.setState({ serverId: 'srv-1' });

      // First call succeeds and sets isStreaming = true
      useChatStore.getState().sendMessage('first');
      // Second call should be blocked by the re-entry guard
      useChatStore.getState().sendMessage('second');

      const state = useChatStore.getState();
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].content).toBe('first');
      expect(createSSEConnection).toHaveBeenCalledTimes(1);
    });
  });

  describe('regenerateLastResponse', () => {
    it('removes last assistant message and re-sends the preceding user message', () => {
      useChatStore.setState({
        serverId: 'srv-1',
        messages: [
          { id: 'u1', role: 'user', content: 'install nginx', timestamp: '' },
          { id: 'a1', role: 'assistant', content: 'Sure, let me help', timestamp: '' },
        ],
      });

      useChatStore.getState().regenerateLastResponse();

      const state = useChatStore.getState();
      // Assistant message removed, user message kept, new user message added by sendMessage
      expect(state.messages).toHaveLength(2);
      expect(state.messages[0].id).toBe('u1');
      expect(state.messages[1].role).toBe('user');
      expect(state.messages[1].content).toBe('install nginx');
      expect(state.isStreaming).toBe(true);
      expect(createSSEConnection).toHaveBeenCalled();
    });

    it('is a no-op when streaming', () => {
      useChatStore.setState({
        serverId: 'srv-1',
        isStreaming: true,
        messages: [
          { id: 'u1', role: 'user', content: 'hi', timestamp: '' },
          { id: 'a1', role: 'assistant', content: 'hello', timestamp: '' },
        ],
      });

      useChatStore.getState().regenerateLastResponse();

      expect(useChatStore.getState().messages).toHaveLength(2);
      expect(createSSEConnection).not.toHaveBeenCalled();
    });

    it('is a no-op when no assistant messages exist', () => {
      useChatStore.setState({
        serverId: 'srv-1',
        messages: [
          { id: 'u1', role: 'user', content: 'hi', timestamp: '' },
        ],
      });

      useChatStore.getState().regenerateLastResponse();

      expect(useChatStore.getState().messages).toHaveLength(1);
      expect(createSSEConnection).not.toHaveBeenCalled();
    });

    it('is a no-op when no user message precedes the assistant message', () => {
      useChatStore.setState({
        serverId: 'srv-1',
        messages: [
          { id: 'a1', role: 'assistant', content: 'unsolicited', timestamp: '' },
        ],
      });

      useChatStore.getState().regenerateLastResponse();

      expect(useChatStore.getState().messages).toHaveLength(1);
      expect(createSSEConnection).not.toHaveBeenCalled();
    });

    it('handles multiple messages — only removes the last assistant', () => {
      useChatStore.setState({
        serverId: 'srv-1',
        messages: [
          { id: 'u1', role: 'user', content: 'q1', timestamp: '' },
          { id: 'a1', role: 'assistant', content: 'answer1', timestamp: '' },
          { id: 'u2', role: 'user', content: 'q2', timestamp: '' },
          { id: 'a2', role: 'assistant', content: 'answer2', timestamp: '' },
        ],
      });

      useChatStore.getState().regenerateLastResponse();

      const state = useChatStore.getState();
      // First pair kept, a2 removed, new user message from sendMessage added
      expect(state.messages).toHaveLength(4);
      expect(state.messages[0].id).toBe('u1');
      expect(state.messages[1].id).toBe('a1');
      expect(state.messages[2].id).toBe('u2');
      expect(state.messages[3].content).toBe('q2');
      expect(state.messages[3].role).toBe('user');
    });
  });

  describe('rejectPlan', () => {
    it('clears plan and adds system message', () => {
      useChatStore.setState({
        currentPlan: {
          planId: 'p1',
          description: 'Test',
          steps: [],
          totalRisk: 'green',
          requiresConfirmation: true,
        },
        planStatus: 'preview',
      });

      useChatStore.getState().rejectPlan();

      const state = useChatStore.getState();
      expect(state.currentPlan).toBeNull();
      expect(state.planStatus).toBe('none');
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].role).toBe('system');
    });
  });

  describe('newSession', () => {
    it('resets chat state', () => {
      useChatStore.setState({
        sessionId: 'sess-1',
        messages: [
          { id: '1', role: 'user', content: 'hi', timestamp: '' },
        ],
        currentPlan: {
          planId: 'p1',
          description: 'Test',
          steps: [],
          totalRisk: 'green',
          requiresConfirmation: true,
        },
        planStatus: 'preview',
        isStreaming: true,
        streamingContent: 'partial',
        error: 'old error',
      });

      useChatStore.getState().newSession();

      const state = useChatStore.getState();
      expect(state.sessionId).toBeNull();
      expect(state.messages).toHaveLength(0);
      expect(state.currentPlan).toBeNull();
      expect(state.planStatus).toBe('none');
      expect(state.isStreaming).toBe(false);
      expect(state.streamingContent).toBe('');
      expect(state.error).toBeNull();
    });
  });

  describe('cancelStream', () => {
    it('adds partial message if streaming content exists', () => {
      useChatStore.setState({
        isStreaming: true,
        streamingContent: 'partial response',
      });

      useChatStore.getState().cancelStream();

      const state = useChatStore.getState();
      expect(state.isStreaming).toBe(false);
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].content).toContain('partial response');
      expect(state.messages[0].content).toContain('[Cancelled]');
    });

    it('does not add message if no streaming content', () => {
      useChatStore.setState({
        isStreaming: true,
        streamingContent: '',
      });

      useChatStore.getState().cancelStream();

      const state = useChatStore.getState();
      expect(state.isStreaming).toBe(false);
      expect(state.messages).toHaveLength(0);
    });
  });

  describe('fetchSessions', () => {
    it('fetches sessions and updates state', async () => {
      const sessions = [
        {
          id: 'sess-1',
          serverId: 'srv-1',
          messageCount: 3,
          createdAt: '2025-01-01',
          updatedAt: '2025-01-01',
        },
      ];
      (apiRequest as Mock).mockResolvedValueOnce({ sessions });

      await useChatStore.getState().fetchSessions('srv-1');

      const state = useChatStore.getState();
      expect(state.sessions).toEqual(sessions);
      expect(state.isLoading).toBe(false);
    });

    it('sets error on failure', async () => {
      (apiRequest as Mock).mockRejectedValueOnce(new Error('Network error'));

      await useChatStore.getState().fetchSessions('srv-1');

      expect(useChatStore.getState().error).toBe('Failed to load sessions');
      expect(useChatStore.getState().isLoading).toBe(false);
    });
  });

  describe('loadSession', () => {
    it('loads session messages', async () => {
      const messages = [
        { id: '1', role: 'user', content: 'hi', timestamp: '2025-01-01' },
      ];
      (apiRequest as Mock).mockResolvedValueOnce({
        session: { id: 'sess-1', messages },
      });

      await useChatStore.getState().loadSession('srv-1', 'sess-1');

      const state = useChatStore.getState();
      expect(state.sessionId).toBe('sess-1');
      expect(state.messages).toEqual(messages);
    });
  });

  describe('deleteSession', () => {
    it('removes session from list', async () => {
      useChatStore.setState({
        sessions: [
          {
            id: 'sess-1',
            serverId: 'srv-1',
            messageCount: 1,
            createdAt: '',
            updatedAt: '',
          },
          {
            id: 'sess-2',
            serverId: 'srv-1',
            messageCount: 2,
            createdAt: '',
            updatedAt: '',
          },
        ],
      });
      (apiRequest as Mock).mockResolvedValueOnce({});

      await useChatStore.getState().deleteSession('srv-1', 'sess-1');

      const state = useChatStore.getState();
      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0].id).toBe('sess-2');
    });

    it('clears active session if deleted', async () => {
      useChatStore.setState({
        sessionId: 'sess-1',
        messages: [
          { id: '1', role: 'user', content: 'hi', timestamp: '' },
        ],
        sessions: [
          {
            id: 'sess-1',
            serverId: 'srv-1',
            messageCount: 1,
            createdAt: '',
            updatedAt: '',
          },
        ],
      });
      (apiRequest as Mock).mockResolvedValueOnce({});

      await useChatStore.getState().deleteSession('srv-1', 'sess-1');

      const state = useChatStore.getState();
      expect(state.sessionId).toBeNull();
      expect(state.messages).toHaveLength(0);
    });
  });

  describe('clearError', () => {
    it('clears the error', () => {
      useChatStore.setState({ error: 'some error' });
      useChatStore.getState().clearError();
      expect(useChatStore.getState().error).toBeNull();
    });

    it('resets isReconnecting when clearing error', () => {
      useChatStore.setState({ error: 'connection lost', isReconnecting: true });
      useChatStore.getState().clearError();
      expect(useChatStore.getState().error).toBeNull();
      expect(useChatStore.getState().isReconnecting).toBe(false);
    });
  });

  describe('confirmPlan', () => {
    it('does nothing without required state', () => {
      useChatStore.getState().confirmPlan();
      expect(createSSEConnection).not.toHaveBeenCalled();
    });

    it('starts execution with correct parameters', () => {
      useChatStore.setState({
        serverId: 'srv-1',
        sessionId: 'sess-1',
        currentPlan: {
          planId: 'plan-1',
          description: 'Test',
          steps: [],
          totalRisk: 'green',
          requiresConfirmation: true,
        },
      });

      useChatStore.getState().confirmPlan();

      expect(useChatStore.getState().planStatus).toBe('executing');
      expect(createSSEConnection).toHaveBeenCalledWith(
        '/chat/srv-1/execute',
        { planId: 'plan-1', sessionId: 'sess-1' },
        expect.any(Object)
      );
    });

    it('resets execution state and sets startTime', () => {
      useChatStore.setState({
        serverId: 'srv-1',
        sessionId: 'sess-1',
        currentPlan: {
          planId: 'plan-1',
          description: 'Test',
          steps: [],
          totalRisk: 'green',
          requiresConfirmation: true,
        },
        execution: {
          activeStepId: 'old',
          outputs: { old: 'data' },
          completedSteps: { old: { exitCode: 0, duration: 100 } },
          success: true,
          operationId: 'old-op',
          startTime: 1000,
          cancelled: true,
        },
      });

      useChatStore.getState().confirmPlan();

      const exec = useChatStore.getState().execution;
      expect(exec.activeStepId).toBeNull();
      expect(exec.outputs).toEqual({});
      expect(exec.completedSteps).toEqual({});
      expect(exec.success).toBeNull();
      expect(exec.operationId).toBeNull();
      expect(exec.startTime).toBeTypeOf('number');
      expect(exec.cancelled).toBe(false);
    });
  });

  describe('SSE reconnection callbacks', () => {
    function getSSECallbacks(): Record<string, (...args: unknown[]) => void> {
      const mockFn = createSSEConnection as Mock;
      const lastCall = mockFn.mock.calls[mockFn.mock.calls.length - 1];
      return lastCall[2] as Record<string, (...args: unknown[]) => void>;
    }

    it('sets isReconnecting on onReconnecting callback', () => {
      useChatStore.setState({ serverId: 'srv-1' });
      useChatStore.getState().sendMessage('hello');

      const callbacks = getSSECallbacks();
      callbacks.onReconnecting(1);

      const state = useChatStore.getState();
      expect(state.isReconnecting).toBe(true);
      expect(state.error).toBeNull();
    });

    it('clears isReconnecting on onReconnected callback', () => {
      useChatStore.setState({ serverId: 'srv-1' });
      useChatStore.getState().sendMessage('hello');

      const callbacks = getSSECallbacks();
      callbacks.onReconnecting(1);
      callbacks.onReconnected();

      expect(useChatStore.getState().isReconnecting).toBe(false);
    });

    it('preserves streamingContent as partial message on error', () => {
      useChatStore.setState({ serverId: 'srv-1' });
      useChatStore.getState().sendMessage('hello');

      // Simulate some streaming content received before error
      useChatStore.setState({ streamingContent: 'partial AI response' });

      const callbacks = getSSECallbacks();
      callbacks.onError(new Error('Connection lost'));

      const state = useChatStore.getState();
      expect(state.isStreaming).toBe(false);
      expect(state.isReconnecting).toBe(false);
      expect(state.streamingContent).toBe('');
      expect(state.error).toBe('Connection lost');
      // Partial content saved as a message (1 user + 1 partial assistant)
      expect(state.messages).toHaveLength(2);
      expect(state.messages[1].role).toBe('assistant');
      expect(state.messages[1].content).toContain('partial AI response');
      expect(state.messages[1].content).toContain('[Connection lost]');
    });

    it('does not add partial message on error if no streaming content', () => {
      useChatStore.setState({ serverId: 'srv-1' });
      useChatStore.getState().sendMessage('hello');

      const callbacks = getSSECallbacks();
      callbacks.onError(new Error('Connection failed'));

      const state = useChatStore.getState();
      expect(state.isStreaming).toBe(false);
      expect(state.error).toBe('Connection failed');
      // Only the user message
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].role).toBe('user');
    });

    it('resets isReconnecting on new message send', () => {
      useChatStore.setState({ serverId: 'srv-1', isReconnecting: true });
      useChatStore.getState().sendMessage('retry');

      expect(useChatStore.getState().isReconnecting).toBe(false);
    });

    it('resets isReconnecting on newSession', () => {
      useChatStore.setState({ isReconnecting: true });
      useChatStore.getState().newSession();

      expect(useChatStore.getState().isReconnecting).toBe(false);
    });
  });

  describe('emergencyStop', () => {
    it('does nothing without required state', async () => {
      await useChatStore.getState().emergencyStop();
      expect(apiRequest).not.toHaveBeenCalled();
    });

    it('calls cancel API and updates state', async () => {
      (apiRequest as Mock).mockResolvedValueOnce({ success: true });

      useChatStore.setState({
        serverId: 'srv-1',
        sessionId: 'sess-1',
        currentPlan: {
          planId: 'plan-1',
          description: 'Test',
          steps: [],
          totalRisk: 'green',
          requiresConfirmation: true,
        },
        planStatus: 'executing',
        execution: {
          activeStepId: 'step-1',
          outputs: {},
          completedSteps: {},
          success: null,
          operationId: null,
          startTime: Date.now(),
          cancelled: false,
        },
      });

      await useChatStore.getState().emergencyStop();

      expect(apiRequest).toHaveBeenCalledWith(
        '/chat/srv-1/execute/cancel',
        expect.objectContaining({
          method: 'POST',
        })
      );

      const state = useChatStore.getState();
      expect(state.planStatus).toBe('completed');
      expect(state.execution.success).toBe(false);
      expect(state.execution.cancelled).toBe(true);
      expect(state.execution.activeStepId).toBeNull();
    });

    it('still sets cancelled state if API fails', async () => {
      (apiRequest as Mock).mockRejectedValueOnce(new Error('Network error'));

      useChatStore.setState({
        serverId: 'srv-1',
        sessionId: 'sess-1',
        currentPlan: {
          planId: 'plan-1',
          description: 'Test',
          steps: [],
          totalRisk: 'green',
          requiresConfirmation: true,
        },
        planStatus: 'executing',
        execution: {
          activeStepId: 'step-1',
          outputs: {},
          completedSteps: {},
          success: null,
          operationId: null,
          startTime: Date.now(),
          cancelled: false,
        },
      });

      await useChatStore.getState().emergencyStop();

      const state = useChatStore.getState();
      expect(state.planStatus).toBe('completed');
      expect(state.execution.cancelled).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('aborts active SSE connection', () => {
      const abortFn = vi.fn();
      (createSSEConnection as Mock).mockReturnValueOnce({
        abort: abortFn,
        controller: new AbortController(),
      });

      useChatStore.setState({ serverId: 'srv-1' });
      useChatStore.getState().sendMessage('hello');

      useChatStore.getState().cleanup();

      expect(abortFn).toHaveBeenCalled();
    });

    it('resets streaming state but preserves messages and session', () => {
      useChatStore.setState({
        serverId: 'srv-1',
        sessionId: 'sess-1',
        messages: [
          { id: '1', role: 'user', content: 'hi', timestamp: '' },
        ],
        isStreaming: true,
        isReconnecting: true,
        streamingContent: 'partial',
        executionMode: 'inline',
        pendingConfirm: {
          stepId: 's1',
          command: 'rm -rf /',
          description: 'danger',
          riskLevel: 'critical',
        },
        agenticConfirm: {
          confirmId: 'c1',
          command: 'rm -rf /',
          description: 'danger',
          riskLevel: 'critical',
        },
      });

      useChatStore.getState().cleanup();

      const state = useChatStore.getState();
      // Streaming state reset
      expect(state.isStreaming).toBe(false);
      expect(state.isReconnecting).toBe(false);
      expect(state.streamingContent).toBe('');
      expect(state.executionMode).toBe('none');
      expect(state.pendingConfirm).toBeNull();
      expect(state.agenticConfirm).toBeNull();
      // Messages and session preserved
      expect(state.messages).toHaveLength(1);
      expect(state.sessionId).toBe('sess-1');
      expect(state.serverId).toBe('srv-1');
    });

    it('is safe to call when no active SSE connection exists', () => {
      expect(() => useChatStore.getState().cleanup()).not.toThrow();
    });
  });

  describe('agentic confirm flow', () => {
    function getSSECallbacks(): Record<string, (...args: unknown[]) => void> {
      const mockFn = createSSEConnection as Mock;
      const lastCall = mockFn.mock.calls[mockFn.mock.calls.length - 1];
      return lastCall[2] as Record<string, (...args: unknown[]) => void>;
    }

    it('onConfirmRequired sets agenticConfirm with confirmId from event', () => {
      useChatStore.setState({ serverId: 'srv-1' });
      useChatStore.getState().sendMessage('hello');

      const callbacks = getSSECallbacks();
      callbacks.onConfirmRequired(JSON.stringify({
        id: 'tool-1',
        command: 'apt install nginx',
        description: 'Install nginx',
        riskLevel: 'yellow',
        confirmId: 'session:abc-123',
      }));

      const state = useChatStore.getState();
      expect(state.agenticConfirm).toEqual({
        confirmId: 'session:abc-123',
        command: 'apt install nginx',
        description: 'Install nginx',
        riskLevel: 'yellow',
      });
    });

    it('onConfirmRequired rejects payload missing confirmId (chat-032)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      useChatStore.setState({ serverId: 'srv-1' });
      useChatStore.getState().sendMessage('hello');

      const callbacks = getSSECallbacks();
      callbacks.onConfirmRequired(JSON.stringify({
        id: 'tool-1',
        command: 'rm -rf /tmp',
        description: 'Remove temp files',
        riskLevel: 'red',
      }));

      expect(useChatStore.getState().agenticConfirm).toBeNull();
      expect(useChatStore.getState().sseParseErrors).toBe(1);
      warnSpy.mockRestore();
    });

    it('onConfirmId updates an existing agenticConfirm with confirmId', () => {
      useChatStore.setState({ serverId: 'srv-1' });
      useChatStore.getState().sendMessage('hello');

      const callbacks = getSSECallbacks();
      // Set agenticConfirm via onConfirmRequired (with confirmId)
      callbacks.onConfirmRequired(JSON.stringify({
        id: 'tool-1',
        command: 'apt install nginx',
        description: 'Install',
        riskLevel: 'yellow',
        confirmId: 'session:initial',
      }));
      expect(useChatStore.getState().agenticConfirm!.confirmId).toBe('session:initial');

      // Then receive updated confirmId via separate event
      callbacks.onConfirmId(JSON.stringify({ confirmId: 'session:xyz' }));

      expect(useChatStore.getState().agenticConfirm!.confirmId).toBe('session:xyz');
    });

    it('onConfirmId before onConfirmRequired results in null agenticConfirm', () => {
      useChatStore.setState({ serverId: 'srv-1' });
      useChatStore.getState().sendMessage('hello');

      const callbacks = getSSECallbacks();
      // confirm_id arrives with no prior agenticConfirm state
      callbacks.onConfirmId(JSON.stringify({ confirmId: 'session:early' }));

      expect(useChatStore.getState().agenticConfirm).toBeNull();
    });

    it('respondToAgenticConfirm sends API request and clears state', async () => {
      (apiRequest as Mock).mockResolvedValue({});
      useChatStore.setState({
        serverId: 'srv-1',
        agenticConfirm: {
          confirmId: 'session:confirm-1',
          command: 'apt install nginx',
          description: 'Install',
          riskLevel: 'yellow',
        },
      });

      await useChatStore.getState().respondToAgenticConfirm(true);

      expect(apiRequest).toHaveBeenCalledWith('/chat/srv-1/confirm', {
        method: 'POST',
        body: JSON.stringify({
          confirmId: 'session:confirm-1',
          approved: true,
        }),
      });
      expect(useChatStore.getState().agenticConfirm).toBeNull();
    });

    it('respondToAgenticConfirm does nothing when confirmId is empty', async () => {
      (apiRequest as Mock).mockResolvedValue({});
      useChatStore.setState({
        serverId: 'srv-1',
        agenticConfirm: {
          confirmId: '',
          command: 'dangerous command',
          description: 'dangerous',
          riskLevel: 'critical',
        },
      });

      await useChatStore.getState().respondToAgenticConfirm(true);

      expect(apiRequest).not.toHaveBeenCalled();
    });

    it('respondToAgenticConfirm does nothing without serverId', async () => {
      useChatStore.setState({
        serverId: null,
        agenticConfirm: {
          confirmId: 'session:c1',
          command: 'cmd',
          description: 'desc',
          riskLevel: 'yellow',
        },
      });

      await useChatStore.getState().respondToAgenticConfirm(false);

      expect(apiRequest).not.toHaveBeenCalled();
    });
  });
});
