// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAuthStore } from './auth';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function mockFetchResponse(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

describe('useAuthStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('login', () => {
    it('sets user and tokens on successful login', async () => {
      const responseData = {
        accessToken: 'test-jwt-token',
        refreshToken: 'test-refresh-token',
        user: { id: '1', email: 'test@example.com', name: 'Test' },
      };
      mockFetchResponse(200, responseData);

      await useAuthStore.getState().login('test@example.com', 'password');

      const state = useAuthStore.getState();
      expect(state.user).toEqual(responseData.user);
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(localStorage.getItem('auth_token')).toBe('test-jwt-token');
      expect(localStorage.getItem('refresh_token')).toBe('test-refresh-token');
      expect(localStorage.getItem('auth_user')).toBe(
        JSON.stringify(responseData.user)
      );
    });

    it('sets error on failed login', async () => {
      mockFetchResponse(401, {
        error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' },
      });

      await expect(
        useAuthStore.getState().login('test@example.com', 'wrong')
      ).rejects.toThrow();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.error).toBeTruthy();
      expect(state.isLoading).toBe(false);
    });

    it('sets loading state during login', async () => {
      let resolvePromise: (value: unknown) => void;
      fetchMock.mockReturnValueOnce(
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
      );

      const loginPromise = useAuthStore.getState().login('test@example.com', 'pass');
      expect(useAuthStore.getState().isLoading).toBe(true);

      resolvePromise!({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            accessToken: 'tok',
            refreshToken: 'ref',
            user: { id: '1', email: 'test@example.com' },
          }),
      });

      await loginPromise;
      expect(useAuthStore.getState().isLoading).toBe(false);
    });
  });

  describe('register', () => {
    it('sets user and tokens on successful registration', async () => {
      const responseData = {
        accessToken: 'new-token',
        refreshToken: 'new-refresh-token',
        user: { id: '2', email: 'new@example.com', name: 'New User' },
      };
      mockFetchResponse(200, responseData);

      await useAuthStore.getState().register('new@example.com', 'password', 'New User');

      const state = useAuthStore.getState();
      expect(state.user).toEqual(responseData.user);
      expect(state.isAuthenticated).toBe(true);
      expect(localStorage.getItem('auth_token')).toBe('new-token');
      expect(localStorage.getItem('refresh_token')).toBe('new-refresh-token');
    });

    it('sets error on registration failure', async () => {
      mockFetchResponse(400, {
        error: { code: 'VALIDATION_ERROR', message: 'Email already exists' },
      });

      await expect(
        useAuthStore.getState().register('dup@example.com', 'password', 'Dup')
      ).rejects.toThrow();

      expect(useAuthStore.getState().error).toBeTruthy();
    });
  });

  describe('logout', () => {
    it('clears user state and localStorage', () => {
      localStorage.setItem('auth_token', 'some-token');
      localStorage.setItem('refresh_token', 'some-refresh');
      localStorage.setItem('auth_user', '{"id":"1"}');
      useAuthStore.setState({
        user: { id: '1', email: 'test@example.com' },
        isAuthenticated: true,
      });

      useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(localStorage.getItem('auth_token')).toBeNull();
      expect(localStorage.getItem('refresh_token')).toBeNull();
      expect(localStorage.getItem('auth_user')).toBeNull();
    });
  });

  describe('clearError', () => {
    it('clears the error state', () => {
      useAuthStore.setState({ error: 'Some error' });
      useAuthStore.getState().clearError();
      expect(useAuthStore.getState().error).toBeNull();
    });
  });

  describe('restoreSession', () => {
    it('restores user from localStorage', () => {
      const user = { id: '1', email: 'test@example.com', name: 'Test' };
      localStorage.setItem('auth_token', 'stored-token');
      localStorage.setItem('auth_user', JSON.stringify(user));

      useAuthStore.getState().restoreSession();

      const state = useAuthStore.getState();
      expect(state.user).toEqual(user);
      expect(state.isAuthenticated).toBe(true);
    });

    it('does nothing when no token in localStorage', () => {
      useAuthStore.getState().restoreSession();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });

    it('clears invalid data from localStorage', () => {
      localStorage.setItem('auth_token', 'token');
      localStorage.setItem('auth_user', 'invalid-json');

      useAuthStore.getState().restoreSession();

      expect(useAuthStore.getState().user).toBeNull();
      expect(localStorage.getItem('auth_token')).toBeNull();
      expect(localStorage.getItem('auth_user')).toBeNull();
    });
  });
});
