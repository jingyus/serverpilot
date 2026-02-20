// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { API_BASE_URL } from "@/utils/constants";

// ---------------------------------------------------------------------------
// Token storage helpers
// ---------------------------------------------------------------------------

export function getToken(): string | null {
  return localStorage.getItem("auth_token");
}

export function setToken(token: string): void {
  localStorage.setItem("auth_token", token);
}

export function clearToken(): void {
  localStorage.removeItem("auth_token");
}

export function getRefreshToken(): string | null {
  return localStorage.getItem("refresh_token");
}

// ---------------------------------------------------------------------------
// Deduplicated token refresh
// ---------------------------------------------------------------------------

interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

/** In-flight refresh promise — ensures at most one refresh request at a time */
let refreshPromise: Promise<string | null> | null = null;

/**
 * Attempt to refresh the access token. Concurrent callers share the same
 * in-flight request — only one HTTP call is made regardless of how many
 * SSE/API streams hit 401 simultaneously.
 *
 * @returns The new access token on success, or null on failure.
 */
export function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = doRefresh().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function doRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as RefreshResponse;
    setToken(data.accessToken);
    localStorage.setItem("refresh_token", data.refreshToken);
    return data.accessToken;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** @internal — expose current refresh promise for testing deduplication */
export function _getRefreshPromise(): Promise<string | null> | null {
  return refreshPromise;
}

/**
 * Get tenant ID from user data (stub for cloud features)
 * TODO: Implement proper tenant management
 */
export function getTenantId(): string | null {
  // Stub implementation - cloud features need proper tenant context
  return null;
}
