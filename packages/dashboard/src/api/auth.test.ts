// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getToken,
  setToken,
  clearToken,
  getRefreshToken,
  refreshAccessToken,
  _getRefreshPromise,
} from './auth';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = fetchMock;
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  localStorage.clear();
});

function mockRefreshResponse(ok: boolean, body?: unknown): Response {
  return {
    ok,
    status: ok ? 200 : 401,
    json: () => Promise.resolve(body ?? {}),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Token storage helpers
// ---------------------------------------------------------------------------
describe('token storage helpers', () => {
  it('getToken returns null when no token', () => {
    expect(getToken()).toBeNull();
  });

  it('setToken stores and getToken retrieves', () => {
    setToken('abc-123');
    expect(getToken()).toBe('abc-123');
  });

  it('clearToken removes the token', () => {
    setToken('abc-123');
    clearToken();
    expect(getToken()).toBeNull();
  });

  it('getRefreshToken returns null when absent', () => {
    expect(getRefreshToken()).toBeNull();
  });

  it('getRefreshToken returns stored value', () => {
    localStorage.setItem('refresh_token', 'rt-123');
    expect(getRefreshToken()).toBe('rt-123');
  });
});

// ---------------------------------------------------------------------------
// refreshAccessToken — basic behavior
// ---------------------------------------------------------------------------
describe('refreshAccessToken', () => {
  it('returns null when no refresh token exists', async () => {
    const result = await refreshAccessToken();
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns new access token on success', async () => {
    localStorage.setItem('refresh_token', 'rt-old');
    fetchMock.mockResolvedValueOnce(
      mockRefreshResponse(true, {
        accessToken: 'at-new',
        refreshToken: 'rt-new',
      }),
    );

    const result = await refreshAccessToken();

    expect(result).toBe('at-new');
    expect(localStorage.getItem('auth_token')).toBe('at-new');
    expect(localStorage.getItem('refresh_token')).toBe('rt-new');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null on server error response', async () => {
    localStorage.setItem('refresh_token', 'rt-old');
    fetchMock.mockResolvedValueOnce(mockRefreshResponse(false));

    const result = await refreshAccessToken();

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null on network error', async () => {
    localStorage.setItem('refresh_token', 'rt-old');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await refreshAccessToken();

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// refreshAccessToken — deduplication / concurrency
// ---------------------------------------------------------------------------
describe('refreshAccessToken deduplication', () => {
  it('concurrent calls share the same in-flight request', async () => {
    localStorage.setItem('refresh_token', 'rt-old');

    // Use a deferred promise to control when the fetch resolves
    let resolveRefresh!: (v: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    // Launch two concurrent refresh calls
    const p1 = refreshAccessToken();
    const p2 = refreshAccessToken();

    // Both should share the same promise
    expect(_getRefreshPromise()).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1); // only ONE fetch

    // Resolve the shared request
    resolveRefresh(
      mockRefreshResponse(true, {
        accessToken: 'at-shared',
        refreshToken: 'rt-shared',
      }),
    );

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe('at-shared');
    expect(r2).toBe('at-shared');

    // Promise is cleared after resolution
    expect(_getRefreshPromise()).toBeNull();
  });

  it('concurrent calls all receive null on failure', async () => {
    localStorage.setItem('refresh_token', 'rt-old');

    let rejectRefresh!: (e: Error) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((_resolve, reject) => {
        rejectRefresh = reject;
      }),
    );

    const p1 = refreshAccessToken();
    const p2 = refreshAccessToken();
    const p3 = refreshAccessToken();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    rejectRefresh(new TypeError('Network down'));

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toBeNull();
    expect(r2).toBeNull();
    expect(r3).toBeNull();
  });

  it('after first batch resolves, a new call creates a fresh request', async () => {
    localStorage.setItem('refresh_token', 'rt-old');

    // First call
    fetchMock.mockResolvedValueOnce(
      mockRefreshResponse(true, {
        accessToken: 'at-1',
        refreshToken: 'rt-1',
      }),
    );

    const r1 = await refreshAccessToken();
    expect(r1).toBe('at-1');
    expect(_getRefreshPromise()).toBeNull();

    // Second call — should make a new fetch
    fetchMock.mockResolvedValueOnce(
      mockRefreshResponse(true, {
        accessToken: 'at-2',
        refreshToken: 'rt-2',
      }),
    );

    const r2 = await refreshAccessToken();
    expect(r2).toBe('at-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends correct request body to /auth/refresh', async () => {
    localStorage.setItem('refresh_token', 'rt-check');
    fetchMock.mockResolvedValueOnce(
      mockRefreshResponse(true, {
        accessToken: 'at-x',
        refreshToken: 'rt-x',
      }),
    );

    await refreshAccessToken();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/refresh'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: 'rt-check' }),
      }),
    );
  });
});
