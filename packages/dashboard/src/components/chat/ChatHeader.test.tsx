// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatHeader } from './ChatHeader';

describe('ChatHeader', () => {
  const baseProps = {
    serverName: 'Production',
    sessionId: null,
    onNewSession: vi.fn(),
  };

  it('renders server name and title', () => {
    render(<ChatHeader {...baseProps} />);
    expect(screen.getByText('AI Assistant')).toBeInTheDocument();
    expect(screen.getByText(/Production/)).toBeInTheDocument();
  });

  it('shows session ID when provided', () => {
    render(<ChatHeader {...baseProps} sessionId="abcdef1234567890" />);
    expect(screen.getByText(/abcdef12\.\.\./)).toBeInTheDocument();
  });

  it('calls onNewSession when new chat button clicked', () => {
    const onNew = vi.fn();
    render(<ChatHeader {...baseProps} onNewSession={onNew} />);
    fireEvent.click(screen.getByTestId('new-session-btn'));
    expect(onNew).toHaveBeenCalledOnce();
  });

  describe('mobile sidebar toggle', () => {
    it('shows hamburger button when hasSessions is true', () => {
      const onToggle = vi.fn();
      render(
        <ChatHeader
          {...baseProps}
          hasSessions={true}
          onToggleSidebar={onToggle}
        />
      );
      expect(screen.getByTestId('mobile-sidebar-toggle')).toBeInTheDocument();
    });

    it('calls onToggleSidebar when hamburger clicked', () => {
      const onToggle = vi.fn();
      render(
        <ChatHeader
          {...baseProps}
          hasSessions={true}
          onToggleSidebar={onToggle}
        />
      );
      fireEvent.click(screen.getByTestId('mobile-sidebar-toggle'));
      expect(onToggle).toHaveBeenCalledOnce();
    });

    it('hides hamburger button when hasSessions is false', () => {
      render(
        <ChatHeader
          {...baseProps}
          hasSessions={false}
          onToggleSidebar={vi.fn()}
        />
      );
      expect(screen.queryByTestId('mobile-sidebar-toggle')).not.toBeInTheDocument();
    });

    it('hides hamburger button when onToggleSidebar is not provided', () => {
      render(<ChatHeader {...baseProps} hasSessions={true} />);
      expect(screen.queryByTestId('mobile-sidebar-toggle')).not.toBeInTheDocument();
    });
  });
});
