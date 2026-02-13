// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Notifications } from './Notifications';
import { useNotificationHistoryStore } from '@/stores/notification-history';
import type { NotificationItem } from '@/types/notification-history';

const mockItems: NotificationItem[] = [
  {
    id: 'alert-1',
    category: 'alert',
    title: 'CPU Alert',
    message: 'CPU usage above 90%',
    timestamp: '2026-02-13T10:00:00Z',
    read: false,
    severity: 'critical',
  },
  {
    id: 'webhook-1',
    category: 'webhook',
    title: 'Webhook: task.completed',
    message: 'Delivery delivered (1 attempt)',
    timestamp: '2026-02-13T09:00:00Z',
    read: true,
    severity: 'info',
  },
  {
    id: 'alert-2',
    category: 'alert',
    title: 'DISK Alert',
    message: 'Disk usage above 80%',
    timestamp: '2026-02-13T08:00:00Z',
    read: false,
    severity: 'warning',
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <Notifications />
    </MemoryRouter>,
  );
}

function setupStore(
  overrides: Partial<ReturnType<typeof useNotificationHistoryStore.getState>> = {},
) {
  useNotificationHistoryStore.setState({
    items: [...mockItems],
    isLoading: false,
    error: null,
    filter: 'all',
    readIds: new Set(),
    fetchNotifications: vi.fn().mockResolvedValue(undefined),
    setFilter: vi.fn(),
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
  });
}

describe('Notifications Page', () => {
  beforeEach(() => {
    setupStore();
  });

  it('renders the page title and description', () => {
    renderPage();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(
      screen.getByText(
        'View your notification history from alerts and webhook deliveries.',
      ),
    ).toBeInTheDocument();
  });

  it('renders notification items', () => {
    renderPage();
    expect(screen.getByText('CPU Alert')).toBeInTheDocument();
    expect(screen.getByText('Webhook: task.completed')).toBeInTheDocument();
    expect(screen.getByText('DISK Alert')).toBeInTheDocument();
  });

  it('shows loading spinner when loading', () => {
    setupStore({ isLoading: true });
    renderPage();
    const loader = document.querySelector('.animate-spin');
    expect(loader).toBeInTheDocument();
  });

  it('shows empty state when no items', () => {
    setupStore({ items: [] });
    renderPage();
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('No notifications')).toBeInTheDocument();
  });

  it('shows error alert', () => {
    setupStore({ error: 'Failed to load notifications' });
    renderPage();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByText('Failed to load notifications'),
    ).toBeInTheDocument();
  });

  it('calls fetchNotifications on mount', () => {
    const fetchNotifications = vi.fn().mockResolvedValue(undefined);
    setupStore({ fetchNotifications });
    renderPage();
    expect(fetchNotifications).toHaveBeenCalled();
  });

  it('calls markAllAsRead when button clicked', async () => {
    const markAllAsRead = vi.fn();
    setupStore({ markAllAsRead });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('mark-all-read'));
    expect(markAllAsRead).toHaveBeenCalled();
  });

  it('renders filter tabs', () => {
    renderPage();
    const tabs = screen.getByTestId('filter-tabs');
    expect(tabs).toBeInTheDocument();
    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('Alerts')).toBeInTheDocument();
    expect(screen.getByText('Webhooks')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
  });

  it('shows unread indicator dot on unread items', () => {
    renderPage();
    const items = screen.getAllByTestId('notification-item');
    expect(items).toHaveLength(3);
  });

  it('disables mark all read button when no unread items', () => {
    const allRead = mockItems.map((i) => ({ ...i, read: true }));
    setupStore({ items: allRead });
    renderPage();
    expect(screen.getByTestId('mark-all-read')).toBeDisabled();
  });

  it('dismisses error when dismiss clicked', async () => {
    const clearError = vi.fn();
    setupStore({ error: 'Something went wrong', clearError });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByText('Dismiss'));
    expect(clearError).toHaveBeenCalled();
  });
});
