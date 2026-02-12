// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Chat } from './Chat';
import { useChatStore } from '@/stores/chat';
import { useServersStore } from '@/stores/servers';

vi.mock('@/api/client', () => ({
  apiRequest: vi.fn().mockResolvedValue({ sessions: [], servers: [], total: 0 }),
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

function renderChat(path = '/chat') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/chat" element={<Chat />} />
        <Route path="/chat/:serverId" element={<Chat />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Chat Page', () => {
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
    useServersStore.setState({
      servers: [
        {
          id: 'srv-1',
          name: 'Production',
          status: 'online',
          tags: [],
          createdAt: '2025-01-01',
          updatedAt: '2025-01-01',
        },
        {
          id: 'srv-2',
          name: 'Staging',
          status: 'offline',
          tags: [],
          createdAt: '2025-01-01',
          updatedAt: '2025-01-01',
        },
      ],
      isLoading: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  describe('server selector (no serverId)', () => {
    it('renders server selector when no server is selected', () => {
      renderChat('/chat');
      expect(screen.getByTestId('server-selector')).toBeInTheDocument();
      expect(screen.getByText('AI Chat')).toBeInTheDocument();
    });

    it('shows available servers', () => {
      renderChat('/chat');
      expect(screen.getByTestId('server-card-srv-1')).toBeInTheDocument();
      expect(screen.getByTestId('server-card-srv-2')).toBeInTheDocument();
      expect(screen.getByText('Production')).toBeInTheDocument();
      expect(screen.getByText('Staging')).toBeInTheDocument();
    });

    it('shows message when no servers available', () => {
      useServersStore.setState({ servers: [] });
      renderChat('/chat');
      expect(
        screen.getByText('No servers available. Add a server first.')
      ).toBeInTheDocument();
    });
  });

  describe('chat interface (with serverId)', () => {
    it('renders chat page with server', () => {
      renderChat('/chat/srv-1');
      expect(screen.getByTestId('chat-page')).toBeInTheDocument();
    });

    it('shows chat header with server name', () => {
      renderChat('/chat/srv-1');
      const header = screen.getByTestId('chat-header');
      expect(header).toBeInTheDocument();
      expect(screen.getByText('AI Assistant')).toBeInTheDocument();
      expect(header.textContent).toContain('Production');
    });

    it('shows new chat button', () => {
      renderChat('/chat/srv-1');
      expect(screen.getByTestId('new-session-btn')).toBeInTheDocument();
    });

    it('shows empty state when no messages', () => {
      renderChat('/chat/srv-1');
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      expect(screen.getByText('Start a conversation')).toBeInTheDocument();
    });

    it('shows suggestions in empty state', () => {
      renderChat('/chat/srv-1');
      expect(
        screen.getByText('Install nginx and configure it')
      ).toBeInTheDocument();
      expect(
        screen.getByText('Check disk usage and clean up')
      ).toBeInTheDocument();
    });

    it('suggestion cards have cursor-pointer and data-testid', () => {
      renderChat('/chat/srv-1');
      const card = screen.getByTestId('suggestion-card-0');
      expect(card).toBeInTheDocument();
      expect(card.className).toContain('cursor-pointer');
      expect(screen.getByTestId('suggestion-card-1')).toBeInTheDocument();
      expect(screen.getByTestId('suggestion-card-2')).toBeInTheDocument();
      expect(screen.getByTestId('suggestion-card-3')).toBeInTheDocument();
    });

    it('clicking a suggestion card calls sendMessage with suggestion text', async () => {
      const user = (await import('@testing-library/user-event')).default.setup();
      const sendMessage = vi.fn();
      useChatStore.setState({ sendMessage: sendMessage as unknown as (msg: string) => void });
      renderChat('/chat/srv-1');

      const card = screen.getByTestId('suggestion-card-0');
      await user.click(card);

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith('Install nginx and configure it');
    });

    it('renders message input', () => {
      renderChat('/chat/srv-1');
      expect(screen.getByTestId('message-input')).toBeInTheDocument();
    });

    it('shows messages when they exist', () => {
      useChatStore.setState({
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hello AI',
            timestamp: '2025-01-01T00:00:00Z',
          },
          {
            id: 'msg-2',
            role: 'assistant',
            content: 'Hi there!',
            timestamp: '2025-01-01T00:00:01Z',
          },
        ],
      });
      renderChat('/chat/srv-1');
      expect(screen.getByText('Hello AI')).toBeInTheDocument();
      expect(screen.getByText('Hi there!')).toBeInTheDocument();
    });

    it('shows thinking indicator when streaming with no content', () => {
      useChatStore.setState({
        isStreaming: true,
        streamingContent: '',
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hello',
            timestamp: '2025-01-01T00:00:00Z',
          },
        ],
      });
      renderChat('/chat/srv-1');
      expect(screen.getByTestId('thinking-indicator')).toBeInTheDocument();
      expect(screen.getByText('AI is thinking...')).toBeInTheDocument();
    });

    it('shows streaming message', () => {
      useChatStore.setState({
        isStreaming: true,
        streamingContent: 'Generating plan...',
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Install nginx',
            timestamp: '2025-01-01T00:00:00Z',
          },
        ],
      });
      renderChat('/chat/srv-1');
      expect(screen.getByTestId('streaming-message')).toBeInTheDocument();
      expect(screen.getByText('Generating plan...')).toBeInTheDocument();
    });

    it('shows error with dismiss button', () => {
      useChatStore.setState({
        error: 'Connection failed',
        fetchSessions: vi.fn() as unknown as (serverId: string) => Promise<void>,
      });
      renderChat('/chat/srv-1');
      expect(screen.getByText('Connection failed')).toBeInTheDocument();
      expect(screen.getByTestId('dismiss-error')).toBeInTheDocument();
    });

    it('shows plan preview when plan is in preview status', () => {
      useChatStore.setState({
        currentPlan: {
          planId: 'p1',
          description: 'Install nginx',
          steps: [
            {
              id: 's1',
              description: 'Install',
              command: 'apt install nginx',
              riskLevel: 'green',
              timeout: 30000,
              canRollback: false,
            },
          ],
          totalRisk: 'green',
          requiresConfirmation: true,
        },
        planStatus: 'preview',
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Install nginx',
            timestamp: '2025-01-01T00:00:00Z',
          },
        ],
      });
      renderChat('/chat/srv-1');
      expect(screen.getByTestId('plan-preview')).toBeInTheDocument();
    });

    it('shows execution log when executing', () => {
      useChatStore.setState({
        currentPlan: {
          planId: 'p1',
          description: 'Install nginx',
          steps: [
            {
              id: 's1',
              description: 'Install',
              command: 'apt install nginx',
              riskLevel: 'green',
              timeout: 30000,
              canRollback: false,
            },
          ],
          totalRisk: 'green',
          requiresConfirmation: true,
        },
        planStatus: 'executing',
        executionMode: 'log',
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Install nginx',
            timestamp: '2025-01-01T00:00:00Z',
          },
        ],
      });
      renderChat('/chat/srv-1');
      expect(screen.getByTestId('execution-log')).toBeInTheDocument();
    });

    it('disables input during execution', () => {
      useChatStore.setState({
        planStatus: 'executing',
        currentPlan: {
          planId: 'p1',
          description: 'Test',
          steps: [],
          totalRisk: 'green',
          requiresConfirmation: true,
        },
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Test',
            timestamp: '2025-01-01T00:00:00Z',
          },
        ],
      });
      renderChat('/chat/srv-1');
      expect(screen.getByTestId('message-textarea')).toBeDisabled();
    });

    it('shows emergency stop button during execution', () => {
      useChatStore.setState({
        planStatus: 'executing',
        executionMode: 'log',
        currentPlan: {
          planId: 'p1',
          description: 'Test',
          steps: [
            {
              id: 's1',
              description: 'Install',
              command: 'apt install nginx',
              riskLevel: 'green',
              timeout: 30000,
              canRollback: false,
            },
          ],
          totalRisk: 'green',
          requiresConfirmation: true,
        },
        execution: {
          activeStepId: 's1',
          outputs: {},
          completedSteps: {},
          success: null,
          operationId: null,
          startTime: Date.now(),
          cancelled: false,
        },
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Install nginx',
            timestamp: '2025-01-01T00:00:00Z',
          },
        ],
      });
      renderChat('/chat/srv-1');
      expect(screen.getByTestId('emergency-stop-btn')).toBeInTheDocument();
    });

    it('shows step progress indicators', () => {
      useChatStore.setState({
        planStatus: 'executing',
        executionMode: 'log',
        currentPlan: {
          planId: 'p1',
          description: 'Test',
          steps: [
            {
              id: 's1',
              description: 'Step one',
              command: 'echo 1',
              riskLevel: 'green',
              timeout: 30000,
              canRollback: false,
            },
            {
              id: 's2',
              description: 'Step two',
              command: 'echo 2',
              riskLevel: 'green',
              timeout: 30000,
              canRollback: false,
            },
          ],
          totalRisk: 'green',
          requiresConfirmation: true,
        },
        execution: {
          activeStepId: 's1',
          outputs: {},
          completedSteps: {},
          success: null,
          operationId: null,
          startTime: Date.now(),
          cancelled: false,
        },
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Test',
            timestamp: '2025-01-01T00:00:00Z',
          },
        ],
      });
      renderChat('/chat/srv-1');
      expect(screen.getByTestId('step-progress-s1')).toHaveTextContent('[1/2]');
      expect(screen.getByTestId('step-progress-s2')).toHaveTextContent('[2/2]');
    });

    it('shows reconnecting banner when isReconnecting is true', () => {
      useChatStore.setState({
        isReconnecting: true,
        isStreaming: true,
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hello',
            timestamp: '2025-01-01T00:00:00Z',
          },
        ],
      });
      renderChat('/chat/srv-1');
      expect(screen.getByTestId('reconnecting-banner')).toBeInTheDocument();
      expect(screen.getByText('Connection lost. Reconnecting...')).toBeInTheDocument();
    });

    it('does not show reconnecting banner when isReconnecting is false', () => {
      useChatStore.setState({ isReconnecting: false });
      renderChat('/chat/srv-1');
      expect(screen.queryByTestId('reconnecting-banner')).not.toBeInTheDocument();
    });

    it('uses server ID as fallback name', () => {
      useServersStore.setState({ servers: [] });
      renderChat('/chat/srv-unknown');
      const header = screen.getByTestId('chat-header');
      expect(header.textContent).toContain('srv-unknown');
    });
  });

  describe('cleanup on unmount', () => {
    it('calls cleanup when component unmounts', () => {
      const cleanupFn = vi.fn();
      useChatStore.setState({
        cleanup: cleanupFn as unknown as () => void,
        fetchSessions: vi.fn() as unknown as (serverId: string) => Promise<void>,
      });

      const { unmount } = renderChat('/chat/srv-1');
      unmount();

      expect(cleanupFn).toHaveBeenCalled();
    });

    it('calls cleanup when navigating away from chat during streaming', () => {
      const cleanupFn = vi.fn();
      useChatStore.setState({
        isStreaming: true,
        streamingContent: 'partial response',
        cleanup: cleanupFn as unknown as () => void,
        fetchSessions: vi.fn() as unknown as (serverId: string) => Promise<void>,
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hello',
            timestamp: '2025-01-01T00:00:00Z',
          },
        ],
      });

      const { unmount } = renderChat('/chat/srv-1');
      unmount();

      expect(cleanupFn).toHaveBeenCalled();
    });
  });

  describe('session sidebar', () => {
    it('shows session sidebar when sessions exist', () => {
      // Override fetchSessions to prevent it from clearing our test state
      useChatStore.setState({
        sessions: [
          {
            id: 'sess-1',
            serverId: 'srv-1',
            messageCount: 3,
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
            lastMessage: 'Install nginx',
          },
        ],
        fetchSessions: vi.fn() as unknown as (serverId: string) => Promise<void>,
      });
      renderChat('/chat/srv-1');
      expect(screen.getByTestId('session-sidebar')).toBeInTheDocument();
      expect(screen.getByText('Install nginx')).toBeInTheDocument();
    });

    it('hides sidebar when no sessions', () => {
      useChatStore.setState({
        sessions: [],
        fetchSessions: vi.fn() as unknown as (serverId: string) => Promise<void>,
      });
      renderChat('/chat/srv-1');
      expect(
        screen.queryByTestId('session-sidebar')
      ).not.toBeInTheDocument();
    });

    it('groups sessions by date (Today group)', () => {
      useChatStore.setState({
        sessions: [
          {
            id: 'sess-today',
            serverId: 'srv-1',
            messageCount: 2,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastMessage: 'Today session',
          },
        ],
        fetchSessions: vi.fn() as unknown as (serverId: string) => Promise<void>,
      });
      renderChat('/chat/srv-1');
      expect(screen.getByTestId('session-group-today')).toBeInTheDocument();
      expect(screen.getByText('Today session')).toBeInTheDocument();
    });

    it('groups sessions by date (Older group)', () => {
      useChatStore.setState({
        sessions: [
          {
            id: 'sess-old',
            serverId: 'srv-1',
            messageCount: 5,
            createdAt: '2024-06-01T00:00:00Z',
            updatedAt: '2024-06-01T00:00:00Z',
            lastMessage: 'Old session',
          },
        ],
        fetchSessions: vi.fn() as unknown as (serverId: string) => Promise<void>,
      });
      renderChat('/chat/srv-1');
      expect(screen.getByTestId('session-group-older')).toBeInTheDocument();
      expect(screen.getByText('Old session')).toBeInTheDocument();
    });

    it('can collapse and expand a session group', async () => {
      const user = (await import('@testing-library/user-event')).default.setup();
      useChatStore.setState({
        sessions: [
          {
            id: 'sess-collapse',
            serverId: 'srv-1',
            messageCount: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastMessage: 'Collapsible session',
          },
        ],
        fetchSessions: vi.fn() as unknown as (serverId: string) => Promise<void>,
      });
      renderChat('/chat/srv-1');

      expect(screen.getByText('Collapsible session')).toBeInTheDocument();

      await user.click(screen.getByTestId('session-group-toggle-today'));
      expect(screen.queryByText('Collapsible session')).not.toBeInTheDocument();

      await user.click(screen.getByTestId('session-group-toggle-today'));
      expect(screen.getByText('Collapsible session')).toBeInTheDocument();
    });
  });

  describe('scroll behavior optimization', () => {
    let scrollIntoViewMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.useFakeTimers();
      scrollIntoViewMock = vi.fn();
      // Mock scrollIntoView on all elements
      Element.prototype.scrollIntoView = scrollIntoViewMock;
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('uses smooth scroll when a new message is added', () => {
      useChatStore.setState({
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hello',
            timestamp: '2025-01-01T00:00:00Z',
          },
        ],
      });
      renderChat('/chat/srv-1');

      // scrollIntoView should be called with smooth behavior
      const smoothCalls = scrollIntoViewMock.mock.calls.filter(
        (call: [ScrollIntoViewOptions]) => call[0]?.behavior === 'smooth'
      );
      expect(smoothCalls.length).toBeGreaterThan(0);
    });

    it('uses auto (instant) scroll during streaming content updates', () => {
      useChatStore.setState({
        isStreaming: true,
        streamingContent: 'partial',
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hello',
            timestamp: '2025-01-01T00:00:00Z',
          },
        ],
      });
      renderChat('/chat/srv-1');

      scrollIntoViewMock.mockClear();

      // Advance time so the throttle window has passed since initial render
      vi.advanceTimersByTime(200);

      // Simulate streaming content update
      act(() => {
        useChatStore.setState({ streamingContent: 'partial response' });
      });

      // Flush any pending throttled calls
      act(() => {
        vi.advanceTimersByTime(200);
      });

      // The streaming scroll should use 'auto' behavior
      const autoCalls = scrollIntoViewMock.mock.calls.filter(
        (call: [ScrollIntoViewOptions]) => call[0]?.behavior === 'auto'
      );
      expect(autoCalls.length).toBeGreaterThan(0);
    });

    it('throttles scroll calls during rapid streaming updates', () => {
      useChatStore.setState({
        isStreaming: true,
        streamingContent: 'chunk1',
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hello',
            timestamp: '2025-01-01T00:00:00Z',
          },
        ],
      });
      renderChat('/chat/srv-1');

      scrollIntoViewMock.mockClear();

      // Simulate many rapid streaming updates within the throttle window
      for (let i = 0; i < 20; i++) {
        act(() => {
          useChatStore.setState({ streamingContent: `chunk${i + 2}` });
        });
      }

      // Should be throttled — far fewer calls than 20
      const callCount = scrollIntoViewMock.mock.calls.filter(
        (call: [ScrollIntoViewOptions]) => call[0]?.behavior === 'auto'
      ).length;
      expect(callCount).toBeLessThan(20);

      // Flush pending throttled calls
      act(() => {
        vi.advanceTimersByTime(200);
      });
    });

    it('does not scroll on streaming when streamingContent is empty', () => {
      useChatStore.setState({
        isStreaming: true,
        streamingContent: '',
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hello',
            timestamp: '2025-01-01T00:00:00Z',
          },
        ],
      });
      renderChat('/chat/srv-1');

      scrollIntoViewMock.mockClear();

      act(() => {
        useChatStore.setState({ streamingContent: '' });
      });

      // No auto scroll should be triggered for empty content
      const autoCalls = scrollIntoViewMock.mock.calls.filter(
        (call: [ScrollIntoViewOptions]) => call[0]?.behavior === 'auto'
      );
      expect(autoCalls).toHaveLength(0);
    });
  });
});
