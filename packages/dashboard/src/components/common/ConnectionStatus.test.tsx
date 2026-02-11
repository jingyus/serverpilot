// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useWebSocketStore } from '@/stores/websocket';
import { ConnectionStatus } from './ConnectionStatus';

describe('ConnectionStatus', () => {
  beforeEach(() => {
    useWebSocketStore.setState({
      status: 'disconnected',
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      reconnectAttempt: 0,
      error: null,
    });
  });

  it('renders disconnected state', () => {
    render(<ConnectionStatus />);
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    const indicator = screen.getByTestId('connection-indicator');
    expect(indicator.className).toContain('bg-red-500');
  });

  it('renders connected state', () => {
    useWebSocketStore.setState({ status: 'connected' });
    render(<ConnectionStatus />);
    expect(screen.getByText('Connected')).toBeInTheDocument();
    const indicator = screen.getByTestId('connection-indicator');
    expect(indicator.className).toContain('bg-green-500');
  });

  it('renders connecting state', () => {
    useWebSocketStore.setState({ status: 'connecting' });
    render(<ConnectionStatus />);
    expect(screen.getByText('Connecting...')).toBeInTheDocument();
    const indicator = screen.getByTestId('connection-indicator');
    expect(indicator.className).toContain('bg-yellow-500');
    expect(indicator.className).toContain('animate-pulse');
  });

  it('renders reconnecting state', () => {
    useWebSocketStore.setState({ status: 'reconnecting', reconnectAttempt: 3 });
    render(<ConnectionStatus />);
    expect(screen.getByText('Reconnecting...')).toBeInTheDocument();
    const indicator = screen.getByTestId('connection-indicator');
    expect(indicator.className).toContain('bg-yellow-500');
    expect(indicator.className).toContain('animate-pulse');
  });
});
