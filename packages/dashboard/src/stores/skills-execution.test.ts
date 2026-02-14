// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSkillsStore } from "./skills";
import type { SkillExecution } from "@/types/skill";

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

const makeExecution = (
  overrides: Partial<SkillExecution> = {},
): SkillExecution => ({
  id: "exec-1",
  skillId: "sk-1",
  serverId: "srv-1",
  userId: "user-1",
  triggerType: "manual",
  status: "success",
  startedAt: "2026-01-01T00:00:00Z",
  completedAt: "2026-01-01T00:01:00Z",
  result: { output: "done" },
  stepsExecuted: 3,
  duration: 60000,
  ...overrides,
});

describe("useSkillsStore — execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSkillsStore.setState({
      skills: [],
      available: [],
      executions: [],
      selectedExecution: null,
      isLoadingDetail: false,
      isLoading: false,
      error: null,
      stats: null,
      isLoadingStats: false,
    });
  });

  // --------------------------------------------------------------------------
  // executeSkill
  // --------------------------------------------------------------------------

  describe("executeSkill", () => {
    it("should execute a skill and return the result", async () => {
      const executionResult = {
        executionId: "exec-1",
        status: "success" as const,
        stepsExecuted: 3,
        duration: 5000,
        result: { output: "done" },
        errors: [],
      };
      mockApiRequest.mockResolvedValueOnce({ execution: executionResult });

      const result = await useSkillsStore
        .getState()
        .executeSkill("sk-1", "srv-1");

      expect(result).toEqual(executionResult);
      expect(mockApiRequest).toHaveBeenCalledWith("/skills/sk-1/execute", {
        method: "POST",
        body: JSON.stringify({ serverId: "srv-1" }),
      });
    });

    it("should pass optional config to execute", async () => {
      const executionResult = {
        executionId: "exec-2",
        status: "success" as const,
        stepsExecuted: 1,
        duration: 1000,
        result: null,
        errors: [],
      };
      mockApiRequest.mockResolvedValueOnce({ execution: executionResult });

      await useSkillsStore
        .getState()
        .executeSkill("sk-1", "srv-1", { port: 3000 });

      expect(mockApiRequest).toHaveBeenCalledWith("/skills/sk-1/execute", {
        method: "POST",
        body: JSON.stringify({ serverId: "srv-1", config: { port: 3000 } }),
      });
    });

    it("should handle ApiError on execute and re-throw", async () => {
      const { ApiError } = await import("@/api/client");
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(400, "BAD_REQUEST", "Skill not enabled"),
      );

      await expect(
        useSkillsStore.getState().executeSkill("sk-1", "srv-1"),
      ).rejects.toThrow();

      expect(useSkillsStore.getState().error).toBe("Skill not enabled");
    });

    it("should pass dryRun=true to API request", async () => {
      const executionResult = {
        executionId: "exec-dry",
        status: "success" as const,
        stepsExecuted: 0,
        duration: 200,
        result: { output: "Step 1: shell — apt update" },
        errors: [],
      };
      mockApiRequest.mockResolvedValueOnce({ execution: executionResult });

      const result = await useSkillsStore
        .getState()
        .executeSkill("sk-1", "srv-1", undefined, true);

      expect(result).toEqual(executionResult);
      expect(mockApiRequest).toHaveBeenCalledWith("/skills/sk-1/execute", {
        method: "POST",
        body: JSON.stringify({ serverId: "srv-1", dryRun: true }),
      });
    });

    it("should not include dryRun in body when it is falsy", async () => {
      const executionResult = {
        executionId: "exec-normal",
        status: "success" as const,
        stepsExecuted: 2,
        duration: 1000,
        result: null,
        errors: [],
      };
      mockApiRequest.mockResolvedValueOnce({ execution: executionResult });

      await useSkillsStore
        .getState()
        .executeSkill("sk-1", "srv-1", undefined, false);

      expect(mockApiRequest).toHaveBeenCalledWith("/skills/sk-1/execute", {
        method: "POST",
        body: JSON.stringify({ serverId: "srv-1" }),
      });
    });
  });

  // --------------------------------------------------------------------------
  // fetchExecutions
  // --------------------------------------------------------------------------

  describe("fetchExecutions", () => {
    it("should fetch executions and update state", async () => {
      const executions = [makeExecution(), makeExecution({ id: "exec-2" })];
      mockApiRequest.mockResolvedValueOnce({ executions });

      await useSkillsStore.getState().fetchExecutions("sk-1");

      const state = useSkillsStore.getState();
      expect(state.executions).toEqual(executions);
      expect(state.isLoading).toBe(false);
      expect(mockApiRequest).toHaveBeenCalledWith("/skills/sk-1/executions");
    });

    it("should use fallback message for non-ApiError on fetchExecutions", async () => {
      mockApiRequest.mockRejectedValueOnce(new Error("network"));

      await useSkillsStore.getState().fetchExecutions("sk-1");

      expect(useSkillsStore.getState().error).toBe("Failed to load executions");
    });
  });

  // --------------------------------------------------------------------------
  // fetchExecutionDetail
  // --------------------------------------------------------------------------

  describe("fetchExecutionDetail", () => {
    it("should fetch execution detail and update selectedExecution", async () => {
      const execution = makeExecution({ id: "exec-42", skillId: "sk-1" });
      mockApiRequest.mockResolvedValueOnce({ execution });

      await useSkillsStore.getState().fetchExecutionDetail("sk-1", "exec-42");

      const state = useSkillsStore.getState();
      expect(state.selectedExecution).toEqual(execution);
      expect(state.isLoadingDetail).toBe(false);
      expect(state.error).toBeNull();
      expect(mockApiRequest).toHaveBeenCalledWith(
        "/skills/sk-1/executions/exec-42",
      );
    });

    it("should set isLoadingDetail while fetching", async () => {
      let resolvePromise: (v: unknown) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockApiRequest.mockReturnValueOnce(pendingPromise);

      const fetchPromise = useSkillsStore
        .getState()
        .fetchExecutionDetail("sk-1", "exec-1");

      expect(useSkillsStore.getState().isLoadingDetail).toBe(true);

      resolvePromise!({ execution: makeExecution() });
      await fetchPromise;

      expect(useSkillsStore.getState().isLoadingDetail).toBe(false);
    });

    it("should handle error on fetchExecutionDetail", async () => {
      const { ApiError } = await import("@/api/client");
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(404, "NOT_FOUND", "Execution not found"),
      );

      await useSkillsStore
        .getState()
        .fetchExecutionDetail("sk-1", "exec-missing");

      const state = useSkillsStore.getState();
      expect(state.error).toBe("Execution not found");
      expect(state.isLoadingDetail).toBe(false);
      expect(state.selectedExecution).toBeNull();
    });

    it("should use fallback message for non-ApiError", async () => {
      mockApiRequest.mockRejectedValueOnce(new Error("timeout"));

      await useSkillsStore.getState().fetchExecutionDetail("sk-1", "exec-1");

      expect(useSkillsStore.getState().error).toBe(
        "Failed to load execution detail",
      );
    });
  });

  // --------------------------------------------------------------------------
  // fetchPendingConfirmations
  // --------------------------------------------------------------------------

  describe("fetchPendingConfirmations", () => {
    it("should fetch pending confirmations and update state", async () => {
      const pending = [
        makeExecution({
          id: "exec-p1",
          status: "pending_confirmation",
          triggerType: "cron",
        }),
      ];
      mockApiRequest.mockResolvedValueOnce({ executions: pending });

      await useSkillsStore.getState().fetchPendingConfirmations();

      const state = useSkillsStore.getState();
      expect(state.pendingConfirmations).toEqual(pending);
      expect(mockApiRequest).toHaveBeenCalledWith(
        "/skills/pending-confirmations",
      );
    });

    it("should handle error on fetchPendingConfirmations", async () => {
      const { ApiError } = await import("@/api/client");
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(500, "INTERNAL_ERROR", "Server error"),
      );

      await useSkillsStore.getState().fetchPendingConfirmations();

      expect(useSkillsStore.getState().error).toBe("Server error");
    });

    it("should use fallback message for non-ApiError", async () => {
      mockApiRequest.mockRejectedValueOnce(new Error("network"));

      await useSkillsStore.getState().fetchPendingConfirmations();

      expect(useSkillsStore.getState().error).toBe(
        "Failed to load pending confirmations",
      );
    });
  });

  // --------------------------------------------------------------------------
  // confirmExecution
  // --------------------------------------------------------------------------

  describe("confirmExecution", () => {
    it("should confirm execution and remove from pending list", async () => {
      useSkillsStore.setState({
        pendingConfirmations: [
          makeExecution({ id: "exec-p1", status: "pending_confirmation" }),
          makeExecution({ id: "exec-p2", status: "pending_confirmation" }),
        ],
      });

      const result = {
        executionId: "exec-p1",
        status: "success" as const,
        stepsExecuted: 2,
        duration: 1000,
        result: { output: "done" },
        errors: [],
      };
      mockApiRequest.mockResolvedValueOnce({ execution: result });

      const ret = await useSkillsStore.getState().confirmExecution("exec-p1");

      expect(ret).toEqual(result);
      expect(useSkillsStore.getState().pendingConfirmations).toHaveLength(1);
      expect(useSkillsStore.getState().pendingConfirmations[0].id).toBe(
        "exec-p2",
      );
      expect(mockApiRequest).toHaveBeenCalledWith(
        "/skills/executions/exec-p1/confirm",
        {
          method: "POST",
        },
      );
    });

    it("should handle error on confirmExecution and re-throw", async () => {
      const { ApiError } = await import("@/api/client");
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(400, "BAD_REQUEST", "Execution has expired"),
      );

      await expect(
        useSkillsStore.getState().confirmExecution("exec-expired"),
      ).rejects.toThrow();

      expect(useSkillsStore.getState().error).toBe("Execution has expired");
    });
  });

  // --------------------------------------------------------------------------
  // rejectExecution
  // --------------------------------------------------------------------------

  describe("rejectExecution", () => {
    it("should reject execution and remove from pending list", async () => {
      useSkillsStore.setState({
        pendingConfirmations: [
          makeExecution({ id: "exec-p1", status: "pending_confirmation" }),
        ],
      });

      mockApiRequest.mockResolvedValueOnce({ success: true });

      await useSkillsStore.getState().rejectExecution("exec-p1");

      expect(useSkillsStore.getState().pendingConfirmations).toHaveLength(0);
      expect(mockApiRequest).toHaveBeenCalledWith(
        "/skills/executions/exec-p1/reject",
        {
          method: "POST",
        },
      );
    });

    it("should handle error on rejectExecution and re-throw", async () => {
      const { ApiError } = await import("@/api/client");
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(404, "NOT_FOUND", "Execution not found"),
      );

      await expect(
        useSkillsStore.getState().rejectExecution("exec-missing"),
      ).rejects.toThrow();

      expect(useSkillsStore.getState().error).toBe("Execution not found");
    });

    it("should use fallback message for non-ApiError on reject", async () => {
      mockApiRequest.mockRejectedValueOnce(new Error("network"));

      await expect(
        useSkillsStore.getState().rejectExecution("exec-1"),
      ).rejects.toThrow();

      expect(useSkillsStore.getState().error).toBe(
        "Failed to reject execution",
      );
    });
  });

  // --------------------------------------------------------------------------
  // clearSelectedExecution
  // --------------------------------------------------------------------------

  describe("clearSelectedExecution", () => {
    it("should clear the selectedExecution state", () => {
      useSkillsStore.setState({ selectedExecution: makeExecution() });

      useSkillsStore.getState().clearSelectedExecution();

      expect(useSkillsStore.getState().selectedExecution).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // fetchStats
  // --------------------------------------------------------------------------

  describe("fetchStats", () => {
    const sampleStats = {
      totalExecutions: 10,
      successRate: 0.8,
      avgDuration: 1500,
      topSkills: [
        {
          skillId: "sk-1",
          skillName: "Nginx Setup",
          executionCount: 7,
          successCount: 6,
        },
      ],
      dailyTrend: [{ date: "2026-02-12", total: 5, success: 4, failed: 1 }],
      triggerDistribution: [{ triggerType: "manual" as const, count: 8 }],
    };

    it("should fetch stats successfully", async () => {
      mockApiRequest.mockResolvedValueOnce({ stats: sampleStats });

      await useSkillsStore.getState().fetchStats();

      const state = useSkillsStore.getState();
      expect(state.stats).toEqual(sampleStats);
      expect(state.isLoadingStats).toBe(false);
      expect(state.error).toBeNull();
      expect(mockApiRequest).toHaveBeenCalledWith("/skills/stats");
    });

    it("should handle error on fetchStats", async () => {
      const { ApiError } = await import("@/api/client");
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(500, "INTERNAL_ERROR", "Stats unavailable"),
      );

      await useSkillsStore.getState().fetchStats();

      const state = useSkillsStore.getState();
      expect(state.error).toBe("Stats unavailable");
      expect(state.isLoadingStats).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // cancelExecution
  // --------------------------------------------------------------------------

  describe("cancelExecution", () => {
    it("should cancel execution and update status in list", async () => {
      useSkillsStore.setState({
        executions: [makeExecution({ id: "exec-1", status: "running" })],
        isStreaming: true,
      });
      mockApiRequest.mockResolvedValueOnce({ success: true });

      await useSkillsStore.getState().cancelExecution("exec-1");

      const state = useSkillsStore.getState();
      expect(state.executions[0].status).toBe("cancelled");
      expect(state.isCancelling).toBeNull();
      expect(state.isStreaming).toBe(false);
      expect(mockApiRequest).toHaveBeenCalledWith(
        "/skills/executions/exec-1/cancel",
        {
          method: "POST",
        },
      );
    });

    it("should set isCancelling to the execution id while cancelling", async () => {
      useSkillsStore.setState({
        executions: [makeExecution({ id: "exec-1", status: "running" })],
      });
      let resolvePromise: (v: unknown) => void;
      const pending = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockApiRequest.mockReturnValueOnce(pending);

      const cancelPromise = useSkillsStore.getState().cancelExecution("exec-1");
      expect(useSkillsStore.getState().isCancelling).toBe("exec-1");

      resolvePromise!({ success: true });
      await cancelPromise;

      expect(useSkillsStore.getState().isCancelling).toBeNull();
    });

    it("should handle ApiError on cancel and re-throw", async () => {
      const { ApiError } = await import("@/api/client");
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(400, "BAD_REQUEST", "Execution not found or not running"),
      );

      await expect(
        useSkillsStore.getState().cancelExecution("exec-bad"),
      ).rejects.toThrow();

      const state = useSkillsStore.getState();
      expect(state.error).toBe("Execution not found or not running");
      expect(state.isCancelling).toBeNull();
    });

    it("should use fallback message for non-ApiError on cancel", async () => {
      mockApiRequest.mockRejectedValueOnce(new Error("timeout"));

      await expect(
        useSkillsStore.getState().cancelExecution("exec-1"),
      ).rejects.toThrow();

      expect(useSkillsStore.getState().error).toBe(
        "Failed to cancel execution",
      );
    });
  });

  // --------------------------------------------------------------------------
  // dryRunSkill
  // --------------------------------------------------------------------------

  describe("dryRunSkill", () => {
    it("should call dedicated dry-run endpoint and store result", async () => {
      const executionResult = {
        executionId: "exec-dry-1",
        status: "success" as const,
        stepsExecuted: 0,
        duration: 800,
        result: { output: "Step 1: run_command — apt update" },
        errors: [],
      };
      mockApiRequest.mockResolvedValueOnce({
        execution: executionResult,
        dryRun: true,
      });

      const result = await useSkillsStore
        .getState()
        .dryRunSkill("sk-1", "srv-1");

      expect(result).toEqual(executionResult);
      const state = useSkillsStore.getState();
      expect(state.dryRunResult).toEqual(executionResult);
      expect(state.isDryRunning).toBe(false);
      expect(mockApiRequest).toHaveBeenCalledWith("/skills/sk-1/dry-run", {
        method: "POST",
        body: JSON.stringify({ serverId: "srv-1" }),
      });
    });

    it("should pass inputs as config to the dry-run endpoint", async () => {
      const executionResult = {
        executionId: "exec-dry-2",
        status: "success" as const,
        stepsExecuted: 0,
        duration: 500,
        result: null,
        errors: [],
      };
      mockApiRequest.mockResolvedValueOnce({
        execution: executionResult,
        dryRun: true,
      });

      await useSkillsStore
        .getState()
        .dryRunSkill("sk-1", "srv-1", { port: 3000 });

      expect(mockApiRequest).toHaveBeenCalledWith("/skills/sk-1/dry-run", {
        method: "POST",
        body: JSON.stringify({ serverId: "srv-1", config: { port: 3000 } }),
      });
    });

    it("should set isDryRunning while request is in-flight", async () => {
      let resolvePromise: (v: unknown) => void;
      const pending = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockApiRequest.mockReturnValueOnce(pending);

      const dryRunPromise = useSkillsStore
        .getState()
        .dryRunSkill("sk-1", "srv-1");

      expect(useSkillsStore.getState().isDryRunning).toBe(true);
      expect(useSkillsStore.getState().dryRunResult).toBeNull();

      resolvePromise!({
        execution: {
          executionId: "e",
          status: "success",
          stepsExecuted: 0,
          duration: 0,
          result: null,
          errors: [],
        },
      });
      await dryRunPromise;

      expect(useSkillsStore.getState().isDryRunning).toBe(false);
    });

    it("should handle error on dryRunSkill and re-throw", async () => {
      const { ApiError } = await import("@/api/client");
      mockApiRequest.mockRejectedValueOnce(
        new ApiError(500, "INTERNAL_ERROR", "AI provider unavailable"),
      );

      await expect(
        useSkillsStore.getState().dryRunSkill("sk-1", "srv-1"),
      ).rejects.toThrow();

      const state = useSkillsStore.getState();
      expect(state.error).toBe("AI provider unavailable");
      expect(state.isDryRunning).toBe(false);
      expect(state.dryRunResult).toBeNull();
    });

    it("should use fallback message for non-ApiError on dryRunSkill", async () => {
      mockApiRequest.mockRejectedValueOnce(new Error("network"));

      await expect(
        useSkillsStore.getState().dryRunSkill("sk-1", "srv-1"),
      ).rejects.toThrow();

      expect(useSkillsStore.getState().error).toBe("Failed to preview skill");
    });
  });

  // --------------------------------------------------------------------------
  // clearDryRunResult
  // --------------------------------------------------------------------------

  describe("clearDryRunResult", () => {
    it("should clear the dryRunResult state", () => {
      useSkillsStore.setState({
        dryRunResult: {
          executionId: "exec-dry-1",
          status: "success",
          stepsExecuted: 0,
          duration: 500,
          result: { output: "plan" },
          errors: [],
        },
      });

      useSkillsStore.getState().clearDryRunResult();

      expect(useSkillsStore.getState().dryRunResult).toBeNull();
    });
  });
});
