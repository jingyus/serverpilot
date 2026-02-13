// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SystemStatus } from './SystemStatus';
import { useSettingsStore } from '@/stores/settings';
import type { HealthDetailResponse } from '@/types/dashboard';

vi.mock('@/stores/settings');
const mockUseSettingsStore = vi.mocked(useSettingsStore);

const makeHealthy: HealthDetailResponse = {
  status: 'healthy',
  timestamp: Date.now(),
  subsystems: {
    aiProvider: { status: 'healthy', provider: 'claude' },
    database: { status: 'healthy', type: 'sqlite' },
    websocket: { status: 'healthy', connections: 3, maxConnections: 100 },
    rag: { status: 'healthy', indexedDocs: 10 },
  },
};

const makeDegraded: HealthDetailResponse = {
  status: 'degraded',
  timestamp: Date.now(),
  subsystems: {
    aiProvider: { status: 'unhealthy', message: 'No AI provider configured' },
    database: { status: 'healthy', type: 'sqlite' },
    websocket: { status: 'healthy', connections: 1, maxConnections: 100 },
    rag: { status: 'healthy', indexedDocs: 5 },
  },
};

const makeUnhealthy: HealthDetailResponse = {
  status: 'unhealthy',
  timestamp: Date.now(),
  subsystems: {
    aiProvider: { status: 'unhealthy', message: 'No AI provider configured' },
    database: { status: 'unhealthy', type: 'sqlite', message: 'Database not initialized' },
    websocket: { status: 'unhealthy', connections: 0, maxConnections: 0, message: 'WebSocket server not initialized' },
    rag: { status: 'unhealthy', indexedDocs: 0, message: 'RAG pipeline not initialized' },
  },
};

const defaultStoreValue = {
  settings: null,
  isLoading: false,
  error: null,
  isSaving: false,
  healthStatus: null,
  isCheckingHealth: false,
  systemHealth: null as HealthDetailResponse | null,
  isCheckingSystemHealth: false,
  fetchSettings: vi.fn(),
  updateAIProvider: vi.fn(),
  updateUserProfile: vi.fn(),
  updateNotifications: vi.fn(),
  updateKnowledgeBase: vi.fn(),
  checkProviderHealth: vi.fn(),
  fetchHealthDetail: vi.fn(),
  clearError: vi.fn(),
};

describe('SystemStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSettingsStore.mockReturnValue({ ...defaultStoreValue });
  });

  it('should call fetchHealthDetail on mount', () => {
    const fetchHealthDetail = vi.fn();
    mockUseSettingsStore.mockReturnValue({ ...defaultStoreValue, fetchHealthDetail });

    render(<SystemStatus />);

    expect(fetchHealthDetail).toHaveBeenCalledTimes(1);
  });

  it('should show loading spinner when checking and no data', () => {
    mockUseSettingsStore.mockReturnValue({
      ...defaultStoreValue,
      isCheckingSystemHealth: true,
    });

    const { container } = render(<SystemStatus />);
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('should render all subsystems when healthy', () => {
    mockUseSettingsStore.mockReturnValue({
      ...defaultStoreValue,
      systemHealth: makeHealthy,
    });

    render(<SystemStatus />);

    expect(screen.getByText('System Status')).toBeInTheDocument();
    expect(screen.getByTestId('system-health-overall')).toHaveTextContent('All systems operational');
    expect(screen.getByTestId('subsystem-ai-provider')).toBeInTheDocument();
    expect(screen.getByTestId('subsystem-database')).toBeInTheDocument();
    expect(screen.getByTestId('subsystem-websocket')).toBeInTheDocument();
    expect(screen.getByTestId('subsystem-rag-pipeline')).toBeInTheDocument();
  });

  it('should show green dots for healthy subsystems', () => {
    mockUseSettingsStore.mockReturnValue({
      ...defaultStoreValue,
      systemHealth: makeHealthy,
    });

    render(<SystemStatus />);

    const healthyDots = screen.getAllByTestId('status-dot-healthy');
    expect(healthyDots).toHaveLength(4);
  });

  it('should show degraded status when some subsystems are unhealthy', () => {
    mockUseSettingsStore.mockReturnValue({
      ...defaultStoreValue,
      systemHealth: makeDegraded,
    });

    render(<SystemStatus />);

    expect(screen.getByTestId('system-health-overall')).toHaveTextContent('Some systems degraded');
    expect(screen.getByTestId('status-dot-unhealthy')).toBeInTheDocument();
    expect(screen.getAllByTestId('status-dot-healthy')).toHaveLength(3);
  });

  it('should show config hint link when AI Provider is unhealthy', () => {
    mockUseSettingsStore.mockReturnValue({
      ...defaultStoreValue,
      systemHealth: makeDegraded,
    });

    render(<SystemStatus />);

    const configLink = screen.getByTestId('config-hint-link');
    expect(configLink).toBeInTheDocument();
    expect(configLink).toHaveTextContent('Configure');
  });

  it('should show unhealthy status when all subsystems are down', () => {
    mockUseSettingsStore.mockReturnValue({
      ...defaultStoreValue,
      systemHealth: makeUnhealthy,
    });

    render(<SystemStatus />);

    expect(screen.getByTestId('system-health-overall')).toHaveTextContent('All systems down');
    expect(screen.getAllByTestId('status-dot-unhealthy')).toHaveLength(4);
  });

  it('should trigger refresh when clicking refresh button', async () => {
    const user = userEvent.setup();
    const fetchHealthDetail = vi.fn();
    mockUseSettingsStore.mockReturnValue({
      ...defaultStoreValue,
      systemHealth: makeHealthy,
      fetchHealthDetail,
    });

    render(<SystemStatus />);

    // One call from mount
    expect(fetchHealthDetail).toHaveBeenCalledTimes(1);

    const refreshButton = screen.getByRole('button', { name: /Refresh system status/i });
    await user.click(refreshButton);

    expect(fetchHealthDetail).toHaveBeenCalledTimes(2);
  });

  it('should show unavailable state when no data and not loading', () => {
    mockUseSettingsStore.mockReturnValue({
      ...defaultStoreValue,
      systemHealth: null,
      isCheckingSystemHealth: false,
    });

    render(<SystemStatus />);

    expect(screen.getByText('Unable to retrieve system status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh system status/i })).toBeInTheDocument();
  });

  it('should display subsystem descriptions correctly', () => {
    mockUseSettingsStore.mockReturnValue({
      ...defaultStoreValue,
      systemHealth: makeHealthy,
    });

    render(<SystemStatus />);

    expect(screen.getByText('claude')).toBeInTheDocument();
    expect(screen.getByText('SQLITE')).toBeInTheDocument();
    expect(screen.getByText('3/100 connections')).toBeInTheDocument();
    expect(screen.getByText('10 documents indexed')).toBeInTheDocument();
  });

  it('should display last checked timestamp', () => {
    const timestamp = new Date(2026, 1, 13, 14, 30, 0).getTime();
    mockUseSettingsStore.mockReturnValue({
      ...defaultStoreValue,
      systemHealth: { ...makeHealthy, timestamp },
    });

    render(<SystemStatus />);

    expect(screen.getByText(/Last checked/)).toBeInTheDocument();
  });

  it('should disable refresh button while checking', () => {
    mockUseSettingsStore.mockReturnValue({
      ...defaultStoreValue,
      systemHealth: makeHealthy,
      isCheckingSystemHealth: true,
    });

    render(<SystemStatus />);

    const refreshButton = screen.getByRole('button', { name: /Refresh system status/i });
    expect(refreshButton).toBeDisabled();
  });
});
