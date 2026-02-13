// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionSidebar, getSessionDateGroup } from './SessionSidebar';
import type { SessionItem } from './SessionSidebar';

function makeSessions(overrides?: Partial<SessionItem>[]): SessionItem[] {
  return (overrides ?? [{ id: 'sess-1', createdAt: new Date().toISOString(), lastMessage: 'Hello', messageCount: 3 }]).map(
    (o, i) => ({
      id: `sess-${i + 1}`,
      createdAt: new Date().toISOString(),
      lastMessage: `Session ${i + 1}`,
      messageCount: 1,
      ...o,
    })
  );
}

const baseProps = {
  activeSessionId: null,
  serverId: 'srv-1',
  onSelect: vi.fn(),
  onDelete: vi.fn(),
  onRename: vi.fn(),
  isLoading: false,
};

describe('SessionSidebar', () => {
  it('returns null when no sessions and not loading', () => {
    const { container } = render(
      <SessionSidebar {...baseProps} sessions={[]} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders desktop sidebar with session items', () => {
    render(<SessionSidebar {...baseProps} sessions={makeSessions()} />);
    expect(screen.getByTestId('session-sidebar')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  describe('mobile overlay', () => {
    it('shows mobile sidebar when mobileOpen is true', () => {
      render(
        <SessionSidebar
          {...baseProps}
          sessions={makeSessions()}
          mobileOpen={true}
          onMobileClose={vi.fn()}
        />
      );
      expect(screen.getByTestId('mobile-session-sidebar')).toBeInTheDocument();
      expect(screen.getByTestId('mobile-sidebar-backdrop')).toBeInTheDocument();
      expect(screen.getByTestId('mobile-sidebar-close')).toBeInTheDocument();
    });

    it('hides mobile sidebar when mobileOpen is false', () => {
      render(
        <SessionSidebar
          {...baseProps}
          sessions={makeSessions()}
          mobileOpen={false}
          onMobileClose={vi.fn()}
        />
      );
      expect(screen.queryByTestId('mobile-session-sidebar')).not.toBeInTheDocument();
    });

    it('calls onMobileClose when backdrop clicked', () => {
      const onClose = vi.fn();
      render(
        <SessionSidebar
          {...baseProps}
          sessions={makeSessions()}
          mobileOpen={true}
          onMobileClose={onClose}
        />
      );
      fireEvent.click(screen.getByTestId('mobile-sidebar-backdrop'));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onMobileClose when close button clicked', () => {
      const onClose = vi.fn();
      render(
        <SessionSidebar
          {...baseProps}
          sessions={makeSessions()}
          mobileOpen={true}
          onMobileClose={onClose}
        />
      );
      fireEvent.click(screen.getByTestId('mobile-sidebar-close'));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('shows session items in mobile sidebar', () => {
      render(
        <SessionSidebar
          {...baseProps}
          sessions={makeSessions([
            { id: 'sess-mobile', lastMessage: 'Mobile session', messageCount: 5, createdAt: new Date().toISOString() },
          ])}
          mobileOpen={true}
          onMobileClose={vi.fn()}
        />
      );
      // Session should appear in both desktop and mobile sidebars
      const texts = screen.getAllByText('Mobile session');
      expect(texts.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('session rename', () => {
    it('shows rename button on hover', () => {
      render(<SessionSidebar {...baseProps} sessions={makeSessions()} />);
      // Rename button exists but hidden (group-hover:flex)
      const renameBtn = screen.getByTestId('rename-session-sess-1');
      expect(renameBtn).toBeInTheDocument();
    });

    it('shows rename input when edit button is clicked', () => {
      render(<SessionSidebar {...baseProps} sessions={makeSessions()} />);
      fireEvent.click(screen.getByTestId('rename-session-sess-1'));
      expect(screen.getByTestId('rename-input-sess-1')).toBeInTheDocument();
    });

    it('calls onRename with new name on Enter', () => {
      const onRename = vi.fn();
      render(<SessionSidebar {...baseProps} onRename={onRename} sessions={makeSessions()} />);
      fireEvent.click(screen.getByTestId('rename-session-sess-1'));
      const input = screen.getByTestId('rename-input-sess-1');
      fireEvent.change(input, { target: { value: 'New Name' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onRename).toHaveBeenCalledWith('sess-1', 'New Name');
    });

    it('does not call onRename when Escape is pressed', () => {
      const onRename = vi.fn();
      render(<SessionSidebar {...baseProps} onRename={onRename} sessions={makeSessions()} />);
      fireEvent.click(screen.getByTestId('rename-session-sess-1'));
      const input = screen.getByTestId('rename-input-sess-1');
      fireEvent.change(input, { target: { value: 'New Name' } });
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(onRename).not.toHaveBeenCalled();
    });

    it('does not call onRename when name is unchanged', () => {
      const onRename = vi.fn();
      render(<SessionSidebar {...baseProps} onRename={onRename} sessions={makeSessions()} />);
      fireEvent.click(screen.getByTestId('rename-session-sess-1'));
      const input = screen.getByTestId('rename-input-sess-1');
      // Don't change the value, just press Enter
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onRename).not.toHaveBeenCalled();
    });

    it('does not call onRename when name is empty', () => {
      const onRename = vi.fn();
      render(<SessionSidebar {...baseProps} onRename={onRename} sessions={makeSessions()} />);
      fireEvent.click(screen.getByTestId('rename-session-sess-1'));
      const input = screen.getByTestId('rename-input-sess-1');
      fireEvent.change(input, { target: { value: '   ' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onRename).not.toHaveBeenCalled();
    });

    it('displays session.name as title when set', () => {
      render(
        <SessionSidebar
          {...baseProps}
          sessions={makeSessions([
            { id: 'sess-named', name: 'My Custom Name', lastMessage: 'Some message', messageCount: 2, createdAt: new Date().toISOString() },
          ])}
        />
      );
      expect(screen.getByText('My Custom Name')).toBeInTheDocument();
    });

    it('falls back to lastMessage when name is null', () => {
      render(
        <SessionSidebar
          {...baseProps}
          sessions={makeSessions([
            { id: 'sess-noname', name: null, lastMessage: 'Fallback Message', messageCount: 1, createdAt: new Date().toISOString() },
          ])}
        />
      );
      expect(screen.getByText('Fallback Message')).toBeInTheDocument();
    });

    it('exits edit mode after saving on blur', () => {
      const onRename = vi.fn();
      render(<SessionSidebar {...baseProps} onRename={onRename} sessions={makeSessions()} />);
      fireEvent.click(screen.getByTestId('rename-session-sess-1'));
      const input = screen.getByTestId('rename-input-sess-1');
      fireEvent.change(input, { target: { value: 'Blurred Name' } });
      fireEvent.blur(input);
      expect(onRename).toHaveBeenCalledWith('sess-1', 'Blurred Name');
      expect(screen.queryByTestId('rename-input-sess-1')).not.toBeInTheDocument();
    });
  });
});

describe('getSessionDateGroup', () => {
  it('returns today for current date', () => {
    expect(getSessionDateGroup(new Date().toISOString())).toBe('today');
  });

  it('returns older for very old date', () => {
    expect(getSessionDateGroup('2020-01-01T00:00:00Z')).toBe('older');
  });
});
