// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSystemStore } from "@/stores/system";
import type { EditionResponse } from "@/stores/system";
import { useFeatures, useEdition } from "./useFeatures";

// Mock the API client module (same mock as system.test.ts)
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
  limits: { maxServers: 1, maxSessions: 1, maxSkills: 5, maxUsers: 1 },
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
  limits: { maxServers: -1, maxSessions: -1, maxSkills: -1, maxUsers: -1 },
};

function resetStore(): void {
  useSystemStore.setState({
    edition: null,
    features: {},
    version: null,
    isLoading: false,
    error: null,
  });
}

// ---------------------------------------------------------------------------
// useFeatures
// ---------------------------------------------------------------------------

describe("useFeatures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("should return all features as false before fetch", () => {
    const { result } = renderHook(() => useFeatures());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.features.chat).toBe(false);
    expect(result.current.features.multiServer).toBe(false);
    expect(result.current.features.webhooks).toBe(false);
    expect(result.current.features.teamCollaboration).toBe(false);
    expect(result.current.features.billing).toBe(false);
  });

  it("should return correct CE features after fetch", async () => {
    mockApiRequest.mockResolvedValueOnce(CE_RESPONSE);

    const { result } = renderHook(() => useFeatures());

    await act(async () => {
      await useSystemStore.getState().fetchEdition();
    });

    // CE core features enabled
    expect(result.current.features.chat).toBe(true);
    expect(result.current.features.commandExecution).toBe(true);
    expect(result.current.features.knowledgeBase).toBe(true);

    // EE features disabled
    expect(result.current.features.multiServer).toBe(false);
    expect(result.current.features.teamCollaboration).toBe(false);
    expect(result.current.features.webhooks).toBe(false);
    expect(result.current.features.alerts).toBe(false);
    expect(result.current.features.metricsMonitoring).toBe(false);
    expect(result.current.features.auditExport).toBe(false);
    expect(result.current.features.oauthLogin).toBe(false);
    expect(result.current.features.rateLimiting).toBe(false);

    // Cloud-only features disabled
    expect(result.current.features.multiTenant).toBe(false);
    expect(result.current.features.billing).toBe(false);

    expect(result.current.isLoading).toBe(false);
  });

  it("should return correct EE features after fetch", async () => {
    mockApiRequest.mockResolvedValueOnce(EE_RESPONSE);

    const { result } = renderHook(() => useFeatures());

    await act(async () => {
      await useSystemStore.getState().fetchEdition();
    });

    // All CE + EE features enabled
    expect(result.current.features.chat).toBe(true);
    expect(result.current.features.multiServer).toBe(true);
    expect(result.current.features.teamCollaboration).toBe(true);
    expect(result.current.features.webhooks).toBe(true);
    expect(result.current.features.alerts).toBe(true);
    expect(result.current.features.metricsMonitoring).toBe(true);
    expect(result.current.features.auditExport).toBe(true);
    expect(result.current.features.oauthLogin).toBe(true);
    expect(result.current.features.rateLimiting).toBe(true);

    // Cloud-only still disabled
    expect(result.current.features.multiTenant).toBe(false);
    expect(result.current.features.billing).toBe(false);
  });

  it("should reflect isLoading while fetch is in-flight", async () => {
    let resolveRequest!: (value: EditionResponse) => void;
    mockApiRequest.mockReturnValueOnce(
      new Promise<EditionResponse>((r) => {
        resolveRequest = r;
      }),
    );

    const { result } = renderHook(() => useFeatures());

    // Start fetch
    let fetchPromise: Promise<void>;
    act(() => {
      fetchPromise = useSystemStore.getState().fetchEdition();
    });

    expect(result.current.isLoading).toBe(true);
    // Features still all false while loading
    expect(result.current.features.chat).toBe(false);

    // Resolve
    await act(async () => {
      resolveRequest(CE_RESPONSE);
      await fetchPromise!;
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.features.chat).toBe(true);
  });

  it("should return a complete FeatureFlags object with all keys", () => {
    const { result } = renderHook(() => useFeatures());

    const allKeys = [
      "chat",
      "commandExecution",
      "knowledgeBase",
      "multiServer",
      "multiSession",
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

    for (const key of allKeys) {
      expect(result.current.features).toHaveProperty(key);
      expect(
        typeof result.current.features[
          key as keyof typeof result.current.features
        ],
      ).toBe("boolean");
    }
  });

  it("should fill missing keys with false when store has partial features", () => {
    // Simulate a partial feature set (only some keys present)
    useSystemStore.setState({
      edition: "ce",
      features: { chat: true, commandExecution: true },
      isLoading: false,
    });

    const { result } = renderHook(() => useFeatures());

    expect(result.current.features.chat).toBe(true);
    expect(result.current.features.commandExecution).toBe(true);
    // Missing keys default to false
    expect(result.current.features.multiServer).toBe(false);
    expect(result.current.features.webhooks).toBe(false);
    expect(result.current.features.billing).toBe(false);
  });

  it("should return stable reference when features do not change", () => {
    useSystemStore.setState({
      edition: "ee",
      features: EE_RESPONSE.features,
      isLoading: false,
    });

    const { result, rerender } = renderHook(() => useFeatures());
    const firstRef = result.current.features;

    rerender();
    const secondRef = result.current.features;

    expect(firstRef).toBe(secondRef);
  });

  it("should return new reference when features change", () => {
    useSystemStore.setState({
      edition: "ce",
      features: CE_RESPONSE.features,
      isLoading: false,
    });

    const { result } = renderHook(() => useFeatures());
    const firstRef = result.current.features;

    act(() => {
      useSystemStore.setState({ features: EE_RESPONSE.features });
    });

    expect(result.current.features).not.toBe(firstRef);
    expect(result.current.features.multiServer).toBe(true);
  });

  it("should not be affected by error state", () => {
    useSystemStore.setState({
      edition: "ce",
      features: CE_RESPONSE.features,
      isLoading: false,
      error: "some error",
    });

    const { result } = renderHook(() => useFeatures());
    // Features should still be readable despite error
    expect(result.current.features.chat).toBe(true);
    expect(result.current.features.multiServer).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useEdition
// ---------------------------------------------------------------------------

describe("useEdition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("should return null edition and both flags false before fetch", () => {
    const { result } = renderHook(() => useEdition());

    expect(result.current.edition).toBeNull();
    expect(result.current.isCE).toBe(false);
    expect(result.current.isEE).toBe(false);
  });

  it("should return isCE=true for CE edition", async () => {
    mockApiRequest.mockResolvedValueOnce(CE_RESPONSE);

    const { result } = renderHook(() => useEdition());

    await act(async () => {
      await useSystemStore.getState().fetchEdition();
    });

    expect(result.current.edition).toBe("ce");
    expect(result.current.isCE).toBe(true);
    expect(result.current.isEE).toBe(false);
  });

  it("should return isEE=true for EE edition", async () => {
    mockApiRequest.mockResolvedValueOnce(EE_RESPONSE);

    const { result } = renderHook(() => useEdition());

    await act(async () => {
      await useSystemStore.getState().fetchEdition();
    });

    expect(result.current.edition).toBe("ee");
    expect(result.current.isCE).toBe(false);
    expect(result.current.isEE).toBe(true);
  });

  it("should update when edition changes", async () => {
    const { result } = renderHook(() => useEdition());

    // Initially null
    expect(result.current.edition).toBeNull();

    // Set to CE directly via store
    act(() => {
      useSystemStore.setState({ edition: "ce" });
    });
    expect(result.current.isCE).toBe(true);
    expect(result.current.isEE).toBe(false);

    // Switch to EE
    act(() => {
      useSystemStore.setState({ edition: "ee" });
    });
    expect(result.current.isCE).toBe(false);
    expect(result.current.isEE).toBe(true);
  });

  it("should return stable reference when edition does not change", () => {
    useSystemStore.setState({ edition: "ce" });

    const { result, rerender } = renderHook(() => useEdition());
    const firstRef = result.current;

    rerender();
    const secondRef = result.current;

    expect(firstRef).toBe(secondRef);
  });

  it("should return new reference when edition changes", () => {
    useSystemStore.setState({ edition: "ce" });

    const { result } = renderHook(() => useEdition());
    const firstRef = result.current;

    act(() => {
      useSystemStore.setState({ edition: "ee" });
    });

    expect(result.current).not.toBe(firstRef);
    expect(result.current.isEE).toBe(true);
  });
});
