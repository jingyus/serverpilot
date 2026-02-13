// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatMessage } from './ChatMessage';
import { useNotificationsStore } from '@/stores/notifications';
import type { ChatMessage as ChatMessageType } from '@/types/chat';

function createMessage(
  overrides: Partial<ChatMessageType> = {}
): ChatMessageType {
  return {
    id: 'msg-1',
    role: 'user',
    content: 'Hello world',
    timestamp: '2025-01-15T10:30:00Z',
    ...overrides,
  };
}

describe('ChatMessage', () => {
  it('renders a user message', () => {
    render(<ChatMessage message={createMessage()} />);
    expect(screen.getByTestId('chat-message-user')).toBeInTheDocument();
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders an assistant message', () => {
    render(
      <ChatMessage
        message={createMessage({ role: 'assistant', content: 'I can help' })}
      />
    );
    expect(screen.getByTestId('chat-message-assistant')).toBeInTheDocument();
    expect(screen.getByText('I can help')).toBeInTheDocument();
  });

  it('renders a system message', () => {
    render(
      <ChatMessage
        message={createMessage({ role: 'system', content: 'Plan rejected' })}
      />
    );
    expect(screen.getByTestId('chat-message-system')).toBeInTheDocument();
    expect(screen.getByText('Plan rejected')).toBeInTheDocument();
  });

  it('displays timestamp', () => {
    render(<ChatMessage message={createMessage()} />);
    expect(screen.getByText(/2025/)).toBeInTheDocument();
  });

  it('preserves whitespace in user messages', () => {
    render(
      <ChatMessage
        message={createMessage({ content: 'line1\nline2\nline3' })}
      />
    );
    const container = screen.getByTestId('chat-message-user');
    const pre = container.querySelector('.whitespace-pre-wrap');
    expect(pre).toBeInTheDocument();
    expect(pre?.textContent).toBe('line1\nline2\nline3');
  });

  it('user messages align right', () => {
    render(<ChatMessage message={createMessage({ role: 'user' })} />);
    const container = screen.getByTestId('chat-message-user');
    expect(container).toHaveClass('justify-end');
  });

  it('assistant messages align left', () => {
    render(<ChatMessage message={createMessage({ role: 'assistant' })} />);
    const container = screen.getByTestId('chat-message-assistant');
    expect(container).toHaveClass('justify-start');
  });

  it('system messages align center', () => {
    render(<ChatMessage message={createMessage({ role: 'system' })} />);
    const container = screen.getByTestId('chat-message-system');
    expect(container).toHaveClass('justify-center');
  });

  it('renders assistant message with MarkdownRenderer', () => {
    render(
      <ChatMessage
        message={createMessage({ role: 'assistant', content: '**bold text**' })}
      />
    );
    expect(screen.getByTestId('markdown-content')).toBeInTheDocument();
    const bold = screen.getByText('bold text');
    expect(bold.tagName).toBe('STRONG');
  });

  it('user messages do NOT use MarkdownRenderer', () => {
    render(
      <ChatMessage
        message={createMessage({ role: 'user', content: '**not bold**' })}
      />
    );
    expect(screen.queryByTestId('markdown-content')).not.toBeInTheDocument();
    // Content shown as plain text including markdown syntax
    expect(screen.getByText('**not bold**')).toBeInTheDocument();
  });

  it('assistant message renders code blocks', () => {
    render(
      <ChatMessage
        message={createMessage({
          role: 'assistant',
          content: '```bash\necho "hello"\n```',
        })}
      />
    );
    expect(screen.getByTestId('code-block')).toBeInTheDocument();
    expect(screen.getByText('bash')).toBeInTheDocument();
    expect(screen.getByTestId('copy-code-button')).toBeInTheDocument();
  });

  it('assistant message renders lists', () => {
    render(
      <ChatMessage
        message={createMessage({
          role: 'assistant',
          content: '- Item A\n- Item B\n- Item C',
        })}
      />
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
  });

  it('assistant message renders headings', () => {
    render(
      <ChatMessage
        message={createMessage({
          role: 'assistant',
          content: '## Section Title\nSome paragraph text',
        })}
      />
    );
    expect(screen.getByText('Section Title').tagName).toBe('H2');
  });

  describe('message actions', () => {
    beforeEach(() => {
      useNotificationsStore.setState({ notifications: [] });
    });

    it('renders message actions for user messages', () => {
      render(<ChatMessage message={createMessage({ role: 'user' })} />);
      expect(screen.getByTestId('message-actions')).toBeInTheDocument();
      expect(screen.getByTestId('copy-message-btn')).toBeInTheDocument();
    });

    it('renders message actions for assistant messages', () => {
      render(
        <ChatMessage
          message={createMessage({ role: 'assistant', content: 'Help' })}
        />
      );
      expect(screen.getByTestId('message-actions')).toBeInTheDocument();
      expect(screen.getByTestId('copy-message-btn')).toBeInTheDocument();
    });

    it('does not render message actions for system messages', () => {
      render(
        <ChatMessage
          message={createMessage({ role: 'system', content: 'Info' })}
        />
      );
      expect(screen.queryByTestId('message-actions')).not.toBeInTheDocument();
    });

    it('copies message content to clipboard on click', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: { writeText },
      });

      render(
        <ChatMessage
          message={createMessage({ content: 'Copy me' })}
        />
      );

      await userEvent.click(screen.getByTestId('copy-message-btn'));
      expect(writeText).toHaveBeenCalledWith('Copy me');
    });

    it('shows toast notification after copy', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: { writeText },
      });

      render(
        <ChatMessage
          message={createMessage({ content: 'Copy me' })}
        />
      );

      await userEvent.click(screen.getByTestId('copy-message-btn'));
      const notifications = useNotificationsStore.getState().notifications;
      expect(notifications).toHaveLength(1);
      expect(notifications[0].type).toBe('success');
    });

    it('does not show regenerate button for user messages', () => {
      render(
        <ChatMessage
          message={createMessage({ role: 'user' })}
          isLastAssistant={false}
          onRegenerate={vi.fn()}
        />
      );
      expect(screen.queryByTestId('regenerate-btn')).not.toBeInTheDocument();
    });

    it('does not show regenerate button for non-last assistant messages', () => {
      render(
        <ChatMessage
          message={createMessage({ role: 'assistant', content: 'old reply' })}
          isLastAssistant={false}
          onRegenerate={vi.fn()}
        />
      );
      expect(screen.queryByTestId('regenerate-btn')).not.toBeInTheDocument();
    });

    it('shows regenerate button for last assistant message', () => {
      render(
        <ChatMessage
          message={createMessage({ role: 'assistant', content: 'latest reply' })}
          isLastAssistant={true}
          onRegenerate={vi.fn()}
        />
      );
      expect(screen.getByTestId('regenerate-btn')).toBeInTheDocument();
    });

    it('calls onRegenerate when regenerate button clicked', async () => {
      const onRegenerate = vi.fn();
      render(
        <ChatMessage
          message={createMessage({ role: 'assistant', content: 'reply' })}
          isLastAssistant={true}
          onRegenerate={onRegenerate}
        />
      );
      await userEvent.click(screen.getByTestId('regenerate-btn'));
      expect(onRegenerate).toHaveBeenCalledTimes(1);
    });

    it('message actions are hidden by default (opacity-0)', () => {
      render(<ChatMessage message={createMessage()} />);
      const actions = screen.getByTestId('message-actions');
      expect(actions).toHaveClass('opacity-0');
    });

    it('message actions become visible on group hover (has group-hover:opacity-100)', () => {
      render(<ChatMessage message={createMessage()} />);
      const actions = screen.getByTestId('message-actions');
      expect(actions).toHaveClass('group-hover:opacity-100');
    });
  });

  describe('retry button', () => {
    it('shows retry button when failed is true and onRetry provided', () => {
      const onRetry = vi.fn();
      render(
        <ChatMessage
          message={createMessage({ role: 'user', content: 'Install nginx' })}
          failed={true}
          onRetry={onRetry}
        />
      );
      const retryBtn = screen.getByTestId('retry-message-btn');
      expect(retryBtn).toBeInTheDocument();
      expect(retryBtn).toHaveTextContent('Retry');
    });

    it('calls onRetry with message id when retry clicked', () => {
      const onRetry = vi.fn();
      render(
        <ChatMessage
          message={createMessage({ id: 'msg-42', role: 'user', content: 'test' })}
          failed={true}
          onRetry={onRetry}
        />
      );
      fireEvent.click(screen.getByTestId('retry-message-btn'));
      expect(onRetry).toHaveBeenCalledWith('msg-42');
    });

    it('does not show retry when failed is false', () => {
      render(
        <ChatMessage
          message={createMessage({ role: 'user' })}
          failed={false}
          onRetry={vi.fn()}
        />
      );
      expect(screen.queryByTestId('retry-message-btn')).not.toBeInTheDocument();
    });

    it('adds ring styling to failed messages', () => {
      render(
        <ChatMessage
          message={createMessage({ role: 'user' })}
          failed={true}
          onRetry={vi.fn()}
        />
      );
      const container = screen.getByTestId('chat-message-user');
      const bubble = container.querySelector('.ring-2');
      expect(bubble).toBeInTheDocument();
    });
  });
});
