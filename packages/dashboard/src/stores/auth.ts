// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { create } from 'zustand';
import { apiRequest, setToken, clearToken, ApiError } from '@/api/client';

export interface User {
  id: string;
  email: string;
  name?: string;
  timezone?: string;
}

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => void;
  clearError: () => void;
  restoreSession: () => void;
}

// Eagerly hydrate auth state from localStorage so that MainLayout
// does not flash a redirect to /login on page reload.
function hydrateAuth(): { user: User | null; isAuthenticated: boolean } {
  try {
    const token = localStorage.getItem('auth_token');
    const userJson = localStorage.getItem('auth_user');
    if (token && userJson) {
      return { user: JSON.parse(userJson) as User, isAuthenticated: true };
    }
  } catch { /* ignore */ }
  return { user: null, isAuthenticated: false };
}

const initialAuth = hydrateAuth();

export const useAuthStore = create<AuthState>((set) => ({
  user: initialAuth.user,
  isAuthenticated: initialAuth.isAuthenticated,
  isLoading: false,
  error: null,

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiRequest<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setToken(data.accessToken);
      localStorage.setItem('refresh_token', data.refreshToken);
      localStorage.setItem('auth_user', JSON.stringify(data.user));
      set({ user: data.user, isAuthenticated: true, isLoading: false });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Network error, please try again';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  register: async (email, password, name) => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiRequest<AuthResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
      });
      setToken(data.accessToken);
      localStorage.setItem('refresh_token', data.refreshToken);
      localStorage.setItem('auth_user', JSON.stringify(data.user));
      set({ user: data.user, isAuthenticated: true, isLoading: false });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Network error, please try again';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  logout: () => {
    clearToken();
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('auth_user');
    set({ user: null, isAuthenticated: false, error: null });
  },

  clearError: () => set({ error: null }),

  restoreSession: () => {
    const token = localStorage.getItem('auth_token');
    const userJson = localStorage.getItem('auth_user');
    if (token && userJson) {
      try {
        const user = JSON.parse(userJson) as User;
        set({ user, isAuthenticated: true });
      } catch {
        clearToken();
        localStorage.removeItem('auth_user');
      }
    }

    // Listen for forced logout from token refresh failure
    window.addEventListener('auth:logout', () => {
      set({ user: null, isAuthenticated: false, error: 'Session expired, please log in again' });
    });
  },
}));
