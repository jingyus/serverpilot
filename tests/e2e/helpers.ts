/**
 * E2E test helpers and shared utilities.
 *
 * Provides API helper functions for test setup (user creation,
 * server creation, auth tokens) without going through the UI.
 *
 * @module tests/e2e/helpers
 */

import type { APIRequestContext } from '@playwright/test';

const API_BASE = 'http://localhost:3000/api/v1';

export interface TestUser {
  id: string;
  email: string;
  name: string;
  accessToken: string;
  refreshToken: string;
}

export interface TestServer {
  id: string;
  name: string;
  agentToken: string;
}

let userCounter = 0;

/** Generate a unique test email */
export function uniqueEmail(): string {
  return `e2e-user-${Date.now()}-${++userCounter}@test.local`;
}

/** Register a user via the API and return tokens + user info */
export async function registerUser(
  request: APIRequestContext,
  overrides: { email?: string; password?: string; name?: string } = {},
): Promise<TestUser> {
  const email = overrides.email ?? uniqueEmail();
  const password = overrides.password ?? 'TestPass123!';
  const name = overrides.name ?? 'E2E Test User';

  const res = await request.post(`${API_BASE}/auth/register`, {
    data: { email, password, name },
  });

  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`Register failed (${res.status()}): ${body}`);
  }

  const json = await res.json();
  return {
    id: json.user.id,
    email: json.user.email,
    name: json.user.name,
    accessToken: json.accessToken,
    refreshToken: json.refreshToken,
  };
}

/** Login a user via the API */
export async function loginUser(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<TestUser> {
  const res = await request.post(`${API_BASE}/auth/login`, {
    data: { email, password },
  });

  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`Login failed (${res.status()}): ${body}`);
  }

  const json = await res.json();
  return {
    id: json.user.id,
    email: json.user.email,
    name: json.user.name,
    accessToken: json.accessToken,
    refreshToken: json.refreshToken,
  };
}

/** Create a server via the API (requires auth) */
export async function createServer(
  request: APIRequestContext,
  token: string,
  name: string,
  tags?: string[],
): Promise<TestServer> {
  const res = await request.post(`${API_BASE}/servers`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, tags },
  });

  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`Create server failed (${res.status()}): ${body}`);
  }

  const json = await res.json();
  return {
    id: json.server.id,
    name: json.server.name,
    agentToken: json.token,
  };
}

/**
 * Set auth tokens in the browser so the dashboard recognizes the session.
 *
 * Uses `addInitScript` so that localStorage is populated BEFORE the app's
 * JavaScript initialises on any subsequent navigation. This avoids the race
 * where MainLayout renders with `isAuthenticated=false` and redirects to
 * /login before the `restoreSession` useEffect can run.
 *
 * Usage: call setAuthInBrowser, then navigate to the target page.
 * The page must already be on the same origin (e.g. after `page.goto('/login')`).
 */
export async function setAuthInBrowser(
  page: import('@playwright/test').Page,
  user: TestUser,
): Promise<void> {
  const userJson = JSON.stringify({ id: user.id, email: user.email, name: user.name });

  // Set localStorage now (page must be on same origin)
  await page.evaluate(
    ({ accessToken, refreshToken, uj }) => {
      localStorage.setItem('auth_token', accessToken);
      localStorage.setItem('refresh_token', refreshToken);
      localStorage.setItem('auth_user', uj);
    },
    { accessToken: user.accessToken, refreshToken: user.refreshToken, uj: userJson },
  );

  // Also register an init script so localStorage is re-set BEFORE page JS
  // runs on the next navigation (avoids the isAuthenticated=false race).
  await page.addInitScript(
    ({ accessToken, refreshToken, uj }) => {
      localStorage.setItem('auth_token', accessToken);
      localStorage.setItem('refresh_token', refreshToken);
      localStorage.setItem('auth_user', uj);
    },
    { accessToken: user.accessToken, refreshToken: user.refreshToken, uj: userJson },
  );
}

/** Make an authenticated API call */
export async function apiGet(
  request: APIRequestContext,
  path: string,
  token: string,
): Promise<unknown> {
  const res = await request.get(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

/** Make an authenticated API POST */
export async function apiPost(
  request: APIRequestContext,
  path: string,
  token: string,
  data: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await request.post(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  return { status: res.status(), body: await res.json() };
}

/** Make an authenticated API PATCH */
export async function apiPatch(
  request: APIRequestContext,
  path: string,
  token: string,
  data: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await request.patch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  return { status: res.status(), body: await res.json() };
}

/** Make an authenticated API DELETE */
export async function apiDelete(
  request: APIRequestContext,
  path: string,
  token: string,
): Promise<{ status: number; body: unknown }> {
  const res = await request.delete(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status(), body: await res.json() };
}
