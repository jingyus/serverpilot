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
