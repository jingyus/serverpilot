// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatMessage } from './ChatMessage';
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
