// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { API_BASE_URL } from '@/utils/constants';
import {
  getToken,
  clearToken,
  refreshAccessToken,
} from './auth';

// Re-export token helpers so existing consumers don't break
export { setToken, clearToken } from './auth';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** User-friendly error messages by error code */
const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: 'Session expired, please log in again',
  FORBIDDEN: 'You do not have permission to perform this action',
  NOT_FOUND: 'The requested resource was not found',
  VALIDATION_ERROR: 'Invalid input, please check your data',
  RATE_LIMITED: 'Too many requests, please try again later',
  SERVER_OFFLINE: 'Server is offline, cannot process request',
  AI_UNAVAILABLE: 'AI service is temporarily unavailable',
  INTERNAL_ERROR: 'An unexpected error occurred, please try again',
};

function friendlyMessage(code: string, fallback: string, isAuthPath: boolean): string {
  // For auth endpoints (login/register), use the server's message directly
  // — "Invalid email or password" is more helpful than generic "Session expired"
  if (isAuthPath && code === 'UNAUTHORIZED') {
    return fallback;
  }
  return ERROR_MESSAGES[code] ?? fallback;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) ?? {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  // On 401, attempt token refresh and retry once
  if (response.status === 401 && !path.startsWith('/auth/')) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers,
      });
    }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = body.error ?? {};
    const code = error.code ?? 'UNKNOWN_ERROR';
    const message = error.message ?? `Request failed with status ${response.status}`;

    // Force logout on persistent auth failure
    if (response.status === 401 && !path.startsWith('/auth/')) {
      clearToken();
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('auth_user');
      window.dispatchEvent(new CustomEvent('auth:logout'));
    }

    throw new ApiError(response.status, code, friendlyMessage(code, message, path.startsWith('/auth/')));
  }

  return response.json() as Promise<T>;
}
