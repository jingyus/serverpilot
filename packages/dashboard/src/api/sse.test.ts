// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isRetriableError,
  computeReconnectDelay,
  createSSEConnection,
  parseSSEStream,
} from './sse';
import type { SSECallbacks, SSEConnectionHandle, SSEDispatchFn } from './sse';

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
