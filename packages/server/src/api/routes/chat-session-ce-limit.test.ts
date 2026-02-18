// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for CE single-session limit.
 *
 * In CE mode (FEATURES.multiSession === false), chat should reuse
 * the existing session instead of creating a new one when no
 * sessionId is provided. In EE mode, new sessions are always created.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { Hono } from "hono";

// ============================================================================
// Module Mocks — must be before imports of the module under test
// ============================================================================

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

vi.mock("../middleware/require-feature.js", () => ({
  requireFeature: vi.fn(() => {
    return async (_c: unknown, next: () => Promise<void>) => {
      await next();
    };
  }),
}));

// Track the current multiSession flag for dynamic toggling
let mockMultiSession = false;

vi.mock("../../config/edition.js", async () => {
  const actual = await vi.importActual("../../config/edition.js");
  return {
    ...(actual as object),
    get FEATURES() {
      return {
        chat: true,
        commandExecution: true,
        knowledgeBase: true,
        multiServer: mockMultiSession,
        multiSession: mockMultiSession,
        teamCollaboration: mockMultiSession,
        webhooks: mockMultiSession,
        alerts: mockMultiSession,
        metricsMonitoring: mockMultiSession,
        auditExport: mockMultiSession,
        oauthLogin: mockMultiSession,
        rateLimiting: mockMultiSession,
        multiTenant: false,
        billing: false,
      };
    },
    get EDITION() {
      return {
        edition: mockMultiSession ? "ee" : "ce",
        isCE: !mockMultiSession,
        isEE: mockMultiSession,
        isCloud: false,
      };
    },
  };
});

vi.mock("./chat-ai.js", async () => {
  const actual = await vi.importActual("./chat-ai.js");
  return {
    ...(actual as object),
    getChatAIAgent: () => null,
    initChatAIAgent: vi.fn(),
    _resetChatAIAgent: vi.fn(),
  };
});

vi.mock("../../ai/agentic-chat.js", () => ({
  getAgenticEngine: () => null,
  initAgenticEngine: vi.fn(),
  _resetAgenticEngine: vi.fn(),
}));

vi.mock("../../core/agent/agent-connector.js", () => ({
  findConnectedAgent: vi.fn(() => null),
  isAgentConnected: vi.fn(() => false),
}));

vi.mock("../../core/profile/manager.js", () => ({
  getProfileManager: vi.fn(() => ({
    getProfile: vi.fn(async () => null),
  })),
  _resetProfileManager: vi.fn(),
}));

vi.mock("../../knowledge/rag-pipeline.js", () => ({
  getRagPipeline: () => null,
  initRagPipeline: vi.fn(),
  _resetRagPipeline: vi.fn(),
}));

vi.mock("../../core/security/audit-logger.js", () => ({
  getAuditLogger: vi.fn(() => ({
    log: vi.fn(async (input: unknown) => ({
      id: "audit-mock",
      ...(input as Record<string, unknown>),
      createdAt: new Date().toISOString(),
    })),
    updateExecutionResult: vi.fn(async () => true),
    query: vi.fn(async () => ({ logs: [], total: 0 })),
  })),
}));

vi.mock("../../core/task/executor.js", () => ({
  getTaskExecutor: vi.fn(() => null),
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
  InMemorySessionRepository,
  setSessionRepository,
  _resetSessionRepository,
} from "../../db/repositories/session-repository.js";
import {
  getSessionManager,
  _resetSessionManager,
} from "../../core/session/manager.js";
import { _resetSessionLocks } from "./chat-session-lock.js";
import { _resetPendingConfirmations } from "./chat-confirmations.js";
import {
  _resetActiveExecutions,
  _resetPendingDecisions,
} from "./chat-execution.js";
import type { ApiEnv } from "./types.js";
import { createApiApp } from "./index.js";

// ============================================================================
// Test Setup
// ============================================================================

const TEST_SECRET = "test-secret-key-that-is-at-least-32-chars-long!!";
const USER_ID = "user-ce-session-test";

let app: Hono<ApiEnv>;
let repo: InMemoryServerRepository;
let token: string;

beforeAll(async () => {
  _resetJwtConfig();
  initJwtConfig({ secret: TEST_SECRET });
  const tokens = await generateTokens(USER_ID);
  token = tokens.accessToken;
});

beforeEach(() => {
  mockMultiSession = false; // default to CE mode
  repo = new InMemoryServerRepository();
  setServerRepository(repo);
  _resetSessionManager();
  _resetSessionRepository();
  setSessionRepository(new InMemorySessionRepository());
  _resetSessionLocks();
  _resetPendingConfirmations();
  _resetActiveExecutions();
  _resetPendingDecisions();
  app = createApiApp();
});

// ============================================================================
// Helpers
// ============================================================================

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function jsonPost(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
}

function jsonGet(path: string): Promise<Response> {
  return app.request(path, {
    headers: authHeaders(),
  });
}

function jsonDelete(path: string): Promise<Response> {
  return app.request(path, {
    method: "DELETE",
    headers: authHeaders(),
  });
}

function jsonPatch(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
}

async function createServer(name: string): Promise<string> {
  const res = await jsonPost("/api/v1/servers", { name });
  const body = await res.json();
  return body.server.id;
}

async function parseSSEEvents(
  response: Response,
): Promise<Array<{ event: string; data: string }>> {
  const text = await response.text();
  const events: Array<{ event: string; data: string }> = [];
  const lines = text.split("\n");

  let currentEvent = "message";
  for (const line of lines) {
    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      events.push({ event: currentEvent, data: line.slice(6) });
    } else if (line === "") {
      currentEvent = "message";
    }
  }

  return events;
}

function extractSessionId(
  events: Array<{ event: string; data: string }>,
): string {
  const msgEvent = events.find((e) => e.event === "message");
  const data = JSON.parse(msgEvent!.data);
  return data.sessionId;
}

// ============================================================================
// CE single-session limit
// ============================================================================

describe.skip("CE single-session limit", () => {
  it("CE mode: first message creates a session", async () => {
    mockMultiSession = false;
    const serverId = await createServer("my-server");

    const res = await jsonPost(`/api/v1/chat/${serverId}`, {
      message: "hello",
    });
    expect(res.status).toBe(200);

    const events = await parseSSEEvents(res);
    const sessionId = extractSessionId(events);
    expect(sessionId).toBeDefined();
    expect(typeof sessionId).toBe("string");
  });

  it("CE mode: second message without sessionId reuses existing session", async () => {
    mockMultiSession = false;
    const serverId = await createServer("my-server");

    // First message — creates a session
    const res1 = await jsonPost(`/api/v1/chat/${serverId}`, {
      message: "hello",
    });
    const events1 = await parseSSEEvents(res1);
    const sessionId1 = extractSessionId(events1);

    // Second message — should reuse the same session (no sessionId provided)
    const res2 = await jsonPost(`/api/v1/chat/${serverId}`, {
      message: "world",
    });
    const events2 = await parseSSEEvents(res2);
    const sessionId2 = extractSessionId(events2);

    expect(sessionId2).toBe(sessionId1);
  });

  it("CE mode: explicit sessionId is honored", async () => {
    mockMultiSession = false;
    const serverId = await createServer("my-server");

    // Create a session via first message
    const res1 = await jsonPost(`/api/v1/chat/${serverId}`, {
      message: "first",
    });
    const events1 = await parseSSEEvents(res1);
    const sessionId1 = extractSessionId(events1);

    // Send with explicit sessionId
    const res2 = await jsonPost(`/api/v1/chat/${serverId}`, {
      message: "second",
      sessionId: sessionId1,
    });
    const events2 = await parseSSEEvents(res2);
    const sessionId2 = extractSessionId(events2);

    expect(sessionId2).toBe(sessionId1);
  });

  it("CE mode: session list returns only 1 session after multiple messages", async () => {
    mockMultiSession = false;
    const serverId = await createServer("my-server");

    // Send multiple messages without sessionId — must consume response body
    // to release session lock (lock held until SSE stream completes)
    const res1 = await jsonPost(`/api/v1/chat/${serverId}`, {
      message: "msg1",
    });
    await res1.text();
    const res2 = await jsonPost(`/api/v1/chat/${serverId}`, {
      message: "msg2",
    });
    await res2.text();
    const res3 = await jsonPost(`/api/v1/chat/${serverId}`, {
      message: "msg3",
    });
    await res3.text();

    // List sessions — should still be 1
    const listRes = await jsonGet(`/api/v1/chat/${serverId}/sessions`);
    const listBody = await listRes.json();
    expect(listBody.total).toBe(1);
    expect(listBody.sessions).toHaveLength(1);
  });

  it("CE mode: GET /sessions ignores limit/offset query params", async () => {
    mockMultiSession = false;
    const serverId = await createServer("my-server");

    // Create a session
    const res = await jsonPost(`/api/v1/chat/${serverId}`, {
      message: "hello",
    });
    await res.text();

    // Try to request more — CE mode should still cap at 1
    const listRes = await jsonGet(
      `/api/v1/chat/${serverId}/sessions?limit=50&offset=0`,
    );
    const listBody = await listRes.json();
    expect(listBody.sessions).toHaveLength(1);
  });

  it("CE mode: DELETE /sessions/:id returns 403 when it is the only session", async () => {
    mockMultiSession = false;
    const serverId = await createServer("my-server");

    // Create a session via chat message
    const res = await jsonPost(`/api/v1/chat/${serverId}`, {
      message: "hello",
    });
    const events = await parseSSEEvents(res);
    const sessionId = extractSessionId(events);

    // Try to delete the only session — should be blocked
    const deleteRes = await jsonDelete(
      `/api/v1/chat/${serverId}/sessions/${sessionId}`,
    );
    expect(deleteRes.status).toBe(403);

    const body = await deleteRes.json();
    expect(body.error).toContain("Cannot delete the only session");
  });
});

describe.skip("EE multi-session mode", () => {
  it("EE mode: each message without sessionId creates a new session", async () => {
    mockMultiSession = true;
    const serverId = await createServer("ee-server");

    // First message
    const res1 = await jsonPost(`/api/v1/chat/${serverId}`, {
      message: "hello",
    });
    const events1 = await parseSSEEvents(res1);
    const sessionId1 = extractSessionId(events1);

    // Second message without sessionId — should create new session
    const res2 = await jsonPost(`/api/v1/chat/${serverId}`, {
      message: "world",
    });
    const events2 = await parseSSEEvents(res2);
    const sessionId2 = extractSessionId(events2);

    expect(sessionId2).not.toBe(sessionId1);
  });

  it("EE mode: session list returns multiple sessions", async () => {
    mockMultiSession = true;
    const serverId = await createServer("ee-server");

    // Send messages without sessionId — each creates a new session
    const r1 = await jsonPost(`/api/v1/chat/${serverId}`, { message: "msg1" });
    await r1.text();
    const r2 = await jsonPost(`/api/v1/chat/${serverId}`, { message: "msg2" });
    await r2.text();

    const listRes = await jsonGet(`/api/v1/chat/${serverId}/sessions`);
    const listBody = await listRes.json();
    expect(listBody.total).toBe(2);
    expect(listBody.sessions).toHaveLength(2);
  });

  it("EE mode: explicit sessionId reuses session", async () => {
    mockMultiSession = true;
    const serverId = await createServer("ee-server");

    // Create a session
    const res1 = await jsonPost(`/api/v1/chat/${serverId}`, {
      message: "first",
    });
    const events1 = await parseSSEEvents(res1);
    const sessionId1 = extractSessionId(events1);

    // Send with explicit sessionId — should reuse
    const res2 = await jsonPost(`/api/v1/chat/${serverId}`, {
      message: "second",
      sessionId: sessionId1,
    });
    const events2 = await parseSSEEvents(res2);
    const sessionId2 = extractSessionId(events2);

    expect(sessionId2).toBe(sessionId1);
  });

  it("EE mode: DELETE /sessions/:id succeeds normally", async () => {
    mockMultiSession = true;
    const serverId = await createServer("ee-server");

    // Create a session
    const res = await jsonPost(`/api/v1/chat/${serverId}`, {
      message: "hello",
    });
    const events = await parseSSEEvents(res);
    const sessionId = extractSessionId(events);

    // Delete in EE mode — should succeed
    const deleteRes = await jsonDelete(
      `/api/v1/chat/${serverId}/sessions/${sessionId}`,
    );
    expect(deleteRes.status).toBe(200);

    const body = await deleteRes.json();
    expect(body.success).toBe(true);
  });

  it("EE mode: GET /sessions respects limit/offset query params", async () => {
    mockMultiSession = true;
    const serverId = await createServer("ee-server");

    // Create 3 sessions
    const r1 = await jsonPost(`/api/v1/chat/${serverId}`, { message: "msg1" });
    await r1.text();
    const r2 = await jsonPost(`/api/v1/chat/${serverId}`, { message: "msg2" });
    await r2.text();
    const r3 = await jsonPost(`/api/v1/chat/${serverId}`, { message: "msg3" });
    await r3.text();

    // Request with limit=2
    const listRes = await jsonGet(`/api/v1/chat/${serverId}/sessions?limit=2`);
    const listBody = await listRes.json();
    expect(listBody.sessions).toHaveLength(2);
    expect(listBody.total).toBe(3);
  });
});

// ============================================================================
// GET /sessions/:sessionId — session detail
// ============================================================================

describe.skip("GET /sessions/:sessionId — session detail", () => {
  it("CE mode: returns session detail for existing session", async () => {
    mockMultiSession = false;
    const serverId = await createServer("ce-detail");

    // Create session via chat
    const res = await jsonPost(`/api/v1/chat/${serverId}`, {
      message: "hello",
    });
    const events = await parseSSEEvents(res);
    const sessionId = extractSessionId(events);

    // Fetch detail
    const detailRes = await jsonGet(
      `/api/v1/chat/${serverId}/sessions/${sessionId}`,
    );
    expect(detailRes.status).toBe(200);

    const body = await detailRes.json();
    expect(body.session).toBeDefined();
    expect(body.session.id).toBe(sessionId);
    expect(Array.isArray(body.session.messages)).toBe(true);
  });

  it("EE mode: returns session detail for existing session", async () => {
    mockMultiSession = true;
    const serverId = await createServer("ee-detail");

    const res = await jsonPost(`/api/v1/chat/${serverId}`, {
      message: "hello",
    });
    const events = await parseSSEEvents(res);
    const sessionId = extractSessionId(events);

    const detailRes = await jsonGet(
      `/api/v1/chat/${serverId}/sessions/${sessionId}`,
    );
    expect(detailRes.status).toBe(200);

    const body = await detailRes.json();
    expect(body.session.id).toBe(sessionId);
  });

  it("returns 404 for non-existent session", async () => {
    mockMultiSession = false;
    const serverId = await createServer("ce-404");

    const detailRes = await jsonGet(
      `/api/v1/chat/${serverId}/sessions/non-existent-id`,
    );
    expect(detailRes.status).toBe(404);
  });

  it("returns 404 for non-existent server", async () => {
    mockMultiSession = false;

    const detailRes = await jsonGet(
      "/api/v1/chat/fake-server-id/sessions/fake-session-id",
    );
    expect(detailRes.status).toBe(404);
  });
});

// ============================================================================
// PATCH /sessions/:sessionId — rename session
// ============================================================================

describe.skip("PATCH /sessions/:sessionId — rename session", () => {
  it("CE mode: rename session succeeds", async () => {
    mockMultiSession = false;
    const serverId = await createServer("ce-rename");

    const res = await jsonPost(`/api/v1/chat/${serverId}`, {
      message: "hello",
    });
    const events = await parseSSEEvents(res);
    const sessionId = extractSessionId(events);

    const patchRes = await jsonPatch(
      `/api/v1/chat/${serverId}/sessions/${sessionId}`,
      {
        name: "My Session",
      },
    );
    expect(patchRes.status).toBe(200);

    const body = await patchRes.json();
    expect(body.success).toBe(true);
  });

  it("EE mode: rename session succeeds", async () => {
    mockMultiSession = true;
    const serverId = await createServer("ee-rename");

    const res = await jsonPost(`/api/v1/chat/${serverId}`, {
      message: "hello",
    });
    const events = await parseSSEEvents(res);
    const sessionId = extractSessionId(events);

    const patchRes = await jsonPatch(
      `/api/v1/chat/${serverId}/sessions/${sessionId}`,
      {
        name: "EE Session Name",
      },
    );
    expect(patchRes.status).toBe(200);

    const body = await patchRes.json();
    expect(body.success).toBe(true);
  });

  it("returns 404 for non-existent session", async () => {
    mockMultiSession = false;
    const serverId = await createServer("rename-404");

    const patchRes = await jsonPatch(
      `/api/v1/chat/${serverId}/sessions/non-existent-id`,
      {
        name: "New Name",
      },
    );
    expect(patchRes.status).toBe(404);
  });

  it("returns 404 for non-existent server", async () => {
    mockMultiSession = false;

    const patchRes = await jsonPatch(
      "/api/v1/chat/fake-server-id/sessions/fake-session-id",
      {
        name: "New Name",
      },
    );
    expect(patchRes.status).toBe(404);
  });

  it("rejects empty name", async () => {
    mockMultiSession = false;
    const serverId = await createServer("rename-empty");

    const res = await jsonPost(`/api/v1/chat/${serverId}`, {
      message: "hello",
    });
    const events = await parseSSEEvents(res);
    const sessionId = extractSessionId(events);

    const patchRes = await jsonPatch(
      `/api/v1/chat/${serverId}/sessions/${sessionId}`,
      {
        name: "",
      },
    );
    expect(patchRes.status).toBe(400);
  });

  it("rejects name exceeding 200 chars", async () => {
    mockMultiSession = false;
    const serverId = await createServer("rename-long");

    const res = await jsonPost(`/api/v1/chat/${serverId}`, {
      message: "hello",
    });
    const events = await parseSSEEvents(res);
    const sessionId = extractSessionId(events);

    const patchRes = await jsonPatch(
      `/api/v1/chat/${serverId}/sessions/${sessionId}`,
      {
        name: "x".repeat(201),
      },
    );
    expect(patchRes.status).toBe(400);
  });
});

// ============================================================================
// DELETE edge cases
// ============================================================================

describe.skip("DELETE /sessions/:sessionId — edge cases", () => {
  it("returns 404 for non-existent server", async () => {
    mockMultiSession = true;

    const deleteRes = await jsonDelete(
      "/api/v1/chat/fake-server-id/sessions/fake-session-id",
    );
    expect(deleteRes.status).toBe(404);
  });

  it("returns 404 for non-existent session in EE mode", async () => {
    mockMultiSession = true;
    const serverId = await createServer("delete-404");

    const deleteRes = await jsonDelete(
      `/api/v1/chat/${serverId}/sessions/non-existent-id`,
    );
    expect(deleteRes.status).toBe(404);
  });

  it("CE mode: DELETE returns 403 even after rename (still only session)", async () => {
    mockMultiSession = false;
    const serverId = await createServer("ce-delete-after-rename");

    const res = await jsonPost(`/api/v1/chat/${serverId}`, {
      message: "hello",
    });
    const events = await parseSSEEvents(res);
    const sessionId = extractSessionId(events);

    // Rename first
    await jsonPatch(`/api/v1/chat/${serverId}/sessions/${sessionId}`, {
      name: "Renamed",
    });

    // Still should not be deletable — it's the only session
    const deleteRes = await jsonDelete(
      `/api/v1/chat/${serverId}/sessions/${sessionId}`,
    );
    expect(deleteRes.status).toBe(403);

    const body = await deleteRes.json();
    expect(body.error).toContain("Cannot delete the only session");
  });

  it("returns 404 for non-existent session in CE mode", async () => {
    mockMultiSession = false;
    const serverId = await createServer("ce-delete-no-session");

    const deleteRes = await jsonDelete(
      `/api/v1/chat/${serverId}/sessions/non-existent-id`,
    );
    // CE mode checks total sessions first; if 0 sessions total, that's <= 1, so returns 403
    expect(deleteRes.status).toBe(403);
  });
});

// ============================================================================
// GET /sessions — list edge cases
// ============================================================================

describe.skip("GET /sessions — list edge cases", () => {
  it("CE mode: returns empty list when no sessions exist", async () => {
    mockMultiSession = false;
    const serverId = await createServer("ce-empty");

    const listRes = await jsonGet(`/api/v1/chat/${serverId}/sessions`);
    expect(listRes.status).toBe(200);

    const body = await listRes.json();
    expect(body.sessions).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it("EE mode: returns empty list when no sessions exist", async () => {
    mockMultiSession = true;
    const serverId = await createServer("ee-empty");

    const listRes = await jsonGet(`/api/v1/chat/${serverId}/sessions`);
    expect(listRes.status).toBe(200);

    const body = await listRes.json();
    expect(body.sessions).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it("returns 404 for non-existent server", async () => {
    mockMultiSession = false;

    const listRes = await jsonGet("/api/v1/chat/fake-server-id/sessions");
    expect(listRes.status).toBe(404);
  });
});
