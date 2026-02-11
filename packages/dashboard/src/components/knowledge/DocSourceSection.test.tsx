// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocSourceSection } from './DocSourceSection';
import { useDocSourcesStore } from '@/stores/doc-sources';

vi.mock('@/stores/doc-sources');
const mockUseDocSourcesStore = vi.mocked(useDocSourcesStore);

const MOCK_SOURCES = [
  {
    id: 'ds-1',
    name: 'Nginx Docs',
    software: 'nginx',
    type: 'github' as const,
    enabled: true,
    autoUpdate: false,
    updateFrequencyHours: 168,
    lastFetchedAt: '2025-01-15T00:00:00Z',
    lastFetchStatus: 'success' as const,
    documentCount: 10,
    createdAt: '2025-01-01T00:00:00Z',
  },
  {
    id: 'ds-2',
    name: 'Docker Docs',
    software: 'docker',
    type: 'website' as const,
    enabled: true,
    autoUpdate: true,
    updateFrequencyHours: 24,
    lastFetchedAt: null,
    lastFetchStatus: null,
    documentCount: 0,
    createdAt: '2025-01-02T00:00:00Z',
  },
];

describe('DocSourceSection', () => {
  const mockFetchSources = vi.fn();
  const mockCreateSource = vi.fn();
  const mockUpdateSource = vi.fn();
  const mockDeleteSource = vi.fn();
  const mockTriggerFetch = vi.fn();
  const mockClearError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    mockUseDocSourcesStore.mockReturnValue({
      sources: MOCK_SOURCES,
      isLoading: false,
      error: null,
      isSaving: false,
      fetchingSources: new Set(),
      fetchSources: mockFetchSources,
      createSource: mockCreateSource,
      updateSource: mockUpdateSource,
      deleteSource: mockDeleteSource,
      triggerFetch: mockTriggerFetch,
      clearError: mockClearError,
    });
  });

  it('renders doc source section', () => {
    render(<DocSourceSection />);
    expect(screen.getByTestId('doc-source-section')).toBeInTheDocument();
    expect(screen.getByText('Document Sources')).toBeInTheDocument();
  });

  it('calls fetchSources on mount', () => {
    render(<DocSourceSection />);
    expect(mockFetchSources).toHaveBeenCalledTimes(1);
  });

  it('renders source list with correct details', () => {
    render(<DocSourceSection />);

    expect(screen.getByText('Nginx Docs')).toBeInTheDocument();
    expect(screen.getByText('nginx')).toBeInTheDocument();
    expect(screen.getByText('Docker Docs')).toBeInTheDocument();
    expect(screen.getByText('docker')).toBeInTheDocument();
    expect(screen.getByText('10 docs')).toBeInTheDocument();
  });

  it('renders loading state', () => {
    mockUseDocSourcesStore.mockReturnValue({
      sources: [],
      isLoading: true,
      error: null,
      isSaving: false,
      fetchingSources: new Set(),
      fetchSources: mockFetchSources,
      createSource: mockCreateSource,
      updateSource: mockUpdateSource,
      deleteSource: mockDeleteSource,
      triggerFetch: mockTriggerFetch,
      clearError: mockClearError,
    });

    const { container } = render(<DocSourceSection />);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('renders empty state when no sources', () => {
    mockUseDocSourcesStore.mockReturnValue({
      sources: [],
      isLoading: false,
      error: null,
      isSaving: false,
      fetchingSources: new Set(),
      fetchSources: mockFetchSources,
      createSource: mockCreateSource,
      updateSource: mockUpdateSource,
      deleteSource: mockDeleteSource,
      triggerFetch: mockTriggerFetch,
      clearError: mockClearError,
    });

    render(<DocSourceSection />);
    expect(screen.getByText('No documentation sources configured yet.')).toBeInTheDocument();
  });

  it('renders error state', () => {
    mockUseDocSourcesStore.mockReturnValue({
      sources: MOCK_SOURCES,
      isLoading: false,
      error: 'Failed to load sources',
      isSaving: false,
      fetchingSources: new Set(),
      fetchSources: mockFetchSources,
      createSource: mockCreateSource,
      updateSource: mockUpdateSource,
      deleteSource: mockDeleteSource,
      triggerFetch: mockTriggerFetch,
      clearError: mockClearError,
    });

    render(<DocSourceSection />);
    expect(screen.getByText('Failed to load sources')).toBeInTheDocument();
  });

  it('opens add dialog when clicking Add Source button', async () => {
    const user = userEvent.setup();
    render(<DocSourceSection />);

    const addButton = screen.getByTestId('add-doc-source-btn');
    await user.click(addButton);

    await waitFor(() => {
      expect(screen.getByText('Add Documentation Source')).toBeInTheDocument();
    });
  });

  it('shows success status badge for successful fetch', () => {
    render(<DocSourceSection />);
    expect(screen.getByText('Success')).toBeInTheDocument();
  });

  it('shows "Not fetched" for sources without fetch history', () => {
    render(<DocSourceSection />);
    expect(screen.getByText('Not fetched')).toBeInTheDocument();
  });

  it('handles delete source', async () => {
    const user = userEvent.setup();
    mockDeleteSource.mockResolvedValue(undefined);

    render(<DocSourceSection />);

    const deleteButtons = screen.getAllByTitle('Delete');
    await user.click(deleteButtons[0]);

    await waitFor(() => {
      expect(mockDeleteSource).toHaveBeenCalledWith('ds-1');
    });
  });

  it('handles trigger fetch', async () => {
    const user = userEvent.setup();
    mockTriggerFetch.mockResolvedValue({ id: 'task-1', status: 'completed' });

    render(<DocSourceSection />);

    const fetchButtons = screen.getAllByTitle('Fetch now');
    await user.click(fetchButtons[0]);

    await waitFor(() => {
      expect(mockTriggerFetch).toHaveBeenCalledWith('ds-1');
    });
  });
});
