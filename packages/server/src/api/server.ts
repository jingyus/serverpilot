/**
 * WebSocket server for AI Installer.
 *
 * Manages WebSocket connections, sessions, and heartbeat mechanism.
 * Handles message routing between connected agents and the server.
 *
 * @module api/server
 */

import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';

import { WebSocketServer } from 'ws';
import type { WebSocket as WsWebSocket } from 'ws';

import type { Message, SessionCreateMessage } from '@aiinstaller/shared';
import { safeParseMessage } from '@aiinstaller/shared';
import { SessionStatus } from '@aiinstaller/shared';
import type { SessionInfo } from '@aiinstaller/shared';

// ============================================================================
// Types
// ============================================================================

/** Configuration options for the InstallServer */
export interface InstallServerOptions {
  /** Port to listen on */
  port: number;
  /** Heartbeat interval in milliseconds (default: 30000) */
  heartbeatIntervalMs?: number;
  /** Connection timeout in milliseconds - close if no pong received (default: 10000) */
  connectionTimeoutMs?: number;
  /** Host to bind to (default: '0.0.0.0') */
  host?: string;
  /** Require authentication for all connections (default: true) */
  requireAuth?: boolean;
  /** Authentication timeout in milliseconds (default: 10000) */
  authTimeoutMs?: number;
  /** Maximum concurrent connections allowed (default: 100) */
  maxConnections?: number;
}

/** Internal client tracking data */
interface ClientInfo {
  /** Unique client identifier */
  id: string;
  /** The WebSocket connection */
  ws: WsWebSocket;
  /** Whether we are waiting for a pong response */
  isAlive: boolean;
  /** Whether client is authenticated */
  authenticated: boolean;
  /** Device ID from authentication */
  deviceId?: string;
  /** Device token from authentication */
  deviceToken?: string;
  /** Session ID associated with this client (if any) */
  sessionId?: string;
  /** Timestamp when the client connected */
  connectedAt: number;
  /** Timestamp when authentication completed */
  authenticatedAt?: number;
}

/** Events emitted by the InstallServer */
export interface InstallServerEvents {
  /** Emitted when a new client connects */
  connection: (clientId: string) => void;
  /** Emitted when a client disconnects */
  disconnect: (clientId: string) => void;
  /** Emitted when a valid message is received */
  message: (clientId: string, message: Message) => void;
  /** Emitted when a message fails validation */
  error: (clientId: string, error: Error) => void;
}

// ============================================================================
// InstallServer
// ============================================================================

/**
 * WebSocket server for managing installation sessions.
 *
 * Provides connection management, session tracking, and heartbeat mechanism
 * for real-time communication between the server and agent clients.
 *
 * @example
 * ```ts
 * const server = new InstallServer({ port: 3000 });
 * server.on('message', (clientId, msg) => {
 *   console.log(`Received ${msg.type} from ${clientId}`);
 * });
 * server.start();
 * ```
 */
export class InstallServer {
  private wss: WebSocketServer | null = null;
  private httpServer: HttpServer | null = null;
  private clients: Map<string, ClientInfo> = new Map();
  private sessions: Map<string, SessionInfo> = new Map();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Partial<{
    [K in keyof InstallServerEvents]: InstallServerEvents[K][];
  }> = {};

  private readonly port: number;
  private readonly host: string;
  private readonly heartbeatIntervalMs: number;
  private readonly connectionTimeoutMs: number;
  private readonly requireAuth: boolean;
  private readonly authTimeoutMs: number;
  private readonly maxConnections: number;

  constructor(options: InstallServerOptions) {
    this.port = options.port;
    this.host = options.host ?? '0.0.0.0';
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30000;
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? 10000;
    this.requireAuth = options.requireAuth ?? true;
    this.authTimeoutMs = options.authTimeoutMs ?? 10000;
    this.maxConnections = options.maxConnections ?? 100;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Start the WebSocket server and begin accepting connections.
   *
   * When an HTTP server is provided, the WebSocket server will attach to it
   * and handle upgrade requests (sharing the same port). Otherwise, it will
   * create a standalone WebSocket server on the configured port.
   *
   * @param httpServer - Optional HTTP server to attach to for port sharing
   * @returns A promise that resolves when the server is listening
   */
  start(httpServer?: HttpServer): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.wss) {
        reject(new Error('Server is already running'));
        return;
      }

      if (httpServer) {
        // Attach to existing HTTP server (noServer mode)
        this.wss = new WebSocketServer({ noServer: true });
        this.httpServer = httpServer;

        httpServer.on('upgrade', (request, socket, head) => {
          this.wss!.handleUpgrade(request, socket, head, (ws) => {
            this.wss!.emit('connection', ws, request);
          });
        });

        this.wss.on('connection', (ws) => {
          this.handleConnection(ws);
        });

        this.startHeartbeat();
        resolve();
      } else {
        // Standalone mode (backward compatible)
        this.wss = new WebSocketServer({
          port: this.port,
          host: this.host,
        });

        this.wss.on('listening', () => {
          this.startHeartbeat();
          resolve();
        });

        this.wss.on('error', (error) => {
          reject(error);
        });

        this.wss.on('connection', (ws) => {
          this.handleConnection(ws);
        });
      }
    });
  }

  /**
   * Stop the WebSocket server and close all connections.
   *
   * @returns A promise that resolves when the server has stopped
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.stopHeartbeat();

      // Close all client connections
      for (const client of this.clients.values()) {
        client.ws.close(1001, 'Server shutting down');
      }
      this.clients.clear();

      const closeHttpServer = () => {
        if (this.httpServer) {
          this.httpServer.close(() => {
            this.httpServer = null;
            resolve();
          });
        } else {
          resolve();
        }
      };

      if (this.wss) {
        this.wss.close(() => {
          this.wss = null;
          closeHttpServer();
        });
      } else {
        closeHttpServer();
      }
    });
  }

  /**
   * Get the address the server is listening on.
   *
   * @returns The address info from the underlying HTTP or WebSocket server
   */
  address(): import('node:net').AddressInfo | null {
    if (this.httpServer) {
      return this.httpServer.address() as import('node:net').AddressInfo | null;
    }
    if (this.wss) {
      return this.wss.address() as import('node:net').AddressInfo;
    }
    return null;
  }

  /**
   * Send a message to a specific client.
   *
   * @param clientId - The client to send the message to
   * @param message - The protocol message to send
   * @throws {Error} When the client is not found or connection is not open
   */
  send(clientId: string, message: Message): void {
    const client = this.clients.get(clientId);
    if (!client) {
      throw new Error(`Client ${clientId} not found`);
    }
    if (client.ws.readyState !== client.ws.OPEN) {
      throw new Error(`Client ${clientId} connection is not open`);
    }
    client.ws.send(JSON.stringify(message));
  }

  /**
   * Broadcast a message to all connected clients.
   *
   * @param message - The protocol message to broadcast
   */
  broadcast(message: Message): void {
    const data = JSON.stringify(message);
    for (const client of this.clients.values()) {
      if (client.ws.readyState === client.ws.OPEN) {
        client.ws.send(data);
      }
    }
  }

  /**
   * Register an event listener.
   *
   * @param event - The event name
   * @param listener - The listener function
   */
  on<K extends keyof InstallServerEvents>(
    event: K,
    listener: InstallServerEvents[K],
  ): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    (this.listeners[event] as InstallServerEvents[K][]).push(listener);
  }

  /**
   * Create a new installation session for a client.
   *
   * @param clientId - The client requesting the session
   * @param payload - The session creation payload
   * @returns The created session info
   */
  createSession(
    clientId: string,
    payload: SessionCreateMessage['payload'],
  ): SessionInfo {
    const client = this.clients.get(clientId);
    if (!client) {
      throw new Error(`Client ${clientId} not found`);
    }

    const now = Date.now();
    const session: SessionInfo = {
      id: randomUUID(),
      software: payload.software,
      version: payload.version,
      status: SessionStatus.CREATED,
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.set(session.id, session);
    client.sessionId = session.id;

    return session;
  }

  /**
   * Get session info by session ID.
   *
   * @param sessionId - The session identifier
   * @returns The session info, or undefined if not found
   */
  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Update session status.
   *
   * @param sessionId - The session identifier
   * @param status - The new status
   * @throws {Error} When the session is not found
   */
  updateSessionStatus(sessionId: string, status: SessionInfo['status']): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    session.status = status;
    session.updatedAt = Date.now();
  }

  /**
   * Get the number of connected clients.
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get the number of active sessions.
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Get client info by client ID.
   *
   * @param clientId - The client identifier
   * @returns The client session ID, or undefined if not found
   */
  getClientSessionId(clientId: string): string | undefined {
    return this.clients.get(clientId)?.sessionId;
  }

  /**
   * Check if the server is currently running.
   */
  isRunning(): boolean {
    return this.wss !== null;
  }

  /**
   * Check if a client is authenticated.
   *
   * @param clientId - The client identifier
   * @returns True if client is authenticated
   */
  isClientAuthenticated(clientId: string): boolean {
    const client = this.clients.get(clientId);
    return client ? client.authenticated : false;
  }

  /**
   * Mark a client as authenticated.
   *
   * @param clientId - The client identifier
   * @param deviceId - Device fingerprint ID
   * @param deviceToken - Device authentication token
   * @throws {Error} When the client is not found
   */
  authenticateClient(clientId: string, deviceId: string, deviceToken: string): void {
    const client = this.clients.get(clientId);
    if (!client) {
      throw new Error(`Client ${clientId} not found`);
    }

    client.authenticated = true;
    client.deviceId = deviceId;
    client.deviceToken = deviceToken;
    client.authenticatedAt = Date.now();
  }

  /**
   * Get client authentication info.
   *
   * @param clientId - The client identifier
   * @returns Client device ID and token, or undefined if not authenticated
   */
  getClientAuth(clientId: string): { deviceId: string; deviceToken: string } | undefined {
    const client = this.clients.get(clientId);
    if (!client || !client.authenticated || !client.deviceId || !client.deviceToken) {
      return undefined;
    }

    return {
      deviceId: client.deviceId,
      deviceToken: client.deviceToken,
    };
  }

  /**
   * Find authenticated client IDs by device ID.
   *
   * @param deviceId - The device fingerprint ID to search for
   * @returns Array of client IDs authenticated with this device ID
   */
  getClientsByDeviceId(deviceId: string): string[] {
    const result: string[] = [];
    for (const client of this.clients.values()) {
      if (client.authenticated && client.deviceId === deviceId) {
        result.push(client.id);
      }
    }
    return result;
  }

  // --------------------------------------------------------------------------
  // Private methods
  // --------------------------------------------------------------------------

  /**
   * Get the maximum number of concurrent connections allowed.
   */
  getMaxConnections(): number {
    return this.maxConnections;
  }

  private handleConnection(ws: WsWebSocket): void {
    // Enforce connection limit
    if (this.clients.size >= this.maxConnections) {
      ws.close(1013, 'Maximum connections reached');
      return;
    }

    const clientId = randomUUID();
    const client: ClientInfo = {
      id: clientId,
      ws,
      isAlive: true,
      authenticated: !this.requireAuth, // Auto-authenticate if auth is disabled
      connectedAt: Date.now(),
    };

    this.clients.set(clientId, client);
    this.emit('connection', clientId);

    // Set up authentication timeout if required
    if (this.requireAuth) {
      const authTimeout = setTimeout(() => {
        const c = this.clients.get(clientId);
        if (c && !c.authenticated) {
          c.ws.close(4401, 'Authentication timeout');
          this.clients.delete(clientId);
          this.emit('disconnect', clientId);
        }
      }, this.authTimeoutMs);

      // Clear timeout on close
      ws.on('close', () => {
        clearTimeout(authTimeout);
      });
    }

    ws.on('pong', () => {
      const c = this.clients.get(clientId);
      if (c) {
        c.isAlive = true;
      }
    });

    ws.on('message', (data) => {
      this.handleRawMessage(clientId, data);
    });

    ws.on('close', () => {
      this.clients.delete(clientId);
      this.emit('disconnect', clientId);
    });

    ws.on('error', (error) => {
      this.emit('error', clientId, error);
    });
  }

  private handleRawMessage(clientId: string, data: unknown): void {
    try {
      const text = typeof data === 'string' ? data : String(data);
      const json: unknown = JSON.parse(text);
      const result = safeParseMessage(json);

      if (result.success) {
        this.emit('message', clientId, result.data);
      } else {
        this.emit('error', clientId, new Error(`Invalid message: ${result.error.message}`));
      }
    } catch (err) {
      this.emit(
        'error',
        clientId,
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const [clientId, client] of this.clients.entries()) {
        if (!client.isAlive) {
          // Client did not respond to last ping, terminate
          client.ws.terminate();
          this.clients.delete(clientId);
          this.emit('disconnect', clientId);
          continue;
        }

        client.isAlive = false;
        client.ws.ping();
      }
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private emit<K extends keyof InstallServerEvents>(
    event: K,
    ...args: Parameters<InstallServerEvents[K]>
  ): void {
    const listeners = this.listeners[event] as
      | InstallServerEvents[K][]
      | undefined;
    if (listeners) {
      for (const listener of listeners) {
        (listener as (...a: Parameters<InstallServerEvents[K]>) => void)(
          ...args,
        );
      }
    }
  }
}
