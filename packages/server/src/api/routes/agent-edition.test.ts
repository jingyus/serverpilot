// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for agent routes CE/EE edition consistency.
 *
 * Verifies that:
 * - Agent version/binary endpoints work in both CE and EE modes
 *   (they are public, edition-agnostic endpoints)
 * - CE mode does not introduce multi-agent errors
 * - Agent endpoints return consistent data regardless of edition
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import type { FeatureFlags, EditionInfo } from "../../config/edition.js";
import { resolveFeatures } from "../../config/edition.js";

// ============================================================================
// Module Mocks — must be before imports of the module under test
// ============================================================================

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

import { agent } from "./agent.js";

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

let app: Hono;

function createApp(): Hono {
  const a = new Hono();
  a.route("/api/v1/agent", agent);
  return a;
}

// ============================================================================
// CE Mode — Agent endpoints accessible
// ============================================================================

describe("CE mode — agent endpoints accessible", () => {
  beforeEach(() => {
    activeFeatures = ceFeatures;
    app = createApp();
  });

  it("GET /agent/version returns 200 in CE mode", async () => {
    const res = await app.request("/api/v1/agent/version");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("latest");
    expect(body).toHaveProperty("updateAvailable");
  });

  it("GET /agent/version with platform returns download URL in CE mode", async () => {
    const res = await app.request(
      "/api/v1/agent/version?platform=linux&arch=x64",
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.downloadUrl).toContain("linux-x64");
  });

  it("GET /agent/binaries returns all platforms in CE mode", async () => {
    const res = await app.request("/api/v1/agent/binaries");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("binaries");
    expect(Object.keys(body.binaries).length).toBeGreaterThan(0);
  });

  it("version check works for single agent update scenario", async () => {
    const res = await app.request("/api/v1/agent/version?current=0.0.1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.current).toBe("0.0.1");
    expect(body.updateAvailable).toBe(true);
  });

  it("no authentication required for agent endpoints in CE", async () => {
    // Agent endpoints are public — no auth header needed
    const versionRes = await app.request("/api/v1/agent/version");
    expect(versionRes.status).toBe(200);

    const binariesRes = await app.request("/api/v1/agent/binaries");
    expect(binariesRes.status).toBe(200);
  });
});

// ============================================================================
// EE Mode — Agent endpoints accessible
// ============================================================================

describe("EE mode — agent endpoints accessible", () => {
  beforeEach(() => {
    activeFeatures = eeFeatures;
    app = createApp();
  });

  it("GET /agent/version returns 200 in EE mode", async () => {
    const res = await app.request("/api/v1/agent/version");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("latest");
    expect(body).toHaveProperty("updateAvailable");
  });

  it("GET /agent/binaries returns all platforms in EE mode", async () => {
    const res = await app.request("/api/v1/agent/binaries");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("binaries");
  });
});

// ============================================================================
// CE ↔ EE Consistency — Same responses regardless of edition
// ============================================================================

describe("CE ↔ EE consistency — agent responses identical", () => {
  it("version endpoint returns same structure in CE and EE", async () => {
    // CE
    activeFeatures = ceFeatures;
    const ceApp = createApp();
    const ceRes = await ceApp.request(
      "/api/v1/agent/version?current=0.0.1&platform=linux&arch=x64",
    );
    const ceBody = await ceRes.json();

    // EE
    activeFeatures = eeFeatures;
    const eeApp = createApp();
    const eeRes = await eeApp.request(
      "/api/v1/agent/version?current=0.0.1&platform=linux&arch=x64",
    );
    const eeBody = await eeRes.json();

    // Both should have identical fields and values
    expect(ceBody.latest).toBe(eeBody.latest);
    expect(ceBody.current).toBe(eeBody.current);
    expect(ceBody.updateAvailable).toBe(eeBody.updateAvailable);
    expect(ceBody.forceUpdate).toBe(eeBody.forceUpdate);
    expect(ceBody.downloadUrl).toBe(eeBody.downloadUrl);
  });

  it("binaries endpoint returns same structure in CE and EE", async () => {
    // CE
    activeFeatures = ceFeatures;
    const ceApp = createApp();
    const ceRes = await ceApp.request("/api/v1/agent/binaries");
    const ceBody = await ceRes.json();

    // EE
    activeFeatures = eeFeatures;
    const eeApp = createApp();
    const eeRes = await eeApp.request("/api/v1/agent/binaries");
    const eeBody = await eeRes.json();

    expect(ceBody.version).toBe(eeBody.version);
    expect(Object.keys(ceBody.binaries)).toEqual(Object.keys(eeBody.binaries));
  });
});
