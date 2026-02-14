// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for SkillLoader — template engine, variable replacement,
 * requirements checking, and semver range matching.
 *
 * Split from loader.test.ts (which covers YAML parsing + directory scanning).
 */

import { describe, it, expect } from "vitest";
import type {
  ServerProfile,
  OsInfo,
  Software,
} from "../../db/repositories/server-repository.js";
import {
  resolvePromptTemplate,
  checkRequirements,
  satisfiesSemverRange,
  type TemplateVars,
} from "./loader.js";

// ============================================================================
// Helpers
// ============================================================================

function makeServerProfile(
  overrides?: Partial<{
    osInfo: OsInfo | null;
    software: Software[];
  }>,
): ServerProfile {
  return {
    serverId: "srv-1",
    osInfo: overrides?.osInfo ?? {
      platform: "linux",
      arch: "x86_64",
      version: "Ubuntu 22.04",
      kernel: "5.15.0-generic",
      hostname: "test-server",
      uptime: 86400,
    },
    software: overrides?.software ?? [],
    services: [],
    updatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// resolvePromptTemplate Tests
// ============================================================================

describe("resolvePromptTemplate", () => {
  it("should replace {{input.*}} variables", () => {
    const prompt =
      "Backup to {{input.backup_dir}} with {{input.retention_days}} days retention.";
    const vars: TemplateVars = {
      input: { backup_dir: "/var/backups", retention_days: 30 },
    };

    const result = resolvePromptTemplate(prompt, vars);

    expect(result).toBe("Backup to /var/backups with 30 days retention.");
  });

  it("should replace {{server.*}} variables", () => {
    const prompt = "Server: {{server.name}} ({{server.os}}) at {{server.ip}}";
    const vars: TemplateVars = {
      server: { name: "prod-web-01", os: "Ubuntu 22.04", ip: "10.0.0.1" },
    };

    const result = resolvePromptTemplate(prompt, vars);

    expect(result).toBe("Server: prod-web-01 (Ubuntu 22.04) at 10.0.0.1");
  });

  it("should replace {{skill.*}} variables", () => {
    const prompt =
      "Last run: {{skill.last_run}}, result: {{skill.last_result}}";
    const vars: TemplateVars = {
      skill: {
        last_run: "2026-01-15T08:00:00Z",
        last_result: "3 warnings found",
      },
    };

    const result = resolvePromptTemplate(prompt, vars);

    expect(result).toBe(
      "Last run: 2026-01-15T08:00:00Z, result: 3 warnings found",
    );
  });

  it("should replace {{now}} with provided value", () => {
    const prompt = "Current time: {{now}}";
    const vars: TemplateVars = { now: "2026-02-12T10:00:00Z" };

    const result = resolvePromptTemplate(prompt, vars);

    expect(result).toBe("Current time: 2026-02-12T10:00:00Z");
  });

  it("should replace {{now}} with ISO string when not provided", () => {
    const prompt = "Current time: {{now}}";
    const vars: TemplateVars = {};

    const result = resolvePromptTemplate(prompt, vars);

    expect(result).toMatch(/^Current time: \d{4}-\d{2}-\d{2}T/);
  });

  it("should replace {{env.*}} variables", () => {
    const prompt = "API key: {{env.API_KEY}}";
    const vars: TemplateVars = { env: { API_KEY: "sk-test-123" } };

    const result = resolvePromptTemplate(prompt, vars);

    expect(result).toBe("API key: sk-test-123");
  });

  it("should preserve undefined variables as-is", () => {
    const prompt = "Known: {{input.known}}, Unknown: {{input.unknown}}";
    const vars: TemplateVars = { input: { known: "value" } };

    const result = resolvePromptTemplate(prompt, vars);

    expect(result).toBe("Known: value, Unknown: {{input.unknown}}");
  });

  it("should preserve unknown namespace variables as-is", () => {
    const prompt = "Value: {{custom.key}}";
    const vars: TemplateVars = {};

    const result = resolvePromptTemplate(prompt, vars);

    expect(result).toBe("Value: {{custom.key}}");
  });

  it("should handle array values by JSON stringifying", () => {
    const prompt = "Sources: {{input.log_sources}}";
    const vars: TemplateVars = {
      input: { log_sources: ["/var/log/syslog", "/var/log/auth.log"] },
    };

    const result = resolvePromptTemplate(prompt, vars);

    expect(result).toBe('Sources: ["/var/log/syslog","/var/log/auth.log"]');
  });

  it("should handle boolean values", () => {
    const prompt = "Check ports: {{input.check_ports}}";
    const vars: TemplateVars = { input: { check_ports: true } };

    const result = resolvePromptTemplate(prompt, vars);

    expect(result).toBe("Check ports: true");
  });

  it("should handle prompts with no template variables", () => {
    const prompt = "Just a plain prompt with no variables.";
    const result = resolvePromptTemplate(prompt, {});

    expect(result).toBe("Just a plain prompt with no variables.");
  });

  it("should handle whitespace inside braces", () => {
    const prompt = "Value: {{ input.name }}";
    const vars: TemplateVars = { input: { name: "hello" } };

    const result = resolvePromptTemplate(prompt, vars);

    expect(result).toBe("Value: hello");
  });
});

// ============================================================================
// checkRequirements Tests
// ============================================================================

describe("checkRequirements", () => {
  it("should return satisfied when no requirements specified", () => {
    const result = checkRequirements(undefined);

    expect(result.satisfied).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it("should return satisfied when empty requirements", () => {
    const result = checkRequirements({});

    expect(result.satisfied).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it("should pass OS check when platform matches (linux)", () => {
    const profile = makeServerProfile({
      osInfo: {
        platform: "linux",
        arch: "x86_64",
        version: "Ubuntu 22.04",
        kernel: "5.15",
        hostname: "test",
        uptime: 100,
      },
    });

    const result = checkRequirements({ os: ["linux"] }, profile);

    expect(result.satisfied).toBe(true);
  });

  it("should pass OS check when platform matches (darwin)", () => {
    const profile = makeServerProfile({
      osInfo: {
        platform: "darwin",
        arch: "arm64",
        version: "macOS 14.0",
        kernel: "23.0",
        hostname: "mac",
        uptime: 100,
      },
    });

    const result = checkRequirements({ os: ["linux", "darwin"] }, profile);

    expect(result.satisfied).toBe(true);
  });

  it("should fail OS check when platform does not match", () => {
    const profile = makeServerProfile({
      osInfo: {
        platform: "windows",
        arch: "x86_64",
        version: "Windows 11",
        kernel: "10.0",
        hostname: "win",
        uptime: 100,
      },
    });

    const result = checkRequirements({ os: ["linux"] }, profile);

    expect(result.satisfied).toBe(false);
    expect(result.missing[0]).toContain("not in supported list");
  });

  it("should fail OS check when profile unavailable", () => {
    const result = checkRequirements({ os: ["linux"] }, null);

    expect(result.satisfied).toBe(false);
    expect(result.missing[0]).toContain("server profile unavailable");
  });

  it("should normalize platform names (Ubuntu → linux)", () => {
    const profile = makeServerProfile({
      osInfo: {
        platform: "Ubuntu",
        arch: "x86_64",
        version: "22.04",
        kernel: "5.15",
        hostname: "srv",
        uptime: 100,
      },
    });

    const result = checkRequirements({ os: ["linux"] }, profile);

    expect(result.satisfied).toBe(true);
  });

  it("should pass command check when commands are available", () => {
    const profile = makeServerProfile({
      software: [
        { name: "tar", version: "1.34", ports: [] },
        { name: "ss", version: "5.0", ports: [] },
      ],
    });

    const result = checkRequirements({ commands: ["tar", "ss"] }, profile);

    expect(result.satisfied).toBe(true);
  });

  it("should fail command check when a command is missing", () => {
    const profile = makeServerProfile({
      software: [{ name: "tar", version: "1.34", ports: [] }],
    });

    const result = checkRequirements({ commands: ["tar", "zstd"] }, profile);

    expect(result.satisfied).toBe(false);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]).toContain("'zstd'");
  });

  it("should fail command check when profile unavailable", () => {
    const result = checkRequirements({ commands: ["tar"] }, null);

    expect(result.satisfied).toBe(false);
    expect(result.missing[0]).toContain("server profile unavailable");
  });

  it("should accumulate multiple failures", () => {
    const profile = makeServerProfile({
      osInfo: {
        platform: "windows",
        arch: "x86_64",
        version: "Win 11",
        kernel: "10.0",
        hostname: "w",
        uptime: 100,
      },
      software: [],
    });

    const result = checkRequirements(
      {
        os: ["linux"],
        commands: ["tar", "ss"],
      },
      profile,
    );

    expect(result.satisfied).toBe(false);
    expect(result.missing.length).toBeGreaterThanOrEqual(3); // OS + 2 commands
  });

  it("should handle case-insensitive command matching", () => {
    const profile = makeServerProfile({
      software: [{ name: "TAR", version: "1.0", ports: [] }],
    });

    const result = checkRequirements({ commands: ["tar"] }, profile);

    expect(result.satisfied).toBe(true);
  });
});

// ============================================================================
// satisfiesSemverRange Tests
// ============================================================================

describe("satisfiesSemverRange", () => {
  it("should match >= constraint when version is greater", () => {
    expect(satisfiesSemverRange("1.2.0", ">=1.0.0")).toBe(true);
  });

  it("should match >= constraint when version is equal", () => {
    expect(satisfiesSemverRange("1.0.0", ">=1.0.0")).toBe(true);
  });

  it("should reject >= constraint when version is less", () => {
    expect(satisfiesSemverRange("0.9.0", ">=1.0.0")).toBe(false);
  });

  it("should match > constraint only when strictly greater", () => {
    expect(satisfiesSemverRange("1.0.1", ">1.0.0")).toBe(true);
    expect(satisfiesSemverRange("1.0.0", ">1.0.0")).toBe(false);
  });

  it("should match <= constraint", () => {
    expect(satisfiesSemverRange("1.0.0", "<=1.0.0")).toBe(true);
    expect(satisfiesSemverRange("0.9.0", "<=1.0.0")).toBe(true);
    expect(satisfiesSemverRange("1.0.1", "<=1.0.0")).toBe(false);
  });

  it("should match < constraint", () => {
    expect(satisfiesSemverRange("0.9.0", "<1.0.0")).toBe(true);
    expect(satisfiesSemverRange("1.0.0", "<1.0.0")).toBe(false);
  });

  it("should match = constraint (exact)", () => {
    expect(satisfiesSemverRange("1.0.0", "=1.0.0")).toBe(true);
    expect(satisfiesSemverRange("1.0.1", "=1.0.0")).toBe(false);
  });

  it("should treat bare version as exact match", () => {
    expect(satisfiesSemverRange("1.0.0", "1.0.0")).toBe(true);
    expect(satisfiesSemverRange("1.0.1", "1.0.0")).toBe(false);
  });

  it("should handle different segment lengths", () => {
    expect(satisfiesSemverRange("1.0", ">=1.0.0")).toBe(true);
    expect(satisfiesSemverRange("2", ">=1.0.0")).toBe(true);
  });

  it("should return false for invalid constraint format", () => {
    expect(satisfiesSemverRange("1.0.0", "~1.0.0")).toBe(false);
    expect(satisfiesSemverRange("1.0.0", ">=1.0.0 <2.0.0")).toBe(false);
  });

  it("should return false for invalid version format", () => {
    expect(satisfiesSemverRange("abc", ">=1.0.0")).toBe(false);
    expect(satisfiesSemverRange("v1.0.0", ">=1.0.0")).toBe(false);
  });
});

// ============================================================================
// checkRequirements — Agent Version Tests
// ============================================================================

describe("checkRequirements — agent version", () => {
  it("should pass when agent version satisfies constraint", () => {
    const result = checkRequirements({ agent: ">=1.0.0" }, null, "1.2.0");

    expect(result.satisfied).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("should fail when agent version does not satisfy constraint", () => {
    const result = checkRequirements({ agent: ">=2.0.0" }, null, "1.5.0");

    expect(result.satisfied).toBe(false);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]).toContain("'1.5.0'");
    expect(result.missing[0]).toContain("'>=2.0.0'");
  });

  it("should degrade to warning when agent version is not available (null)", () => {
    const result = checkRequirements({ agent: ">=1.0.0" }, null, null);

    expect(result.satisfied).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("cannot be verified");
  });

  it("should degrade to warning when agent version is not provided (undefined)", () => {
    const result = checkRequirements({ agent: ">=1.0.0" }, null);

    expect(result.satisfied).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("agent did not report version");
  });

  it("should return empty warnings when no agent requirement", () => {
    const result = checkRequirements({ os: ["linux"] }, makeServerProfile());

    expect(result.warnings).toHaveLength(0);
  });

  it("should check agent version alongside OS and command checks", () => {
    const profile = makeServerProfile({
      osInfo: {
        platform: "windows",
        arch: "x86_64",
        version: "Win 11",
        kernel: "10.0",
        hostname: "w",
        uptime: 100,
      },
      software: [],
    });

    const result = checkRequirements(
      {
        os: ["linux"],
        commands: ["tar"],
        agent: ">=1.0.0",
      },
      profile,
      "0.5.0",
    );

    expect(result.satisfied).toBe(false);
    expect(result.missing.length).toBeGreaterThanOrEqual(3); // OS + command + agent
    expect(result.missing.some((m) => m.includes("Agent version"))).toBe(true);
  });

  it("should pass exact version match with bare constraint", () => {
    const result = checkRequirements({ agent: "1.0.0" }, null, "1.0.0");

    expect(result.satisfied).toBe(true);
  });
});
