// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for auth register route edition gating (CE vs EE).
 *
 * Verifies that POST /auth/register is blocked in CE mode
 * (single-user, pre-set admin only) and accessible in EE mode.
 * Login, refresh, and logout routes remain available in both modes.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import type { FeatureFlags, EditionInfo } from "../../config/edition.js";
import { resolveFeatures } from "../../config/edition.js";

// ============================================================================
// Module Mocks — must be before imports of the module under test
// ============================================================================

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockUser = {
  id: "user-admin",
  email: "admin@local.host",
  name: "Admin",
  passwordHash: "hashed-password",
};

vi.mock("../../db/repositories/user-repository.js", () => ({
  getUserRepository: () => ({
    findByEmail: vi.fn(async (email: string) => {
      if (email === "admin@local.host") return mockUser;
      return null;
    }),
    findById: vi.fn(async (id: string) => ({
      id,
      email: "admin@local.host",
      name: "Admin",
      passwordHash: "hashed-password",
    })),
    create: vi.fn(async (data: { email: string; name?: string }) => ({
      id: "user-new",
      email: data.email,
      name: data.name ?? "New User",
      passwordHash: "hashed-password",
    })),
  }),
}));

vi.mock("../../db/connection.js", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        limit: () => ({
          all: () => [{ id: "user-new" }],
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          run: vi.fn(),
        }),
      }),
    }),
  }),
}));

vi.mock("../../db/schema.js", () => ({
  users: {},
}));

vi.mock("../../utils/password.js", () => ({
  hashPassword: vi.fn(async () => "hashed-password"),
  verifyPassword: vi.fn(async () => true),
}));

vi.mock("../../utils/auto-tenant.js", () => ({
  ensureDefaultTenant: vi.fn(async () => {}),
}));

vi.mock("../middleware/auth.js", () => ({
  generateTokens: vi.fn(async () => ({
    accessToken: "access-token-mock",
    refreshToken: "refresh-token-mock",
  })),
  verifyToken: vi.fn(async () => ({ userId: "user-1" })),
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

// Keep the real EDITION but make it controllable via activeEdition
let activeEdition: EditionInfo;
let activeFeatures: FeatureFlags;

vi.mock("../../config/edition.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../config/edition.js")>();
  return {
    ...original,
    get EDITION() {
      return activeEdition;
    },
    get FEATURES() {
      return activeFeatures;
    },
  };
});

// Import after mocks
import { onError } from "../middleware/error-handler.js";
import { auth } from "./auth.js";
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
  app.route("/auth", auth);
  return app;
}

const validRegisterBody = {
  email: "newuser@example.com",
  password: "StrongPass123!",
  name: "New User",
};

const validLoginBody = {
  email: "admin@local.host",
  password: "AdminPass123!",
};

// ============================================================================
// CE Mode — Registration blocked
// ============================================================================

describe("CE mode — register route blocked", () => {
  beforeEach(() => {
    activeEdition = ceInfo;
    activeFeatures = ceFeatures;
  });

  it("POST /auth/register returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validRegisterBody),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.message).toContain("Community Edition");
  });

  it("POST /auth/login remains accessible in CE mode", async () => {
    const app = createTestApp();
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validLoginBody),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accessToken).toBeDefined();
    expect(body.refreshToken).toBeDefined();
  });

  it("POST /auth/refresh remains accessible in CE mode", async () => {
    const app = createTestApp();
    const res = await app.request("/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: "some-valid-token" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accessToken).toBeDefined();
  });

  it("POST /auth/logout remains accessible in CE mode", async () => {
    const app = createTestApp();
    const res = await app.request("/auth/logout", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("Logged out successfully");
  });
});

// ============================================================================
// EE Mode — Registration accessible
// ============================================================================

describe("EE mode — register route accessible", () => {
  beforeEach(() => {
    activeEdition = eeInfo;
    activeFeatures = eeFeatures;
  });

  it("POST /auth/register returns 201 with user and tokens", async () => {
    const app = createTestApp();
    const res = await app.request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validRegisterBody),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user).toBeDefined();
    expect(body.user.email).toBe(validRegisterBody.email);
    expect(body.accessToken).toBe("access-token-mock");
    expect(body.refreshToken).toBe("refresh-token-mock");
  });

  it("POST /auth/login remains accessible in EE mode", async () => {
    const app = createTestApp();
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validLoginBody),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accessToken).toBeDefined();
  });
});
