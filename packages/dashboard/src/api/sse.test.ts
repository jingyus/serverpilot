// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isRetriableError,
  computeReconnectDelay,
  createSSEConnection,
  createGetSSE,
  parseSSEStream,
  getSSEConnectionPool,
  _resetSSEConnectionPool,
} from './sse';
import type { SSECallbacks, SSEConnectionHandle, SSEDispatchFn, GetSSEConfig } from './sse';

vi.mock('./auth', () => ({
  refreshAccessToken: vi.fn().mockResolvedValue(null),
}));

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
// parseSSEStream
// ---------------------------------------------------------------------------

/** Helper: create a reader from SSE text chunks */
function readerFromChunks(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  return makeSSEStream(chunks).getReader();
}

describe('parseSSEStream', () => {
  it('dispatches a simple event with event + data + blank line', async () => {
    const dispatch = vi.fn();
    const reader = readerFromChunks(['event: plan\ndata: {"steps":[]}\n\n']);

    await parseSSEStream(reader, dispatch);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('plan', '{"steps":[]}');
  });

  it('defaults event type to "message" when no event: field', async () => {
    const dispatch = vi.fn();
    const reader = readerFromChunks(['data: hello\n\n']);

    await parseSSEStream(reader, dispatch);

    expect(dispatch).toHaveBeenCalledWith('message', 'hello');
  });

  it('preserves event type when blank line appears between events, not within', async () => {
    const dispatch = vi.fn();
    // Two separate events: tool_call then message
    const reader = readerFromChunks([
      'event: tool_call\ndata: {"tool":"ls"}\n\n',
      'data: fallback\n\n',
    ]);

    await parseSSEStream(reader, dispatch);

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledWith('tool_call', '{"tool":"ls"}');
    expect(dispatch).toHaveBeenCalledWith('message', 'fallback');
  });

  it('joins multiple data: lines with newline (multi-line data)', async () => {
    const dispatch = vi.fn();
    const reader = readerFromChunks([
      'event: output\ndata: line1\ndata: line2\ndata: line3\n\n',
    ]);

    await parseSSEStream(reader, dispatch);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('output', 'line1\nline2\nline3');
  });

  it('does not dispatch on blank line if no data lines were accumulated', async () => {
    const dispatch = vi.fn();
    // Just blank lines, no data
    const reader = readerFromChunks(['\n\n\n']);

    await parseSSEStream(reader, dispatch);

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('handles multiple events in a single chunk', async () => {
    const dispatch = vi.fn();
    const reader = readerFromChunks([
      'event: step_start\ndata: {"id":1}\n\nevent: step_complete\ndata: {"id":1,"ok":true}\n\n',
    ]);

    await parseSSEStream(reader, dispatch);

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledWith('step_start', '{"id":1}');
    expect(dispatch).toHaveBeenCalledWith('step_complete', '{"id":1,"ok":true}');
  });

  it('handles events split across multiple chunks', async () => {
    const dispatch = vi.fn();
    // Event split mid-line across chunks
    const reader = readerFromChunks([
      'event: tool_',
      'call\ndata: {"t":"x"}\n\n',
    ]);

    await parseSSEStream(reader, dispatch);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('tool_call', '{"t":"x"}');
  });

  it('stops parsing when dispatch returns true', async () => {
    const dispatch = vi.fn().mockReturnValueOnce(true);
    const reader = readerFromChunks([
      'event: complete\ndata: done\n\nevent: message\ndata: ignored\n\n',
    ]);

    await parseSSEStream(reader, dispatch);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('complete', 'done');
  });

  it('resets event type to "message" after dispatching', async () => {
    const dispatch = vi.fn();
    const reader = readerFromChunks([
      'event: confirm_required\ndata: {"id":"c1"}\n\ndata: no-event\n\n',
    ]);

    await parseSSEStream(reader, dispatch);

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[0]).toEqual(['confirm_required', '{"id":"c1"}']);
    expect(dispatch.mock.calls[1]).toEqual(['message', 'no-event']);
  });

  it('flushes remaining data at stream end without trailing blank line', async () => {
    const dispatch = vi.fn();
    // No trailing \n\n — data is still in accumulator when stream closes
    const reader = readerFromChunks(['event: metric\ndata: {"cpu":50}\n']);

    await parseSSEStream(reader, dispatch);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('metric', '{"cpu":50}');
  });

  it('ignores SSE comment lines (starting with :)', async () => {
    const dispatch = vi.fn();
    const reader = readerFromChunks([
      ': this is a comment\nevent: status\ndata: online\n\n',
    ]);

    await parseSSEStream(reader, dispatch);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('status', 'online');
  });

  it('handles event: field appearing before and overriding previous event', async () => {
    const dispatch = vi.fn();
    // Two event: fields — last one wins per SSE spec
    const reader = readerFromChunks([
      'event: old_type\nevent: new_type\ndata: value\n\n',
    ]);

    await parseSSEStream(reader, dispatch);

    expect(dispatch).toHaveBeenCalledWith('new_type', 'value');
  });

  it('handles empty data field', async () => {
    const dispatch = vi.fn();
    const reader = readerFromChunks(['event: ping\ndata: \n\n']);

    await parseSSEStream(reader, dispatch);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('ping', '');
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
    _resetSSEConnectionPool();
  });

  afterEach(() => {
    _resetSSEConnectionPool();
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

  it('strips message and adds reconnect flag on reconnect', async () => {
    const onReconnecting = vi.fn();
    const onComplete = vi.fn();

    // First call: network error to trigger reconnect
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    // Second call: success
    fetchMock.mockResolvedValueOnce(
      okSSEResponse(['event: complete\ndata: {"reconnected":true}\n\n']),
    );

    const handle = createSSEConnection(
      '/chat/srv-1',
      { message: 'hello', sessionId: 'sess-1' },
      { onReconnecting, onComplete },
    );

    // Wait for first attempt to fail
    await vi.advanceTimersByTimeAsync(0);
    expect(onReconnecting).toHaveBeenCalledWith(1);

    // Advance past backoff (1s)
    await vi.advanceTimersByTimeAsync(1000);
    await vi.runAllTimersAsync();

    // Verify the reconnect request body: message removed, reconnect added
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const reconnectCall = fetchMock.mock.calls[1];
    const reconnectBody = JSON.parse(reconnectCall[1].body as string);
    expect(reconnectBody.reconnect).toBe(true);
    expect(reconnectBody.message).toBeUndefined();
    expect(reconnectBody.sessionId).toBe('sess-1');

    // First call should have the original message
    const firstCall = fetchMock.mock.calls[0];
    const firstBody = JSON.parse(firstCall[1].body as string);
    expect(firstBody.message).toBe('hello');
    expect(firstBody.reconnect).toBeUndefined();

    handle.abort();
  });

  it('sends reconnect body on stream-end reconnect (no complete event)', async () => {
    const onReconnecting = vi.fn();
    const onComplete = vi.fn();

    // First stream ends without complete event (triggers reconnect)
    fetchMock.mockResolvedValueOnce(
      okSSEResponse(['event: message\ndata: {"content":"partial"}\n\n']),
    );
    // Reconnect succeeds with complete
    fetchMock.mockResolvedValueOnce(
      okSSEResponse(['event: complete\ndata: {"reconnected":true}\n\n']),
    );

    const handle = createSSEConnection(
      '/chat/srv-1',
      { message: 'test', sessionId: 'sess-2' },
      { onReconnecting, onComplete },
    );

    // Let first stream complete
    await vi.runAllTimersAsync();
    expect(onReconnecting).toHaveBeenCalledWith(1);

    // Advance past backoff
    await vi.advanceTimersByTimeAsync(1000);
    await vi.runAllTimersAsync();

    // Verify reconnect request strips message
    const reconnectCall = fetchMock.mock.calls[1];
    const reconnectBody = JSON.parse(reconnectCall[1].body as string);
    expect(reconnectBody.reconnect).toBe(true);
    expect(reconnectBody.message).toBeUndefined();
    expect(reconnectBody.sessionId).toBe('sess-2');

    expect(onComplete).toHaveBeenCalled();
    handle.abort();
  });
});

// ---------------------------------------------------------------------------
// createGetSSE (generic GET-based SSE wrapper)
// ---------------------------------------------------------------------------
describe('createGetSSE', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    vi.useFakeTimers();
    localStorage.setItem('auth_token', 'test-token');
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    _resetSSEConnectionPool();
    // Reset the refreshAccessToken mock
    const { refreshAccessToken } = await import('./auth');
    vi.mocked(refreshAccessToken).mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    _resetSSEConnectionPool();
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    localStorage.clear();
  });

  it('dispatches events to the dispatch function', async () => {
    const dispatch = vi.fn();
    fetchMock.mockResolvedValueOnce(
      okSSEResponse(['event: metric\ndata: {"cpu":50}\n\n']),
    );

    // Use reconnect: false to avoid infinite loop after stream ends
    const handle = createGetSSE({ path: '/metrics/stream', dispatch, reconnect: false });
    await vi.runAllTimersAsync();

    expect(dispatch).toHaveBeenCalledWith('metric', '{"cpu":50}');
    handle.abort();
  });

  it('sends Authorization header from localStorage', async () => {
    const dispatch = vi.fn();
    fetchMock.mockResolvedValueOnce(
      okSSEResponse(['event: connected\ndata: ok\n\n']),
    );

    const handle = createGetSSE({ path: '/test', dispatch, reconnect: false });
    await vi.runAllTimersAsync();

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-token');
    expect(headers['Accept']).toBe('text/event-stream');
    handle.abort();
  });

  it('reconnects on stream end when reconnect is enabled (default)', async () => {
    const dispatch = vi.fn();
    // First stream ends normally
    fetchMock.mockResolvedValueOnce(
      okSSEResponse(['event: status\ndata: online\n\n']),
    );
    // Second stream also ends
    fetchMock.mockResolvedValueOnce(
      okSSEResponse(['event: status\ndata: offline\n\n']),
    );

    const handle = createGetSSE({ path: '/status', dispatch });

    // Let first stream finish — it schedules a reconnect timer
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Advance past reconnect backoff (1s for attempt 0)
    await vi.advanceTimersByTimeAsync(1000);
    // Let second stream complete then abort before further reconnect
    await vi.advanceTimersByTimeAsync(0);
    handle.abort();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledWith('status', 'online');
    expect(dispatch).toHaveBeenCalledWith('status', 'offline');
  });

  it('does not reconnect when reconnect is false', async () => {
    const dispatch = vi.fn();
    fetchMock.mockResolvedValueOnce(
      okSSEResponse(['event: completed\ndata: done\n\n']),
    );

    const handle = createGetSSE({ path: '/exec/1', dispatch, reconnect: false });
    await vi.runAllTimersAsync();

    // Wait past any potential reconnect
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    handle.abort();
  });

  it('closes stream when dispatch returns true', async () => {
    const dispatch = vi.fn().mockReturnValueOnce(true);
    fetchMock.mockResolvedValueOnce(
      okSSEResponse([
        'event: completed\ndata: done\n\nevent: extra\ndata: ignored\n\n',
      ]),
    );

    const handle = createGetSSE({ path: '/exec/1', dispatch, reconnect: false });
    await vi.runAllTimersAsync();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('completed', 'done');
    handle.abort();
  });

  it('calls onError on HTTP error', async () => {
    const dispatch = vi.fn();
    const onError = vi.fn();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const handle = createGetSSE({
      path: '/missing',
      dispatch,
      onError,
      reconnect: false,
    });
    await vi.runAllTimersAsync();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('Not Found');
    handle.abort();
  });

  it('reconnects on error when reconnect is true', async () => {
    const dispatch = vi.fn();
    const onError = vi.fn();

    // First: network error
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    // Second: success
    fetchMock.mockResolvedValueOnce(
      okSSEResponse(['event: metric\ndata: ok\n\n']),
    );

    const handle = createGetSSE({ path: '/metrics', dispatch, onError });

    // Let first attempt fail
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledTimes(1);

    // Advance past backoff (1s), let second stream complete, then abort
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(0);
    handle.abort();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledWith('metric', 'ok');
  });

  it('resets reconnect counter after successful connection', async () => {
    const dispatch = vi.fn();
    const onError = vi.fn();

    // First: network error → reconnect attempt 0 (delay 1s)
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    // Second: success, stream ends → reconnect attempt should be reset to 0 (delay 1s again)
    fetchMock.mockResolvedValueOnce(
      okSSEResponse(['event: ping\ndata: 1\n\n']),
    );
    // Third: reconnect after stream end
    fetchMock.mockResolvedValueOnce(
      okSSEResponse(['event: ping\ndata: 2\n\n']),
    );

    const handle = createGetSSE({ path: '/stream', dispatch, onError });

    // First attempt fails
    await vi.advanceTimersByTimeAsync(0);

    // Backoff 1s (attempt 0) for reconnect, let second stream complete
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // After success, reconnectAttempt resets. Next backoff should be 1s (not 2s)
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(0);
    handle.abort();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not reconnect or dispatch after abort', async () => {
    const dispatch = vi.fn();

    fetchMock.mockResolvedValueOnce(
      okSSEResponse(['event: data\ndata: first\n\n']),
    );

    const handle = createGetSSE({ path: '/stream', dispatch });

    // Let first stream complete
    await vi.advanceTimersByTimeAsync(0);
    handle.abort();

    // Advance well past any backoff
    await vi.advanceTimersByTimeAsync(30_000);

    // Only one fetch call (no reconnect after abort)
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('attempts 401 token refresh', async () => {
    const { refreshAccessToken } = await import('./auth');
    const refreshMock = vi.mocked(refreshAccessToken);
    refreshMock.mockResolvedValueOnce('new-token');

    const dispatch = vi.fn();
    // First response: 401
    fetchMock.mockResolvedValueOnce(
      new Response('', { status: 401 }),
    );
    // After refresh, retry succeeds
    fetchMock.mockResolvedValueOnce(
      okSSEResponse(['event: connected\ndata: ok\n\n']),
    );

    const handle = createGetSSE({ path: '/stream', dispatch, reconnect: false });
    await vi.runAllTimersAsync();

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Second call should use the new token
    const retryHeaders = fetchMock.mock.calls[1][1].headers as Record<string, string>;
    expect(retryHeaders['Authorization']).toBe('Bearer new-token');
    expect(dispatch).toHaveBeenCalledWith('connected', 'ok');
    handle.abort();
  });

  it('works without auth token', async () => {
    localStorage.clear();
    const dispatch = vi.fn();
    fetchMock.mockResolvedValueOnce(
      okSSEResponse(['event: test\ndata: no-auth\n\n']),
    );

    const handle = createGetSSE({ path: '/public', dispatch, reconnect: false });
    await vi.runAllTimersAsync();

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
    expect(dispatch).toHaveBeenCalledWith('test', 'no-auth');
    handle.abort();
  });
});

// ---------------------------------------------------------------------------
// SSE Connection Pool
// ---------------------------------------------------------------------------
describe('SSEConnectionPool', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.setItem('auth_token', 'test-token');
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    _resetSSEConnectionPool();
  });

  afterEach(() => {
    _resetSSEConnectionPool();
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    localStorage.clear();
  });

  /** Response that never closes — simulates a long-running SSE stream */
  function hangingResponse(): Response {
    return new Response(
      new ReadableStream({ start() { /* intentionally hanging */ } }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );
  }

  it('tracks POST SSE connections in the pool', async () => {
    fetchMock.mockResolvedValue(
      okSSEResponse(['event: complete\ndata: {}\n\n']),
    );

    const pool = getSSEConnectionPool();
    expect(pool.postCount).toBe(0);

    const handle = createSSEConnection('/chat/srv-1', { message: 'hi' }, {});
    expect(pool.postCount).toBe(1);

    await vi.runAllTimersAsync();
    // After complete event, connection is unregistered
    expect(pool.postCount).toBe(0);
    handle.abort();
  });

  it('tracks GET SSE connections in the pool', () => {
    fetchMock.mockReturnValue(hangingResponse());

    const pool = getSSEConnectionPool();
    expect(pool.getCount).toBe(0);

    const handle = createGetSSE({ path: '/stream', dispatch: vi.fn(), reconnect: false });
    expect(pool.getCount).toBe(1);

    handle.abort();
    expect(pool.getCount).toBe(0);
  });

  it('evicts oldest POST SSE when limit is reached', () => {
    _resetSSEConnectionPool(2, 3);
    fetchMock.mockReturnValue(hangingResponse());

    const pool = getSSEConnectionPool();
    const onError1 = vi.fn();

    const handle1 = createSSEConnection('/chat/srv-1', { message: 'a' }, { onError: onError1 });
    const handle2 = createSSEConnection('/chat/srv-2', { message: 'b' }, {});
    expect(pool.postCount).toBe(2);

    // Third connection should evict handle1 (the oldest)
    const handle3 = createSSEConnection('/chat/srv-3', { message: 'c' }, {});
    expect(pool.postCount).toBe(2);
    expect(pool.totalCount).toBe(2);

    // handle1 was aborted by eviction
    expect(handle1.controller.signal.aborted).toBe(true);

    handle2.abort();
    handle3.abort();
  });

  it('evicts oldest GET SSE when limit is reached', () => {
    _resetSSEConnectionPool(3, 2);
    fetchMock.mockReturnValue(hangingResponse());

    const pool = getSSEConnectionPool();

    const handle1 = createGetSSE({ path: '/s1', dispatch: vi.fn(), reconnect: false });
    const handle2 = createGetSSE({ path: '/s2', dispatch: vi.fn(), reconnect: false });
    expect(pool.getCount).toBe(2);

    // Third should evict handle1
    const handle3 = createGetSSE({ path: '/s3', dispatch: vi.fn(), reconnect: false });
    expect(pool.getCount).toBe(2);

    handle2.abort();
    handle3.abort();
    expect(pool.getCount).toBe(0);
  });

  it('POST and GET pools are independent', () => {
    _resetSSEConnectionPool(2, 2);
    fetchMock.mockReturnValue(hangingResponse());

    const pool = getSSEConnectionPool();

    const postHandle1 = createSSEConnection('/chat/srv-1', { message: 'a' }, {});
    const postHandle2 = createSSEConnection('/chat/srv-2', { message: 'b' }, {});
    const getHandle1 = createGetSSE({ path: '/s1', dispatch: vi.fn(), reconnect: false });
    const getHandle2 = createGetSSE({ path: '/s2', dispatch: vi.fn(), reconnect: false });

    expect(pool.postCount).toBe(2);
    expect(pool.getCount).toBe(2);
    expect(pool.totalCount).toBe(4);

    // Adding a 3rd POST evicts oldest POST, not any GET
    const postHandle3 = createSSEConnection('/chat/srv-3', { message: 'c' }, {});
    expect(pool.postCount).toBe(2);
    expect(pool.getCount).toBe(2);

    postHandle2.abort();
    postHandle3.abort();
    getHandle1.abort();
    getHandle2.abort();
  });

  it('unregisters POST SSE on non-retriable error', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(404, 'Not found'));

    const pool = getSSEConnectionPool();
    const handle = createSSEConnection('/chat/srv-1', { message: 'hi' }, { onError: vi.fn() });
    expect(pool.postCount).toBe(1);

    await vi.runAllTimersAsync();
    expect(pool.postCount).toBe(0);
    handle.abort();
  });

  it('keeps POST SSE registered during reconnect attempts', async () => {
    _resetSSEConnectionPool(3, 3);

    // First: network error → reconnect
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    // Second: success with complete
    fetchMock.mockResolvedValueOnce(
      okSSEResponse(['event: complete\ndata: {}\n\n']),
    );

    const pool = getSSEConnectionPool();
    const handle = createSSEConnection('/chat/srv-1', { message: 'hi' }, {
      onReconnecting: vi.fn(),
    });

    // Connection stays registered during reconnect
    expect(pool.postCount).toBe(1);

    await vi.advanceTimersByTimeAsync(0);
    // Still registered (reconnecting)
    expect(pool.postCount).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.runAllTimersAsync();

    // After complete, unregistered
    expect(pool.postCount).toBe(0);
    handle.abort();
  });

  it('_resetSSEConnectionPool aborts all connections and resets counts', () => {
    fetchMock.mockReturnValue(hangingResponse());

    createSSEConnection('/chat/srv-1', { message: 'a' }, {});
    createGetSSE({ path: '/s1', dispatch: vi.fn(), reconnect: false });

    const pool = getSSEConnectionPool();
    expect(pool.postCount).toBe(1);
    expect(pool.getCount).toBe(1);

    _resetSSEConnectionPool();

    const newPool = getSSEConnectionPool();
    expect(newPool.postCount).toBe(0);
    expect(newPool.getCount).toBe(0);
    expect(newPool.totalCount).toBe(0);
  });

  it('abort is idempotent — calling twice does not break pool', () => {
    fetchMock.mockReturnValue(hangingResponse());

    const pool = getSSEConnectionPool();
    const handle = createSSEConnection('/chat/srv-1', { message: 'a' }, {});
    expect(pool.postCount).toBe(1);

    handle.abort();
    expect(pool.postCount).toBe(0);

    // Calling abort again is safe
    handle.abort();
    expect(pool.postCount).toBe(0);
  });

  it('respects default limits of 3 POST and 3 GET', () => {
    const pool = getSSEConnectionPool();
    expect(pool.maxPost).toBe(3);
    expect(pool.maxGet).toBe(3);
  });
});
