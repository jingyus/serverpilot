// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { API_BASE_URL } from '@/utils/constants';
import { refreshAccessToken } from './auth';

// ---------------------------------------------------------------------------
// SSE Connection Pool — limits concurrent connections per category
// ---------------------------------------------------------------------------

/** Default maximum concurrent POST SSE connections (chat streams) */
const DEFAULT_MAX_POST_SSE = 3;
/** Default maximum concurrent GET SSE connections (metrics/status streams) */
const DEFAULT_MAX_GET_SSE = 3;

interface PoolEntry {
  id: number;
  abort: () => void;
}

let nextPoolId = 1;

class SSEConnectionPool {
  private postConnections: PoolEntry[] = [];
  private getConnections: PoolEntry[] = [];
  maxPost: number;
  maxGet: number;

  constructor(maxPost = DEFAULT_MAX_POST_SSE, maxGet = DEFAULT_MAX_GET_SSE) {
    this.maxPost = maxPost;
    this.maxGet = maxGet;
  }

  /** Register a POST SSE connection. Evicts oldest if over limit. Returns pool entry id. */
  registerPost(abortFn: () => void): number {
    while (this.postConnections.length >= this.maxPost) {
      const oldest = this.postConnections.shift();
      oldest?.abort();
    }
    const id = nextPoolId++;
    this.postConnections.push({ id, abort: abortFn });
    return id;
  }

  /** Register a GET SSE connection. Evicts oldest if over limit. Returns pool entry id. */
  registerGet(abortFn: () => void): number {
    while (this.getConnections.length >= this.maxGet) {
      const oldest = this.getConnections.shift();
      oldest?.abort();
    }
    const id = nextPoolId++;
    this.getConnections.push({ id, abort: abortFn });
    return id;
  }

  /** Remove a connection from the pool by id (called on abort/completion) */
  unregister(id: number): void {
    this.postConnections = this.postConnections.filter((e) => e.id !== id);
    this.getConnections = this.getConnections.filter((e) => e.id !== id);
  }

  /** Number of active POST SSE connections */
  get postCount(): number {
    return this.postConnections.length;
  }

  /** Number of active GET SSE connections */
  get getCount(): number {
    return this.getConnections.length;
  }

  /** Total active connections */
  get totalCount(): number {
    return this.postConnections.length + this.getConnections.length;
  }
}

/** Module-level singleton pool */
let pool = new SSEConnectionPool();

/** Get the connection pool (for testing) */
export function getSSEConnectionPool(): SSEConnectionPool {
  return pool;
}

/** Reset the pool (for testing) */
export function _resetSSEConnectionPool(maxPost?: number, maxGet?: number): void {
  // Abort all active connections before resetting
  for (const entry of [...pool['postConnections'], ...pool['getConnections']]) {
    entry.abort();
  }
  pool = new SSEConnectionPool(maxPost, maxGet);
  nextPoolId = 1;
}

export interface SSECallbacks {
  onMessage?: (data: string) => void;
  onPlan?: (data: string) => void;
  onRetry?: (data: string) => void;
  onAutoExecute?: (data: string) => void;
  onStepConfirm?: (data: string) => void;
  onStepDecisionTimeout?: (data: string) => void;
  onStepStart?: (data: string) => void;
  onOutput?: (data: string) => void;
  onStepComplete?: (data: string) => void;
  onDiagnosis?: (data: string) => void;
  onComplete?: (data: string) => void;
  onError?: (error: Error) => void;
  onReconnecting?: (attempt: number) => void;
  onReconnected?: () => void;
  // Agentic mode events
  onToolCall?: (data: string) => void;
  onToolExecuting?: (data: string) => void;
  onToolOutput?: (data: string) => void;
  onToolResult?: (data: string) => void;
  onConfirmRequired?: (data: string) => void;
  onConfirmId?: (data: string) => void;
}

async function sseRequest(
  path: string,
  body: Record<string, unknown>,
  controller: AbortController,
  token: string | null,
): Promise<Response> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  });

  // On 401, attempt token refresh and retry once
  if (response.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return fetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${newToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    }
  }

  return response;
}

/** Maximum number of reconnection attempts for Chat SSE */
const MAX_RECONNECT_ATTEMPTS = 5;
/** Maximum backoff delay in milliseconds */
const MAX_RECONNECT_DELAY_MS = 30_000;

/** HTTP status codes that should NOT trigger reconnection */
const NON_RETRIABLE_STATUSES = new Set([400, 401, 403, 404, 422]);

/**
 * Determine whether an error is a transient network failure worth retrying.
 * Returns false for auth/client errors (4xx) that won't succeed on retry.
 */
export function isRetriableError(error: unknown): boolean {
  if (error instanceof TypeError) return true; // fetch network failures
  if (error instanceof DOMException && error.name === 'AbortError') return false;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('network') || msg.includes('failed to fetch')) return true;
    // HTTP status errors encoded in message
    for (const status of NON_RETRIABLE_STATUSES) {
      if (msg.includes(`status ${status}`)) return false;
    }
  }
  return false;
}

/** Compute exponential backoff delay: 1s, 2s, 4s, 8s, ... capped at MAX */
export function computeReconnectDelay(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), MAX_RECONNECT_DELAY_MS);
}

export interface SSEConnectionHandle {
  abort: () => void;
  /** For backward-compat: the underlying AbortController */
  controller: AbortController;
}

export function createSSEConnection(
  path: string,
  body: Record<string, unknown>,
  callbacks: SSECallbacks
): SSEConnectionHandle {
  const controller = new AbortController();
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let completed = false;
  let poolEntryId = -1;

  function cleanup() {
    stopped = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (!controller.signal.aborted) {
      controller.abort();
    }
    if (poolEntryId !== -1) {
      pool.unregister(poolEntryId);
      poolEntryId = -1;
    }
  }

  function scheduleReconnect() {
    if (stopped || completed) return;
    if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      callbacks.onError?.(new Error('Connection lost. Max reconnection attempts reached.'));
      return;
    }
    const delay = computeReconnectDelay(reconnectAttempt);
    reconnectAttempt++;
    callbacks.onReconnecting?.(reconnectAttempt);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect(true);
    }, delay);
  }

  async function connect(isReconnect: boolean) {
    if (stopped) return;

    const token = localStorage.getItem('auth_token');

    try {
      // On reconnect, use a new AbortController for the fetch but keep the
      // same outer lifecycle. We create a child signal linked to the parent.
      const fetchController = isReconnect ? new AbortController() : controller;
      if (isReconnect) {
        // If parent is aborted, also abort the child
        controller.signal.addEventListener('abort', () => fetchController.abort(), { once: true });
      }

      // On reconnect, strip the message field to prevent the server from
      // re-processing the user message (duplicate AI responses). Send only
      // sessionId + reconnect flag so the server resumes the existing stream.
      const requestBody = isReconnect
        ? { ...body, message: undefined, reconnect: true }
        : body;

      const response = await sseRequest(path, requestBody, fetchController, token);

      if (!response.ok) {
        if (response.status === 401) {
          // Auth failure — don't reconnect, let token refresh in sseRequest handle it
          const errorBody = await response.json().catch(() => ({}));
          const msg = (errorBody as Record<string, { message?: string }>).error?.message
            ?? 'Authentication failed';
          throw new SSEHttpError(msg, response.status);
        }
        const errorBody = await response.json().catch(() => ({}));
        const msg =
          (errorBody as Record<string, { message?: string }>).error?.message ??
          `Request failed with status ${response.status}`;
        throw new SSEHttpError(msg, response.status);
      }

      // Connection success — reset reconnect counter
      if (isReconnect) {
        reconnectAttempt = 0;
        callbacks.onReconnected?.();
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      await parseSSEStream(reader, (event, data) => {
        dispatchSSEEvent(event, data, callbacks);
        if (event === 'complete') {
          completed = true;
          return true;
        }
      });

      // Stream ended without 'complete' event — might be network drop
      if (!completed && !stopped) {
        scheduleReconnect();
      }
      // If completed, unregister from pool (connection is done)
      if (completed && poolEntryId !== -1) {
        pool.unregister(poolEntryId);
        poolEntryId = -1;
      }
    } catch (err: unknown) {
      if (stopped || controller.signal.aborted) return;

      const error =
        err instanceof Error ? err : new Error('SSE connection failed');

      // If it's a retriable error, attempt reconnect (scheduleReconnect checks max)
      if (isRetriableError(err)) {
        scheduleReconnect();
        return;
      }

      // Non-retriable error (auth, not found, etc.) — unregister from pool
      if (poolEntryId !== -1) {
        pool.unregister(poolEntryId);
        poolEntryId = -1;
      }
      callbacks.onError?.(error);
    }
  }

  // Register with pool (evicts oldest if over limit)
  poolEntryId = pool.registerPost(cleanup);
  connect(false);

  return { abort: cleanup, controller };
}

/** Error with an HTTP status code — used to distinguish retriable vs non-retriable errors */
class SSEHttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'SSEHttpError';
    this.status = status;
  }
}

/** Configuration for a GET-based SSE connection */
export interface GetSSEConfig {
  /** Full URL path (appended to API_BASE_URL) */
  path: string;
  /** Dispatch incoming SSE events; return true to close the stream */
  dispatch: SSEDispatchFn;
  /** Error callback */
  onError?: (error: Error) => void;
  /** Whether to auto-reconnect on stream end or error (default: true) */
  reconnect?: boolean;
}

/** Create a GET-based SSE connection with auth, 401 retry, and optional reconnect. */
export function createGetSSE(config: GetSSEConfig): { abort: () => void } {
  const { path, dispatch, onError, reconnect: shouldReconnect = true } = config;
  const controller = new AbortController();
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let poolEntryId = -1;

  function cleanup() {
    stopped = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    controller.abort();
    if (poolEntryId !== -1) {
      pool.unregister(poolEntryId);
      poolEntryId = -1;
    }
  }

  function scheduleReconnect() {
    if (stopped || !shouldReconnect) return;
    const delay = computeReconnectDelay(reconnectAttempt);
    reconnectAttempt++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  async function connect() {
    if (stopped) return;

    const token = localStorage.getItem('auth_token');
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      let response = await fetch(`${API_BASE_URL}${path}`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      // On 401, attempt token refresh and retry once
      if (response.status === 401) {
        const newToken = await refreshAccessToken();
        if (newToken) {
          headers['Authorization'] = `Bearer ${newToken}`;
          response = await fetch(`${API_BASE_URL}${path}`, {
            method: 'GET',
            headers,
            signal: controller.signal,
          });
        }
      }

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const msg = (errorBody as Record<string, string>).error
          ?? `Stream failed: ${response.status}`;
        throw new Error(msg);
      }

      // Connection success — reset reconnect counter
      reconnectAttempt = 0;

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      await parseSSEStream(reader, (event, data) => {
        const shouldClose = dispatch(event, data);
        if (shouldClose) {
          cleanup();
          return true;
        }
      });

      // Stream ended normally — reconnect if configured
      if (!stopped) scheduleReconnect();
    } catch (err: unknown) {
      if (stopped || controller.signal.aborted) return;
      const error = err instanceof Error ? err : new Error('SSE connection failed');
      onError?.(error);
      scheduleReconnect();
    }
  }

  // Register with pool (evicts oldest GET SSE if over limit)
  poolEntryId = pool.registerGet(cleanup);
  connect();

  return { abort: cleanup };
}

export interface MetricsSSECallbacks {
  onMetric?: (data: string) => void;
  onConnected?: (data: string) => void;
  onError?: (error: Error) => void;
}

export function createMetricsSSE(
  path: string,
  callbacks: MetricsSSECallbacks,
): { abort: () => void } {
  return createGetSSE({
    path,
    onError: callbacks.onError,
    dispatch(event, data) {
      if (event === 'metric') {
        callbacks.onMetric?.(data);
      } else if (event === 'connected') {
        callbacks.onConnected?.(data);
      }
    },
  });
}

export interface ServerStatusSSECallbacks {
  onStatus?: (data: string) => void;
  onConnected?: (data: string) => void;
  onError?: (error: Error) => void;
}

export function createServerStatusSSE(
  callbacks: ServerStatusSSECallbacks,
): { abort: () => void } {
  return createGetSSE({
    path: '/servers/status/stream',
    onError: callbacks.onError,
    dispatch(event, data) {
      if (event === 'status') {
        callbacks.onStatus?.(data);
      } else if (event === 'connected') {
        callbacks.onConnected?.(data);
      }
    },
  });
}

export interface SkillExecutionSSECallbacks {
  onConnected?: (data: string) => void;
  onStep?: (data: string) => void;
  onLog?: (data: string) => void;
  onCompleted?: (data: string) => void;
  onError?: (error: Error) => void;
}

export function createSkillExecutionSSE(
  executionId: string,
  callbacks: SkillExecutionSSECallbacks,
): { abort: () => void } {
  return createGetSSE({
    path: `/skills/executions/${executionId}/stream`,
    reconnect: false,
    onError: callbacks.onError,
    dispatch(event, data) {
      if (event === 'step') {
        callbacks.onStep?.(data);
      } else if (event === 'log') {
        callbacks.onLog?.(data);
      } else if (event === 'completed') {
        callbacks.onCompleted?.(data);
        return true; // close stream
      } else if (event === 'connected') {
        callbacks.onConnected?.(data);
      } else if (event === 'error') {
        try {
          const parsed = JSON.parse(data) as { message?: string };
          callbacks.onError?.(new Error(parsed.message ?? 'Execution error'));
        } catch {
          callbacks.onError?.(new Error(data));
        }
        return true; // close stream
      }
    },
  });
}

/**
 * SSE event dispatch callback.
 * @param event - The event type (from `event:` field, defaults to 'message' per SSE spec)
 * @param data - The accumulated data (from one or more `data:` lines, joined with '\n')
 * @returns true if the stream should be closed after this event
 */
export type SSEDispatchFn = (event: string, data: string) => boolean | void;

/** Parse an SSE stream per W3C EventSource spec: accumulate event/data fields, dispatch on blank line. */
export async function parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  dispatch: SSEDispatchFn,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = 'message';
  let dataLines: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        dataLines.push(line.slice(6));
      } else if (line === '') {
        // Blank line = end of event — dispatch if we have data
        if (dataLines.length > 0) {
          const shouldClose = dispatch(currentEvent, dataLines.join('\n'));
          if (shouldClose) return;
        }
        // Reset for next event
        currentEvent = 'message';
        dataLines = [];
      }
      // Lines starting with ':' are comments — ignore per spec
    }
  }

  // Flush any remaining event data at stream end (no trailing blank line)
  if (dataLines.length > 0) {
    dispatch(currentEvent, dataLines.join('\n'));
  }
}

/** Map SSE event names to SSECallbacks keys */
const SSE_EVENT_MAP: Record<string, keyof SSECallbacks> = {
  message: 'onMessage',
  plan: 'onPlan',
  retry: 'onRetry',
  auto_execute: 'onAutoExecute',
  step_confirm: 'onStepConfirm',
  step_decision_timeout: 'onStepDecisionTimeout',
  step_start: 'onStepStart',
  output: 'onOutput',
  step_complete: 'onStepComplete',
  diagnosis: 'onDiagnosis',
  complete: 'onComplete',
  tool_call: 'onToolCall',
  tool_executing: 'onToolExecuting',
  tool_output: 'onToolOutput',
  tool_result: 'onToolResult',
  confirm_required: 'onConfirmRequired',
  confirm_id: 'onConfirmId',
};

function dispatchSSEEvent(
  event: string,
  data: string,
  callbacks: SSECallbacks
): void {
  const key = SSE_EVENT_MAP[event] ?? 'onMessage';
  const handler = callbacks[key] as ((d: string) => void) | undefined;
  handler?.(data);
}
