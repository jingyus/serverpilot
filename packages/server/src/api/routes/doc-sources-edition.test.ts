// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for doc-sources routes edition behavior (CE vs EE).
 *
 * Knowledge base (doc-sources) is a CE core feature — all endpoints
 * must be accessible in BOTH CE and EE modes without feature gating.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import type { FeatureFlags, EditionInfo } from "../../config/edition.js";
import { resolveFeatures } from "../../config/edition.js";

// ============================================================================
// Module Mocks — must be before imports of the module under test
// ============================================================================

vi.mock("../middleware/auth.js", () => ({
  requireAuth: vi.fn(
    async (
      c: Record<string, (k: string, v: string) => void>,
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

const mockDocSourceRepo = {
  create: vi.fn(async () => ({
    id: "ds-1",
    userId: "user-1",
    name: "Nginx Docs",
    software: "nginx",
    type: "github",
    githubConfig: { owner: "nginx", repo: "nginx" },
    websiteConfig: null,
    enabled: true,
    autoUpdate: false,
    updateFrequencyHours: 168,
    lastFetchedAt: null,
    lastFetchStatus: null,
    lastFetchError: null,
    documentCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })),
  findById: vi.fn(async () => ({
    id: "ds-1",
    userId: "user-1",
    name: "Nginx Docs",
    software: "nginx",
    type: "github",
    githubConfig: { owner: "nginx", repo: "nginx" },
    websiteConfig: null,
    enabled: true,
    autoUpdate: false,
    updateFrequencyHours: 168,
    lastFetchedAt: null,
    lastFetchStatus: null,
    lastFetchError: null,
    documentCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })),
  listByUserId: vi.fn(async () => []),
  update: vi.fn(async () => ({
    id: "ds-1",
    userId: "user-1",
    name: "Updated",
    software: "nginx",
    type: "github",
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })),
  delete: vi.fn(async () => true),
  recordFetchResult: vi.fn(),
  shouldUpdate: vi.fn(() => false),
};

vi.mock("../../db/repositories/doc-source-repository.js", () => ({
  getDocSourceRepository: () => mockDocSourceRepo,
}));

vi.mock("../../knowledge/doc-fetcher.js", () => ({
  DocFetcher: vi.fn().mockImplementation(() => ({
    fetchSource: vi.fn(async () => ({
      id: "task-1",
      status: "completed",
      summary: { succeeded: 5 },
    })),
  })),
}));

// Keep the real requireFeature — we test actual feature gating behavior.
// Override the FEATURES singleton via a mocked edition module getter.
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
const { default: docSourcesApp } = await import("./doc-sources.js");
import { onError } from "../middleware/error-handler.js";
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
// Helpers
// ============================================================================

function createTestApp() {
  const app = new Hono<ApiEnv>();
  app.onError(onError);
  app.route("/doc-sources", docSourcesApp);
  return app;
}

// ============================================================================
// CE Mode — All doc-source routes accessible (CE core feature)
// ============================================================================

describe("CE mode — doc-sources routes accessible (knowledgeBase is CE core)", () => {
  beforeEach(() => {
    activeFeatures = ceFeatures;
    vi.clearAllMocks();
  });

  it("GET /doc-sources returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/doc-sources");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sources).toBeDefined();
  });

  it("POST /doc-sources returns 201", async () => {
    const app = createTestApp();
    const res = await app.request("/doc-sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Nginx Docs",
        software: "nginx",
        type: "github",
        githubConfig: { owner: "nginx", repo: "nginx" },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.source).toBeDefined();
  });

  it("GET /doc-sources/:id returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/doc-sources/ds-1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBeDefined();
  });

  it("PATCH /doc-sources/:id returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/doc-sources/ds-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBeDefined();
  });

  it("DELETE /doc-sources/:id returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/doc-sources/ds-1", { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("POST /doc-sources/:id/fetch returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/doc-sources/ds-1/fetch", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("GET /doc-sources/:id/status returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/doc-sources/ds-1/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBeDefined();
  });

  it("knowledgeBase feature flag is true in CE", () => {
    expect(ceFeatures.knowledgeBase).toBe(true);
  });
});

// ============================================================================
// EE Mode — All doc-source routes also accessible
// ============================================================================

describe("EE mode — doc-sources routes accessible", () => {
  beforeEach(() => {
    activeFeatures = eeFeatures;
    vi.clearAllMocks();
  });

  it("GET /doc-sources returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/doc-sources");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sources).toBeDefined();
  });

  it("POST /doc-sources returns 201", async () => {
    const app = createTestApp();
    const res = await app.request("/doc-sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Nginx Docs",
        software: "nginx",
        type: "github",
        githubConfig: { owner: "nginx", repo: "nginx" },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.source).toBeDefined();
  });

  it("GET /doc-sources/:id returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/doc-sources/ds-1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBeDefined();
  });

  it("PATCH /doc-sources/:id returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/doc-sources/ds-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBeDefined();
  });

  it("DELETE /doc-sources/:id returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/doc-sources/ds-1", { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("POST /doc-sources/:id/fetch returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/doc-sources/ds-1/fetch", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("GET /doc-sources/:id/status returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/doc-sources/ds-1/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBeDefined();
  });

  it("knowledgeBase feature flag is true in EE", () => {
    expect(eeFeatures.knowledgeBase).toBe(true);
  });
});
