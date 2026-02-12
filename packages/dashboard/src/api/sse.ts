// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { API_BASE_URL } from '@/utils/constants';
import { refreshAccessToken } from './auth';

export interface SSECallbacks {
  onMessage?: (data: string) => void;
  onPlan?: (data: string) => void;
  onRetry?: (data: string) => void;
  onAutoExecute?: (data: string) => void;
  onStepConfirm?: (data: string) => void;
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

  function cleanup() {
    stopped = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (!controller.signal.aborted) {
      controller.abort();
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

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentEvent = 'message';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const data = line.slice(6);
            dispatchSSEEvent(currentEvent, data, callbacks);
            if (currentEvent === 'complete') {
              completed = true;
            }
          } else if (line === '') {
            currentEvent = 'message';
          }
        }
      }

      // Stream ended without 'complete' event — might be network drop
      if (!completed && !stopped) {
        scheduleReconnect();
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

      // Non-retriable error (auth, not found, etc.)
      callbacks.onError?.(error);
    }
  }

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

// ============================================================================
// GET-based SSE for metrics streaming
// ============================================================================

export interface MetricsSSECallbacks {
  onMetric?: (data: string) => void;
  onConnected?: (data: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Create a GET-based SSE connection for real-time metrics streaming.
 *
 * Unlike createSSEConnection (which uses POST for chat), this uses GET
 * with query params and supports automatic reconnection with exponential
 * backoff.
 *
 * @returns Object with abort() to close connection
 */
export function createMetricsSSE(
  path: string,
  callbacks: MetricsSSECallbacks,
): { abort: () => void } {
  const controller = new AbortController();
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function cleanup() {
    stopped = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    controller.abort();
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
        const msg = (errorBody as Record<string, string>).error ?? `Stream failed: ${response.status}`;
        throw new Error(msg);
      }

      // Connection success — reset reconnect counter
      reconnectAttempt = 0;

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentEvent = 'metric';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (currentEvent === 'metric') {
              callbacks.onMetric?.(data);
            } else if (currentEvent === 'connected') {
              callbacks.onConnected?.(data);
            }
          } else if (line === '') {
            currentEvent = 'metric';
          }
        }
      }

      // Stream ended normally — reconnect if not aborted
      if (!stopped) scheduleReconnect();
    } catch (err: unknown) {
      if (stopped || controller.signal.aborted) return;
      const error = err instanceof Error ? err : new Error('SSE connection failed');
      callbacks.onError?.(error);
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (stopped) return;
    // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), 30_000);
    reconnectAttempt++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  connect();

  return { abort: cleanup };
}

// ============================================================================
// GET-based SSE for server status streaming
// ============================================================================

export interface ServerStatusSSECallbacks {
  onStatus?: (data: string) => void;
  onConnected?: (data: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Create a GET-based SSE connection for real-time server status updates.
 *
 * Subscribes to /servers/status/stream to receive online/offline events
 * for all servers. Supports automatic reconnection with exponential backoff.
 *
 * @returns Object with abort() to close connection
 */
export function createServerStatusSSE(
  callbacks: ServerStatusSSECallbacks,
): { abort: () => void } {
  const controller = new AbortController();
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function cleanup() {
    stopped = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    controller.abort();
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
      let response = await fetch(`${API_BASE_URL}/servers/status/stream`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      // On 401, attempt token refresh and retry once
      if (response.status === 401) {
        const newToken = await refreshAccessToken();
        if (newToken) {
          headers['Authorization'] = `Bearer ${newToken}`;
          response = await fetch(`${API_BASE_URL}/servers/status/stream`, {
            method: 'GET',
            headers,
            signal: controller.signal,
          });
        }
      }

      if (!response.ok) {
        throw new Error(`Status stream failed: ${response.status}`);
      }

      reconnectAttempt = 0;

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentEvent = 'status';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (currentEvent === 'status') {
              callbacks.onStatus?.(data);
            } else if (currentEvent === 'connected') {
              callbacks.onConnected?.(data);
            }
          } else if (line === '') {
            currentEvent = 'status';
          }
        }
      }

      if (!stopped) scheduleReconnect();
    } catch (err: unknown) {
      if (stopped || controller.signal.aborted) return;
      const error = err instanceof Error ? err : new Error('SSE connection failed');
      callbacks.onError?.(error);
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (stopped) return;
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), 30_000);
    reconnectAttempt++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  connect();

  return { abort: cleanup };
}

// ============================================================================
// GET-based SSE for skill execution progress streaming
// ============================================================================

export interface SkillExecutionSSECallbacks {
  onConnected?: (data: string) => void;
  onStep?: (data: string) => void;
  onLog?: (data: string) => void;
  onCompleted?: (data: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Create a GET-based SSE connection for real-time skill execution progress.
 *
 * Subscribes to /skills/executions/:eid/stream to receive step, log,
 * and completion events. Auto-closes when execution completes.
 *
 * @returns Object with abort() to close connection
 */
export function createSkillExecutionSSE(
  executionId: string,
  callbacks: SkillExecutionSSECallbacks,
): { abort: () => void } {
  const controller = new AbortController();
  let stopped = false;

  function cleanup() {
    stopped = true;
    controller.abort();
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
      let response = await fetch(
        `${API_BASE_URL}/skills/executions/${executionId}/stream`,
        { method: 'GET', headers, signal: controller.signal },
      );

      // On 401, attempt token refresh and retry once
      if (response.status === 401) {
        const newToken = await refreshAccessToken();
        if (newToken) {
          headers['Authorization'] = `Bearer ${newToken}`;
          response = await fetch(
            `${API_BASE_URL}/skills/executions/${executionId}/stream`,
            { method: 'GET', headers, signal: controller.signal },
          );
        }
      }

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const msg = (errorBody as Record<string, string>).error
          ?? `Stream failed: ${response.status}`;
        throw new Error(msg);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentEvent = 'step';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (currentEvent === 'step') {
              callbacks.onStep?.(data);
            } else if (currentEvent === 'log') {
              callbacks.onLog?.(data);
            } else if (currentEvent === 'completed') {
              callbacks.onCompleted?.(data);
              // Auto-close on completion
              cleanup();
              return;
            } else if (currentEvent === 'connected') {
              callbacks.onConnected?.(data);
            } else if (currentEvent === 'error') {
              try {
                const parsed = JSON.parse(data) as { message?: string };
                callbacks.onError?.(new Error(parsed.message ?? 'Execution error'));
              } catch {
                callbacks.onError?.(new Error(data));
              }
              cleanup();
              return;
            }
          } else if (line === '') {
            currentEvent = 'step';
          }
        }
      }
    } catch (err: unknown) {
      if (stopped || controller.signal.aborted) return;
      const error = err instanceof Error ? err : new Error('SSE connection failed');
      callbacks.onError?.(error);
    }
  }

  connect();

  return { abort: cleanup };
}

// ============================================================================
// SSE Event Dispatch
// ============================================================================

function dispatchSSEEvent(
  event: string,
  data: string,
  callbacks: SSECallbacks
): void {
  switch (event) {
    case 'message':
      callbacks.onMessage?.(data);
      break;
    case 'plan':
      callbacks.onPlan?.(data);
      break;
    case 'retry':
      callbacks.onRetry?.(data);
      break;
    case 'auto_execute':
      callbacks.onAutoExecute?.(data);
      break;
    case 'step_confirm':
      callbacks.onStepConfirm?.(data);
      break;
    case 'step_start':
      callbacks.onStepStart?.(data);
      break;
    case 'output':
      callbacks.onOutput?.(data);
      break;
    case 'step_complete':
      callbacks.onStepComplete?.(data);
      break;
    case 'diagnosis':
      callbacks.onDiagnosis?.(data);
      break;
    case 'complete':
      callbacks.onComplete?.(data);
      break;
    // Agentic mode events
    case 'tool_call':
      callbacks.onToolCall?.(data);
      break;
    case 'tool_executing':
      callbacks.onToolExecuting?.(data);
      break;
    case 'tool_output':
      callbacks.onToolOutput?.(data);
      break;
    case 'tool_result':
      callbacks.onToolResult?.(data);
      break;
    case 'confirm_required':
      callbacks.onConfirmRequired?.(data);
      break;
    case 'confirm_id':
      callbacks.onConfirmId?.(data);
      break;
    default:
      callbacks.onMessage?.(data);
  }
}
