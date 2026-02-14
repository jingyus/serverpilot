// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for team and members routes edition gating (CE vs EE).
 *
 * Verifies that all /team/* and /members/* endpoints are blocked
 * in CE mode and accessible in EE mode.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import type { FeatureFlags, EditionInfo } from "../../config/edition.js";
import { resolveFeatures } from "../../config/edition.js";

// ============================================================================
// Module Mocks — must be before imports of the module under test
// ============================================================================

// Mock auth/tenant/RBAC to pass-through (we test feature gating, not permissions)
vi.mock("../middleware/auth.js", () => ({
  requireAuth: vi.fn(
    async (
      c: Record<string, (k: string, v: string) => void>,
      next: () => Promise<void>,
    ) => {
      c.set("userId", "owner-1");
      await next();
    },
  ),
  generateTokens: vi.fn(async () => ({
    accessToken: "mock-access-token",
    refreshToken: "mock-refresh-token",
  })),
}));

vi.mock("../middleware/tenant.js", () => ({
  requireTenant: vi.fn(
    async (
      c: Record<string, (k: string, v: string) => void>,
      next: () => Promise<void>,
    ) => {
      c.set("tenantId", "tenant-1");
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

vi.mock("../../utils/password.js", () => ({
  hashPassword: vi.fn(async (pw: string) => `hashed:${pw}`),
  verifyPassword: vi.fn(async () => true),
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
import { onError } from "../middleware/error-handler.js";
import {
  InMemoryRbacRepository,
  setRbacRepository,
  _resetRbacRepository,
} from "../../db/repositories/rbac-repository.js";
import {
  InMemoryUserRepository,
  setUserRepository,
  _resetUserRepository,
} from "../../db/repositories/user-repository.js";
import {
  InMemoryInvitationRepository,
  setInvitationRepository,
  _resetInvitationRepository,
} from "../../db/repositories/invitation-repository.js";
import { membersRoute } from "./members.js";
import { teamRoute } from "./team.js";
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
  app.route("/team", teamRoute);
  app.route("/members", membersRoute);
  return app;
}

const mockRbacRepo = new InMemoryRbacRepository();
const mockUserRepo = new InMemoryUserRepository();
const mockInvRepo = new InMemoryInvitationRepository();

function seedTestData() {
  const user = {
    id: "owner-1",
    email: "owner@test.com",
    passwordHash: "hash",
    name: "Owner",
    timezone: "UTC",
    tenantId: "tenant-1",
    role: "owner" as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  (mockUserRepo as InMemoryUserRepository)["users"].set("owner-1", user);

  mockRbacRepo.setRole("owner-1", "owner");
  mockRbacRepo.setTenantOwner("tenant-1", "owner-1");
  mockRbacRepo.setTenantMembers("tenant-1", [
    {
      id: "owner-1",
      email: "owner@test.com",
      name: "Owner",
      role: "owner",
      createdAt: new Date().toISOString(),
    },
  ]);
}

beforeEach(() => {
  _resetRbacRepository();
  _resetUserRepository();
  _resetInvitationRepository();
  mockRbacRepo.clear();
  mockUserRepo.clear();
  mockInvRepo.clear();
  setRbacRepository(mockRbacRepo);
  setUserRepository(mockUserRepo);
  setInvitationRepository(mockInvRepo);
  seedTestData();
});

// ============================================================================
// CE Mode — All team/members routes blocked
// ============================================================================

describe("CE mode — team routes blocked", () => {
  beforeEach(() => {
    activeFeatures = ceFeatures;
  });

  it("POST /team/invite returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/team/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "new@test.com", role: "member" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.feature).toBe("teamCollaboration");
  });

  it("GET /team/invitations returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/team/invitations");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.feature).toBe("teamCollaboration");
  });

  it("DELETE /team/invitations/:id returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/team/invitations/inv-1", {
      method: "DELETE",
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
  });

  it("GET /team/members returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/team/members");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
  });

  it("PUT /team/members/:id/role returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/team/members/member-1/role", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
  });

  it("DELETE /team/members/:id returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/team/members/member-1", {
      method: "DELETE",
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
  });

  it("GET /team/invite/:token (public) returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/team/invite/some-token");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.feature).toBe("teamCollaboration");
  });

  it("POST /team/invite/:token/accept (public) returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/team/invite/some-token/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "User", password: "password123" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
  });
});

describe("CE mode — members routes blocked", () => {
  beforeEach(() => {
    activeFeatures = ceFeatures;
  });

  it("GET /members returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/members");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.feature).toBe("teamCollaboration");
  });

  it("PATCH /members/:userId/role returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/members/member-1/role", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.feature).toBe("teamCollaboration");
  });

  it("DELETE /members/:userId returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/members/member-1", { method: "DELETE" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.feature).toBe("teamCollaboration");
  });
});

// ============================================================================
// EE Mode — All routes accessible
// ============================================================================

describe("EE mode — team routes accessible", () => {
  beforeEach(() => {
    activeFeatures = eeFeatures;
  });

  it("POST /team/invite returns 201", async () => {
    const app = createTestApp();
    const res = await app.request("/team/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "new@test.com", role: "member" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.invitation.email).toBe("new@test.com");
  });

  it("GET /team/invitations returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/team/invitations");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invitations).toBeDefined();
  });

  it("GET /team/members returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/team/members");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toBeDefined();
  });
});

describe("EE mode — members routes accessible", () => {
  beforeEach(() => {
    activeFeatures = eeFeatures;
  });

  it("GET /members returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/members");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toBeDefined();
  });
});
