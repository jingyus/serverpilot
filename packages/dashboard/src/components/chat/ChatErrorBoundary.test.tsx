// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatErrorBoundary } from './ChatErrorBoundary';

// Suppress console.error noise from React and ErrorBoundary during tests
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

/** A component that throws on render */
function ThrowingChild({ message = 'Markdown parse error' }: { message?: string }): never {
  throw new Error(message);
}

/** A component that renders normally */
function GoodChild() {
  return <div data-testid="chat-content">Chat messages here</div>;
}

describe('ChatErrorBoundary', () => {
  const onNewSession = vi.fn();

  beforeEach(() => {
    onNewSession.mockClear();
  });

  it('renders children when no error occurs', () => {
    render(
      <ChatErrorBoundary onNewSession={onNewSession}>
        <GoodChild />
      </ChatErrorBoundary>,
    );
    expect(screen.getByTestId('chat-content')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-error-boundary')).not.toBeInTheDocument();
  });

  it('renders chat-specific error fallback when child throws', () => {
    render(
      <ChatErrorBoundary onNewSession={onNewSession}>
        <ThrowingChild />
      </ChatErrorBoundary>,
    );
    expect(screen.getByTestId('chat-error-boundary')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Chat failed to load')).toBeInTheDocument();
    expect(
      screen.getByText('A message could not be rendered. Please try again or start a new session.'),
    ).toBeInTheDocument();
  });

  it('shows retry button that resets the error boundary', async () => {
    const user = userEvent.setup();
    let shouldThrow = true;

    function ConditionalThrow() {
      if (shouldThrow) throw new Error('render crash');
      return <div data-testid="recovered">Recovered</div>;
    }

    render(
      <ChatErrorBoundary onNewSession={onNewSession}>
        <ConditionalThrow />
      </ChatErrorBoundary>,
    );

    expect(screen.getByTestId('chat-error-boundary')).toBeInTheDocument();

    // Fix the error and click retry
    shouldThrow = false;
    await user.click(screen.getByTestId('chat-error-retry'));

    expect(screen.queryByTestId('chat-error-boundary')).not.toBeInTheDocument();
    expect(screen.getByTestId('recovered')).toBeInTheDocument();
  });

  it('shows new session button that calls onNewSession', async () => {
    const user = userEvent.setup();

    render(
      <ChatErrorBoundary onNewSession={onNewSession}>
        <ThrowingChild />
      </ChatErrorBoundary>,
    );

    const newSessionBtn = screen.getByTestId('chat-error-new-session');
    expect(newSessionBtn).toBeInTheDocument();

    await user.click(newSessionBtn);
    expect(onNewSession).toHaveBeenCalledOnce();
  });

  it('shows error details in development mode', () => {
    // import.meta.env.DEV is true in vitest by default
    render(
      <ChatErrorBoundary onNewSession={onNewSession}>
        <ThrowingChild message="detailed error info" />
      </ChatErrorBoundary>,
    );

    expect(screen.getByTestId('chat-error-details')).toBeInTheDocument();
    expect(screen.getByText(/detailed error info/)).toBeInTheDocument();
  });

  it('logs error to console', () => {
    render(
      <ChatErrorBoundary onNewSession={onNewSession}>
        <ThrowingChild message="console log test" />
      </ChatErrorBoundary>,
    );

    expect(console.error).toHaveBeenCalled();
  });
});
