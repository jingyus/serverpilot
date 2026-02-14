// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for servers routes edition gating (CE vs EE).
 *
 * Verifies that multi-server management routes are blocked in CE mode
 * and accessible in EE mode, while single-server read routes remain
 * accessible in both modes.
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

// Mock RBAC to pass-through (we test feature gating, not permissions)
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

// Keep the real requireFeature — we test actual feature gating behavior
// But we need to override the FEATURES it reads. We do this by mocking
// the edition module to provide controllable feature flags.
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
  InMemoryServerRepository,
  setServerRepository,
  _resetServerRepository,
} from "../../db/repositories/server-repository.js";
import {
  initDatabase,
  closeDatabase,
  createTables,
  getDatabase,
} from "../../db/connection.js";
import { _resetProfileRepository } from "../../db/repositories/profile-repository.js";
import { _resetOperationRepository } from "../../db/repositories/operation-repository.js";
import { _resetMetricsRepository } from "../../db/repositories/metrics-repository.js";
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
const USER_A = "user-edition-aaa";

let app: Hono<ApiEnv>;
let repo: InMemoryServerRepository;
let tokenA: string;

beforeAll(async () => {
  _resetJwtConfig();
  initJwtConfig({ secret: TEST_SECRET });

  const tokensA = await generateTokens(USER_A);
  tokenA = tokensA.accessToken;
});

beforeEach(() => {
  repo = new InMemoryServerRepository();
  setServerRepository(repo);
  initDatabase(":memory:");
  createTables();
  _resetProfileRepository();
  _resetOperationRepository();
  _resetMetricsRepository();
  _resetOperationHistoryService();

  const sqlite = (
    getDatabase() as unknown as {
      session: { client: { exec: (s: string) => void } };
    }
  ).session.client;
  sqlite.exec(
    `INSERT OR IGNORE INTO users (id, email, password_hash, created_at, updated_at)
     VALUES ('${USER_A}', 'edition-test@test.com', 'hash', ${Date.now()}, ${Date.now()})`,
  );
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

/** Create a server directly in the in-memory repo (bypasses API for setup). */
async function seedServer(name: string): Promise<string> {
  const server = await repo.create({ name, userId: USER_A, tags: [] });
  // Also insert into SQLite for profile routes
  const sqlite = (
    getDatabase() as unknown as {
      session: { client: { exec: (s: string) => void } };
    }
  ).session.client;
  sqlite.exec(
    `INSERT OR IGNORE INTO servers (id, name, user_id, status, tags, created_at, updated_at)
     VALUES ('${server.id}', '${name}', '${USER_A}', 'online', '[]', ${Date.now()}, ${Date.now()})`,
  );
  sqlite.exec(
    `INSERT OR IGNORE INTO profiles (id, server_id, os_info, software, services, preferences, notes, operation_history, history_summary, updated_at)
     VALUES ('prof-${server.id}', '${server.id}', null, '[]', '[]', null, '[]', '[]', null, ${Date.now()})`,
  );
  return server.id;
}

// ============================================================================
// CE Mode — Multi-server routes blocked
// ============================================================================

describe("CE mode — multi-server routes blocked", () => {
  beforeEach(() => {
    activeFeatures = ceFeatures;
    app = createApiApp();
  });

  it("GET /servers returns 403 FEATURE_DISABLED", async () => {
    const res = await req("/api/v1/servers", tokenA);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.feature).toBe("multiServer");
  });

  it("POST /servers returns 403 FEATURE_DISABLED", async () => {
    const res = await jsonPost("/api/v1/servers", { name: "web-01" }, tokenA);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.feature).toBe("multiServer");
  });

  it("DELETE /servers/:id returns 403 FEATURE_DISABLED", async () => {
    const serverId = await seedServer("to-delete");
    const res = await req(`/api/v1/servers/${serverId}`, tokenA, {
      method: "DELETE",
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
  });

  it("PATCH /servers/:id returns 403 FEATURE_DISABLED", async () => {
    const serverId = await seedServer("to-update");
    const res = await jsonPatch(
      `/api/v1/servers/${serverId}`,
      { name: "updated" },
      tokenA,
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
  });

  it("GET /servers/groups returns 403 FEATURE_DISABLED", async () => {
    const res = await req("/api/v1/servers/groups", tokenA);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
  });

  it("POST /servers/batch/action returns 403 FEATURE_DISABLED", async () => {
    const res = await jsonPost(
      "/api/v1/servers/batch/action",
      { serverIds: ["id1"], action: "delete" },
      tokenA,
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
  });

  it("GET /servers/status/stream returns 403 FEATURE_DISABLED", async () => {
    const res = await req("/api/v1/servers/status/stream", tokenA);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
  });
});

// ============================================================================
// CE Mode — Single-server read routes accessible
// ============================================================================

describe("CE mode — single-server read routes accessible", () => {
  beforeEach(() => {
    activeFeatures = ceFeatures;
    app = createApiApp();
  });

  it("GET /servers/:id returns server details", async () => {
    const serverId = await seedServer("local-server");
    const res = await req(`/api/v1/servers/${serverId}`, tokenA);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.server.id).toBe(serverId);
  });

  it("GET /servers/:id/profile returns profile", async () => {
    const serverId = await seedServer("local-server");
    const res = await req(`/api/v1/servers/${serverId}/profile`, tokenA);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile).toBeDefined();
    expect(body.profile.serverId).toBe(serverId);
  });

  it("GET /servers/:id/metrics returns metrics", async () => {
    const serverId = await seedServer("local-server");
    const res = await req(`/api/v1/servers/${serverId}/metrics`, tokenA);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics).toBeDefined();
  });

  it("GET /servers/:id/operations returns operations", async () => {
    const serverId = await seedServer("local-server");
    const res = await req(`/api/v1/servers/${serverId}/operations`, tokenA);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.operations).toBeDefined();
  });

  it("GET /servers/:id/profile/history returns history", async () => {
    const serverId = await seedServer("local-server");
    const res = await req(
      `/api/v1/servers/${serverId}/profile/history`,
      tokenA,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.history).toBeDefined();
  });

  it("GET /servers/:id/profile/summary returns summary", async () => {
    const serverId = await seedServer("local-server");
    const res = await req(
      `/api/v1/servers/${serverId}/profile/summary`,
      tokenA,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("summary");
  });

  it("POST /servers/:id/profile/notes is accessible (single-server write)", async () => {
    const serverId = await seedServer("local-server");
    const res = await jsonPost(
      `/api/v1/servers/${serverId}/profile/notes`,
      { note: "A note on local server" },
      tokenA,
    );
    expect(res.status).toBe(200);
  });

  it("POST /servers/:id/profile/history is accessible (single-server write)", async () => {
    const serverId = await seedServer("local-server");
    const res = await jsonPost(
      `/api/v1/servers/${serverId}/profile/history`,
      { summary: "Installed nginx" },
      tokenA,
    );
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// EE Mode — All routes accessible
// ============================================================================

describe("EE mode — all routes accessible", () => {
  beforeEach(() => {
    activeFeatures = eeFeatures;
    app = createApiApp();
  });

  it("GET /servers returns 200", async () => {
    const res = await req("/api/v1/servers", tokenA);
    expect(res.status).toBe(200);
  });

  it("POST /servers returns 201", async () => {
    const res = await jsonPost(
      "/api/v1/servers",
      { name: "ee-server" },
      tokenA,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.server.name).toBe("ee-server");
  });

  it("GET /servers/:id returns 200", async () => {
    const serverId = await seedServer("ee-server");
    const res = await req(`/api/v1/servers/${serverId}`, tokenA);
    expect(res.status).toBe(200);
  });

  it("PATCH /servers/:id returns 200", async () => {
    const serverId = await seedServer("ee-server");
    const res = await jsonPatch(
      `/api/v1/servers/${serverId}`,
      { name: "updated" },
      tokenA,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.server.name).toBe("updated");
  });

  it("DELETE /servers/:id returns 200", async () => {
    const serverId = await seedServer("ee-server");
    const res = await req(`/api/v1/servers/${serverId}`, tokenA, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
  });

  it("GET /servers/groups returns 200", async () => {
    const res = await req("/api/v1/servers/groups", tokenA);
    expect(res.status).toBe(200);
  });

  it("GET /servers/:id/profile returns 200", async () => {
    const serverId = await seedServer("ee-server");
    const res = await req(`/api/v1/servers/${serverId}/profile`, tokenA);
    expect(res.status).toBe(200);
  });

  it("GET /servers/:id/metrics returns 200", async () => {
    const serverId = await seedServer("ee-server");
    const res = await req(`/api/v1/servers/${serverId}/metrics`, tokenA);
    expect(res.status).toBe(200);
  });
});
