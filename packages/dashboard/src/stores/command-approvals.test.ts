// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CommandApproval } from "@/types/command-approval";

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
}));

// Mock SSE
const mockAbort = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreateGetSSE = vi.fn<any>();

vi.mock("@/api/sse", () => ({
  // Use a function that calls mockCreateGetSSE to avoid hoisting issues
  createGetSSE: (...args: unknown[]) => mockCreateGetSSE(...args),
}));

// Import after mocks are set up
import { useCommandApprovalsStore } from "./command-approvals";

const makeApproval = (
  overrides: Partial<CommandApproval> = {},
): CommandApproval => ({
  id: "approval-1",
  userId: "user-1",
  serverId: "server-1",
  command: "rm -rf /tmp/*",
  riskLevel: "red",
  status: "pending",
  reason: "Dangerous file deletion",
  warnings: ["Recursive deletion", "Affects /tmp directory"],
  requestedAt: "2026-02-20T10:00:00Z",
  expiresAt: "2026-02-20T10:05:00Z",
  decidedAt: null,
  decidedBy: null,
  executionContext: { sessionId: "session-1" },
  ...overrides,
});

describe("useCommandApprovalsStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateGetSSE.mockReturnValue({ abort: mockAbort });
    useCommandApprovalsStore.setState({
      approvals: [],
      isLoading: false,
      error: null,
      sseConnection: null,
    });
  });

  afterEach(() => {
    // Cleanup any open SSE connections
    const state = useCommandApprovalsStore.getState();
    if (state.sseConnection) {
      state.stopSSE();
    }
  });

  describe("fetchApprovals", () => {
    it("should fetch approvals successfully", async () => {
      const approvals = [
        makeApproval(),
        makeApproval({ id: "approval-2", status: "approved" }),
      ];
      mockApiRequest.mockResolvedValueOnce({ approvals, total: 2 });

      await useCommandApprovalsStore.getState().fetchApprovals();

      const state = useCommandApprovalsStore.getState();
      expect(state.approvals).toEqual(approvals);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(mockApiRequest).toHaveBeenCalledWith("/approvals");
    });

    it("should fetch approvals with status filter", async () => {
      const approvals = [makeApproval()];
      mockApiRequest.mockResolvedValueOnce({ approvals, total: 1 });

      await useCommandApprovalsStore.getState().fetchApprovals("pending");

      expect(mockApiRequest).toHaveBeenCalledWith("/approvals?status=pending");
    });

    it("should set isLoading to true while fetching", async () => {
      let resolvePromise: (v: unknown) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockApiRequest.mockReturnValueOnce(pendingPromise);

      const fetchPromise = useCommandApprovalsStore.getState().fetchApprovals();

      expect(useCommandApprovalsStore.getState().isLoading).toBe(true);

      resolvePromise!({ approvals: [], total: 0 });
      await fetchPromise;

      expect(useCommandApprovalsStore.getState().isLoading).toBe(false);
    });

    it("should handle ApiError on fetch", async () => {
      const { ApiError } = await import("@/api/client");
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(500, "INTERNAL_ERROR", "Server error"),
      );

      await useCommandApprovalsStore.getState().fetchApprovals();

      const state = useCommandApprovalsStore.getState();
      expect(state.error).toBe("Server error");
      expect(state.isLoading).toBe(false);
    });

    it("should handle generic error on fetch", async () => {
      mockApiRequest.mockRejectedValueOnce(new Error("Network failure"));

      await useCommandApprovalsStore.getState().fetchApprovals();

      const state = useCommandApprovalsStore.getState();
      expect(state.error).toBe("Failed to load approvals");
      expect(state.isLoading).toBe(false);
    });
  });

  describe("approveCommand", () => {
    it("should approve command successfully", async () => {
      const approval = makeApproval();
      const approved = {
        ...approval,
        status: "approved" as const,
        decidedAt: "2026-02-20T10:02:00Z",
      };
      mockApiRequest.mockResolvedValueOnce({ approval: approved });

      useCommandApprovalsStore.setState({ approvals: [approval] });

      await useCommandApprovalsStore.getState().approveCommand(approval.id);

      const state = useCommandApprovalsStore.getState();
      expect(state.approvals[0].status).toBe("approved");
      expect(state.error).toBeNull();
      expect(mockApiRequest).toHaveBeenCalledWith(
        "/approvals/approval-1/decide",
        {
          method: "POST",
          body: JSON.stringify({ decision: "approve" }),
        },
      );
    });

    it("should handle ApiError on approve", async () => {
      const { ApiError } = await import("@/api/client");
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(404, "NOT_FOUND", "Approval not found"),
      );

      await expect(
        useCommandApprovalsStore.getState().approveCommand("approval-1"),
      ).rejects.toThrow();

      const state = useCommandApprovalsStore.getState();
      expect(state.error).toBe("Approval not found");
    });

    it("should handle generic error on approve", async () => {
      mockApiRequest.mockRejectedValueOnce(new Error("Network failure"));

      await expect(
        useCommandApprovalsStore.getState().approveCommand("approval-1"),
      ).rejects.toThrow();

      const state = useCommandApprovalsStore.getState();
      expect(state.error).toBe("Failed to approve command");
    });
  });

  describe("rejectCommand", () => {
    it("should reject command successfully", async () => {
      const approval = makeApproval();
      const rejected = {
        ...approval,
        status: "rejected" as const,
        decidedAt: "2026-02-20T10:02:00Z",
      };
      mockApiRequest.mockResolvedValueOnce({ approval: rejected });

      useCommandApprovalsStore.setState({ approvals: [approval] });

      await useCommandApprovalsStore.getState().rejectCommand(approval.id);

      const state = useCommandApprovalsStore.getState();
      expect(state.approvals[0].status).toBe("rejected");
      expect(state.error).toBeNull();
      expect(mockApiRequest).toHaveBeenCalledWith(
        "/approvals/approval-1/decide",
        {
          method: "POST",
          body: JSON.stringify({ decision: "reject" }),
        },
      );
    });

    it("should handle ApiError on reject", async () => {
      const { ApiError } = await import("@/api/client");
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(404, "NOT_FOUND", "Approval not found"),
      );

      await expect(
        useCommandApprovalsStore.getState().rejectCommand("approval-1"),
      ).rejects.toThrow();

      const state = useCommandApprovalsStore.getState();
      expect(state.error).toBe("Approval not found");
    });

    it("should handle generic error on reject", async () => {
      mockApiRequest.mockRejectedValueOnce(new Error("Network failure"));

      await expect(
        useCommandApprovalsStore.getState().rejectCommand("approval-1"),
      ).rejects.toThrow();

      const state = useCommandApprovalsStore.getState();
      expect(state.error).toBe("Failed to reject command");
    });
  });

  describe("SSE connection", () => {
    it("should start SSE connection", () => {
      useCommandApprovalsStore.getState().startSSE();

      const state = useCommandApprovalsStore.getState();
      expect(state.sseConnection).not.toBeNull();
      expect(mockCreateGetSSE).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/approvals/stream",
        }),
      );
    });

    it("should not start duplicate SSE connection", () => {
      useCommandApprovalsStore.getState().startSSE();
      useCommandApprovalsStore.getState().startSSE();

      expect(mockCreateGetSSE).toHaveBeenCalledTimes(1);
    });

    it("should stop SSE connection", () => {
      useCommandApprovalsStore.getState().startSSE();
      useCommandApprovalsStore.getState().stopSSE();

      const state = useCommandApprovalsStore.getState();
      expect(state.sseConnection).toBeNull();
      expect(mockAbort).toHaveBeenCalled();
    });

    it("should handle new approval event", () => {
      useCommandApprovalsStore.getState().startSSE();

      // Get the dispatch function from the mock call
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sseConfig = (mockCreateGetSSE.mock.calls as any)[0]?.[0];
      if (!sseConfig) throw new Error("SSE config not found");
      const approval = makeApproval();

      sseConfig.dispatch("approval", JSON.stringify(approval));

      const state = useCommandApprovalsStore.getState();
      expect(state.approvals).toHaveLength(1);
      expect(state.approvals[0]).toEqual(approval);
    });

    it("should handle decision event", () => {
      const approval = makeApproval();
      useCommandApprovalsStore.setState({ approvals: [approval] });

      useCommandApprovalsStore.getState().startSSE();

      // Get the dispatch function
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sseConfig = (mockCreateGetSSE.mock.calls as any)[0]?.[0];
      if (!sseConfig) throw new Error("SSE config not found");
      const updated = { ...approval, status: "approved" as const };

      sseConfig.dispatch("decision", JSON.stringify(updated));

      const state = useCommandApprovalsStore.getState();
      expect(state.approvals[0].status).toBe("approved");
    });

    it("should handle ping event", () => {
      useCommandApprovalsStore.getState().startSSE();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sseConfig = (mockCreateGetSSE.mock.calls as any)[0]?.[0];
      if (!sseConfig) throw new Error("SSE config not found");
      sseConfig.dispatch("ping", JSON.stringify({ timestamp: Date.now() }));

      // Should not affect state
      const state = useCommandApprovalsStore.getState();
      expect(state.approvals).toHaveLength(0);
    });

    it("should handle SSE error", () => {
      useCommandApprovalsStore.getState().startSSE();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sseConfig = (mockCreateGetSSE.mock.calls as any)[0]?.[0];
      if (!sseConfig) throw new Error("SSE config not found");
      sseConfig.onError?.(new Error("Connection failed"));

      const state = useCommandApprovalsStore.getState();
      expect(state.error).toBe("Connection failed");
    });
  });

  describe("clearError", () => {
    it("should clear error", () => {
      useCommandApprovalsStore.setState({ error: "Some error" });

      useCommandApprovalsStore.getState().clearError();

      expect(useCommandApprovalsStore.getState().error).toBeNull();
    });
  });
});
