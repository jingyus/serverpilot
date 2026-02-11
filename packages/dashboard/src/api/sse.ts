// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { API_BASE_URL } from '@/utils/constants';

export interface SSECallbacks {
  onMessage?: (data: string) => void;
  onPlan?: (data: string) => void;
  onStepStart?: (data: string) => void;
  onOutput?: (data: string) => void;
  onStepComplete?: (data: string) => void;
  onComplete?: (data: string) => void;
  onError?: (error: Error) => void;
}

async function tryRefreshToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) return null;

  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) return null;

    const data = (await response.json()) as { accessToken: string; refreshToken: string };
    localStorage.setItem('auth_token', data.accessToken);
    localStorage.setItem('refresh_token', data.refreshToken);
    return data.accessToken;
  } catch {
    return null;
  }
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
    const newToken = await tryRefreshToken();
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

export function createSSEConnection(
  path: string,
  body: Record<string, unknown>,
  callbacks: SSECallbacks
): AbortController {
  const controller = new AbortController();
  const token = localStorage.getItem('auth_token');

  sseRequest(path, body, controller, token)
    .then(async (response) => {
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const msg =
          errorBody.error?.message ??
          `Request failed with status ${response.status}`;
        throw new Error(msg);
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
          } else if (line === '') {
            currentEvent = 'message';
          }
        }
      }
    })
    .catch((err: unknown) => {
      if (controller.signal.aborted) return;
      const error =
        err instanceof Error ? err : new Error('SSE connection failed');
      callbacks.onError?.(error);
    });

  return controller;
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
        const newToken = await tryRefreshToken();
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
    case 'step_start':
      callbacks.onStepStart?.(data);
      break;
    case 'output':
      callbacks.onOutput?.(data);
      break;
    case 'step_complete':
      callbacks.onStepComplete?.(data);
      break;
    case 'complete':
      callbacks.onComplete?.(data);
      break;
    default:
      callbacks.onMessage?.(data);
  }
}
