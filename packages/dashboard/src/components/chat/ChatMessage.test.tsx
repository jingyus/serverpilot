// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('preserves whitespace in content', () => {
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
});
