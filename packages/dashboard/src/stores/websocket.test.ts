// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach } from 'vitest';
import { useWebSocketStore } from './websocket';

describe('useWebSocketStore', () => {
  beforeEach(() => {
    useWebSocketStore.getState().reset();
  });

  describe('initial state', () => {
    it('starts disconnected', () => {
      expect(useWebSocketStore.getState().status).toBe('disconnected');
    });

    it('has no timestamps', () => {
      const state = useWebSocketStore.getState();
      expect(state.lastConnectedAt).toBeNull();
      expect(state.lastDisconnectedAt).toBeNull();
    });

    it('has zero reconnect attempts', () => {
      expect(useWebSocketStore.getState().reconnectAttempt).toBe(0);
    });

    it('has no error', () => {
      expect(useWebSocketStore.getState().error).toBeNull();
    });
  });

  describe('setStatus', () => {
    it('sets connection status', () => {
      useWebSocketStore.getState().setStatus('connecting');
      expect(useWebSocketStore.getState().status).toBe('connecting');
    });
  });

  describe('setConnected', () => {
    it('sets status to connected', () => {
      useWebSocketStore.getState().setConnected();
      expect(useWebSocketStore.getState().status).toBe('connected');
    });

    it('records connection timestamp', () => {
      useWebSocketStore.getState().setConnected();
      expect(useWebSocketStore.getState().lastConnectedAt).toBeTruthy();
    });

    it('resets reconnect attempts', () => {
      useWebSocketStore.setState({ reconnectAttempt: 5 });
      useWebSocketStore.getState().setConnected();
      expect(useWebSocketStore.getState().reconnectAttempt).toBe(0);
    });

    it('clears error', () => {
      useWebSocketStore.setState({ error: 'Connection refused' });
      useWebSocketStore.getState().setConnected();
      expect(useWebSocketStore.getState().error).toBeNull();
    });
  });

  describe('setDisconnected', () => {
    it('sets status to disconnected', () => {
      useWebSocketStore.setState({ status: 'connected' });
      useWebSocketStore.getState().setDisconnected();
      expect(useWebSocketStore.getState().status).toBe('disconnected');
    });

    it('records disconnection timestamp', () => {
      useWebSocketStore.getState().setDisconnected();
      expect(useWebSocketStore.getState().lastDisconnectedAt).toBeTruthy();
    });

    it('sets error message when provided', () => {
      useWebSocketStore.getState().setDisconnected('Connection lost');
      expect(useWebSocketStore.getState().error).toBe('Connection lost');
    });

    it('sets error to null when not provided', () => {
      useWebSocketStore.setState({ error: 'old error' });
      useWebSocketStore.getState().setDisconnected();
      expect(useWebSocketStore.getState().error).toBeNull();
    });
  });

  describe('setReconnecting', () => {
    it('sets status to reconnecting', () => {
      useWebSocketStore.getState().setReconnecting(1);
      expect(useWebSocketStore.getState().status).toBe('reconnecting');
    });

    it('tracks reconnect attempt number', () => {
      useWebSocketStore.getState().setReconnecting(3);
      expect(useWebSocketStore.getState().reconnectAttempt).toBe(3);
    });

    it('increments attempt on each call', () => {
      useWebSocketStore.getState().setReconnecting(1);
      expect(useWebSocketStore.getState().reconnectAttempt).toBe(1);

      useWebSocketStore.getState().setReconnecting(2);
      expect(useWebSocketStore.getState().reconnectAttempt).toBe(2);
    });
  });

  describe('clearError', () => {
    it('clears the error', () => {
      useWebSocketStore.setState({ error: 'Some error' });
      useWebSocketStore.getState().clearError();
      expect(useWebSocketStore.getState().error).toBeNull();
    });
  });

  describe('reset', () => {
    it('resets all state to initial values', () => {
      useWebSocketStore.setState({
        status: 'connected',
        lastConnectedAt: '2026-01-01T00:00:00Z',
        lastDisconnectedAt: '2026-01-01T01:00:00Z',
        reconnectAttempt: 5,
        error: 'Some error',
      });

      useWebSocketStore.getState().reset();

      const state = useWebSocketStore.getState();
      expect(state.status).toBe('disconnected');
      expect(state.lastConnectedAt).toBeNull();
      expect(state.lastDisconnectedAt).toBeNull();
      expect(state.reconnectAttempt).toBe(0);
      expect(state.error).toBeNull();
    });
  });

  describe('connection lifecycle', () => {
    it('transitions through full lifecycle', () => {
      const store = useWebSocketStore.getState;

      // Start connecting
      store().setStatus('connecting');
      expect(store().status).toBe('connecting');

      // Connected successfully
      store().setConnected();
      expect(store().status).toBe('connected');
      expect(store().lastConnectedAt).toBeTruthy();

      // Disconnected with error
      store().setDisconnected('Server closed connection');
      expect(store().status).toBe('disconnected');
      expect(store().error).toBe('Server closed connection');

      // Reconnecting
      store().setReconnecting(1);
      expect(store().status).toBe('reconnecting');
      expect(store().reconnectAttempt).toBe(1);

      // Reconnected
      store().setConnected();
      expect(store().status).toBe('connected');
      expect(store().reconnectAttempt).toBe(0);
      expect(store().error).toBeNull();
    });
  });
});
