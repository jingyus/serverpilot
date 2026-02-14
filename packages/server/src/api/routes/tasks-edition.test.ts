// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for tasks routes edition gating (CE vs EE).
 *
 * Verifies that:
 * - CE mode: tasks are accessible and auto-bind to the local server
 * - CE mode: serverId parameter is ignored on create (uses local server)
 * - CE mode: GET /tasks auto-scopes to the local server
 * - EE mode: tasks support multi-server (explicit serverId required)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import type { FeatureFlags } from "../../config/edition.js";
import { resolveFeatures } from "../../config/edition.js";
import type {
  TaskRepository,
  Task,
} from "../../db/repositories/task-repository.js";
import { onError } from "../middleware/error-handler.js";
import type { ApiEnv } from "./types.js";

// ============================================================================
// Module Mocks — must be before imports of the module under test
// ============================================================================

const mockTaskRepo: TaskRepository = {
  create: vi.fn(),
  getById: vi.fn(),
  listByServer: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  findByStatus: vi.fn(),
  updateRunResult: vi.fn(async () => true),
  findDueTasks: vi.fn(async () => []),
};

vi.mock("../../db/repositories/task-repository.js", () => ({
  getTaskRepository: () => mockTaskRepo,
}));

// Controllable server list for CE/EE testing
const LOCAL_SERVER_ID = "550e8400-e29b-41d4-a716-446655440099";
let mockServers: Array<{ id: string; name: string; tags: string[] }> = [];

vi.mock("../../db/repositories/server-repository.js", () => ({
  getServerRepository: () => ({
    findAllByUserId: vi.fn(async () => mockServers),
  }),
}));

vi.mock("../../core/task/executor.js", () => ({
  getTaskExecutor: () => ({
    executeCommand: vi.fn(async () => ({
      success: true,
      executionId: "exec-1",
      operationId: "op-1",
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      duration: 100,
      timedOut: false,
    })),
  }),
}));

vi.mock("../../core/task/scheduler.js", async () => {
  const { CronExpressionParser } = await import("cron-parser");
  return {
    getTaskScheduler: () => ({
      findConnectedAgent: vi.fn(() => "client-1"),
    }),
    getNextRunDate: (cronExpr: string, from?: Date) => {
      try {
        const expr = CronExpressionParser.parse(cronExpr, {
          currentDate: from ?? new Date(),
          tz: "UTC",
        });
        return expr.next().toDate();
      } catch {
        return null;
      }
    },
  };
});

vi.mock("../middleware/auth.js", () => ({
  requireAuth: vi.fn(
    async (
      c: { set: (k: string, v: string) => void },
      next: () => Promise<void>,
    ) => {
      c.set("userId", "user-1");
      await next();
    },
  ),
}));

vi.mock("../middleware/rbac.js", () => ({
  resolveRole: vi.fn(
    async (
      c: Record<string, (k: string, v: string) => void>,
      next: () => Promise<void>,
    ) => {
      c.set("userRole", "owner");
      await next();
    },
  ),
  requirePermission: vi.fn(() => {
    return async (_c: unknown, next: () => Promise<void>) => {
      await next();
    };
  }),
}));

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock edition — use getter so we can switch CE/EE per describe block
let activeFeatures: FeatureFlags;

vi.mock("../../config/edition.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../config/edition.js")>();
  return {
    ...original,
    get FEATURES() {
      return activeFeatures;
    },
  };
});

// Import after mocks
import { tasks } from "./tasks.js";

// ============================================================================
// Edition constants
// ============================================================================

const ceInfo = {
  edition: "ce" as const,
  isCE: true,
  isEE: false,
  isCloud: false,
};
const eeInfo = {
  edition: "ee" as const,
  isCE: false,
  isEE: true,
  isCloud: false,
};
const ceFeatures: FeatureFlags = resolveFeatures(ceInfo);
const eeFeatures: FeatureFlags = resolveFeatures(eeInfo);

// ============================================================================
// Test Helpers
// ============================================================================

function createTestApp() {
  const app = new Hono<ApiEnv>();
  app.route("/tasks", tasks);
  app.onError(onError);
  return app;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    serverId: LOCAL_SERVER_ID,
    userId: "user-1",
    name: "Daily Backup",
    description: "Backup database every day",
    cron: "0 2 * * *",
    command: "pg_dump -U postgres mydb > /backup/db.sql",
    status: "active",
    lastRun: null,
    lastStatus: null,
    nextRun: new Date("2026-02-10T02:00:00Z").toISOString(),
    createdAt: new Date("2026-02-09T00:00:00Z").toISOString(),
    ...overrides,
  };
}

let app: ReturnType<typeof createTestApp>;

// ============================================================================
// CE Mode — tasks auto-bind to local server
// ============================================================================

describe("CE mode — tasks auto-bind to local server", () => {
  beforeEach(() => {
    activeFeatures = ceFeatures;
    mockServers = [
      { id: LOCAL_SERVER_ID, name: "Local Server", tags: ["local", "auto"] },
    ];
    app = createTestApp();
    vi.clearAllMocks();
  });

  it("POST /tasks creates task with local serverId (no serverId in body)", async () => {
    const newTask = makeTask();
    (mockTaskRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(
      newTask,
    );

    const res = await app.request("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Daily Backup",
        cron: "0 2 * * *",
        command: "pg_dump -U postgres mydb > /backup/db.sql",
      }),
    });

    expect(res.status).toBe(201);
    expect(mockTaskRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: LOCAL_SERVER_ID,
        userId: "user-1",
        name: "Daily Backup",
      }),
    );
  });

  it("POST /tasks ignores provided serverId in CE mode (uses local server)", async () => {
    const newTask = makeTask();
    (mockTaskRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(
      newTask,
    );

    const res = await app.request("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverId: "550e8400-e29b-41d4-a716-446655440001",
        name: "Task With ServerId",
        cron: "0 2 * * *",
        command: "echo hello",
      }),
    });

    expect(res.status).toBe(201);
    // Should use local server ID, not the one in the body
    expect(mockTaskRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: LOCAL_SERVER_ID,
      }),
    );
  });

  it("GET /tasks auto-scopes to local server when no serverId provided", async () => {
    (mockTaskRepo.listByServer as ReturnType<typeof vi.fn>).mockResolvedValue({
      tasks: [makeTask()],
      total: 1,
    });

    const res = await app.request("/tasks");

    expect(res.status).toBe(200);
    expect(mockTaskRepo.listByServer).toHaveBeenCalledWith(
      LOCAL_SERVER_ID,
      "user-1",
      expect.objectContaining({ limit: 50, offset: 0 }),
    );
  });

  it("GET /tasks with explicit serverId still works in CE mode", async () => {
    (mockTaskRepo.listByServer as ReturnType<typeof vi.fn>).mockResolvedValue({
      tasks: [],
      total: 0,
    });

    const res = await app.request(`/tasks?serverId=${LOCAL_SERVER_ID}`);

    expect(res.status).toBe(200);
    expect(mockTaskRepo.listByServer).toHaveBeenCalledWith(
      LOCAL_SERVER_ID,
      "user-1",
      expect.any(Object),
    );
  });

  it("CRUD operations work in CE mode", async () => {
    const task = makeTask();

    // Get by ID
    (mockTaskRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(task);
    const getRes = await app.request(`/tasks/${task.id}`);
    expect(getRes.status).toBe(200);

    // Update
    (mockTaskRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(task);
    (mockTaskRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...task,
      name: "Updated",
    });
    const patchRes = await app.request(`/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated" }),
    });
    expect(patchRes.status).toBe(200);

    // Delete
    (mockTaskRepo.delete as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const delRes = await app.request(`/tasks/${task.id}`, { method: "DELETE" });
    expect(delRes.status).toBe(200);
  });

  it("POST /tasks returns 400 when no server is registered in CE mode", async () => {
    mockServers = [];

    const res = await app.request("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "No Server Task",
        cron: "0 2 * * *",
        command: "echo test",
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain("No server registered");
  });

  it("GET /tasks returns 400 when no server is registered in CE mode", async () => {
    mockServers = [];

    const res = await app.request("/tasks");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain("No server registered");
  });
});

// ============================================================================
// EE Mode — full multi-server task management
// ============================================================================

describe("EE mode — multi-server task management", () => {
  beforeEach(() => {
    activeFeatures = eeFeatures;
    mockServers = [
      { id: LOCAL_SERVER_ID, name: "Server 1", tags: [] },
      {
        id: "550e8400-e29b-41d4-a716-446655440088",
        name: "Server 2",
        tags: [],
      },
    ];
    app = createTestApp();
    vi.clearAllMocks();
  });

  it("POST /tasks requires explicit serverId", async () => {
    const res = await app.request("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "No Server",
        cron: "0 2 * * *",
        command: "echo test",
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain("serverId is required");
  });

  it("POST /tasks creates task with explicit serverId", async () => {
    const serverId = "550e8400-e29b-41d4-a716-446655440088";
    const newTask = makeTask({ serverId });
    (mockTaskRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(
      newTask,
    );

    const res = await app.request("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverId,
        name: "Multi-server Task",
        cron: "0 2 * * *",
        command: "echo hello",
      }),
    });

    expect(res.status).toBe(201);
    expect(mockTaskRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId,
        name: "Multi-server Task",
      }),
    );
  });

  it("GET /tasks lists all tasks across servers (no auto-scope)", async () => {
    (mockTaskRepo.findByStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      tasks: [makeTask()],
      total: 1,
    });

    const res = await app.request("/tasks");

    expect(res.status).toBe(200);
    // In EE mode without serverId, should call findByStatus (not listByServer)
    expect(mockTaskRepo.findByStatus).toHaveBeenCalledWith(
      "user-1",
      "active",
      expect.any(Object),
    );
    expect(mockTaskRepo.listByServer).not.toHaveBeenCalled();
  });

  it("GET /tasks filters by serverId when provided in EE mode", async () => {
    (mockTaskRepo.listByServer as ReturnType<typeof vi.fn>).mockResolvedValue({
      tasks: [],
      total: 0,
    });

    const serverId = "550e8400-e29b-41d4-a716-446655440088";
    const res = await app.request(`/tasks?serverId=${serverId}`);

    expect(res.status).toBe(200);
    expect(mockTaskRepo.listByServer).toHaveBeenCalledWith(
      serverId,
      "user-1",
      expect.any(Object),
    );
  });

  it("all CRUD endpoints accessible in EE mode", async () => {
    const task = makeTask();

    // Get by ID
    (mockTaskRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(task);
    const getRes = await app.request(`/tasks/${task.id}`);
    expect(getRes.status).toBe(200);

    // Update
    (mockTaskRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(task);
    (mockTaskRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(task);
    const patchRes = await app.request(`/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated" }),
    });
    expect(patchRes.status).toBe(200);

    // Delete
    (mockTaskRepo.delete as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const delRes = await app.request(`/tasks/${task.id}`, { method: "DELETE" });
    expect(delRes.status).toBe(200);
  });
});
