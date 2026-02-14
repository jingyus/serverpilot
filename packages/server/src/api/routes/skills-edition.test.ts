// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for skills routes edition gating (CE vs EE).
 *
 * Verifies that:
 * - CE mode enforces a maximum of 5 installed skills
 * - Skills with event/threshold triggers are blocked in CE mode
 * - EE mode allows unlimited skills and all trigger types
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import type { SkillManifest } from "@aiinstaller/shared";
import type { FeatureFlags, EditionInfo } from "../../config/edition.js";
import { resolveFeatures } from "../../config/edition.js";

// ============================================================================
// Module Mocks — must be before imports of the module under test
// ============================================================================

// Mock auth/RBAC to pass-through (we test edition gating, not permissions)
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
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createContextLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---- Skill repository mock ----
// Tracks installed skills so CE limit tests can control count.
let mockInstalledSkills: Array<{ id: string; userId: string; name: string }> =
  [];

vi.mock("../../db/repositories/skill-repository.js", () => ({
  getSkillRepository: () => ({
    findAll: vi.fn(async (userId: string) =>
      mockInstalledSkills.filter((s) => s.userId === userId),
    ),
  }),
}));

// ---- Skill engine mock ----
vi.mock("../../core/skill/engine.js", () => ({
  getSkillEngine: () => ({
    install: vi.fn(async () => ({
      id: "new-skill-id",
      userId: "user-1",
      name: "test-skill",
      version: "1.0.0",
      source: "local",
      status: "installed",
    })),
    listInstalled: vi.fn(async (userId: string) =>
      mockInstalledSkills.filter((s) => s.userId === userId),
    ),
    listInstalledWithInputs: vi.fn(async () => []),
  }),
}));

// ---- Git installer mock ----
vi.mock("../../core/skill/git-installer.js", () => ({
  installFromGitUrl: vi.fn(async () => ({
    skillDir: "/tmp/cloned-skill",
    warnings: [],
  })),
}));

// ---- Skill loader mock ----
// Returns a manifest with configurable triggers.
let mockManifestTriggers: SkillManifest["triggers"] = [{ type: "manual" }];

vi.mock("../../core/skill/loader.js", () => ({
  loadSkillFromDir: vi.fn(async () => ({
    kind: "skill",
    version: "1.0",
    metadata: {
      name: "test-skill",
      displayName: "Test Skill",
      version: "1.0.0",
    },
    triggers: mockManifestTriggers,
    tools: ["shell"],
    constraints: {},
    prompt: "A".repeat(50),
  })),
}));

// ---- Edition mock — dynamic feature flags ----
let activeFeatures: FeatureFlags;
let activeEdition: EditionInfo;

vi.mock("../../config/edition.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../config/edition.js")>();
  return {
    ...original,
    get FEATURES() {
      return activeFeatures;
    },
    get EDITION() {
      return activeEdition;
    },
  };
});

// Import after mocks
import { onError } from "../middleware/error-handler.js";
import { skillsRoute, CE_MAX_SKILLS } from "./skills.js";
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
  app.route("/skills", skillsRoute);
  return app;
}

function installRequest(body: Record<string, unknown> = {}) {
  return {
    method: "POST" as const,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      skillDir: "/path/to/skill",
      source: "local",
      ...body,
    }),
  };
}

function makeSkill(index: number) {
  return { id: `skill-${index}`, userId: "user-1", name: `skill-${index}` };
}

// ============================================================================
// CE Mode — Skill count limit
// ============================================================================

describe("CE mode — skill count limit", () => {
  beforeEach(() => {
    activeFeatures = ceFeatures;
    activeEdition = ceInfo;
    mockInstalledSkills = [];
    mockManifestTriggers = [{ type: "manual" }];
  });

  it("allows install when under CE_MAX_SKILLS limit", async () => {
    // 4 existing skills — under the limit of 5
    mockInstalledSkills = Array.from({ length: 4 }, (_, i) => makeSkill(i));
    const app = createTestApp();
    const res = await app.request("/skills/install", installRequest());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.skill).toBeDefined();
  });

  it("blocks install when at CE_MAX_SKILLS limit", async () => {
    // 5 existing skills — at the limit
    mockInstalledSkills = Array.from({ length: CE_MAX_SKILLS }, (_, i) =>
      makeSkill(i),
    );
    const app = createTestApp();
    const res = await app.request("/skills/install", installRequest());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.limit).toBe(CE_MAX_SKILLS);
    expect(body.error.current).toBe(CE_MAX_SKILLS);
    expect(body.error.message).toContain("Community Edition");
    expect(body.error.message).toContain(`${CE_MAX_SKILLS}`);
  });

  it("blocks install when over CE_MAX_SKILLS limit", async () => {
    mockInstalledSkills = Array.from({ length: CE_MAX_SKILLS + 2 }, (_, i) =>
      makeSkill(i),
    );
    const app = createTestApp();
    const res = await app.request("/skills/install", installRequest());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.current).toBe(CE_MAX_SKILLS + 2);
  });

  it("allows install when no existing skills", async () => {
    mockInstalledSkills = [];
    const app = createTestApp();
    const res = await app.request("/skills/install", installRequest());
    expect(res.status).toBe(201);
  });

  it("CE_MAX_SKILLS constant is 5", () => {
    expect(CE_MAX_SKILLS).toBe(5);
  });
});

// ============================================================================
// CE Mode — Event/threshold trigger gating
// ============================================================================

describe("CE mode — event/threshold trigger skills blocked", () => {
  beforeEach(() => {
    activeFeatures = ceFeatures;
    activeEdition = ceInfo;
    mockInstalledSkills = [];
  });

  it("blocks skill with event trigger in CE mode", async () => {
    mockManifestTriggers = [{ type: "event", on: "alert.triggered" }];
    const app = createTestApp();
    const res = await app.request("/skills/install", installRequest());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.feature).toBe("webhooks");
    expect(body.error.message).toContain("event or threshold");
  });

  it("blocks skill with threshold trigger in CE mode", async () => {
    mockManifestTriggers = [
      { type: "threshold", metric: "cpu.usage", operator: "gt", value: 80 },
    ];
    const app = createTestApp();
    const res = await app.request("/skills/install", installRequest());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.feature).toBe("webhooks");
  });

  it("blocks skill with mixed triggers including event", async () => {
    mockManifestTriggers = [
      { type: "manual" },
      { type: "event", on: "server.offline" },
    ];
    const app = createTestApp();
    const res = await app.request("/skills/install", installRequest());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
  });

  it("allows skill with only manual trigger in CE mode", async () => {
    mockManifestTriggers = [{ type: "manual" }];
    const app = createTestApp();
    const res = await app.request("/skills/install", installRequest());
    expect(res.status).toBe(201);
  });

  it("allows skill with cron trigger in CE mode", async () => {
    mockManifestTriggers = [{ type: "cron", schedule: "0 0 * * *" }];
    const app = createTestApp();
    const res = await app.request("/skills/install", installRequest());
    expect(res.status).toBe(201);
  });

  it("allows skill with manual + cron triggers in CE mode", async () => {
    mockManifestTriggers = [
      { type: "manual" },
      { type: "cron", schedule: "*/5 * * * *" },
    ];
    const app = createTestApp();
    const res = await app.request("/skills/install", installRequest());
    expect(res.status).toBe(201);
  });
});

// ============================================================================
// CE Mode — Both limits interact correctly
// ============================================================================

describe("CE mode — skill count checked before trigger type", () => {
  beforeEach(() => {
    activeFeatures = ceFeatures;
    activeEdition = ceInfo;
  });

  it("count limit error takes priority over trigger type error", async () => {
    // At skill count limit AND has event trigger — count limit checked first
    mockInstalledSkills = Array.from({ length: CE_MAX_SKILLS }, (_, i) =>
      makeSkill(i),
    );
    mockManifestTriggers = [{ type: "event", on: "alert.triggered" }];

    const app = createTestApp();
    const res = await app.request("/skills/install", installRequest());
    expect(res.status).toBe(403);
    const body = await res.json();
    // Count limit is checked first (before manifest loading)
    expect(body.error.limit).toBe(CE_MAX_SKILLS);
    expect(body.error.message).toContain("Community Edition");
  });
});

// ============================================================================
// EE Mode — No limits
// ============================================================================

describe("EE mode — no skill limits", () => {
  beforeEach(() => {
    activeFeatures = eeFeatures;
    activeEdition = eeInfo;
    mockInstalledSkills = [];
  });

  it("allows install beyond CE_MAX_SKILLS in EE mode", async () => {
    mockInstalledSkills = Array.from({ length: 10 }, (_, i) => makeSkill(i));
    mockManifestTriggers = [{ type: "manual" }];

    const app = createTestApp();
    const res = await app.request("/skills/install", installRequest());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.skill).toBeDefined();
  });

  it("allows skill with event trigger in EE mode", async () => {
    mockManifestTriggers = [{ type: "event", on: "alert.triggered" }];

    const app = createTestApp();
    const res = await app.request("/skills/install", installRequest());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.skill).toBeDefined();
  });

  it("allows skill with threshold trigger in EE mode", async () => {
    mockManifestTriggers = [
      { type: "threshold", metric: "cpu.usage", operator: "gt", value: 90 },
    ];

    const app = createTestApp();
    const res = await app.request("/skills/install", installRequest());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.skill).toBeDefined();
  });

  it("allows skill with mixed event + manual triggers in EE mode", async () => {
    mockManifestTriggers = [
      { type: "manual" },
      { type: "event", on: "server.offline" },
      {
        type: "threshold",
        metric: "memory.usage_percent",
        operator: "gt",
        value: 90,
      },
    ];

    const app = createTestApp();
    const res = await app.request("/skills/install", installRequest());
    expect(res.status).toBe(201);
  });

  it("allows 20+ skills in EE mode", async () => {
    mockInstalledSkills = Array.from({ length: 20 }, (_, i) => makeSkill(i));
    mockManifestTriggers = [{ type: "manual" }];

    const app = createTestApp();
    const res = await app.request("/skills/install", installRequest());
    expect(res.status).toBe(201);
  });
});

// ============================================================================
// Other routes remain accessible in both modes
// ============================================================================

describe("Non-install routes accessible in CE mode", () => {
  beforeEach(() => {
    activeFeatures = ceFeatures;
    activeEdition = ceInfo;
  });

  it("GET /skills returns skills list regardless of edition", async () => {
    // getSkillEngine is mocked above to return listInstalledWithInputs
    const app = createTestApp();
    const res = await app.request("/skills");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skills).toBeDefined();
  });
});
