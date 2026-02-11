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
  createSSEConnection: vi.fn(() => ({ abort: vi.fn() })),
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

    it('uses server ID as fallback name', () => {
      useServersStore.setState({ servers: [] });
      renderChat('/chat/srv-unknown');
      const header = screen.getByTestId('chat-header');
      expect(header.textContent).toContain('srv-unknown');
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
      expect(screen.getByTestId('session-group-Today')).toBeInTheDocument();
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
      expect(screen.getByTestId('session-group-Older')).toBeInTheDocument();
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

      await user.click(screen.getByTestId('session-group-toggle-Today'));
      expect(screen.queryByText('Collapsible session')).not.toBeInTheDocument();

      await user.click(screen.getByTestId('session-group-toggle-Today'));
      expect(screen.getByText('Collapsible session')).toBeInTheDocument();
    });
  });
});
