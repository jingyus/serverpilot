// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for auth-github routes edition gating (CE vs EE).
 *
 * Verifies that all /auth/github/* endpoints are blocked in CE mode
 * and accessible in EE mode via requireFeature('oauthLogin').
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

vi.mock("../../db/repositories/user-repository.js", () => ({
  getUserRepository: () => ({
    findByEmail: vi.fn(async () => null),
    findById: vi.fn(async () => null),
    create: vi.fn(async () => ({
      id: "user-new",
      email: "test@github.com",
      name: "Test User",
      passwordHash: "oauth:fake",
    })),
  }),
}));

vi.mock("../../db/repositories/oauth-account-repository.js", () => ({
  getOAuthAccountRepository: () => ({
    findByProviderAccount: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
  }),
}));

vi.mock("../../utils/github-oauth.js", () => ({
  isGitHubOAuthEnabled: vi.fn(() => true),
  generateOAuthState: vi.fn(() => "test-state"),
  validateOAuthState: vi.fn(() => true),
  getAuthorizationUrl: vi.fn(
    () => "https://github.com/login/oauth/authorize?client_id=test",
  ),
  exchangeCodeForToken: vi.fn(async () => ({
    access_token: "gho_test",
    token_type: "bearer",
    scope: "",
  })),
  fetchGitHubUser: vi.fn(async () => ({
    id: 12345,
    login: "testuser",
    avatar_url: "https://avatars.githubusercontent.com/u/12345",
    email: "test@github.com",
    name: "Test User",
  })),
  fetchGitHubUserEmail: vi.fn(async () => "test@github.com"),
}));

vi.mock("../middleware/auth.js", () => ({
  generateTokens: vi.fn(async () => ({
    accessToken: "access-token-mock",
    refreshToken: "refresh-token-mock",
  })),
}));

vi.mock("../../utils/auto-tenant.js", () => ({
  ensureDefaultTenant: vi.fn(async () => {}),
}));

// Keep the real requireFeature — we test actual feature gating behavior.
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
import { authGitHub } from "./auth-github.js";
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
  app.route("/auth/github", authGitHub);
  return app;
}

// ============================================================================
// CE Mode — All OAuth routes blocked
// ============================================================================

describe("CE mode — auth-github routes blocked", () => {
  beforeEach(() => {
    activeFeatures = ceFeatures;
  });

  it("GET /auth/github returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/auth/github");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.feature).toBe("oauthLogin");
  });

  it("GET /auth/github/callback returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request(
      "/auth/github/callback?code=test-code&state=test-state",
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.feature).toBe("oauthLogin");
  });
});

// ============================================================================
// EE Mode — OAuth routes accessible
// ============================================================================

describe("EE mode — auth-github routes accessible", () => {
  beforeEach(() => {
    activeFeatures = eeFeatures;
  });

  it("GET /auth/github returns 302 redirect to GitHub", async () => {
    const app = createTestApp();
    const res = await app.request("/auth/github", { redirect: "manual" });
    expect(res.status).toBe(302);
    const location = res.headers.get("Location");
    expect(location).toContain("github.com/login/oauth/authorize");
  });

  it("GET /auth/github/callback returns 302 redirect with tokens", async () => {
    const app = createTestApp();
    const res = await app.request(
      "/auth/github/callback?code=test-code&state=test-state",
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("Location");
    expect(location).toContain("/login#oauth_callback?");
  });
});
