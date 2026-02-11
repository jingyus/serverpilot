// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageInput } from './MessageInput';

describe('MessageInput', () => {
  const defaultProps = {
    onSend: vi.fn(),
    onCancel: vi.fn(),
    isStreaming: false,
  };

  it('renders the textarea and send button', () => {
    render(<MessageInput {...defaultProps} />);
    expect(screen.getByTestId('message-textarea')).toBeInTheDocument();
    expect(screen.getByTestId('send-btn')).toBeInTheDocument();
  });

  it('send button is disabled when input is empty', () => {
    render(<MessageInput {...defaultProps} />);
    expect(screen.getByTestId('send-btn')).toBeDisabled();
  });

  it('sends message on button click', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);

    await user.type(screen.getByTestId('message-textarea'), 'Hello');
    await user.click(screen.getByTestId('send-btn'));
    expect(onSend).toHaveBeenCalledWith('Hello');
  });

  it('sends message on Enter key', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);

    await user.type(screen.getByTestId('message-textarea'), 'Hello{Enter}');
    expect(onSend).toHaveBeenCalledWith('Hello');
  });

  it('does not send on Shift+Enter', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);

    await user.type(
      screen.getByTestId('message-textarea'),
      'Hello{Shift>}{Enter}{/Shift}'
    );
    expect(onSend).not.toHaveBeenCalled();
  });

  it('clears input after sending', async () => {
    const user = userEvent.setup();
    render(<MessageInput {...defaultProps} onSend={vi.fn()} />);

    const textarea = screen.getByTestId('message-textarea');
    await user.type(textarea, 'Hello{Enter}');
    expect(textarea).toHaveValue('');
  });

  it('shows char count when input has content', async () => {
    const user = userEvent.setup();
    render(<MessageInput {...defaultProps} />);

    await user.type(screen.getByTestId('message-textarea'), 'Hello');
    expect(screen.getByTestId('char-count')).toHaveTextContent('5/4000');
  });

  it('hides char count when input is empty', () => {
    render(<MessageInput {...defaultProps} />);
    expect(screen.queryByTestId('char-count')).not.toBeInTheDocument();
  });

  it('shows cancel button when streaming', () => {
    render(<MessageInput {...defaultProps} isStreaming={true} />);
    expect(screen.getByTestId('cancel-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('send-btn')).not.toBeInTheDocument();
  });

  it('calls onCancel when cancel button clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <MessageInput {...defaultProps} isStreaming={true} onCancel={onCancel} />
    );

    await user.click(screen.getByTestId('cancel-btn'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables textarea when disabled prop is true', () => {
    render(<MessageInput {...defaultProps} disabled={true} />);
    expect(screen.getByTestId('message-textarea')).toBeDisabled();
  });

  it('shows placeholder text', () => {
    render(<MessageInput {...defaultProps} />);
    expect(
      screen.getByPlaceholderText(/Type your message/)
    ).toBeInTheDocument();
  });

  it('trims whitespace before sending', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);

    await user.type(
      screen.getByTestId('message-textarea'),
      '  Hello  {Enter}'
    );
    expect(onSend).toHaveBeenCalledWith('Hello');
  });
});
