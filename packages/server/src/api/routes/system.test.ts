// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for system routes (edition / feature discovery API).
 */

import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { FeatureFlags } from "../../config/edition.js";

// ============================================================================
// Module Mocks
// ============================================================================

const ceFeatures: FeatureFlags = {
  chat: true,
  commandExecution: true,
  knowledgeBase: true,
  multiServer: false,
  multiSession: false,
  teamCollaboration: false,
  webhooks: false,
  alerts: false,
  metricsMonitoring: false,
  auditExport: false,
  oauthLogin: false,
  rateLimiting: false,
  multiTenant: false,
  billing: false,
};

const eeFeatures: FeatureFlags = {
  chat: true,
  commandExecution: true,
  knowledgeBase: true,
  multiServer: true,
  multiSession: true,
  teamCollaboration: true,
  webhooks: true,
  alerts: true,
  metricsMonitoring: true,
  auditExport: true,
  oauthLogin: true,
  rateLimiting: true,
  multiTenant: false,
  billing: false,
};

const cloudFeatures: FeatureFlags = {
  chat: true,
  commandExecution: true,
  knowledgeBase: true,
  multiServer: true,
  multiSession: true,
  teamCollaboration: true,
  webhooks: true,
  alerts: true,
  metricsMonitoring: true,
  auditExport: true,
  oauthLogin: true,
  rateLimiting: true,
  multiTenant: true,
  billing: true,
};

// Default to CE mode; individual tests override via mockEdition/mockFeatures
let mockEdition = {
  edition: "ce" as const,
  isCE: true,
  isEE: false,
  isCloud: false,
};
let mockFeatures: FeatureFlags = ceFeatures;

vi.mock("../../config/edition.js", () => ({
  get EDITION() {
    return mockEdition;
  },
  get FEATURES() {
    return mockFeatures;
  },
}));

// Import after mocks
import { systemRoute } from "./system.js";

// ============================================================================
// Test App Setup
// ============================================================================

function createTestApp() {
  const app = new Hono();
  app.route("/system", systemRoute);
  return app;
}

// ============================================================================
// Tests
// ============================================================================

describe("system routes", () => {
  // --------------------------------------------------------------------------
  // GET /system/edition
  // --------------------------------------------------------------------------

  describe("GET /system/edition", () => {
    it("returns CE edition info with correct features", async () => {
      mockEdition = { edition: "ce", isCE: true, isEE: false, isCloud: false };
      mockFeatures = ceFeatures;

      const app = createTestApp();
      const res = await app.request("/system/edition");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.edition).toBe("ce");
      expect(body.version).toEqual(expect.any(String));
      expect(body.features).toBeDefined();

      // CE core features enabled
      expect(body.features.chat).toBe(true);
      expect(body.features.commandExecution).toBe(true);
      expect(body.features.knowledgeBase).toBe(true);

      // EE features disabled
      expect(body.features.multiServer).toBe(false);
      expect(body.features.teamCollaboration).toBe(false);
      expect(body.features.webhooks).toBe(false);
      expect(body.features.alerts).toBe(false);
      expect(body.features.metricsMonitoring).toBe(false);
      expect(body.features.auditExport).toBe(false);
      expect(body.features.oauthLogin).toBe(false);
      expect(body.features.rateLimiting).toBe(false);

      // Cloud features disabled
      expect(body.features.multiTenant).toBe(false);
      expect(body.features.billing).toBe(false);
    });

    it("returns EE edition info with correct features", async () => {
      mockEdition = { edition: "ee", isCE: false, isEE: true, isCloud: false };
      mockFeatures = eeFeatures;

      const app = createTestApp();
      const res = await app.request("/system/edition");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.edition).toBe("ee");

      // All CE + EE features enabled
      expect(body.features.chat).toBe(true);
      expect(body.features.multiServer).toBe(true);
      expect(body.features.teamCollaboration).toBe(true);
      expect(body.features.webhooks).toBe(true);
      expect(body.features.alerts).toBe(true);
      expect(body.features.metricsMonitoring).toBe(true);
      expect(body.features.auditExport).toBe(true);
      expect(body.features.oauthLogin).toBe(true);
      expect(body.features.rateLimiting).toBe(true);

      // Cloud features still disabled
      expect(body.features.multiTenant).toBe(false);
      expect(body.features.billing).toBe(false);
    });

    it("returns EE+Cloud edition info with all features enabled", async () => {
      mockEdition = { edition: "ee", isCE: false, isEE: true, isCloud: true };
      mockFeatures = cloudFeatures;

      const app = createTestApp();
      const res = await app.request("/system/edition");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.edition).toBe("ee");

      // All features enabled including cloud-only
      expect(body.features.multiTenant).toBe(true);
      expect(body.features.billing).toBe(true);
    });

    it("returns a valid version string", async () => {
      mockEdition = { edition: "ce", isCE: true, isEE: false, isCloud: false };
      mockFeatures = ceFeatures;

      const app = createTestApp();
      const res = await app.request("/system/edition");

      expect(res.status).toBe(200);
      const body = await res.json();
      // Version should be a semver-like string
      expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it("is accessible without authentication", async () => {
      mockEdition = { edition: "ce", isCE: true, isEE: false, isCloud: false };
      mockFeatures = ceFeatures;

      const app = createTestApp();
      // No Authorization header — should still succeed
      const res = await app.request("/system/edition");
      expect(res.status).toBe(200);
    });

    it("returns correct Content-Type header", async () => {
      mockEdition = { edition: "ce", isCE: true, isEE: false, isCloud: false };
      mockFeatures = ceFeatures;

      const app = createTestApp();
      const res = await app.request("/system/edition");

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
    });

    it("response has exactly edition, features, limits, and version keys", async () => {
      mockEdition = { edition: "ce", isCE: true, isEE: false, isCloud: false };
      mockFeatures = ceFeatures;

      const app = createTestApp();
      const res = await app.request("/system/edition");

      const body = await res.json();
      const keys = Object.keys(body).sort();
      expect(keys).toEqual(["edition", "features", "limits", "version"]);
    });

    it("features object has all expected keys in CE mode", async () => {
      mockEdition = { edition: "ce", isCE: true, isEE: false, isCloud: false };
      mockFeatures = ceFeatures;

      const app = createTestApp();
      const res = await app.request("/system/edition");

      const body = await res.json();
      const featureKeys = Object.keys(body.features).sort();
      expect(featureKeys).toEqual([
        "alerts",
        "auditExport",
        "billing",
        "chat",
        "commandExecution",
        "knowledgeBase",
        "metricsMonitoring",
        "multiServer",
        "multiSession",
        "multiTenant",
        "oauthLogin",
        "rateLimiting",
        "teamCollaboration",
        "webhooks",
      ]);
    });

    it("features object has all expected keys in EE mode", async () => {
      mockEdition = { edition: "ee", isCE: false, isEE: true, isCloud: false };
      mockFeatures = eeFeatures;

      const app = createTestApp();
      const res = await app.request("/system/edition");

      const body = await res.json();
      const featureKeys = Object.keys(body.features).sort();
      expect(featureKeys).toEqual([
        "alerts",
        "auditExport",
        "billing",
        "chat",
        "commandExecution",
        "knowledgeBase",
        "metricsMonitoring",
        "multiServer",
        "multiSession",
        "multiTenant",
        "oauthLogin",
        "rateLimiting",
        "teamCollaboration",
        "webhooks",
      ]);
    });

    it("all feature values are booleans in CE mode", async () => {
      mockEdition = { edition: "ce", isCE: true, isEE: false, isCloud: false };
      mockFeatures = ceFeatures;

      const app = createTestApp();
      const res = await app.request("/system/edition");

      const body = await res.json();
      for (const value of Object.values(
        body.features as Record<string, unknown>,
      )) {
        expect(typeof value).toBe("boolean");
      }
    });

    it("all feature values are booleans in EE+Cloud mode", async () => {
      mockEdition = { edition: "ee", isCE: false, isEE: true, isCloud: true };
      mockFeatures = cloudFeatures;

      const app = createTestApp();
      const res = await app.request("/system/edition");

      const body = await res.json();
      for (const value of Object.values(
        body.features as Record<string, unknown>,
      )) {
        expect(typeof value).toBe("boolean");
      }
    });

    it('edition field is always "ce" or "ee"', async () => {
      for (const ed of [
        {
          mock: {
            edition: "ce" as const,
            isCE: true,
            isEE: false,
            isCloud: false,
          },
          feat: ceFeatures,
        },
        {
          mock: {
            edition: "ee" as const,
            isCE: false,
            isEE: true,
            isCloud: false,
          },
          feat: eeFeatures,
        },
        {
          mock: {
            edition: "ee" as const,
            isCE: false,
            isEE: true,
            isCloud: true,
          },
          feat: cloudFeatures,
        },
      ]) {
        mockEdition = ed.mock;
        mockFeatures = ed.feat;

        const app = createTestApp();
        const res = await app.request("/system/edition");
        const body = await res.json();
        expect(["ce", "ee"]).toContain(body.edition);
      }
    });

    it("returns 404 for non-existent sub-routes", async () => {
      mockEdition = { edition: "ce", isCE: true, isEE: false, isCloud: false };
      mockFeatures = ceFeatures;

      const app = createTestApp();
      const res = await app.request("/system/nonexistent");
      expect(res.status).toBe(404);
    });

    it("POST /system/edition returns 404 (only GET supported)", async () => {
      mockEdition = { edition: "ce", isCE: true, isEE: false, isCloud: false };
      mockFeatures = ceFeatures;

      const app = createTestApp();
      const res = await app.request("/system/edition", { method: "POST" });
      expect(res.status).toBe(404);
    });

    it("CE mode has exactly 3 enabled features", async () => {
      mockEdition = { edition: "ce", isCE: true, isEE: false, isCloud: false };
      mockFeatures = ceFeatures;

      const app = createTestApp();
      const res = await app.request("/system/edition");
      const body = await res.json();
      const enabledCount = Object.values(
        body.features as Record<string, boolean>,
      ).filter(Boolean).length;
      expect(enabledCount).toBe(3);
    });

    it("EE mode has exactly 12 enabled features", async () => {
      mockEdition = { edition: "ee", isCE: false, isEE: true, isCloud: false };
      mockFeatures = eeFeatures;

      const app = createTestApp();
      const res = await app.request("/system/edition");
      const body = await res.json();
      const enabledCount = Object.values(
        body.features as Record<string, boolean>,
      ).filter(Boolean).length;
      expect(enabledCount).toBe(12);
    });

    it("Cloud mode has all 14 features enabled", async () => {
      mockEdition = { edition: "ee", isCE: false, isEE: true, isCloud: true };
      mockFeatures = cloudFeatures;

      const app = createTestApp();
      const res = await app.request("/system/edition");
      const body = await res.json();
      const enabledCount = Object.values(
        body.features as Record<string, boolean>,
      ).filter(Boolean).length;
      expect(enabledCount).toBe(14);
    });

    it("CE mode returns finite limits", async () => {
      mockEdition = { edition: "ce", isCE: true, isEE: false, isCloud: false };
      mockFeatures = ceFeatures;

      const app = createTestApp();
      const res = await app.request("/system/edition");
      const body = await res.json();

      expect(body.limits).toBeDefined();
      expect(body.limits.maxServers).toBe(1);
      expect(body.limits.maxSessions).toBe(1);
      expect(body.limits.maxSkills).toBe(5);
      expect(body.limits.maxUsers).toBe(1);
    });

    it("EE mode returns -1 for unlimited limits", async () => {
      mockEdition = { edition: "ee", isCE: false, isEE: true, isCloud: false };
      mockFeatures = eeFeatures;

      const app = createTestApp();
      const res = await app.request("/system/edition");
      const body = await res.json();

      expect(body.limits).toBeDefined();
      expect(body.limits.maxServers).toBe(-1);
      expect(body.limits.maxSessions).toBe(-1);
      expect(body.limits.maxSkills).toBe(-1);
      expect(body.limits.maxUsers).toBe(-1);
    });

    it("limits object has exactly 4 keys", async () => {
      mockEdition = { edition: "ce", isCE: true, isEE: false, isCloud: false };
      mockFeatures = ceFeatures;

      const app = createTestApp();
      const res = await app.request("/system/edition");
      const body = await res.json();

      const limitKeys = Object.keys(body.limits).sort();
      expect(limitKeys).toEqual([
        "maxServers",
        "maxSessions",
        "maxSkills",
        "maxUsers",
      ]);
    });

    it("all limit values are numbers", async () => {
      for (const ed of [
        {
          mock: {
            edition: "ce" as const,
            isCE: true,
            isEE: false,
            isCloud: false,
          },
          feat: ceFeatures,
        },
        {
          mock: {
            edition: "ee" as const,
            isCE: false,
            isEE: true,
            isCloud: false,
          },
          feat: eeFeatures,
        },
      ]) {
        mockEdition = ed.mock;
        mockFeatures = ed.feat;

        const app = createTestApp();
        const res = await app.request("/system/edition");
        const body = await res.json();

        for (const value of Object.values(
          body.limits as Record<string, unknown>,
        )) {
          expect(typeof value).toBe("number");
        }
      }
    });

    it("version string is not empty", async () => {
      mockEdition = { edition: "ce", isCE: true, isEE: false, isCloud: false };
      mockFeatures = ceFeatures;

      const app = createTestApp();
      const res = await app.request("/system/edition");
      const body = await res.json();
      expect(body.version.length).toBeGreaterThan(0);
    });
  });
});
