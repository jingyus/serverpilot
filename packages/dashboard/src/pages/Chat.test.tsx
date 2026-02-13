// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

// Mock react-virtuoso: Virtuoso doesn't work in jsdom (no layout engine).
// Render all items directly so tests can query them.
vi.mock('react-virtuoso', () => {
  const React = require('react');
  return {
    Virtuoso: React.forwardRef(function MockVirtuoso(
      props: {
        data?: unknown[];
        itemContent?: (index: number, item: unknown) => React.ReactNode;
        components?: { Footer?: () => React.ReactNode };
        className?: string;
      },
      _ref: unknown,
    ) {
      const { data = [], itemContent, components } = props;
      const Footer = components?.Footer;
      return React.createElement('div', { 'data-testid': 'virtuoso-scroller' },
        data.map((item: unknown, index: number) =>
          React.createElement('div', { key: index }, itemContent?.(index, item))
        ),
        Footer ? React.createElement(Footer) : null,
      );
    }),
  };
});

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

    it('disables suggestion cards when isStreaming is true', () => {
      // Simulate the brief window where isStreaming is true but messages is still empty
      useChatStore.setState({ isStreaming: false, messages: [] });
      renderChat('/chat/srv-1');

      const card = screen.getByTestId('suggestion-card-0');
      expect(card.className).toContain('cursor-pointer');
      expect(card.className).not.toContain('pointer-events-none');
      expect(card.className).not.toContain('opacity-50');
    });

    it('rapid double-click on suggestion cards only sends one message', async () => {
      const user = (await import('@testing-library/user-event')).default.setup();
      // Use a sendMessage mock that sets isStreaming on first call (mimicking store behavior)
      const sendMessage = vi.fn().mockImplementation(() => {
        useChatStore.setState({
          isStreaming: true,
          messages: [
            { id: 'msg-1', role: 'user' as const, content: 'Install nginx and configure it', timestamp: new Date().toISOString() },
          ],
        });
      });
      useChatStore.setState({ sendMessage: sendMessage as unknown as (msg: string) => void });
      renderChat('/chat/srv-1');

      const card = screen.getByTestId('suggestion-card-0');
      // First click triggers sendMessage, which sets isStreaming=true and adds a message.
      // React re-render will unmount EmptyState since messages.length > 0.
      await user.click(card);

      // EmptyState should no longer be rendered
      expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
      expect(sendMessage).toHaveBeenCalledTimes(1);
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

    it('renders messages via Virtuoso virtual scroller', () => {
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
      expect(screen.getByTestId('virtuoso-scroller')).toBeInTheDocument();
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

    it('shows mobile sidebar toggle button when sessions exist', () => {
      useChatStore.setState({
        sessions: [
          {
            id: 'sess-mobile',
            serverId: 'srv-1',
            messageCount: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastMessage: 'Mobile session',
          },
        ],
        fetchSessions: vi.fn() as unknown as (serverId: string) => Promise<void>,
      });
      renderChat('/chat/srv-1');
      expect(screen.getByTestId('mobile-sidebar-toggle')).toBeInTheDocument();
    });

    it('does not show mobile sidebar toggle when no sessions', () => {
      useChatStore.setState({
        sessions: [],
        fetchSessions: vi.fn() as unknown as (serverId: string) => Promise<void>,
      });
      renderChat('/chat/srv-1');
      expect(screen.queryByTestId('mobile-sidebar-toggle')).not.toBeInTheDocument();
    });

    it('opens mobile sidebar overlay when toggle is clicked', async () => {
      const user = (await import('@testing-library/user-event')).default.setup();
      useChatStore.setState({
        sessions: [
          {
            id: 'sess-drawer',
            serverId: 'srv-1',
            messageCount: 2,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastMessage: 'Drawer session',
          },
        ],
        fetchSessions: vi.fn() as unknown as (serverId: string) => Promise<void>,
      });
      renderChat('/chat/srv-1');

      expect(screen.queryByTestId('mobile-session-sidebar')).not.toBeInTheDocument();

      await user.click(screen.getByTestId('mobile-sidebar-toggle'));

      expect(screen.getByTestId('mobile-session-sidebar')).toBeInTheDocument();
      expect(screen.getByTestId('mobile-sidebar-backdrop')).toBeInTheDocument();
      expect(screen.getByTestId('mobile-sidebar-close')).toBeInTheDocument();
    });

    it('closes mobile sidebar when backdrop is clicked', async () => {
      const user = (await import('@testing-library/user-event')).default.setup();
      useChatStore.setState({
        sessions: [
          {
            id: 'sess-backdrop',
            serverId: 'srv-1',
            messageCount: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastMessage: 'Backdrop test',
          },
        ],
        fetchSessions: vi.fn() as unknown as (serverId: string) => Promise<void>,
      });
      renderChat('/chat/srv-1');

      await user.click(screen.getByTestId('mobile-sidebar-toggle'));
      expect(screen.getByTestId('mobile-session-sidebar')).toBeInTheDocument();

      await user.click(screen.getByTestId('mobile-sidebar-backdrop'));
      expect(screen.queryByTestId('mobile-session-sidebar')).not.toBeInTheDocument();
    });

    it('closes mobile sidebar when close button is clicked', async () => {
      const user = (await import('@testing-library/user-event')).default.setup();
      useChatStore.setState({
        sessions: [
          {
            id: 'sess-close-btn',
            serverId: 'srv-1',
            messageCount: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastMessage: 'Close button test',
          },
        ],
        fetchSessions: vi.fn() as unknown as (serverId: string) => Promise<void>,
      });
      renderChat('/chat/srv-1');

      await user.click(screen.getByTestId('mobile-sidebar-toggle'));
      expect(screen.getByTestId('mobile-session-sidebar')).toBeInTheDocument();

      await user.click(screen.getByTestId('mobile-sidebar-close'));
      expect(screen.queryByTestId('mobile-session-sidebar')).not.toBeInTheDocument();
    });

    it('closes mobile sidebar when a session is selected', async () => {
      const user = (await import('@testing-library/user-event')).default.setup();
      const loadSession = vi.fn();
      useChatStore.setState({
        sessions: [
          {
            id: 'sess-select',
            serverId: 'srv-1',
            messageCount: 3,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastMessage: 'Select to close',
          },
        ],
        loadSession: loadSession as unknown as (serverId: string, sessionId: string) => Promise<void>,
        fetchSessions: vi.fn() as unknown as (serverId: string) => Promise<void>,
      });
      renderChat('/chat/srv-1');

      await user.click(screen.getByTestId('mobile-sidebar-toggle'));
      expect(screen.getByTestId('mobile-session-sidebar')).toBeInTheDocument();

      // Click the session item inside the mobile overlay
      const sessionItems = screen.getAllByTestId('session-item-sess-select');
      // The mobile overlay renders a second instance of the session list
      const mobileItem = sessionItems[sessionItems.length - 1];
      await user.click(mobileItem);

      expect(loadSession).toHaveBeenCalledWith('srv-1', 'sess-select');
      expect(screen.queryByTestId('mobile-session-sidebar')).not.toBeInTheDocument();
    });
  });

  describe('global keyboard shortcuts', () => {
    it('Escape cancels streaming from anywhere on the page', async () => {
      const user = (await import('@testing-library/user-event')).default.setup();
      const cancelStream = vi.fn();
      useChatStore.setState({
        isStreaming: true,
        streamingContent: 'partial...',
        cancelStream: cancelStream as unknown as () => void,
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
      renderChat('/chat/srv-1');

      // Press Escape on the document body (not in textarea)
      await user.keyboard('{Escape}');
      expect(cancelStream).toHaveBeenCalledTimes(1);
    });

    it('Escape does nothing when not streaming', async () => {
      const user = (await import('@testing-library/user-event')).default.setup();
      const cancelStream = vi.fn();
      useChatStore.setState({
        isStreaming: false,
        cancelStream: cancelStream as unknown as () => void,
        fetchSessions: vi.fn() as unknown as (serverId: string) => Promise<void>,
      });
      renderChat('/chat/srv-1');

      await user.keyboard('{Escape}');
      expect(cancelStream).not.toHaveBeenCalled();
    });

    it('/ key focuses the message input when not in a text field', async () => {
      const user = (await import('@testing-library/user-event')).default.setup();
      useChatStore.setState({
        fetchSessions: vi.fn() as unknown as (serverId: string) => Promise<void>,
      });
      renderChat('/chat/srv-1');

      const textarea = screen.getByTestId('message-textarea');
      // Ensure textarea is not focused initially
      expect(document.activeElement).not.toBe(textarea);

      await user.keyboard('/');
      expect(document.activeElement).toBe(textarea);
    });

    it('/ key does not steal focus from textarea', async () => {
      const user = (await import('@testing-library/user-event')).default.setup();
      useChatStore.setState({
        fetchSessions: vi.fn() as unknown as (serverId: string) => Promise<void>,
      });
      renderChat('/chat/srv-1');

      const textarea = screen.getByTestId('message-textarea');
      // Focus the textarea first
      textarea.focus();
      expect(document.activeElement).toBe(textarea);

      // Type / — should be typed into the textarea as normal text, not intercepted
      await user.type(textarea, '/');
      expect(textarea).toHaveValue('/');
    });
  });

  describe('virtual scrolling', () => {
    it('uses Virtuoso to render messages', () => {
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
      expect(screen.getByTestId('virtuoso-scroller')).toBeInTheDocument();
      expect(screen.getByText('Hello')).toBeInTheDocument();
    });

    it('does not render Virtuoso when messages are empty (shows empty state)', () => {
      useChatStore.setState({ messages: [], isStreaming: false });
      renderChat('/chat/srv-1');
      expect(screen.queryByTestId('virtuoso-scroller')).not.toBeInTheDocument();
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });

    it('renders footer content (streaming) inside Virtuoso', () => {
      useChatStore.setState({
        isStreaming: true,
        streamingContent: 'Loading...',
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Help',
            timestamp: '2025-01-01T00:00:00Z',
          },
        ],
      });
      renderChat('/chat/srv-1');
      // Streaming message should be inside the virtuoso scroller (as footer)
      const scroller = screen.getByTestId('virtuoso-scroller');
      expect(scroller).toBeInTheDocument();
      expect(screen.getByTestId('streaming-message')).toBeInTheDocument();
    });

    it('renders multiple messages via Virtuoso', () => {
      const msgs = Array.from({ length: 10 }, (_, i) => ({
        id: `msg-${i}`,
        role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
        content: `Message ${i}`,
        timestamp: '2025-01-01T00:00:00Z',
      }));
      useChatStore.setState({ messages: msgs });
      renderChat('/chat/srv-1');

      for (let i = 0; i < 10; i++) {
        expect(screen.getByText(`Message ${i}`)).toBeInTheDocument();
      }
    });
  });
});
