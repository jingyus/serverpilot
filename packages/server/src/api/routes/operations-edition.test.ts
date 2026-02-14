// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for operations routes edition gating (CE vs EE).
 *
 * Operation history is a CE core feature. These tests verify that:
 * - All operations routes remain accessible in CE mode (no feature gate)
 * - CE mode queries return only local-server operations (user-scoped)
 * - Stats in CE mode correctly aggregate the single-server data
 * - EE mode continues to work as before
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
import type { FeatureFlags, EditionInfo } from "../../config/edition.js";
import { resolveFeatures } from "../../config/edition.js";

// ============================================================================
// Module Mocks — must be before imports of the module under test
// ============================================================================

// Mock RBAC to pass-through (we test edition behavior, not permissions)
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

// Mock edition module with controllable feature flags
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

import {
  initJwtConfig,
  generateTokens,
  _resetJwtConfig,
} from "../middleware/auth.js";
import {
  initDatabase,
  closeDatabase,
  createTables,
  getDatabase,
} from "../../db/connection.js";
import { _resetOperationRepository } from "../../db/repositories/operation-repository.js";
import { _resetProfileRepository } from "../../db/repositories/profile-repository.js";
import { _resetOperationHistoryService } from "../../core/operation/operation-history-service.js";
import type { ApiEnv } from "./types.js";
import { createApiApp } from "./index.js";

// ============================================================================
// Edition constants
// ============================================================================

const ceInfo: EditionInfo = {
  edition: "ce",
  isCE: true,
  isEE: false,
  isCloud: false,
};
const eeInfo: EditionInfo = {
  edition: "ee",
  isCE: false,
  isEE: true,
  isCloud: false,
};

const ceFeatures: FeatureFlags = resolveFeatures(ceInfo);
const eeFeatures: FeatureFlags = resolveFeatures(eeInfo);

// ============================================================================
// Test Setup
// ============================================================================

const TEST_SECRET = "test-secret-key-that-is-at-least-32-chars-long!!";
const USER_A = "user-ops-edition-aaa";
const USER_B = "user-ops-edition-bbb";

let app: Hono<ApiEnv>;
let tokenA: string;
let tokenB: string;

function exec(sql: string) {
  const sqlite = (
    getDatabase() as unknown as {
      session: { client: { exec: (s: string) => void } };
    }
  ).session.client;
  sqlite.exec(sql);
}

beforeAll(async () => {
  _resetJwtConfig();
  initJwtConfig({ secret: TEST_SECRET });

  const tokensA = await generateTokens(USER_A);
  const tokensB = await generateTokens(USER_B);
  tokenA = tokensA.accessToken;
  tokenB = tokensB.accessToken;
});

beforeEach(() => {
  initDatabase(":memory:");
  createTables();
  _resetOperationRepository();
  _resetProfileRepository();
  _resetOperationHistoryService();

  // Seed users
  exec(`INSERT INTO users (id, email, password_hash, created_at, updated_at)
        VALUES ('${USER_A}', 'ops-a@test.com', 'hash', ${Date.now()}, ${Date.now()})`);
  exec(`INSERT INTO users (id, email, password_hash, created_at, updated_at)
        VALUES ('${USER_B}', 'ops-b@test.com', 'hash', ${Date.now()}, ${Date.now()})`);

  // Seed servers — CE user has one server (local), EE scenario can have multiple
  exec(`INSERT INTO servers (id, name, user_id, status, tags, created_at, updated_at)
        VALUES ('srv-local', 'Local Server', '${USER_A}', 'online', '[]', ${Date.now()}, ${Date.now()})`);
  exec(`INSERT INTO servers (id, name, user_id, status, tags, created_at, updated_at)
        VALUES ('srv-other', 'Other Server', '${USER_B}', 'online', '[]', ${Date.now()}, ${Date.now()})`);
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

function req(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<Response> {
  return app.request(path, {
    ...init,
    headers: { ...authHeaders(token), ...init?.headers },
  });
}

function jsonPost(
  path: string,
  body: unknown,
  token: string,
): Promise<Response> {
  return req(path, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function jsonPatch(
  path: string,
  body: unknown,
  token: string,
): Promise<Response> {
  return req(path, token, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ============================================================================
// CE Mode — Operations routes accessible (core feature)
// ============================================================================

describe("CE mode — operations routes accessible", () => {
  beforeEach(() => {
    activeFeatures = ceFeatures;
    app = createApiApp();
  });

  it("GET /operations returns 200 (not feature-gated)", async () => {
    const res = await req("/api/v1/operations", tokenA);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.operations).toBeDefined();
    expect(body.total).toBe(0);
  });

  it("POST /operations creates operation in CE mode", async () => {
    const res = await jsonPost(
      "/api/v1/operations",
      {
        serverId: "srv-local",
        type: "install",
        description: "Install nginx on local",
        commands: ["apt install nginx"],
        riskLevel: "yellow",
      },
      tokenA,
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.operation.id).toBeTruthy();
    expect(body.operation.type).toBe("install");
  });

  it("GET /operations/stats returns 200 in CE mode", async () => {
    const res = await req("/api/v1/operations/stats", tokenA);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stats).toBeDefined();
  });

  it("GET /operations/:id returns operation in CE mode", async () => {
    const createRes = await jsonPost(
      "/api/v1/operations",
      {
        serverId: "srv-local",
        type: "execute",
        description: "Run uptime",
        commands: ["uptime"],
        riskLevel: "green",
      },
      tokenA,
    );
    const { operation } = await createRes.json();

    const res = await req(`/api/v1/operations/${operation.id}`, tokenA);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.operation.id).toBe(operation.id);
  });

  it("PATCH /operations/:id/status works in CE mode", async () => {
    const createRes = await jsonPost(
      "/api/v1/operations",
      {
        serverId: "srv-local",
        type: "install",
        description: "Install X",
        commands: ["cmd"],
        riskLevel: "green",
      },
      tokenA,
    );
    const { operation } = await createRes.json();

    const res = await jsonPatch(
      `/api/v1/operations/${operation.id}/status`,
      { status: "running" },
      tokenA,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.operation.status).toBe("running");
  });
});

// ============================================================================
// CE Mode — Single-server query isolation
// ============================================================================

describe("CE mode — single-server query isolation", () => {
  beforeEach(async () => {
    activeFeatures = ceFeatures;
    app = createApiApp();

    // Seed operations for user A on local server
    await jsonPost(
      "/api/v1/operations",
      {
        serverId: "srv-local",
        type: "install",
        description: "Install nginx",
        commands: ["apt install nginx"],
        riskLevel: "yellow",
      },
      tokenA,
    );
    await jsonPost(
      "/api/v1/operations",
      {
        serverId: "srv-local",
        type: "config",
        description: "Configure SSL",
        commands: ["certbot --nginx"],
        riskLevel: "red",
      },
      tokenA,
    );
  });

  it("lists only local-server operations for CE user", async () => {
    const res = await req("/api/v1/operations", tokenA);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.operations).toHaveLength(2);
    // All operations belong to the single local server
    for (const op of body.operations) {
      expect(op.serverId).toBe("srv-local");
    }
  });

  it("stats reflect only local-server data in CE mode", async () => {
    const res = await req("/api/v1/operations/stats", tokenA);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.stats.total).toBe(2);
    expect(body.stats.byType.install).toBe(1);
    expect(body.stats.byType.config).toBe(1);
  });

  it("stats with serverId filter work in CE mode", async () => {
    const res = await req(
      "/api/v1/operations/stats?serverId=srv-local",
      tokenA,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.stats.total).toBe(2);
  });

  it("other user sees no operations (user isolation in CE)", async () => {
    const res = await req("/api/v1/operations", tokenB);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total).toBe(0);
    expect(body.operations).toHaveLength(0);
  });

  it("other user cannot access operations by ID (user isolation in CE)", async () => {
    // Get operation ID from user A
    const listRes = await req("/api/v1/operations", tokenA);
    const { operations } = await listRes.json();
    const opId = operations[0].id;

    // User B should not see it
    const res = await req(`/api/v1/operations/${opId}`, tokenB);
    expect(res.status).toBe(404);
  });

  it("filtering by type works in CE mode", async () => {
    const res = await req("/api/v1/operations?type=install", tokenA);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.operations[0].type).toBe("install");
  });

  it("search works in CE mode", async () => {
    const res = await req("/api/v1/operations?search=SSL", tokenA);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.operations[0].description).toBe("Configure SSL");
  });
});

// ============================================================================
// EE Mode — Operations routes still work
// ============================================================================

describe("EE mode — operations routes accessible", () => {
  beforeEach(() => {
    activeFeatures = eeFeatures;
    app = createApiApp();

    // Add a second server for user A (multi-server EE scenario)
    exec(`INSERT INTO servers (id, name, user_id, status, tags, created_at, updated_at)
          VALUES ('srv-ee-2', 'EE Server 2', '${USER_A}', 'online', '[]', ${Date.now()}, ${Date.now()})`);
  });

  it("GET /operations returns 200 in EE mode", async () => {
    const res = await req("/api/v1/operations", tokenA);
    expect(res.status).toBe(200);
  });

  it("POST /operations creates operation in EE mode", async () => {
    const res = await jsonPost(
      "/api/v1/operations",
      {
        serverId: "srv-local",
        type: "execute",
        description: "EE operation",
        commands: ["ls -la"],
        riskLevel: "green",
      },
      tokenA,
    );
    expect(res.status).toBe(201);
  });

  it("lists operations across multiple servers in EE mode", async () => {
    // Create operations on two different servers
    await jsonPost(
      "/api/v1/operations",
      {
        serverId: "srv-local",
        type: "install",
        description: "Install on server 1",
        commands: ["apt install nginx"],
        riskLevel: "yellow",
      },
      tokenA,
    );
    await jsonPost(
      "/api/v1/operations",
      {
        serverId: "srv-ee-2",
        type: "config",
        description: "Config on server 2",
        commands: ["vi /etc/nginx.conf"],
        riskLevel: "yellow",
      },
      tokenA,
    );

    // List without serverId filter — should see both
    const res = await req("/api/v1/operations", tokenA);
    const body = await res.json();
    expect(body.total).toBe(2);

    const serverIds = body.operations.map(
      (op: { serverId: string }) => op.serverId,
    );
    expect(serverIds).toContain("srv-local");
    expect(serverIds).toContain("srv-ee-2");
  });

  it("filters by serverId in EE mode", async () => {
    await jsonPost(
      "/api/v1/operations",
      {
        serverId: "srv-local",
        type: "install",
        description: "Op on server 1",
        commands: ["cmd1"],
        riskLevel: "green",
      },
      tokenA,
    );
    await jsonPost(
      "/api/v1/operations",
      {
        serverId: "srv-ee-2",
        type: "config",
        description: "Op on server 2",
        commands: ["cmd2"],
        riskLevel: "green",
      },
      tokenA,
    );

    const res = await req("/api/v1/operations?serverId=srv-ee-2", tokenA);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.operations[0].serverId).toBe("srv-ee-2");
  });

  it("stats aggregate across multiple servers in EE mode", async () => {
    await jsonPost(
      "/api/v1/operations",
      {
        serverId: "srv-local",
        type: "install",
        description: "Op 1",
        commands: ["cmd1"],
        riskLevel: "yellow",
      },
      tokenA,
    );
    await jsonPost(
      "/api/v1/operations",
      {
        serverId: "srv-ee-2",
        type: "install",
        description: "Op 2",
        commands: ["cmd2"],
        riskLevel: "red",
      },
      tokenA,
    );

    const res = await req("/api/v1/operations/stats", tokenA);
    const body = await res.json();
    expect(body.stats.total).toBe(2);
    expect(body.stats.byType.install).toBe(2);
  });
});
