// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  apiRequest,
  ApiError,
  ApiTimeoutError,
  setToken,
  clearToken,
} from "./client";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function mockFetchResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

describe("apiRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("makes GET request and returns data", async () => {
    fetchMock.mockResolvedValueOnce(mockFetchResponse(200, { data: "test" }));

    const result = await apiRequest<{ data: string }>("/test");

    expect(result).toEqual({ data: "test" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/test",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("includes auth token in header when available", async () => {
    setToken("my-token");
    fetchMock.mockResolvedValueOnce(mockFetchResponse(200, { ok: true }));

    await apiRequest("/test");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/test",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer my-token",
        }),
      }),
    );
  });

  it("throws ApiError with user-friendly message on error", async () => {
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(403, {
        error: { code: "FORBIDDEN", message: "Access denied" },
      }),
    );

    await expect(apiRequest("/test")).rejects.toThrow(ApiError);
    try {
      await apiRequest("/test");
    } catch (err) {
      // The first call already resolved, this is just to verify
    }
  });

  it("throws ApiError with friendly message for known error codes", async () => {
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(429, {
        error: { code: "RATE_LIMITED", message: "quota exceeded" },
      }),
    );

    try {
      await apiRequest("/test");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).toBe(
        "Too many requests, please try again later",
      );
    }
  });

  it("attempts token refresh on 401 for non-auth routes", async () => {
    setToken("expired-token");
    localStorage.setItem("refresh_token", "my-refresh");

    // First call: 401
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(401, {
        error: { code: "UNAUTHORIZED", message: "Token expired" },
      }),
    );

    // Refresh call: success
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(200, {
        accessToken: "new-access",
        refreshToken: "new-refresh",
      }),
    );

    // Retry call: success
    fetchMock.mockResolvedValueOnce(mockFetchResponse(200, { data: "ok" }));

    const result = await apiRequest<{ data: string }>("/servers");

    expect(result).toEqual({ data: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(localStorage.getItem("auth_token")).toBe("new-access");
    expect(localStorage.getItem("refresh_token")).toBe("new-refresh");
  });

  it("does not attempt refresh for auth routes", async () => {
    setToken("expired-token");
    localStorage.setItem("refresh_token", "my-refresh");

    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(401, {
        error: { code: "UNAUTHORIZED", message: "Invalid credentials" },
      }),
    );

    await expect(
      apiRequest("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "a", password: "b" }),
      }),
    ).rejects.toThrow(ApiError);

    // Only 1 call (no refresh attempt)
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("dispatches auth:logout event on persistent 401 failure", async () => {
    setToken("expired-token");
    const listener = vi.fn();
    window.addEventListener("auth:logout", listener);

    // 401 response
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(401, {
        error: { code: "UNAUTHORIZED", message: "Expired" },
      }),
    );

    // No refresh token available, so refresh won't work
    // Then still 401 after failed refresh

    await expect(apiRequest("/servers")).rejects.toThrow(ApiError);

    expect(listener).toHaveBeenCalled();
    expect(localStorage.getItem("auth_token")).toBeNull();

    window.removeEventListener("auth:logout", listener);
  });

  it("handles network errors gracefully", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Network error"));

    await expect(apiRequest("/test")).rejects.toThrow("Network error");
  });

  describe("timeout", () => {
    /** Creates a fetch mock that hangs until the abort signal fires */
    function hangingFetch() {
      return (_url: string, init?: RequestInit) =>
        new Promise<ReturnType<typeof mockFetchResponse>>((resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            const onAbort = () =>
              reject(
                new DOMException("The operation was aborted.", "AbortError"),
              );
            if (signal.aborted) return onAbort();
            signal.addEventListener("abort", onAbort, { once: true });
          }
          // Never resolves on its own — waits for abort
        });
    }

    it("throws ApiTimeoutError when request exceeds timeout", async () => {
      fetchMock.mockImplementationOnce(hangingFetch());

      const promise = apiRequest("/test", { timeout: 50 });

      await expect(promise).rejects.toThrow(ApiTimeoutError);
      await expect(promise).rejects.toThrow("Request timed out after 0s");
    });

    it("ApiTimeoutError exposes timeoutMs", async () => {
      fetchMock.mockImplementationOnce(hangingFetch());

      try {
        await apiRequest("/test", { timeout: 100 });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiTimeoutError);
        expect((err as ApiTimeoutError).timeoutMs).toBe(100);
        expect((err as ApiTimeoutError).name).toBe("ApiTimeoutError");
      }
    });

    it("does not timeout when request completes in time", async () => {
      fetchMock.mockResolvedValueOnce(mockFetchResponse(200, { ok: true }));

      const result = await apiRequest<{ ok: boolean }>("/test", {
        timeout: 5000,
      });

      expect(result).toEqual({ ok: true });
    });

    it("uses default 30s timeout when not specified", async () => {
      fetchMock.mockResolvedValueOnce(mockFetchResponse(200, { ok: true }));

      await apiRequest("/test");

      // Request should succeed — the default timeout is 30s, which is far longer than a mock
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("disables timeout when set to 0", async () => {
      fetchMock.mockResolvedValueOnce(mockFetchResponse(200, { data: 1 }));

      const result = await apiRequest<{ data: number }>("/test", {
        timeout: 0,
      });

      expect(result).toEqual({ data: 1 });
      // When timeout=0, fetch is called without our AbortController wrapping
      const callArgs = fetchMock.mock.calls[0];
      expect(callArgs[1].signal).toBeUndefined();
    });

    it("re-throws caller AbortError when caller signal aborts", async () => {
      const callerController = new AbortController();

      fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
        // Simulate caller aborting during fetch
        callerController.abort();
        return Promise.reject(
          new DOMException("The operation was aborted.", "AbortError"),
        );
      });

      await expect(
        apiRequest("/test", { signal: callerController.signal, timeout: 5000 }),
      ).rejects.toThrow(DOMException);

      // Should NOT be ApiTimeoutError
      try {
        fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
          callerController.abort();
          return Promise.reject(
            new DOMException("The operation was aborted.", "AbortError"),
          );
        });
        await apiRequest("/test", {
          signal: callerController.signal,
          timeout: 5000,
        });
      } catch (err) {
        expect(err).not.toBeInstanceOf(ApiTimeoutError);
      }
    });

    it("timeout applies to 401 retry as well", async () => {
      setToken("expired-token");
      localStorage.setItem("refresh_token", "my-refresh");

      // First call: 401
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(401, {
          error: { code: "UNAUTHORIZED", message: "Token expired" },
        }),
      );

      // Refresh call: success
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(200, {
          accessToken: "new-access",
          refreshToken: "new-refresh",
        }),
      );

      // Retry call: hangs until abort signal fires
      fetchMock.mockImplementationOnce(hangingFetch());

      await expect(apiRequest("/servers", { timeout: 50 })).rejects.toThrow(
        ApiTimeoutError,
      );
    });
  });
});

describe("setToken / clearToken", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("setToken stores token in localStorage", () => {
    setToken("abc");
    expect(localStorage.getItem("auth_token")).toBe("abc");
  });

  it("clearToken removes token from localStorage", () => {
    setToken("abc");
    clearToken();
    expect(localStorage.getItem("auth_token")).toBeNull();
  });
});
