// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { API_BASE_URL } from "@/utils/constants";
import { getToken, clearToken, refreshAccessToken } from "./auth";

// Re-export token helpers so existing consumers don't break
export { setToken, clearToken } from "./auth";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class ApiTimeoutError extends Error {
  constructor(public timeoutMs: number) {
    super(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = "ApiTimeoutError";
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

export interface ApiRequestOptions extends RequestInit {
  /** Request timeout in milliseconds. Defaults to 30000 (30s). Set to 0 to disable. */
  timeout?: number;
}

/** User-friendly error messages by error code */
const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "Session expired, please log in again",
  FORBIDDEN: "You do not have permission to perform this action",
  NOT_FOUND: "The requested resource was not found",
  VALIDATION_ERROR: "Invalid input, please check your data",
  RATE_LIMITED: "Too many requests, please try again later",
  SERVER_OFFLINE: "Server is offline, cannot process request",
  AI_UNAVAILABLE: "AI service is temporarily unavailable",
  INTERNAL_ERROR: "An unexpected error occurred, please try again",
};

function friendlyMessage(
  code: string,
  fallback: string,
  isAuthPath: boolean,
): string {
  // For auth endpoints (login/register), use the server's message directly
  // — "Invalid email or password" is more helpful than generic "Session expired"
  if (isAuthPath && code === "UNAUTHORIZED") {
    return fallback;
  }
  return ERROR_MESSAGES[code] ?? fallback;
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { timeout = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;

  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((fetchOptions.headers as Record<string, string>) ?? {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let response = await fetchWithTimeout(
    `${API_BASE_URL}${path}`,
    {
      ...fetchOptions,
      headers,
      signal: fetchOptions.signal,
    },
    timeout,
  );

  // On 401, attempt token refresh and retry once
  if (response.status === 401 && !path.startsWith("/auth/")) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers["Authorization"] = `Bearer ${newToken}`;
      response = await fetchWithTimeout(
        `${API_BASE_URL}${path}`,
        {
          ...fetchOptions,
          headers,
          signal: fetchOptions.signal,
        },
        timeout,
      );
    }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = body.error ?? {};
    const code = error.code ?? "UNKNOWN_ERROR";
    const message =
      error.message ?? `Request failed with status ${response.status}`;

    // Force logout on persistent auth failure
    if (response.status === 401 && !path.startsWith("/auth/")) {
      clearToken();
      localStorage.removeItem("refresh_token");
      localStorage.removeItem("auth_user");
      window.dispatchEvent(new CustomEvent("auth:logout"));
    }

    throw new ApiError(
      response.status,
      code,
      friendlyMessage(code, message, path.startsWith("/auth/")),
    );
  }

  return response.json() as Promise<T>;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  if (timeoutMs <= 0) {
    return fetch(url, init);
  }

  const controller = new AbortController();
  const existingSignal = init.signal;

  // If caller already provided a signal, abort our controller when theirs aborts
  if (existingSignal) {
    if (existingSignal.aborted) {
      controller.abort(existingSignal.reason);
    } else {
      existingSignal.addEventListener(
        "abort",
        () => {
          controller.abort(existingSignal.reason);
        },
        { once: true },
      );
    }
  }

  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      // Distinguish timeout from caller-initiated abort
      if (existingSignal?.aborted) {
        throw err; // Caller aborted — re-throw original
      }
      throw new ApiTimeoutError(timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
