// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SessionSidebar, getSessionDateGroup, filterSessions, highlightText } from './SessionSidebar';
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
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('renders search input', () => {
    render(<SessionSidebar {...baseProps} sessions={makeSessions()} />);
    expect(screen.getByTestId('session-search-input')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search sessions...')).toBeInTheDocument();
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

  describe('session search', () => {
    const searchSessions = makeSessions([
      { id: 'sess-nginx', lastMessage: 'Install nginx server', messageCount: 5, createdAt: new Date().toISOString() },
      { id: 'sess-docker', lastMessage: 'Setup docker containers', messageCount: 3, createdAt: new Date().toISOString() },
      { id: 'sess-named', name: 'Database Backup', lastMessage: 'Configure MySQL', messageCount: 2, createdAt: new Date().toISOString() },
    ]);

    it('filters sessions by lastMessage after debounce', () => {
      render(<SessionSidebar {...baseProps} sessions={searchSessions} />);
      const input = screen.getByTestId('session-search-input');

      fireEvent.change(input, { target: { value: 'nginx' } });

      // Before debounce — all sessions still visible
      expect(screen.getByTestId('session-item-sess-nginx')).toBeInTheDocument();
      expect(screen.getByTestId('session-item-sess-docker')).toBeInTheDocument();

      // After debounce
      act(() => { vi.advanceTimersByTime(300); });

      expect(screen.getByTestId('session-item-sess-nginx')).toBeInTheDocument();
      expect(screen.queryByTestId('session-item-sess-docker')).not.toBeInTheDocument();
      expect(screen.queryByTestId('session-item-sess-named')).not.toBeInTheDocument();
    });

    it('filters sessions by name', () => {
      render(<SessionSidebar {...baseProps} sessions={searchSessions} />);
      const input = screen.getByTestId('session-search-input');

      fireEvent.change(input, { target: { value: 'Database' } });
      act(() => { vi.advanceTimersByTime(300); });

      expect(screen.getByTestId('session-item-sess-named')).toBeInTheDocument();
      expect(screen.queryByTestId('session-item-sess-nginx')).not.toBeInTheDocument();
    });

    it('is case-insensitive', () => {
      render(<SessionSidebar {...baseProps} sessions={searchSessions} />);
      const input = screen.getByTestId('session-search-input');

      fireEvent.change(input, { target: { value: 'DOCKER' } });
      act(() => { vi.advanceTimersByTime(300); });

      expect(screen.getByTestId('session-item-sess-docker')).toBeInTheDocument();
      expect(screen.queryByTestId('session-item-sess-nginx')).not.toBeInTheDocument();
    });

    it('shows empty state when no sessions match', () => {
      render(<SessionSidebar {...baseProps} sessions={searchSessions} />);
      const input = screen.getByTestId('session-search-input');

      fireEvent.change(input, { target: { value: 'nonexistent' } });
      act(() => { vi.advanceTimersByTime(300); });

      expect(screen.getByTestId('session-search-empty')).toBeInTheDocument();
      expect(screen.getByText('No sessions match your search')).toBeInTheDocument();
    });

    it('restores full list when search is cleared', () => {
      render(<SessionSidebar {...baseProps} sessions={searchSessions} />);
      const input = screen.getByTestId('session-search-input');

      // Search
      fireEvent.change(input, { target: { value: 'nginx' } });
      act(() => { vi.advanceTimersByTime(300); });
      expect(screen.queryByTestId('session-item-sess-docker')).not.toBeInTheDocument();

      // Clear
      fireEvent.change(input, { target: { value: '' } });
      act(() => { vi.advanceTimersByTime(300); });

      expect(screen.getByTestId('session-item-sess-nginx')).toBeInTheDocument();
      expect(screen.getByTestId('session-item-sess-docker')).toBeInTheDocument();
      expect(screen.getByTestId('session-item-sess-named')).toBeInTheDocument();
    });

    it('shows clear button when search has value and clears on click', () => {
      render(<SessionSidebar {...baseProps} sessions={searchSessions} />);
      const input = screen.getByTestId('session-search-input');

      // No clear button initially
      expect(screen.queryByTestId('session-search-clear')).not.toBeInTheDocument();

      // Type to show clear button
      fireEvent.change(input, { target: { value: 'nginx' } });
      expect(screen.getByTestId('session-search-clear')).toBeInTheDocument();

      // Click clear
      fireEvent.click(screen.getByTestId('session-search-clear'));
      act(() => { vi.advanceTimersByTime(300); });

      expect(screen.getByTestId('session-item-sess-nginx')).toBeInTheDocument();
      expect(screen.getByTestId('session-item-sess-docker')).toBeInTheDocument();
    });

    it('highlights matching text in session titles', () => {
      render(<SessionSidebar {...baseProps} sessions={searchSessions} />);
      const input = screen.getByTestId('session-search-input');

      fireEvent.change(input, { target: { value: 'nginx' } });
      act(() => { vi.advanceTimersByTime(300); });

      const highlights = screen.getAllByTestId('search-highlight');
      expect(highlights.length).toBeGreaterThanOrEqual(1);
      expect(highlights[0].textContent).toBe('nginx');
    });

    it('supports Chinese search queries', () => {
      const zhSessions = makeSessions([
        { id: 'sess-zh', lastMessage: '安装 nginx 服务器', messageCount: 1, createdAt: new Date().toISOString() },
        { id: 'sess-en', lastMessage: 'Hello world', messageCount: 1, createdAt: new Date().toISOString() },
      ]);
      render(<SessionSidebar {...baseProps} sessions={zhSessions} />);
      const input = screen.getByTestId('session-search-input');

      fireEvent.change(input, { target: { value: '安装' } });
      act(() => { vi.advanceTimersByTime(300); });

      expect(screen.getByTestId('session-item-sess-zh')).toBeInTheDocument();
      expect(screen.queryByTestId('session-item-sess-en')).not.toBeInTheDocument();
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

describe('filterSessions', () => {
  const sessions: SessionItem[] = [
    { id: '1', createdAt: '2026-01-01', lastMessage: 'Install nginx', messageCount: 1 },
    { id: '2', createdAt: '2026-01-01', lastMessage: 'Setup docker', messageCount: 1 },
    { id: '3', createdAt: '2026-01-01', lastMessage: 'Hello', messageCount: 1, name: 'My Backup Task' },
  ];

  it('returns all sessions for empty query', () => {
    expect(filterSessions(sessions, '')).toEqual(sessions);
  });

  it('returns all sessions for whitespace query', () => {
    expect(filterSessions(sessions, '   ')).toEqual(sessions);
  });

  it('filters by lastMessage', () => {
    const result = filterSessions(sessions, 'nginx');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('filters by name', () => {
    const result = filterSessions(sessions, 'Backup');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('3');
  });

  it('is case-insensitive', () => {
    expect(filterSessions(sessions, 'DOCKER')).toHaveLength(1);
    expect(filterSessions(sessions, 'docker')).toHaveLength(1);
  });

  it('returns empty array when nothing matches', () => {
    expect(filterSessions(sessions, 'nonexistent')).toHaveLength(0);
  });

  it('handles sessions with no name or lastMessage', () => {
    const sparse: SessionItem[] = [
      { id: '1', createdAt: '2026-01-01', messageCount: 0 },
    ];
    expect(filterSessions(sparse, 'test')).toHaveLength(0);
    expect(filterSessions(sparse, '')).toHaveLength(1);
  });
});

describe('highlightText', () => {
  it('returns original text for empty query', () => {
    expect(highlightText('Hello world', '')).toEqual(['Hello world']);
  });

  it('returns original text for whitespace query', () => {
    expect(highlightText('Hello world', '   ')).toEqual(['Hello world']);
  });

  it('highlights matching substring', () => {
    const result = highlightText('Install nginx server', 'nginx');
    expect(result).toEqual(['Install ', { highlight: 'nginx' }, ' server']);
  });

  it('highlights case-insensitively', () => {
    const result = highlightText('Install Nginx server', 'nginx');
    expect(result).toEqual(['Install ', { highlight: 'Nginx' }, ' server']);
  });

  it('highlights multiple occurrences', () => {
    const result = highlightText('test this test case', 'test');
    expect(result).toEqual([{ highlight: 'test' }, ' this ', { highlight: 'test' }, ' case']);
  });

  it('escapes regex special characters', () => {
    const result = highlightText('file (copy).txt', '(copy)');
    expect(result).toEqual(['file ', { highlight: '(copy)' }, '.txt']);
  });

  it('handles query at start of text', () => {
    const result = highlightText('nginx config', 'nginx');
    expect(result).toEqual([{ highlight: 'nginx' }, ' config']);
  });

  it('handles query at end of text', () => {
    const result = highlightText('install nginx', 'nginx');
    expect(result).toEqual(['install ', { highlight: 'nginx' }]);
  });
});
