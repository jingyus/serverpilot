// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isRetriableError,
  computeReconnectDelay,
  createSSEConnection,
} from './sse';
import type { SSECallbacks, SSEConnectionHandle } from './sse';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a ReadableStream that yields the given SSE chunks then closes */
function makeSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i++;
      } else {
        controller.close();
      }
    },
  });
}

/** Build a Response with a ReadableStream body */
function okSSEResponse(chunks: string[]): Response {
  return new Response(makeSSEStream(chunks), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function errorResponse(status: number, message = 'error'): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// isRetriableError
// ---------------------------------------------------------------------------
describe('isRetriableError', () => {
  it('returns true for TypeError (fetch network failure)', () => {
    expect(isRetriableError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('returns true for generic network error message', () => {
    expect(isRetriableError(new Error('network error'))).toBe(true);
  });

  it('returns true for "Failed to fetch" error message', () => {
    expect(isRetriableError(new Error('Failed to fetch'))).toBe(true);
  });

  it('returns false for AbortError', () => {
    const err = new DOMException('Aborted', 'AbortError');
    expect(isRetriableError(err)).toBe(false);
  });

  it('returns false for 401 status error', () => {
    expect(isRetriableError(new Error('Request failed with status 401'))).toBe(false);
  });

  it('returns false for 403 status error', () => {
    expect(isRetriableError(new Error('Request failed with status 403'))).toBe(false);
  });

  it('returns false for 404 status error', () => {
    expect(isRetriableError(new Error('Request failed with status 404'))).toBe(false);
  });

  it('returns false for 400 status error', () => {
    expect(isRetriableError(new Error('Request failed with status 400'))).toBe(false);
  });

  it('returns false for unknown non-Error', () => {
    expect(isRetriableError('string error')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeReconnectDelay
// ---------------------------------------------------------------------------
describe('computeReconnectDelay', () => {
  it('returns 1000ms for attempt 0', () => {
    expect(computeReconnectDelay(0)).toBe(1000);
  });

  it('returns 2000ms for attempt 1', () => {
    expect(computeReconnectDelay(1)).toBe(2000);
  });

  it('returns 4000ms for attempt 2', () => {
    expect(computeReconnectDelay(2)).toBe(4000);
  });

  it('caps at 30000ms', () => {
    expect(computeReconnectDelay(100)).toBe(30_000);
  });
});

// ---------------------------------------------------------------------------
// createSSEConnection
// ---------------------------------------------------------------------------
describe('createSSEConnection', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.setItem('auth_token', 'test-token');
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    localStorage.clear();
  });

  it('dispatches message events from SSE stream', async () => {
    const onMessage = vi.fn();
    fetchMock.mockResolvedValueOnce(
      okSSEResponse([
        'event: message\ndata: {"content":"hello"}\n\n',
        'event: complete\ndata: {}\n\n',
      ]),
    );

    const handle = createSSEConnection('/chat/srv-1', { message: 'hi' }, { onMessage });
    // Let microtasks resolve
    await vi.runAllTimersAsync();

    expect(onMessage).toHaveBeenCalledWith('{"content":"hello"}');
    handle.abort();
  });

  it('calls onComplete and does not reconnect after complete event', async () => {
    const onComplete = vi.fn();
    const onReconnecting = vi.fn();
    fetchMock.mockResolvedValueOnce(
      okSSEResponse(['event: complete\ndata: {"success":true}\n\n']),
    );

    const handle = createSSEConnection('/chat/srv-1', { message: 'hi' }, {
      onComplete,
      onReconnecting,
    });
    await vi.runAllTimersAsync();

    expect(onComplete).toHaveBeenCalledWith('{"success":true}');
    expect(onReconnecting).not.toHaveBeenCalled();
    handle.abort();
  });

  it('reconnects on network error with exponential backoff', async () => {
    const onReconnecting = vi.fn();
    const onError = vi.fn();
    const onMessage = vi.fn();

    // First call: network error
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    // Second call: success with complete
    fetchMock.mockResolvedValueOnce(
      okSSEResponse(['event: message\ndata: {"content":"ok"}\n\nevent: complete\ndata: {}\n\n']),
    );

    const handle = createSSEConnection('/chat/srv-1', { message: 'hi' }, {
      onReconnecting,
      onMessage,
      onError,
    });

    // Wait for first attempt to fail
    await vi.advanceTimersByTimeAsync(0);
    // Should schedule reconnect
    expect(onReconnecting).toHaveBeenCalledWith(1);
    expect(onError).not.toHaveBeenCalled();

    // Advance past backoff delay (1s for attempt 0)
    await vi.advanceTimersByTimeAsync(1000);
    // Let the reconnection resolve
    await vi.runAllTimersAsync();

    expect(onMessage).toHaveBeenCalledWith('{"content":"ok"}');
    expect(onError).not.toHaveBeenCalled();
    handle.abort();
  });

  it('calls onReconnected after successful reconnection', async () => {
    const onReconnected = vi.fn();
    const onReconnecting = vi.fn();

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetchMock.mockResolvedValueOnce(
      okSSEResponse(['event: complete\ndata: {}\n\n']),
    );

    const handle = createSSEConnection('/chat/srv-1', { message: 'hi' }, {
      onReconnecting,
      onReconnected,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(onReconnecting).toHaveBeenCalledWith(1);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.runAllTimersAsync();

    expect(onReconnected).toHaveBeenCalledTimes(1);
    handle.abort();
  });

  it('does not reconnect on 401 error', async () => {
    const onError = vi.fn();
    const onReconnecting = vi.fn();

    // sseRequest will get 401, try refresh, fail, return 401
    fetchMock.mockResolvedValueOnce(errorResponse(401, 'Unauthorized'));

    const handle = createSSEConnection('/chat/srv-1', { message: 'hi' }, {
      onError,
      onReconnecting,
    });

    await vi.runAllTimersAsync();

    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0].message).toContain('Unauthorized');
    expect(onReconnecting).not.toHaveBeenCalled();
    handle.abort();
  });

  it('does not reconnect on 404 error', async () => {
    const onError = vi.fn();
    const onReconnecting = vi.fn();

    fetchMock.mockResolvedValueOnce(errorResponse(404, 'Not found'));

    const handle = createSSEConnection('/chat/srv-1', { message: 'hi' }, {
      onError,
      onReconnecting,
    });

    await vi.runAllTimersAsync();

    expect(onError).toHaveBeenCalled();
    expect(onReconnecting).not.toHaveBeenCalled();
    handle.abort();
  });

  it('gives up after max reconnection attempts', async () => {
    const onError = vi.fn();
    const onReconnecting = vi.fn();

    // All 6 attempts fail (1 initial + 5 reconnects)
    for (let i = 0; i < 6; i++) {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    }

    const handle = createSSEConnection('/chat/srv-1', { message: 'hi' }, {
      onError,
      onReconnecting,
    });

    // Let all reconnect cycles complete
    for (let i = 0; i < 6; i++) {
      await vi.runAllTimersAsync();
    }

    // 5 reconnecting calls (attempts 1-5)
    expect(onReconnecting).toHaveBeenCalledTimes(5);
    // Final error after max attempts
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toContain('Max reconnection attempts');
    handle.abort();
  });

  it('reconnects when stream ends without complete event', async () => {
    const onReconnecting = vi.fn();
    const onComplete = vi.fn();

    // First stream ends without complete event
    fetchMock.mockResolvedValueOnce(
      okSSEResponse(['event: message\ndata: {"content":"partial"}\n\n']),
    );
    // Second stream completes properly
    fetchMock.mockResolvedValueOnce(
      okSSEResponse(['event: complete\ndata: {}\n\n']),
    );

    const handle = createSSEConnection('/chat/srv-1', { message: 'hi' }, {
      onReconnecting,
      onComplete,
    });

    // Let first stream complete
    await vi.runAllTimersAsync();

    expect(onReconnecting).toHaveBeenCalledWith(1);

    // Advance past backoff
    await vi.advanceTimersByTimeAsync(1000);
    await vi.runAllTimersAsync();

    expect(onComplete).toHaveBeenCalled();
    handle.abort();
  });

  it('does not reconnect after abort', async () => {
    const onReconnecting = vi.fn();

    // Stream ends without complete event → scheduleReconnect will be called
    fetchMock.mockResolvedValueOnce(
      okSSEResponse(['event: message\ndata: {"content":"partial"}\n\n']),
    );

    const handle = createSSEConnection('/chat/srv-1', { message: 'hi' }, {
      onReconnecting,
    });

    // Let first stream complete
    await vi.advanceTimersByTimeAsync(0);
    // Stream end triggers scheduleReconnect (sets a timer)
    // onReconnecting(1) is called synchronously from scheduleReconnect
    expect(onReconnecting).toHaveBeenCalledTimes(1);

    // Now abort — this should clear the pending reconnect timer
    handle.abort();

    // Even after waiting past backoff, no new fetch should happen
    await vi.advanceTimersByTimeAsync(30_000);

    // Only the initial fetch
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns SSEConnectionHandle with abort and controller', () => {
    fetchMock.mockResolvedValueOnce(
      okSSEResponse(['event: complete\ndata: {}\n\n']),
    );

    const handle = createSSEConnection('/chat/srv-1', { message: 'hi' }, {});
    expect(typeof handle.abort).toBe('function');
    expect(handle.controller).toBeInstanceOf(AbortController);
    handle.abort();
  });
});
