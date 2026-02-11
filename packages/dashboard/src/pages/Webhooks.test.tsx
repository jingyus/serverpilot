// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Webhooks } from './Webhooks';
import { useWebhooksStore } from '@/stores/webhooks';
import type { Webhook } from '@/types/webhook';

const mockWebhooks: Webhook[] = [
  {
    id: 'wh-1',
    userId: 'user-1',
    tenantId: null,
    name: 'Slack Notifications',
    url: 'https://hooks.slack.com/services/xxx',
    secret: 'secr****',
    events: ['task.completed', 'alert.triggered'],
    enabled: true,
    maxRetries: 3,
    createdAt: '2026-02-09T00:00:00Z',
    updatedAt: '2026-02-09T00:00:00Z',
  },
  {
    id: 'wh-2',
    userId: 'user-1',
    tenantId: null,
    name: 'PagerDuty',
    url: 'https://events.pagerduty.com/v2/enqueue',
    secret: 'secr****',
    events: ['server.offline', 'operation.failed'],
    enabled: false,
    maxRetries: 3,
    createdAt: '2026-02-10T00:00:00Z',
    updatedAt: '2026-02-10T00:00:00Z',
  },
];

function renderWebhooks() {
  return render(
    <MemoryRouter>
      <Webhooks />
    </MemoryRouter>,
  );
}

function setupStore(overrides: Partial<ReturnType<typeof useWebhooksStore.getState>> = {}) {
  useWebhooksStore.setState({
    webhooks: mockWebhooks,
    isLoading: false,
    error: null,
    fetchWebhooks: vi.fn().mockResolvedValue(undefined),
    createWebhook: vi.fn().mockResolvedValue(mockWebhooks[0]),
    updateWebhook: vi.fn().mockResolvedValue(undefined),
    deleteWebhook: vi.fn().mockResolvedValue(undefined),
    testWebhook: vi.fn().mockResolvedValue(undefined),
    clearError: vi.fn(),
    ...overrides,
  });
}

describe('Webhooks Page', () => {
  beforeEach(() => {
    setupStore();
  });

  it('should render the page title', () => {
    renderWebhooks();
    expect(screen.getByText('Webhooks')).toBeInTheDocument();
  });

  it('should render webhook list', () => {
    renderWebhooks();
    expect(screen.getByText('Slack Notifications')).toBeInTheDocument();
    expect(screen.getByText('PagerDuty')).toBeInTheDocument();
  });

  it('should show enabled/disabled badges', () => {
    renderWebhooks();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('should show event type badges', () => {
    renderWebhooks();
    expect(screen.getByText('Task Completed')).toBeInTheDocument();
    expect(screen.getByText('Alert Triggered')).toBeInTheDocument();
    expect(screen.getByText('Server Offline')).toBeInTheDocument();
    expect(screen.getByText('Operation Failed')).toBeInTheDocument();
  });

  it('should show loading spinner when loading', () => {
    setupStore({ isLoading: true });
    renderWebhooks();
    // Loader2 icon has an animation class
    const loader = document.querySelector('.animate-spin');
    expect(loader).toBeInTheDocument();
  });

  it('should show empty state when no webhooks', () => {
    setupStore({ webhooks: [] });
    renderWebhooks();
    expect(screen.getByText('No webhooks configured')).toBeInTheDocument();
    expect(screen.getByText('Add Your First Webhook')).toBeInTheDocument();
  });

  it('should show error message', () => {
    setupStore({ error: 'Failed to load webhooks' });
    renderWebhooks();
    expect(screen.getByText('Failed to load webhooks')).toBeInTheDocument();
  });

  it('should open add dialog', async () => {
    const user = userEvent.setup();
    renderWebhooks();

    await user.click(screen.getByText('Add Webhook'));
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('URL')).toBeInTheDocument();
    expect(screen.getByText('Create Webhook')).toBeInTheDocument();
  });

  it('should call fetchWebhooks on mount', () => {
    const fetchWebhooks = vi.fn().mockResolvedValue(undefined);
    setupStore({ fetchWebhooks });
    renderWebhooks();
    expect(fetchWebhooks).toHaveBeenCalled();
  });

  it('should dismiss error', async () => {
    const clearError = vi.fn();
    setupStore({ error: 'Something went wrong', clearError });
    const user = userEvent.setup();
    renderWebhooks();

    await user.click(screen.getByText('Dismiss'));
    expect(clearError).toHaveBeenCalled();
  });
});
