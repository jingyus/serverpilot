// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for chat-export routes edition gating (CE vs EE).
 *
 * Chat session export (single-session JSON/Markdown download) is a basic
 * capability tied to the `chat` feature, which is always enabled in both
 * CE and EE modes. There is no batch or cross-server export endpoint.
 *
 * These tests verify:
 * - CE mode: single-session export works normally (200)
 * - CE mode: both JSON and Markdown formats are available
 * - EE mode: single-session export works normally (200)
 * - Both modes: non-existent server/session returns 404
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import type { FeatureFlags, EditionInfo } from "../../config/edition.js";
import { resolveFeatures } from "../../config/edition.js";

// ============================================================================
// Module Mocks — must be before imports of the module under test
// ============================================================================

// Mock auth/RBAC to pass-through (we test edition gating, not permissions)
vi.mock("../middleware/auth.js", async () => {
  const original = await vi.importActual("../middleware/auth.js");
  return {
    ...(original as object),
    requireAuth: vi.fn(
      async (
        c: Record<string, (k: string, v: string) => void>,
        next: () => Promise<void>,
      ) => {
        c.set("userId", "user-export-edition");
        await next();
      },
    ),
  };
});

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

// Dynamic FEATURES — controlled per-test via `activeFeatures`.
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

// Mock session manager with a controllable in-memory store
const sessionsById = new Map<
  string,
  {
    id: string;
    serverId: string;
    messages: Array<{ role: string; content: string; timestamp: string }>;
    name: string | null;
    createdAt: string;
    updatedAt: string;
  }
>();

vi.mock("../../core/session/manager.js", () => ({
  getSessionManager: () => ({
    getSession: vi.fn(async (sessionId: string, userId: string) => {
      const session = sessionsById.get(sessionId);
      if (!session) return null;
      // Simulate user isolation: session created by 'user-export-edition'
      if (userId !== "user-export-edition") return null;
      return session;
    }),
  }),
}));

// Mock server repository with known servers
const serversById = new Map<
  string,
  { id: string; name: string; userId: string }
>();

vi.mock("../../db/repositories/server-repository.js", () => ({
  getServerRepository: () => ({
    findById: vi.fn(async (serverId: string, userId: string) => {
      const server = serversById.get(serverId);
      if (!server || server.userId !== userId) return null;
      return server;
    }),
  }),
}));

// Import after mocks
import { onError } from "../middleware/error-handler.js";
import { chatExport } from "./chat-export.js";
import type { ApiEnv } from "./types.js";

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
// Test fixtures
// ============================================================================

const TEST_USER = "user-export-edition";
const TEST_SERVER_ID = "srv-export-001";
const TEST_SESSION_ID = "sess-export-001";

function seedTestData(): void {
  serversById.clear();
  sessionsById.clear();

  serversById.set(TEST_SERVER_ID, {
    id: TEST_SERVER_ID,
    name: "web-server-01",
    userId: TEST_USER,
  });

  sessionsById.set(TEST_SESSION_ID, {
    id: TEST_SESSION_ID,
    serverId: TEST_SERVER_ID,
    name: "Deploy Nginx",
    createdAt: "2026-01-15T10:00:00.000Z",
    updatedAt: "2026-01-15T10:05:00.000Z",
    messages: [
      {
        role: "user",
        content: "How do I install nginx?",
        timestamp: "2026-01-15T10:01:00.000Z",
      },
      {
        role: "assistant",
        content: "Run `sudo apt install nginx`",
        timestamp: "2026-01-15T10:01:05.000Z",
      },
      {
        role: "user",
        content: "Thanks!",
        timestamp: "2026-01-15T10:02:00.000Z",
      },
    ],
  });
}

// ============================================================================
// Helpers
// ============================================================================

function createTestApp(): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  app.onError(onError);
  app.route("/chat", chatExport);
  return app;
}

function exportUrl(
  serverId: string,
  sessionId: string,
  format?: "json" | "markdown",
): string {
  const base = `/chat/${serverId}/sessions/${sessionId}/export`;
  return format ? `${base}?format=${format}` : base;
}

// ============================================================================
// CE Mode — single-session export allowed
// ============================================================================

describe("CE mode — chat-export edition gating", () => {
  beforeEach(() => {
    activeFeatures = ceFeatures;
    seedTestData();
  });

  it("GET /chat/:serverId/sessions/:sessionId/export returns 200 (JSON)", async () => {
    const app = createTestApp();
    const res = await app.request(
      exportUrl(TEST_SERVER_ID, TEST_SESSION_ID, "json"),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("content-disposition")).toContain(".json");

    const data = await res.json();
    expect(data.id).toBe(TEST_SESSION_ID);
    expect(data.serverId).toBe(TEST_SERVER_ID);
    expect(data.format).toBe("json");
    expect(data.messages).toHaveLength(3);
    expect(data.messages[0].role).toBe("user");
    expect(data.exportedAt).toBeDefined();
  });

  it("GET /chat/:serverId/sessions/:sessionId/export returns 200 (Markdown)", async () => {
    const app = createTestApp();
    const res = await app.request(
      exportUrl(TEST_SERVER_ID, TEST_SESSION_ID, "markdown"),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(res.headers.get("content-disposition")).toContain(".md");

    const text = await res.text();
    expect(text).toContain("# Deploy Nginx");
    expect(text).toContain("**Server:** web-server-01");
    expect(text).toContain("> How do I install nginx?");
    expect(text).toContain("Run `sudo apt install nginx`");
  });

  it("GET /chat/:serverId/sessions/:sessionId/export defaults to JSON", async () => {
    const app = createTestApp();
    const res = await app.request(exportUrl(TEST_SERVER_ID, TEST_SESSION_ID));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const data = await res.json();
    expect(data.format).toBe("json");
  });

  it("returns 404 for non-existent server", async () => {
    const app = createTestApp();
    const res = await app.request(
      exportUrl("non-existent-srv", TEST_SESSION_ID),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for non-existent session", async () => {
    const app = createTestApp();
    const res = await app.request(
      exportUrl(TEST_SERVER_ID, "non-existent-sess"),
    );
    expect(res.status).toBe(404);
  });

  it("chat feature is always enabled in CE mode", () => {
    expect(ceFeatures.chat).toBe(true);
  });

  it("multiSession is disabled in CE (but export still works)", () => {
    expect(ceFeatures.multiSession).toBe(false);
    // The export route works for any valid session regardless of multiSession flag
  });
});

// ============================================================================
// EE Mode — export fully accessible
// ============================================================================

describe("EE mode — chat-export edition gating", () => {
  beforeEach(() => {
    activeFeatures = eeFeatures;
    seedTestData();
  });

  it("GET /chat/:serverId/sessions/:sessionId/export returns 200 (JSON)", async () => {
    const app = createTestApp();
    const res = await app.request(
      exportUrl(TEST_SERVER_ID, TEST_SESSION_ID, "json"),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(TEST_SESSION_ID);
    expect(data.format).toBe("json");
    expect(data.messages).toHaveLength(3);
  });

  it("GET /chat/:serverId/sessions/:sessionId/export returns 200 (Markdown)", async () => {
    const app = createTestApp();
    const res = await app.request(
      exportUrl(TEST_SERVER_ID, TEST_SESSION_ID, "markdown"),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");

    const text = await res.text();
    expect(text).toContain("# Deploy Nginx");
  });

  it("returns 404 for non-existent server", async () => {
    const app = createTestApp();
    const res = await app.request(
      exportUrl("non-existent-srv", TEST_SESSION_ID),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for non-existent session", async () => {
    const app = createTestApp();
    const res = await app.request(
      exportUrl(TEST_SERVER_ID, "non-existent-sess"),
    );
    expect(res.status).toBe(404);
  });

  it("multiSession is enabled in EE mode", () => {
    expect(eeFeatures.multiSession).toBe(true);
  });
});

// ============================================================================
// Cross-edition: no batch/bulk export endpoint exists
// ============================================================================

describe("No batch export endpoint", () => {
  beforeEach(() => {
    activeFeatures = ceFeatures;
    seedTestData();
  });

  it("there is no bulk export route (e.g. /chat/:serverId/export)", async () => {
    const app = createTestApp();
    const res = await app.request(`/chat/${TEST_SERVER_ID}/export`);
    expect(res.status).toBe(404);
  });

  it("there is no cross-server export route (e.g. /chat/export)", async () => {
    const app = createTestApp();
    const res = await app.request("/chat/export");
    expect(res.status).toBe(404);
  });

  it("there is no sessions bulk export route (e.g. /chat/:serverId/sessions/export)", async () => {
    const app = createTestApp();
    const res = await app.request(`/chat/${TEST_SERVER_ID}/sessions/export`);
    // This path doesn't match /:serverId/sessions/:sessionId/export
    // because "export" is treated as a sessionId, and it won't be found
    expect(res.status).toBe(404);
  });
});
