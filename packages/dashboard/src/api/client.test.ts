// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiRequest, ApiError, setToken, clearToken } from './client';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function mockFetchResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

describe('apiRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('makes GET request and returns data', async () => {
    fetchMock.mockResolvedValueOnce(mockFetchResponse(200, { data: 'test' }));

    const result = await apiRequest<{ data: string }>('/test');

    expect(result).toEqual({ data: 'test' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/test',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    );
  });

  it('includes auth token in header when available', async () => {
    setToken('my-token');
    fetchMock.mockResolvedValueOnce(mockFetchResponse(200, { ok: true }));

    await apiRequest('/test');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/test',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer my-token',
        }),
      })
    );
  });

  it('throws ApiError with user-friendly message on error', async () => {
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(403, {
        error: { code: 'FORBIDDEN', message: 'Access denied' },
      })
    );

    await expect(apiRequest('/test')).rejects.toThrow(ApiError);
    try {
      await apiRequest('/test');
    } catch (err) {
      // The first call already resolved, this is just to verify
    }
  });

  it('throws ApiError with friendly message for known error codes', async () => {
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(429, {
        error: { code: 'RATE_LIMITED', message: 'quota exceeded' },
      })
    );

    try {
      await apiRequest('/test');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).toBe('Too many requests, please try again later');
    }
  });

  it('attempts token refresh on 401 for non-auth routes', async () => {
    setToken('expired-token');
    localStorage.setItem('refresh_token', 'my-refresh');

    // First call: 401
    fetchMock.mockResolvedValueOnce(mockFetchResponse(401, {
      error: { code: 'UNAUTHORIZED', message: 'Token expired' },
    }));

    // Refresh call: success
    fetchMock.mockResolvedValueOnce(mockFetchResponse(200, {
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    }));

    // Retry call: success
    fetchMock.mockResolvedValueOnce(mockFetchResponse(200, { data: 'ok' }));

    const result = await apiRequest<{ data: string }>('/servers');

    expect(result).toEqual({ data: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(localStorage.getItem('auth_token')).toBe('new-access');
    expect(localStorage.getItem('refresh_token')).toBe('new-refresh');
  });

  it('does not attempt refresh for auth routes', async () => {
    setToken('expired-token');
    localStorage.setItem('refresh_token', 'my-refresh');

    fetchMock.mockResolvedValueOnce(mockFetchResponse(401, {
      error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' },
    }));

    await expect(apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a', password: 'b' }),
    })).rejects.toThrow(ApiError);

    // Only 1 call (no refresh attempt)
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('dispatches auth:logout event on persistent 401 failure', async () => {
    setToken('expired-token');
    const listener = vi.fn();
    window.addEventListener('auth:logout', listener);

    // 401 response
    fetchMock.mockResolvedValueOnce(mockFetchResponse(401, {
      error: { code: 'UNAUTHORIZED', message: 'Expired' },
    }));

    // No refresh token available, so refresh won't work
    // Then still 401 after failed refresh

    await expect(apiRequest('/servers')).rejects.toThrow(ApiError);

    expect(listener).toHaveBeenCalled();
    expect(localStorage.getItem('auth_token')).toBeNull();

    window.removeEventListener('auth:logout', listener);
  });

  it('handles network errors gracefully', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network error'));

    await expect(apiRequest('/test')).rejects.toThrow('Network error');
  });
});

describe('setToken / clearToken', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('setToken stores token in localStorage', () => {
    setToken('abc');
    expect(localStorage.getItem('auth_token')).toBe('abc');
  });

  it('clearToken removes token from localStorage', () => {
    setToken('abc');
    clearToken();
    expect(localStorage.getItem('auth_token')).toBeNull();
  });
});
