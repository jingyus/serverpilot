// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSystemStore, useIsFeatureEnabled } from "./system";
import type { EditionResponse, FeatureKey } from "./system";

// Mock the API client module
const mockApiRequest = vi.fn();
vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CE_RESPONSE: EditionResponse = {
  edition: "ce",
  features: {
    chat: true,
    commandExecution: true,
    knowledgeBase: true,
    multiServer: false,
    multiSession: false,
    teamCollaboration: false,
    webhooks: false,
    alerts: false,
    metricsMonitoring: false,
    auditExport: false,
    oauthLogin: false,
    rateLimiting: false,
    multiTenant: false,
    billing: false,
  },
  version: "1.0.0",
  limits: {
    maxServers: 1,
    maxSessions: 1,
    maxSkills: 5,
    maxUsers: 1,
  },
};

const EE_RESPONSE: EditionResponse = {
  edition: "ee",
  features: {
    chat: true,
    commandExecution: true,
    knowledgeBase: true,
    multiServer: true,
    multiSession: true,
    teamCollaboration: true,
    webhooks: true,
    alerts: true,
    metricsMonitoring: true,
    auditExport: true,
    oauthLogin: true,
    rateLimiting: true,
    multiTenant: false,
    billing: false,
  },
  version: "2.0.0",
  limits: {
    maxServers: -1,
    maxSessions: -1,
    maxSkills: -1,
    maxUsers: -1,
  },
};

function resetStore(): void {
  useSystemStore.setState({
    edition: null,
    features: {},
    version: null,
    limits: null,
    isLoading: false,
    error: null,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSystemStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  describe("initial state", () => {
    it("should have null edition and empty features before fetch", () => {
      const state = useSystemStore.getState();
      expect(state.edition).toBeNull();
      expect(state.features).toEqual({});
      expect(state.version).toBeNull();
      expect(state.limits).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe("fetchEdition", () => {
    it("should fetch and store CE edition info", async () => {
      mockApiRequest.mockResolvedValueOnce(CE_RESPONSE);

      await useSystemStore.getState().fetchEdition();

      const state = useSystemStore.getState();
      expect(state.edition).toBe("ce");
      expect(state.features.chat).toBe(true);
      expect(state.features.multiServer).toBe(false);
      expect(state.features.webhooks).toBe(false);
      expect(state.version).toBe("1.0.0");
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(mockApiRequest).toHaveBeenCalledWith("/system/edition");
    });

    it("should fetch and store EE edition info", async () => {
      mockApiRequest.mockResolvedValueOnce(EE_RESPONSE);

      await useSystemStore.getState().fetchEdition();

      const state = useSystemStore.getState();
      expect(state.edition).toBe("ee");
      expect(state.features.multiServer).toBe(true);
      expect(state.features.webhooks).toBe(true);
      expect(state.features.teamCollaboration).toBe(true);
      expect(state.version).toBe("2.0.0");
    });

    it("should not re-fetch if edition is already loaded", async () => {
      mockApiRequest.mockResolvedValueOnce(CE_RESPONSE);

      await useSystemStore.getState().fetchEdition();
      await useSystemStore.getState().fetchEdition();

      expect(mockApiRequest).toHaveBeenCalledTimes(1);
    });

    it("should not start a second fetch while loading", async () => {
      let resolveFirst!: (value: EditionResponse) => void;
      mockApiRequest.mockReturnValueOnce(
        new Promise<EditionResponse>((r) => {
          resolveFirst = r;
        }),
      );

      const firstCall = useSystemStore.getState().fetchEdition();
      // Second call while first is in-flight
      await useSystemStore.getState().fetchEdition();
      expect(mockApiRequest).toHaveBeenCalledTimes(1);

      resolveFirst(CE_RESPONSE);
      await firstCall;

      expect(useSystemStore.getState().edition).toBe("ce");
    });

    it("should handle ApiError gracefully", async () => {
      const { ApiError } = await import("@/api/client");
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(500, "INTERNAL_ERROR", "Server error"),
      );

      await useSystemStore.getState().fetchEdition();

      const state = useSystemStore.getState();
      expect(state.edition).toBeNull();
      expect(state.features).toEqual({});
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe("Server error");
    });

    it("should handle network errors gracefully", async () => {
      mockApiRequest.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      await useSystemStore.getState().fetchEdition();

      const state = useSystemStore.getState();
      expect(state.edition).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe("Failed to load system information");
    });

    it("should store CE limits after fetch", async () => {
      mockApiRequest.mockResolvedValueOnce(CE_RESPONSE);

      await useSystemStore.getState().fetchEdition();

      const state = useSystemStore.getState();
      expect(state.limits).toEqual({
        maxServers: 1,
        maxSessions: 1,
        maxSkills: 5,
        maxUsers: 1,
      });
    });

    it("should store EE limits (-1 for unlimited) after fetch", async () => {
      mockApiRequest.mockResolvedValueOnce(EE_RESPONSE);

      await useSystemStore.getState().fetchEdition();

      const state = useSystemStore.getState();
      expect(state.limits).toEqual({
        maxServers: -1,
        maxSessions: -1,
        maxSkills: -1,
        maxUsers: -1,
      });
    });

    it("should keep limits null on fetch error", async () => {
      mockApiRequest.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      await useSystemStore.getState().fetchEdition();

      expect(useSystemStore.getState().limits).toBeNull();
    });

    it("should allow retry after error", async () => {
      mockApiRequest.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await useSystemStore.getState().fetchEdition();
      expect(useSystemStore.getState().error).toBeTruthy();

      // Reset error and edition to allow retry
      useSystemStore.setState({ error: null, edition: null });

      mockApiRequest.mockResolvedValueOnce(CE_RESPONSE);
      await useSystemStore.getState().fetchEdition();

      expect(useSystemStore.getState().edition).toBe("ce");
      expect(useSystemStore.getState().error).toBeNull();
    });
  });

  describe("clearError", () => {
    it("should clear the error state", async () => {
      mockApiRequest.mockRejectedValueOnce(new TypeError("fail"));
      await useSystemStore.getState().fetchEdition();
      expect(useSystemStore.getState().error).toBeTruthy();

      useSystemStore.getState().clearError();
      expect(useSystemStore.getState().error).toBeNull();
    });

    it("should not affect other state when clearing error", async () => {
      // Load edition first, then inject an error manually
      mockApiRequest.mockResolvedValueOnce(CE_RESPONSE);
      await useSystemStore.getState().fetchEdition();
      useSystemStore.setState({ error: "manual error" });

      useSystemStore.getState().clearError();

      const state = useSystemStore.getState();
      expect(state.error).toBeNull();
      expect(state.edition).toBe("ce");
      expect(state.version).toBe("1.0.0");
      expect(state.features.chat).toBe(true);
    });

    it("should be a no-op when there is no error", () => {
      useSystemStore.getState().clearError();
      const state = useSystemStore.getState();
      expect(state.error).toBeNull();
      expect(state.edition).toBeNull();
    });
  });

  describe("isLoading transitions", () => {
    it("should set isLoading=true at the start of fetch", () => {
      mockApiRequest.mockReturnValueOnce(new Promise(() => {}));
      // Start the fetch (don't await)
      useSystemStore.getState().fetchEdition();
      expect(useSystemStore.getState().isLoading).toBe(true);
      expect(useSystemStore.getState().error).toBeNull();
    });

    it("should set isLoading=false after successful fetch", async () => {
      mockApiRequest.mockResolvedValueOnce(EE_RESPONSE);
      await useSystemStore.getState().fetchEdition();
      expect(useSystemStore.getState().isLoading).toBe(false);
    });

    it("should set isLoading=false after failed fetch", async () => {
      mockApiRequest.mockRejectedValueOnce(new Error("boom"));
      await useSystemStore.getState().fetchEdition();
      expect(useSystemStore.getState().isLoading).toBe(false);
    });
  });

  describe("all feature keys", () => {
    it("should store all 13 feature keys from EE response", async () => {
      mockApiRequest.mockResolvedValueOnce(EE_RESPONSE);
      await useSystemStore.getState().fetchEdition();

      const ALL_KEYS: FeatureKey[] = [
        "chat",
        "commandExecution",
        "knowledgeBase",
        "multiServer",
        "teamCollaboration",
        "webhooks",
        "alerts",
        "metricsMonitoring",
        "auditExport",
        "oauthLogin",
        "rateLimiting",
        "multiTenant",
        "billing",
      ];
      const { features } = useSystemStore.getState();
      for (const key of ALL_KEYS) {
        expect(features).toHaveProperty(key);
        expect(typeof features[key]).toBe("boolean");
      }
    });

    it("should preserve feature values exactly as returned by server", async () => {
      mockApiRequest.mockResolvedValueOnce(EE_RESPONSE);
      await useSystemStore.getState().fetchEdition();

      const { features } = useSystemStore.getState();
      // EE_RESPONSE has multiTenant=false and billing=false
      expect(features.multiTenant).toBe(false);
      expect(features.billing).toBe(false);
      // Core features are true
      expect(features.chat).toBe(true);
      expect(features.metricsMonitoring).toBe(true);
    });
  });
});

describe("useIsFeatureEnabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("should return false for all features before edition is fetched", () => {
    const features: FeatureKey[] = [
      "multiServer",
      "webhooks",
      "alerts",
      "teamCollaboration",
      "chat",
      "commandExecution",
      "knowledgeBase",
    ];
    for (const key of features) {
      const { result } = renderHook(() => useIsFeatureEnabled(key));
      expect(result.current).toBe(false);
    }
  });

  it("should return true for CE core features after fetch", async () => {
    mockApiRequest.mockResolvedValueOnce(CE_RESPONSE);

    await act(async () => {
      await useSystemStore.getState().fetchEdition();
    });

    const { result: chat } = renderHook(() => useIsFeatureEnabled("chat"));
    const { result: cmd } = renderHook(() =>
      useIsFeatureEnabled("commandExecution"),
    );
    const { result: kb } = renderHook(() =>
      useIsFeatureEnabled("knowledgeBase"),
    );

    expect(chat.current).toBe(true);
    expect(cmd.current).toBe(true);
    expect(kb.current).toBe(true);
  });

  it("should return false for EE features on CE edition", async () => {
    mockApiRequest.mockResolvedValueOnce(CE_RESPONSE);

    await act(async () => {
      await useSystemStore.getState().fetchEdition();
    });

    const { result: ms } = renderHook(() => useIsFeatureEnabled("multiServer"));
    const { result: wh } = renderHook(() => useIsFeatureEnabled("webhooks"));
    const { result: al } = renderHook(() => useIsFeatureEnabled("alerts"));
    const { result: tc } = renderHook(() =>
      useIsFeatureEnabled("teamCollaboration"),
    );

    expect(ms.current).toBe(false);
    expect(wh.current).toBe(false);
    expect(al.current).toBe(false);
    expect(tc.current).toBe(false);
  });

  it("should return true for EE features on EE edition", async () => {
    mockApiRequest.mockResolvedValueOnce(EE_RESPONSE);

    await act(async () => {
      await useSystemStore.getState().fetchEdition();
    });

    const { result: ms } = renderHook(() => useIsFeatureEnabled("multiServer"));
    const { result: wh } = renderHook(() => useIsFeatureEnabled("webhooks"));
    const { result: al } = renderHook(() => useIsFeatureEnabled("alerts"));

    expect(ms.current).toBe(true);
    expect(wh.current).toBe(true);
    expect(al.current).toBe(true);
  });

  it("should return false for cloud-only features on non-cloud EE", async () => {
    mockApiRequest.mockResolvedValueOnce(EE_RESPONSE);

    await act(async () => {
      await useSystemStore.getState().fetchEdition();
    });

    const { result: mt } = renderHook(() => useIsFeatureEnabled("multiTenant"));
    const { result: bl } = renderHook(() => useIsFeatureEnabled("billing"));

    expect(mt.current).toBe(false);
    expect(bl.current).toBe(false);
  });

  it("should check all 13 feature keys return false before fetch", () => {
    const ALL_KEYS: FeatureKey[] = [
      "chat",
      "commandExecution",
      "knowledgeBase",
      "multiServer",
      "teamCollaboration",
      "webhooks",
      "alerts",
      "metricsMonitoring",
      "auditExport",
      "oauthLogin",
      "rateLimiting",
      "multiTenant",
      "billing",
    ];
    for (const key of ALL_KEYS) {
      const { result } = renderHook(() => useIsFeatureEnabled(key));
      expect(result.current).toBe(false);
    }
  });

  it("should react to store state changes", async () => {
    const { result } = renderHook(() => useIsFeatureEnabled("webhooks"));
    expect(result.current).toBe(false);

    // Simulate edition load
    act(() => {
      useSystemStore.setState({
        edition: "ee",
        features: EE_RESPONSE.features,
      });
    });

    expect(result.current).toBe(true);
  });

  it("should return false for features not present in partial store", () => {
    // Set partial features (only chat)
    useSystemStore.setState({
      edition: "ce",
      features: { chat: true },
    });

    const { result } = renderHook(() => useIsFeatureEnabled("multiServer"));
    expect(result.current).toBe(false);
  });
});
