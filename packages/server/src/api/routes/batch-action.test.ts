// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for POST /api/v1/servers/batch/action endpoint.
 *
 * Validates batch delete, update-tags, restart, and stop operations
 * with per-server result tracking, permission checks, and validation.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { Hono } from "hono";

// ============================================================================
// Module Mocks — must be before imports of the module under test
// ============================================================================

let mockUserRole = "owner";

vi.mock("../middleware/rbac.js", () => ({
  resolveRole: vi.fn(
    async (
      c: Record<string, (k: string, v: string) => void>,
      next: () => Promise<void>,
    ) => {
      c.set("userRole", mockUserRole);
      await next();
    },
  ),
  requirePermission: vi.fn(() => {
    return async (_c: unknown, next: () => Promise<void>) => {
      await next();
    };
  }),
}));

const mockFindConnectedAgent = vi.fn<(serverId: string) => string | null>();
vi.mock("../../core/agent/agent-connector.js", () => ({
  findConnectedAgent: (...args: unknown[]) =>
    mockFindConnectedAgent(args[0] as string),
}));

const mockExecuteCommand = vi.fn();
vi.mock("../../core/task/executor.js", () => ({
  getTaskExecutor: () => ({
    executeCommand: mockExecuteCommand,
  }),
}));

import {
  initJwtConfig,
  generateTokens,
  _resetJwtConfig,
} from "../middleware/auth.js";
import {
  InMemoryServerRepository,
  setServerRepository,
  _resetServerRepository,
} from "../../db/repositories/server-repository.js";
import {
  initDatabase,
  closeDatabase,
  createTables,
} from "../../db/connection.js";
import { _resetProfileRepository } from "../../db/repositories/profile-repository.js";
import { _resetOperationRepository } from "../../db/repositories/operation-repository.js";
import { _resetMetricsRepository } from "../../db/repositories/metrics-repository.js";
import { _resetOperationHistoryService } from "../../core/operation/operation-history-service.js";
import type { ApiEnv } from "./types.js";
import { createApiApp } from "./index.js";

// ============================================================================
// Test Setup
// ============================================================================

const TEST_SECRET = "test-secret-key-that-is-at-least-32-chars-long!!";
const USER_A = "user-batch-aaa";
const USER_B = "user-batch-bbb";

let app: Hono<ApiEnv>;
let repo: InMemoryServerRepository;
let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  _resetJwtConfig();
  initJwtConfig({ secret: TEST_SECRET });

  const tokensA = await generateTokens(USER_A);
  const tokensB = await generateTokens(USER_B);
  tokenA = tokensA.accessToken;
  tokenB = tokensB.accessToken;
});

beforeEach(() => {
  mockUserRole = "owner";
  mockFindConnectedAgent.mockReset();
  mockExecuteCommand.mockReset();

  repo = new InMemoryServerRepository();
  setServerRepository(repo);
  initDatabase(":memory:");
  createTables();
  _resetProfileRepository();
  _resetOperationRepository();
  _resetMetricsRepository();
  _resetOperationHistoryService();

  app = createApiApp();
});

afterEach(() => {
  closeDatabase();
});

// ============================================================================
// Request Helpers
// ============================================================================

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function jsonPost(
  path: string,
  body: unknown,
  token: string,
): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createServer(
  name: string,
  token: string,
  tags?: string[],
): Promise<{ id: string }> {
  const res = await jsonPost("/api/v1/servers", { name, tags }, token);
  const body = await res.json();
  return body.server;
}

// ============================================================================
// Validation
// ============================================================================

describe("POST /api/v1/servers/batch/action — Validation", () => {
  it("should reject empty serverIds array", async () => {
    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      { serverIds: [], action: "delete" },
      tokenA,
    );
    expect(res.status).toBe(400);
  });

  it("should reject invalid action", async () => {
    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      {
        serverIds: ["550e8400-e29b-41d4-a716-446655440000"],
        action: "explode",
      },
      tokenA,
    );
    expect(res.status).toBe(400);
  });

  it("should reject invalid UUID in serverIds", async () => {
    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      { serverIds: ["not-a-uuid"], action: "delete" },
      tokenA,
    );
    expect(res.status).toBe(400);
  });

  it("should reject update-tags without params.tags", async () => {
    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      {
        serverIds: ["550e8400-e29b-41d4-a716-446655440000"],
        action: "update-tags",
      },
      tokenA,
    );
    expect(res.status).toBe(400);
  });

  it("should reject more than 50 serverIds", async () => {
    const ids = Array.from(
      { length: 51 },
      (_, i) => `550e8400-e29b-41d4-a716-44665544${String(i).padStart(4, "0")}`,
    );
    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      { serverIds: ids, action: "delete" },
      tokenA,
    );
    expect(res.status).toBe(400);
  });

  it("should reject request without auth", async () => {
    const res = await app.request("/api/v1/servers/batch/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverIds: ["550e8400-e29b-41d4-a716-446655440000"],
        action: "delete",
      }),
    });
    expect(res.status).toBe(401);
  });
});

// ============================================================================
// Batch Delete
// ============================================================================

describe("POST /api/v1/servers/batch/action — delete", () => {
  it("should delete multiple servers", async () => {
    const s1 = await createServer("web-01", tokenA);
    const s2 = await createServer("web-02", tokenA);

    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      { serverIds: [s1.id, s2.id], action: "delete" },
      tokenA,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.action).toBe("delete");
    expect(body.successCount).toBe(2);
    expect(body.failureCount).toBe(0);
    expect(body.results).toHaveLength(2);
    expect(body.results[0].success).toBe(true);
    expect(body.results[1].success).toBe(true);

    // Verify servers are actually deleted
    const listRes = await app.request("/api/v1/servers", {
      headers: authHeaders(tokenA),
    });
    const listBody = await listRes.json();
    expect(listBody.servers).toHaveLength(0);
  });

  it("should report failure for non-existent servers", async () => {
    const s1 = await createServer("web-01", tokenA);
    const fakeId = "550e8400-e29b-41d4-a716-446655440000";

    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      { serverIds: [s1.id, fakeId], action: "delete" },
      tokenA,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.successCount).toBe(1);
    expect(body.failureCount).toBe(1);
    expect(body.results[1].success).toBe(false);
    expect(body.results[1].error).toBe("Server not found");
  });

  it("should not delete servers belonging to another user", async () => {
    const s1 = await createServer("web-01", tokenA);
    const s2 = await createServer("other-user-server", tokenB);

    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      { serverIds: [s1.id, s2.id], action: "delete" },
      tokenA,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.successCount).toBe(1);
    expect(body.failureCount).toBe(1);
    // s2 should fail because it belongs to USER_B
    expect(body.results[1].success).toBe(false);
    expect(body.results[1].error).toBe("Server not found");
  });

  it("should reject delete for member role", async () => {
    mockUserRole = "member";
    const s1 = await createServer("web-01", tokenA);

    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      { serverIds: [s1.id], action: "delete" },
      tokenA,
    );
    expect(res.status).toBe(403);
  });
});

// ============================================================================
// Batch Update Tags
// ============================================================================

describe("POST /api/v1/servers/batch/action — update-tags", () => {
  it("should update tags on multiple servers", async () => {
    const s1 = await createServer("web-01", tokenA, ["old-tag"]);
    const s2 = await createServer("web-02", tokenA, ["other"]);

    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      {
        serverIds: [s1.id, s2.id],
        action: "update-tags",
        params: { tags: ["production", "web"] },
      },
      tokenA,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.action).toBe("update-tags");
    expect(body.successCount).toBe(2);
    expect(body.failureCount).toBe(0);

    // Verify tags are actually updated
    const getRes = await app.request(`/api/v1/servers/${s1.id}`, {
      headers: authHeaders(tokenA),
    });
    const getBody = await getRes.json();
    expect(getBody.server.tags).toEqual(["production", "web"]);
  });

  it("should report failure for non-existent servers on update-tags", async () => {
    const fakeId = "550e8400-e29b-41d4-a716-446655440000";

    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      {
        serverIds: [fakeId],
        action: "update-tags",
        params: { tags: ["test"] },
      },
      tokenA,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.successCount).toBe(0);
    expect(body.failureCount).toBe(1);
    expect(body.results[0].error).toBe("Server not found");
  });

  it("should reject update-tags for member role", async () => {
    mockUserRole = "member";
    const s1 = await createServer("web-01", tokenA);

    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      {
        serverIds: [s1.id],
        action: "update-tags",
        params: { tags: ["new"] },
      },
      tokenA,
    );
    expect(res.status).toBe(403);
  });
});

// ============================================================================
// Batch Restart
// ============================================================================

describe("POST /api/v1/servers/batch/action — restart", () => {
  it("should dispatch restart to connected agents", async () => {
    const s1 = await createServer("web-01", tokenA);
    const s2 = await createServer("web-02", tokenA);

    mockFindConnectedAgent.mockImplementation((id) => `client-${id}`);
    mockExecuteCommand.mockResolvedValue({
      success: true,
      executionId: "exec-1",
      operationId: "op-1",
      exitCode: 0,
      stdout: "",
      stderr: "",
      duration: 500,
      timedOut: false,
    });

    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      { serverIds: [s1.id, s2.id], action: "restart" },
      tokenA,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.action).toBe("restart");
    expect(body.successCount).toBe(2);
    expect(body.failureCount).toBe(0);

    // Verify executeCommand was called with correct args
    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
    const firstCall = mockExecuteCommand.mock.calls[0][0];
    expect(firstCall.command).toBe("sudo reboot");
    expect(firstCall.type).toBe("restart");
    expect(firstCall.riskLevel).toBe("yellow");
  });

  it("should report failure when agent not connected", async () => {
    const s1 = await createServer("web-01", tokenA);

    mockFindConnectedAgent.mockReturnValue(null);

    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      { serverIds: [s1.id], action: "restart" },
      tokenA,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.successCount).toBe(0);
    expect(body.failureCount).toBe(1);
    expect(body.results[0].error).toBe("Agent not connected");
  });

  it("should handle partial failures (some agents connected, some not)", async () => {
    const s1 = await createServer("web-01", tokenA);
    const s2 = await createServer("web-02", tokenA);

    mockFindConnectedAgent.mockImplementation((id) =>
      id === s1.id ? `client-${id}` : null,
    );
    mockExecuteCommand.mockResolvedValue({
      success: true,
      executionId: "exec-1",
      operationId: "op-1",
      exitCode: 0,
      stdout: "",
      stderr: "",
      duration: 200,
      timedOut: false,
    });

    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      { serverIds: [s1.id, s2.id], action: "restart" },
      tokenA,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.successCount).toBe(1);
    expect(body.failureCount).toBe(1);
    expect(body.results[0].success).toBe(true);
    expect(body.results[1].success).toBe(false);
    expect(body.results[1].error).toBe("Agent not connected");
  });

  it("should handle command execution failure", async () => {
    const s1 = await createServer("web-01", tokenA);

    mockFindConnectedAgent.mockReturnValue("client-1");
    mockExecuteCommand.mockResolvedValue({
      success: false,
      executionId: "exec-1",
      operationId: "op-1",
      exitCode: 1,
      stdout: "",
      stderr: "Permission denied",
      duration: 100,
      timedOut: false,
    });

    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      { serverIds: [s1.id], action: "restart" },
      tokenA,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.successCount).toBe(0);
    expect(body.failureCount).toBe(1);
    expect(body.results[0].error).toBe("Permission denied");
  });

  it("should reject restart for member role", async () => {
    mockUserRole = "member";
    const s1 = await createServer("web-01", tokenA);

    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      { serverIds: [s1.id], action: "restart" },
      tokenA,
    );
    expect(res.status).toBe(403);
  });
});

// ============================================================================
// Batch Stop
// ============================================================================

describe("POST /api/v1/servers/batch/action — stop", () => {
  it("should dispatch stop to connected agents", async () => {
    const s1 = await createServer("web-01", tokenA);

    mockFindConnectedAgent.mockReturnValue("client-1");
    mockExecuteCommand.mockResolvedValue({
      success: true,
      executionId: "exec-1",
      operationId: "op-1",
      exitCode: 0,
      stdout: "",
      stderr: "",
      duration: 300,
      timedOut: false,
    });

    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      { serverIds: [s1.id], action: "stop" },
      tokenA,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.action).toBe("stop");
    expect(body.successCount).toBe(1);

    // Verify the correct command was used
    const call = mockExecuteCommand.mock.calls[0][0];
    expect(call.command).toBe("sudo shutdown -h now");
  });
});

// ============================================================================
// Response Structure
// ============================================================================

describe("POST /api/v1/servers/batch/action — Response Structure", () => {
  it("should include per-server results with serverId", async () => {
    const s1 = await createServer("web-01", tokenA);
    const s2 = await createServer("web-02", tokenA);

    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      { serverIds: [s1.id, s2.id], action: "delete" },
      tokenA,
    );
    const body = await res.json();

    expect(body.results[0].serverId).toBe(s1.id);
    expect(body.results[1].serverId).toBe(s2.id);
  });

  it("should not include error field on successful results", async () => {
    const s1 = await createServer("web-01", tokenA);

    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      { serverIds: [s1.id], action: "delete" },
      tokenA,
    );
    const body = await res.json();

    expect(body.results[0].success).toBe(true);
    expect(body.results[0].error).toBeUndefined();
  });

  it("should handle exception in executor gracefully", async () => {
    const s1 = await createServer("web-01", tokenA);

    mockFindConnectedAgent.mockReturnValue("client-1");
    mockExecuteCommand.mockRejectedValue(new Error("Connection lost"));

    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      { serverIds: [s1.id], action: "restart" },
      tokenA,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.failureCount).toBe(1);
    expect(body.results[0].error).toBe("Connection lost");
  });
});

// ============================================================================
// Permission Matrix
// ============================================================================

describe("POST /api/v1/servers/batch/action — Permission Matrix", () => {
  it("should allow admin to delete", async () => {
    mockUserRole = "admin";
    const s1 = await createServer("web-01", tokenA);

    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      { serverIds: [s1.id], action: "delete" },
      tokenA,
    );
    expect(res.status).toBe(200);
  });

  it("should allow admin to update-tags", async () => {
    mockUserRole = "admin";
    const s1 = await createServer("web-01", tokenA);

    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      { serverIds: [s1.id], action: "update-tags", params: { tags: ["new"] } },
      tokenA,
    );
    expect(res.status).toBe(200);
  });

  it("should allow admin to restart", async () => {
    mockUserRole = "admin";
    const s1 = await createServer("web-01", tokenA);
    mockFindConnectedAgent.mockReturnValue("client-1");
    mockExecuteCommand.mockResolvedValue({
      success: true,
      executionId: "e1",
      operationId: "o1",
      exitCode: 0,
      stdout: "",
      stderr: "",
      duration: 100,
      timedOut: false,
    });

    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      { serverIds: [s1.id], action: "restart" },
      tokenA,
    );
    expect(res.status).toBe(200);
  });

  it("should reject member for stop action", async () => {
    mockUserRole = "member";

    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      { serverIds: ["550e8400-e29b-41d4-a716-446655440000"], action: "stop" },
      tokenA,
    );
    expect(res.status).toBe(403);
  });
});
