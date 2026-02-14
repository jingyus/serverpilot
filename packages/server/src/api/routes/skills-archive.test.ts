// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for skill import/export archive routes.
 *
 * CRUD tests → skills.test.ts
 * Execution tests → skills-execution.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import type { InstalledSkill } from "../../core/skill/types.js";
import { onError } from "../middleware/error-handler.js";
import type { ApiEnv } from "./types.js";

// ============================================================================
// Module Mocks
// ============================================================================

const mockEngine = {
  listInstalled: vi.fn(),
  listInstalledWithInputs: vi.fn(),
  listAvailable: vi.fn(),
  install: vi.fn(),
  uninstall: vi.fn(),
  configure: vi.fn(),
  updateStatus: vi.fn(),
  execute: vi.fn(),
  getInstalled: vi.fn(),
  getInstalledWithInputs: vi.fn(),
  getExecutions: vi.fn(),
  getExecution: vi.fn(),
  upgrade: vi.fn(),
  healthCheck: vi.fn(),
  confirmExecution: vi.fn(),
  rejectExecution: vi.fn(),
  listPendingConfirmations: vi.fn(),
  cancel: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
};

vi.mock("../../core/skill/engine.js", () => ({
  getSkillEngine: () => mockEngine,
}));

const mockSkillEventBus = {
  subscribe: vi.fn(() => vi.fn()),
  publish: vi.fn(),
  listenerCount: vi.fn(() => 0),
  removeAll: vi.fn(),
};

vi.mock("../../core/skill/skill-event-bus.js", () => ({
  getSkillEventBus: () => mockSkillEventBus,
}));

vi.mock("../../db/repositories/skill-repository.js", () => ({
  getSkillRepository: () => ({
    getStats: vi.fn(),
    getLogs: vi.fn().mockResolvedValue([]),
  }),
}));

let mockUserRole = "owner";

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
      c: { set: (k: string, v: string) => void },
      next: () => Promise<void>,
    ) => {
      c.set("userRole", mockUserRole);
      await next();
    },
  ),
  requirePermission: vi.fn((permission: string) => {
    return async (
      c: { get: (k: string) => string },
      next: () => Promise<void>,
    ) => {
      const role = c.get("userRole");
      const memberPerms = ["skill:view"];
      const adminPerms = ["skill:view", "skill:execute", "skill:manage"];
      const allowed = role === "member" ? memberPerms : adminPerms;
      if (!allowed.includes(permission)) {
        const { ApiError } = await import("../middleware/error-handler.js");
        throw ApiError.forbidden(`Missing permission: ${permission}`);
      }
      await next();
    };
  }),
}));

const mockExportSkill = vi.fn();
const mockImportSkill = vi.fn();

vi.mock("../../core/skill/skill-archive.js", () => ({
  exportSkill: (...args: unknown[]) => mockExportSkill(...args),
  importSkill: (...args: unknown[]) => mockImportSkill(...args),
}));

vi.mock("../../core/skill/git-installer.js", () => ({
  installFromGitUrl: vi.fn(),
}));

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  createContextLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import after mocks
import { skillsRoute } from "./skills.js";

// ============================================================================
// Test App Setup
// ============================================================================

function createTestApp() {
  const app = new Hono<ApiEnv>();
  app.route("/skills", skillsRoute);
  app.onError(onError);
  return app;
}

function makeSkill(overrides: Partial<InstalledSkill> = {}): InstalledSkill {
  return {
    id: "skill-1",
    userId: "user-1",
    tenantId: null,
    name: "nginx-hardening",
    displayName: "Nginx Hardening",
    version: "1.0.0",
    source: "official",
    skillPath: "/skills/official/nginx-hardening",
    status: "enabled",
    config: null,
    createdAt: "2026-02-12T00:00:00.000Z",
    updatedAt: "2026-02-12T00:00:00.000Z",
    ...overrides,
  };
}

// ============================================================================
// Setup
// ============================================================================

let app: ReturnType<typeof createTestApp>;

beforeEach(() => {
  app = createTestApp();
  mockUserRole = "owner";
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// GET /skills/:id/export — Export a skill as .tar.gz
// ============================================================================

describe("GET /skills/:id/export", () => {
  it("should return a .tar.gz archive with correct headers", async () => {
    const archiveBuffer = Buffer.from("fake-tar-gz-content");
    mockExportSkill.mockResolvedValue({
      filename: "nginx-hardening-1.0.0.tar.gz",
      buffer: archiveBuffer,
    });

    const res = await app.request("/skills/skill-1/export");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/gzip");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="nginx-hardening-1.0.0.tar.gz"',
    );
    expect(res.headers.get("Content-Length")).toBe(
      String(archiveBuffer.length),
    );
    expect(mockExportSkill).toHaveBeenCalledWith("skill-1");

    const body = await res.arrayBuffer();
    expect(Buffer.from(body)).toEqual(archiveBuffer);
  });

  it("should return 404 for nonexistent skill", async () => {
    mockExportSkill.mockRejectedValue(
      new Error("Skill not found: nonexistent"),
    );

    const res = await app.request("/skills/nonexistent/export");
    expect(res.status).toBe(404);
  });

  it("should return 400 when skill directory does not exist", async () => {
    mockExportSkill.mockRejectedValue(
      new Error("Skill directory does not exist: /skills/official/missing"),
    );

    const res = await app.request("/skills/skill-1/export");
    expect(res.status).toBe(400);
  });

  it("should propagate unexpected errors as 500", async () => {
    mockExportSkill.mockRejectedValue(new Error("Unexpected tar failure"));

    const res = await app.request("/skills/skill-1/export");
    expect(res.status).toBe(500);
  });

  it("should be forbidden for member role (skill:manage)", async () => {
    mockUserRole = "member";

    const res = await app.request("/skills/skill-1/export");
    expect(res.status).toBe(403);
  });
});

// ============================================================================
// POST /skills/import — Import a skill from .tar.gz archive
// ============================================================================

describe("POST /skills/import", () => {
  function createFormData(filename: string, content: Buffer): FormData {
    const formData = new FormData();
    const blob = new Blob([content], { type: "application/gzip" });
    formData.append("file", blob, filename);
    return formData;
  }

  it("should import a skill from .tar.gz and return 201", async () => {
    const importedSkill = makeSkill({ source: "community" });
    mockImportSkill.mockResolvedValue({
      skill: importedSkill,
      warnings: [],
    });

    const formData = createFormData(
      "nginx-hardening-1.0.0.tar.gz",
      Buffer.from("fake-archive"),
    );

    const res = await app.request("/skills/import", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.skill.name).toBe("nginx-hardening");
    expect(body.warnings).toEqual([]);
    expect(mockImportSkill).toHaveBeenCalledWith(
      expect.any(Buffer),
      "user-1",
      expect.stringContaining("skills/community"),
    );
  });

  it("should return warnings from security scan", async () => {
    const importedSkill = makeSkill({ source: "community" });
    mockImportSkill.mockResolvedValue({
      skill: importedSkill,
      warnings: ["Suspicious command pattern detected: rm -rf"],
    });

    const formData = createFormData(
      "test-skill-1.0.0.tar.gz",
      Buffer.from("archive-data"),
    );

    const res = await app.request("/skills/import", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toContain("Suspicious command");
  });

  it("should return 400 when no file is uploaded", async () => {
    const formData = new FormData();

    const res = await app.request("/skills/import", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain("Missing or invalid file");
  });

  it("should return 400 for non-.tar.gz file extension", async () => {
    const formData = createFormData("skill.zip", Buffer.from("not-a-tar"));

    const res = await app.request("/skills/import", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain(".tar.gz or .tgz");
  });

  it("should accept .tgz file extension", async () => {
    const importedSkill = makeSkill({ source: "community" });
    mockImportSkill.mockResolvedValue({
      skill: importedSkill,
      warnings: [],
    });

    const formData = createFormData(
      "nginx-hardening-1.0.0.tgz",
      Buffer.from("tgz-archive"),
    );

    const res = await app.request("/skills/import", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(201);
  });

  it("should return 400 for duplicate skill import", async () => {
    mockImportSkill.mockRejectedValue(
      new Error("Skill 'nginx-hardening' is already installed (id=skill-1)"),
    );

    const formData = createFormData(
      "nginx-hardening-1.0.0.tar.gz",
      Buffer.from("archive"),
    );

    const res = await app.request("/skills/import", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(400);
  });

  it("should return 400 when archive has no valid skill", async () => {
    mockImportSkill.mockRejectedValue(
      new Error("Archive does not contain a valid skill: no skill.yaml found"),
    );

    const formData = createFormData(
      "bad-archive-1.0.0.tar.gz",
      Buffer.from("bad"),
    );

    const res = await app.request("/skills/import", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(400);
  });

  it("should return 400 when security scan fails", async () => {
    mockImportSkill.mockRejectedValue(
      new Error(
        "Security scan failed for imported skill: contains malicious pattern",
      ),
    );

    const formData = createFormData(
      "malicious-1.0.0.tar.gz",
      Buffer.from("malicious"),
    );

    const res = await app.request("/skills/import", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(400);
  });

  it("should return 400 when target directory already exists", async () => {
    mockImportSkill.mockRejectedValue(
      new Error(
        "Target directory already exists: /skills/community/nginx-hardening",
      ),
    );

    const formData = createFormData(
      "nginx-hardening-1.0.0.tar.gz",
      Buffer.from("archive"),
    );

    const res = await app.request("/skills/import", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(400);
  });

  it("should propagate unexpected errors as 500", async () => {
    mockImportSkill.mockRejectedValue(new Error("Unexpected internal error"));

    const formData = createFormData(
      "test-1.0.0.tar.gz",
      Buffer.from("archive"),
    );

    const res = await app.request("/skills/import", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(500);
  });

  it("should be forbidden for member role (skill:manage)", async () => {
    mockUserRole = "member";

    const formData = createFormData(
      "nginx-hardening-1.0.0.tar.gz",
      Buffer.from("archive"),
    );

    const res = await app.request("/skills/import", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(403);
  });
});
