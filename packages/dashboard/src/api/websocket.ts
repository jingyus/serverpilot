import {
  type Message,
  type MessageType,
  safeParseMessage,
  createMessage,
} from '@aiinstaller/shared';
import { WS_URL } from '@/utils/constants';
import { useWebSocketStore } from '@/stores/websocket';

// ============================================================================
// Types
// ============================================================================

export type MessageHandler = (message: Message) => void;

export interface WebSocketClientOptions {
  url?: string;
  /** Reconnect delays in ms (exponential backoff sequence) */
  reconnectDelays?: number[];
  /** Max reconnect delay in ms */
  maxReconnectDelay?: number;
  /** Heartbeat interval in ms */
  heartbeatInterval?: number;
  /** Heartbeat response timeout in ms */
  heartbeatTimeout?: number;
}

const DEFAULT_OPTIONS: Required<WebSocketClientOptions> = {
  url: WS_URL,
  reconnectDelays: [0, 2000, 4000, 8000, 16000, 32000],
  maxReconnectDelay: 300_000,
  heartbeatInterval: 30_000,
  heartbeatTimeout: 10_000,
};

// ============================================================================
// WebSocket Client
// ============================================================================

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private options: Required<WebSocketClientOptions>;
  private handlers = new Map<string, Set<MessageHandler>>();
  private wildcardHandlers = new Set<MessageHandler>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private pendingRequests = new Map<
    string,
    { resolve: (msg: Message) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(options: WebSocketClientOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  // --------------------------------------------------------------------------
  // Connection lifecycle
  // --------------------------------------------------------------------------

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    this.intentionalClose = false;
    const store = useWebSocketStore.getState();
    store.setStatus('connecting');

    const token = localStorage.getItem('auth_token');
    const url = token ? `${this.options.url}?token=${encodeURIComponent(token)}` : this.options.url;

    this.ws = new WebSocket(url);
    this.ws.onopen = this.handleOpen;
    this.ws.onmessage = this.handleMessage;
    this.ws.onclose = this.handleClose;
    this.ws.onerror = this.handleError;
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.cleanup();
    const store = useWebSocketStore.getState();
    store.setDisconnected();
  }

  // --------------------------------------------------------------------------
  // Message sending
  // --------------------------------------------------------------------------

  send<T extends Message['type']>(
    type: T,
    payload: Extract<Message, { type: T }>['payload'],
    requestId?: string,
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = createMessage(type, payload as any, requestId);
    this.sendRaw(msg);
  }

  sendRaw(message: Message): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Send a message and wait for a response matching the requestId.
   * Rejects after `timeoutMs` (default 5000).
   */
  request<T extends Message['type']>(
    type: T,
    payload: Extract<Message, { type: T }>['payload'],
    timeoutMs = 5000,
  ): Promise<Message> {
    const requestId = crypto.randomUUID();
    return new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request ${type} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timer });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.send(type, payload as any, requestId);
    });
  }

  // --------------------------------------------------------------------------
  // Event subscription
  // --------------------------------------------------------------------------

  /** Subscribe to a specific message type */
  on(type: MessageType, handler: MessageHandler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  /** Subscribe to all messages */
  onAny(handler: MessageHandler): () => void {
    this.wildcardHandlers.add(handler);
    return () => this.wildcardHandlers.delete(handler);
  }

  /** Remove all handlers */
  offAll(): void {
    this.handlers.clear();
    this.wildcardHandlers.clear();
  }

  // --------------------------------------------------------------------------
  // State accessors
  // --------------------------------------------------------------------------

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  // --------------------------------------------------------------------------
  // Internal event handlers (arrow functions to preserve `this`)
  // --------------------------------------------------------------------------

  private handleOpen = (): void => {
    this.reconnectAttempt = 0;
    const store = useWebSocketStore.getState();
    store.setConnected();
    this.startHeartbeat();
  };

  private handleMessage = (event: MessageEvent): void => {
    const raw = typeof event.data === 'string' ? event.data : '';
    if (!raw) return;

    // Handle pong frames (heartbeat response)
    if (raw === 'pong') {
      this.clearHeartbeatTimeout();
      return;
    }

    const result = safeParseMessage(JSON.parse(raw));
    if (!result.success) {
      console.warn('[WebSocket] Invalid message:', result.error);
      return;
    }

    const message = result.data;

    // Resolve pending request-response if matched
    if (message.requestId && this.pendingRequests.has(message.requestId)) {
      const pending = this.pendingRequests.get(message.requestId)!;
      clearTimeout(pending.timer);
      this.pendingRequests.delete(message.requestId);
      pending.resolve(message);
    }

    // Dispatch to type-specific handlers
    const typeHandlers = this.handlers.get(message.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        handler(message);
      }
    }

    // Dispatch to wildcard handlers
    for (const handler of this.wildcardHandlers) {
      handler(message);
    }
  };

  private handleClose = (event: CloseEvent): void => {
    this.stopHeartbeat();

    if (this.intentionalClose) return;

    const store = useWebSocketStore.getState();
    store.setDisconnected(event.reason || `Connection closed (code: ${event.code})`);
    this.scheduleReconnect();
  };

  private handleError = (): void => {
    // The close event will fire after error, so reconnect is handled there
    const store = useWebSocketStore.getState();
    store.setDisconnected('Connection error');
  };

  // --------------------------------------------------------------------------
  // Reconnection logic
  // --------------------------------------------------------------------------

  private scheduleReconnect(): void {
    if (this.intentionalClose) return;

    this.reconnectAttempt++;
    const store = useWebSocketStore.getState();
    store.setReconnecting(this.reconnectAttempt);

    const delays = this.options.reconnectDelays;
    const delay =
      this.reconnectAttempt <= delays.length
        ? delays[this.reconnectAttempt - 1]
        : Math.min(
            delays[delays.length - 1] * 2 ** (this.reconnectAttempt - delays.length),
            this.options.maxReconnectDelay,
          );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // --------------------------------------------------------------------------
  // Heartbeat
  // --------------------------------------------------------------------------

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('ping');
        this.heartbeatTimeoutTimer = setTimeout(() => {
          // No pong received — force close to trigger reconnect
          this.ws?.close(4000, 'Heartbeat timeout');
        }, this.options.heartbeatTimeout);
      }
    }, this.options.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clearHeartbeatTimeout();
  }

  private clearHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  private cleanup(): void {
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('WebSocket disconnected'));
      this.pendingRequests.delete(id);
    }

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'Client disconnect');
      }
      this.ws = null;
    }
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

let instance: WebSocketClient | null = null;

export function getWebSocketClient(options?: WebSocketClientOptions): WebSocketClient {
  if (!instance) {
    instance = new WebSocketClient(options);
  }
  return instance;
}

export function resetWebSocketClient(): void {
  if (instance) {
    instance.disconnect();
    instance.offAll();
    instance = null;
  }
}
