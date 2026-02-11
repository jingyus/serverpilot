// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketClient, getWebSocketClient, resetWebSocketClient } from './websocket';
import { MessageType, createMessage } from '@aiinstaller/shared';
import { useWebSocketStore } from '@/stores/websocket';

// ============================================================================
// Mock WebSocket
// ============================================================================

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  url: string;
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent('close', { code: code ?? 1000, reason: reason ?? '' }));
    }
  }

  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  simulateMessage(data: string): void {
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  simulateError(): void {
    this.onerror?.(new Event('error'));
  }

  simulateClose(code = 1000, reason = ''): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code, reason }));
  }
}

let mockWsInstances: MockWebSocket[] = [];

vi.stubGlobal(
  'WebSocket',
  Object.assign(
    function MockWebSocketConstructor(url: string) {
      const instance = new MockWebSocket(url);
      mockWsInstances.push(instance);
      return instance;
    } as unknown as typeof WebSocket,
    {
      CONNECTING: 0,
      OPEN: 1,
      CLOSING: 2,
      CLOSED: 3,
    },
  ),
);

vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-1234' });

// ============================================================================
// Tests
// ============================================================================

describe('WebSocketClient', () => {
  let client: WebSocketClient;

  beforeEach(() => {
    vi.useFakeTimers();
    mockWsInstances = [];
    localStorage.clear();
    useWebSocketStore.getState().reset();
    client = new WebSocketClient({ url: 'ws://test/ws' });
  });

  afterEach(() => {
    client.disconnect();
    client.offAll();
    resetWebSocketClient();
    vi.useRealTimers();
  });

  function latestWs(): MockWebSocket {
    return mockWsInstances[mockWsInstances.length - 1];
  }

  // --------------------------------------------------------------------------
  // Connection
  // --------------------------------------------------------------------------

  describe('connect', () => {
    it('should create a WebSocket connection', () => {
      client.connect();
      expect(mockWsInstances).toHaveLength(1);
      expect(latestWs().url).toBe('ws://test/ws');
    });

    it('should append auth token as query param when available', () => {
      localStorage.setItem('auth_token', 'my-jwt-token');
      client.connect();
      expect(latestWs().url).toBe('ws://test/ws?token=my-jwt-token');
    });

    it('should set store status to connecting', () => {
      client.connect();
      expect(useWebSocketStore.getState().status).toBe('connecting');
    });

    it('should not create duplicate connections', () => {
      client.connect();
      latestWs().readyState = MockWebSocket.OPEN;
      client.connect();
      expect(mockWsInstances).toHaveLength(1);
    });

    it('should set store status to connected on open', () => {
      client.connect();
      latestWs().simulateOpen();
      const state = useWebSocketStore.getState();
      expect(state.status).toBe('connected');
      expect(state.lastConnectedAt).not.toBeNull();
      expect(state.reconnectAttempt).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Disconnect
  // --------------------------------------------------------------------------

  describe('disconnect', () => {
    it('should close the WebSocket and update store', () => {
      client.connect();
      latestWs().simulateOpen();
      client.disconnect();
      expect(useWebSocketStore.getState().status).toBe('disconnected');
    });

    it('should not attempt reconnect after intentional disconnect', () => {
      client.connect();
      latestWs().simulateOpen();
      client.disconnect();
      vi.advanceTimersByTime(60_000);
      // Only the initial connection should exist
      expect(mockWsInstances).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // Sending messages
  // --------------------------------------------------------------------------

  describe('send', () => {
    it('should send a typed message as JSON', () => {
      client.connect();
      latestWs().simulateOpen();
      client.send(MessageType.SESSION_CREATE, { software: 'nginx' });
      const sent = JSON.parse(latestWs().sentMessages[0]);
      expect(sent.type).toBe('session.create');
      expect(sent.payload.software).toBe('nginx');
      expect(sent.timestamp).toBeTypeOf('number');
    });

    it('should throw when not connected', () => {
      expect(() => client.send(MessageType.SESSION_CREATE, { software: 'nginx' })).toThrow(
        'WebSocket is not connected',
      );
    });

    it('should include requestId when provided', () => {
      client.connect();
      latestWs().simulateOpen();
      client.send(MessageType.SESSION_CREATE, { software: 'nginx' }, 'req-123');
      const sent = JSON.parse(latestWs().sentMessages[0]);
      expect(sent.requestId).toBe('req-123');
    });
  });

  // --------------------------------------------------------------------------
  // Receiving messages
  // --------------------------------------------------------------------------

  describe('message handling', () => {
    it('should dispatch to type-specific handlers', () => {
      const handler = vi.fn();
      client.on(MessageType.PLAN_RECEIVE, handler);
      client.connect();
      latestWs().simulateOpen();

      const msg = createMessage(MessageType.PLAN_RECEIVE, {
        steps: [],
        estimatedTime: 60,
        risks: [],
      });
      latestWs().simulateMessage(JSON.stringify(msg));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(msg);
    });

    it('should dispatch to wildcard handlers', () => {
      const handler = vi.fn();
      client.onAny(handler);
      client.connect();
      latestWs().simulateOpen();

      const msg = createMessage(MessageType.SESSION_COMPLETE, {
        success: true,
        summary: 'done',
      });
      latestWs().simulateMessage(JSON.stringify(msg));

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should ignore invalid messages', () => {
      const handler = vi.fn();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      client.onAny(handler);
      client.connect();
      latestWs().simulateOpen();

      latestWs().simulateMessage(JSON.stringify({ type: 'invalid.type', payload: {} }));

      expect(handler).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('should handle pong heartbeat responses', () => {
      const handler = vi.fn();
      client.onAny(handler);
      client.connect();
      latestWs().simulateOpen();

      latestWs().simulateMessage('pong');
      expect(handler).not.toHaveBeenCalled();
    });

    it('should ignore empty messages', () => {
      const handler = vi.fn();
      client.onAny(handler);
      client.connect();
      latestWs().simulateOpen();

      latestWs().simulateMessage('');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Event subscription
  // --------------------------------------------------------------------------

  describe('event subscription', () => {
    it('should unsubscribe when calling the returned function', () => {
      const handler = vi.fn();
      const unsubscribe = client.on(MessageType.PLAN_RECEIVE, handler);
      client.connect();
      latestWs().simulateOpen();

      unsubscribe();

      const msg = createMessage(MessageType.PLAN_RECEIVE, {
        steps: [],
        estimatedTime: 60,
        risks: [],
      });
      latestWs().simulateMessage(JSON.stringify(msg));
      expect(handler).not.toHaveBeenCalled();
    });

    it('should clear all handlers with offAll', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      client.on(MessageType.PLAN_RECEIVE, h1);
      client.onAny(h2);
      client.connect();
      latestWs().simulateOpen();

      client.offAll();

      const msg = createMessage(MessageType.PLAN_RECEIVE, {
        steps: [],
        estimatedTime: 60,
        risks: [],
      });
      latestWs().simulateMessage(JSON.stringify(msg));
      expect(h1).not.toHaveBeenCalled();
      expect(h2).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Request-response
  // --------------------------------------------------------------------------

  describe('request', () => {
    it('should resolve when a matching requestId response arrives', async () => {
      client.connect();
      latestWs().simulateOpen();

      const promise = client.request(MessageType.SESSION_CREATE, { software: 'nginx' });

      // Server responds with matching requestId
      const response = createMessage(
        MessageType.AUTH_RESPONSE,
        { success: true },
        'test-uuid-1234',
      );
      latestWs().simulateMessage(JSON.stringify(response));

      const result = await promise;
      expect(result.type).toBe(MessageType.AUTH_RESPONSE);
    });

    it('should reject on timeout', async () => {
      client.connect();
      latestWs().simulateOpen();

      const promise = client.request(MessageType.SESSION_CREATE, { software: 'nginx' }, 1000);

      vi.advanceTimersByTime(1001);

      await expect(promise).rejects.toThrow('timed out');
    });
  });

  // --------------------------------------------------------------------------
  // Reconnection
  // --------------------------------------------------------------------------

  describe('reconnection', () => {
    it('should reconnect after unexpected close', () => {
      client.connect();
      latestWs().simulateOpen();
      latestWs().simulateClose(1006, 'Abnormal closure');

      expect(useWebSocketStore.getState().status).toBe('reconnecting');
      expect(useWebSocketStore.getState().reconnectAttempt).toBe(1);

      // First reconnect has 0ms delay
      vi.advanceTimersByTime(0);
      expect(mockWsInstances).toHaveLength(2);
    });

    it('should use exponential backoff for subsequent attempts', () => {
      client.connect();
      latestWs().simulateOpen();

      // First close
      latestWs().simulateClose(1006);
      vi.advanceTimersByTime(0); // delay[0] = 0
      expect(mockWsInstances).toHaveLength(2);

      // Second close
      latestWs().simulateClose(1006);
      vi.advanceTimersByTime(2000); // delay[1] = 2000
      expect(mockWsInstances).toHaveLength(3);

      // Third close
      latestWs().simulateClose(1006);
      vi.advanceTimersByTime(4000); // delay[2] = 4000
      expect(mockWsInstances).toHaveLength(4);
    });

    it('should reset reconnect attempt on successful connection', () => {
      client.connect();
      latestWs().simulateOpen();
      latestWs().simulateClose(1006);

      vi.advanceTimersByTime(0);
      latestWs().simulateOpen();

      expect(useWebSocketStore.getState().reconnectAttempt).toBe(0);
    });

    it('should cap reconnect delay at maxReconnectDelay', () => {
      const c = new WebSocketClient({
        url: 'ws://test/ws',
        reconnectDelays: [100],
        maxReconnectDelay: 500,
      });
      c.connect();
      latestWs().simulateOpen();

      // Close many times to exceed the delays array
      for (let i = 0; i < 20; i++) {
        latestWs().simulateClose(1006);
        vi.advanceTimersByTime(500); // max delay
        latestWs().simulateOpen();
      }

      // Should still be connected, delay never exceeded max
      expect(useWebSocketStore.getState().status).toBe('connected');
      c.disconnect();
    });
  });

  // --------------------------------------------------------------------------
  // Heartbeat
  // --------------------------------------------------------------------------

  describe('heartbeat', () => {
    it('should send ping at configured interval', () => {
      const c = new WebSocketClient({
        url: 'ws://test/ws',
        heartbeatInterval: 5000,
        heartbeatTimeout: 2000,
      });
      c.connect();
      latestWs().simulateOpen();

      vi.advanceTimersByTime(5000);
      expect(latestWs().sentMessages).toContain('ping');
      c.disconnect();
    });

    it('should close connection on heartbeat timeout', () => {
      const c = new WebSocketClient({
        url: 'ws://test/ws',
        heartbeatInterval: 5000,
        heartbeatTimeout: 2000,
      });
      c.connect();
      latestWs().simulateOpen();

      vi.advanceTimersByTime(5000); // sends ping
      vi.advanceTimersByTime(2000); // timeout — should force close

      expect(useWebSocketStore.getState().status).toBe('reconnecting');
      c.disconnect();
    });

    it('should not force close when pong is received', () => {
      const c = new WebSocketClient({
        url: 'ws://test/ws',
        heartbeatInterval: 5000,
        heartbeatTimeout: 2000,
      });
      c.connect();
      latestWs().simulateOpen();

      vi.advanceTimersByTime(5000); // sends ping
      latestWs().simulateMessage('pong'); // pong received
      vi.advanceTimersByTime(2000); // timeout should have been cleared

      expect(useWebSocketStore.getState().status).toBe('connected');
      c.disconnect();
    });
  });

  // --------------------------------------------------------------------------
  // State accessors
  // --------------------------------------------------------------------------

  describe('state accessors', () => {
    it('should report connected state', () => {
      expect(client.connected).toBe(false);
      client.connect();
      latestWs().simulateOpen();
      expect(client.connected).toBe(true);
    });

    it('should report readyState', () => {
      expect(client.readyState).toBe(WebSocket.CLOSED);
      client.connect();
      expect(client.readyState).toBe(WebSocket.CONNECTING);
      latestWs().simulateOpen();
      expect(client.readyState).toBe(WebSocket.OPEN);
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe('error handling', () => {
    it('should update store on connection error', () => {
      client.connect();
      latestWs().simulateError();
      expect(useWebSocketStore.getState().error).toBe('Connection error');
    });

    it('should reject pending requests on disconnect', async () => {
      client.connect();
      latestWs().simulateOpen();

      const promise = client.request(MessageType.SESSION_CREATE, { software: 'nginx' });
      client.disconnect();

      await expect(promise).rejects.toThrow('WebSocket disconnected');
    });
  });

  // --------------------------------------------------------------------------
  // Singleton
  // --------------------------------------------------------------------------

  describe('singleton', () => {
    it('should return the same instance', () => {
      const a = getWebSocketClient({ url: 'ws://test/ws' });
      const b = getWebSocketClient();
      expect(a).toBe(b);
    });

    it('should reset and create new instance', () => {
      const a = getWebSocketClient({ url: 'ws://test/ws' });
      resetWebSocketClient();
      const b = getWebSocketClient({ url: 'ws://test/ws' });
      expect(a).not.toBe(b);
    });
  });
});
