// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for requireFeature middleware.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { FeatureFlags } from "../../config/edition.js";
import { resolveFeatures, FEATURES } from "../../config/edition.js";
import type { EditionInfo } from "../../config/edition.js";
import { requireFeature } from "./require-feature.js";

// ============================================================================
// Helpers
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
const cloudInfo: EditionInfo = {
  edition: "ee",
  isCE: false,
  isEE: true,
  isCloud: true,
};

const ceFeatures: FeatureFlags = resolveFeatures(ceInfo);
const eeFeatures: FeatureFlags = resolveFeatures(eeInfo);
const cloudFeatures: FeatureFlags = resolveFeatures(cloudInfo);

function createApp(
  feature: Parameters<typeof requireFeature>[0],
  features: FeatureFlags,
) {
  const app = new Hono();
  app.get("/test", requireFeature(feature, { features }), (c) => {
    return c.json({ ok: true });
  });
  return app;
}

// ============================================================================
// Single feature — CE mode
// ============================================================================

describe("requireFeature — single feature, CE mode", () => {
  it("allows CE core feature: chat", async () => {
    const app = createApp("chat", ceFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("allows CE core feature: commandExecution", async () => {
    const app = createApp("commandExecution", ceFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  it("allows CE core feature: knowledgeBase", async () => {
    const app = createApp("knowledgeBase", ceFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  it("blocks EE feature: multiServer", async () => {
    const app = createApp("multiServer", ceFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.message).toBe("This feature requires Enterprise Edition");
    expect(body.error.feature).toBe("multiServer");
  });

  it("blocks EE feature: teamCollaboration", async () => {
    const app = createApp("teamCollaboration", ceFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.feature).toBe("teamCollaboration");
  });

  it("blocks EE feature: webhooks", async () => {
    const app = createApp("webhooks", ceFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(403);
  });

  it("blocks EE feature: alerts", async () => {
    const app = createApp("alerts", ceFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(403);
  });

  it("blocks EE feature: metricsMonitoring", async () => {
    const app = createApp("metricsMonitoring", ceFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(403);
  });

  it("blocks EE feature: auditExport", async () => {
    const app = createApp("auditExport", ceFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(403);
  });

  it("blocks EE feature: oauthLogin", async () => {
    const app = createApp("oauthLogin", ceFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(403);
  });

  it("blocks EE feature: rateLimiting", async () => {
    const app = createApp("rateLimiting", ceFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(403);
  });

  it("blocks cloud feature: multiTenant", async () => {
    const app = createApp("multiTenant", ceFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(403);
  });

  it("blocks cloud feature: billing", async () => {
    const app = createApp("billing", ceFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(403);
  });
});

// ============================================================================
// Single feature — EE mode (no cloud)
// ============================================================================

describe("requireFeature — single feature, EE mode", () => {
  it("allows CE core feature: chat", async () => {
    const app = createApp("chat", eeFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  it("allows EE feature: multiServer", async () => {
    const app = createApp("multiServer", eeFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  it("allows EE feature: teamCollaboration", async () => {
    const app = createApp("teamCollaboration", eeFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  it("allows EE feature: webhooks", async () => {
    const app = createApp("webhooks", eeFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  it("allows EE feature: auditExport", async () => {
    const app = createApp("auditExport", eeFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  it("blocks cloud feature: multiTenant (EE without cloud)", async () => {
    const app = createApp("multiTenant", eeFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.feature).toBe("multiTenant");
  });

  it("blocks cloud feature: billing (EE without cloud)", async () => {
    const app = createApp("billing", eeFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(403);
  });
});

// ============================================================================
// Single feature — EE + Cloud mode
// ============================================================================

describe("requireFeature — single feature, EE + Cloud mode", () => {
  it("allows cloud feature: multiTenant", async () => {
    const app = createApp("multiTenant", cloudFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  it("allows cloud feature: billing", async () => {
    const app = createApp("billing", cloudFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  it("allows EE feature: multiServer", async () => {
    const app = createApp("multiServer", cloudFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  it("allows CE core feature: chat", async () => {
    const app = createApp("chat", cloudFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// Multiple features (OR semantics)
// ============================================================================

describe("requireFeature — multiple features (any-match)", () => {
  it("allows if at least one feature is enabled (CE: chat + multiServer)", async () => {
    const app = createApp(["chat", "multiServer"], ceFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  it("blocks if no features are enabled (CE: multiServer + webhooks)", async () => {
    const app = createApp(["multiServer", "webhooks"], ceFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.feature).toBe("multiServer, webhooks");
  });

  it("allows if all features are enabled (EE: multiServer + webhooks)", async () => {
    const app = createApp(["multiServer", "webhooks"], eeFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  it("allows if one of mixed-tier features is enabled (EE: multiServer + billing)", async () => {
    // EE without cloud: multiServer=true, billing=false → should pass
    const app = createApp(["multiServer", "billing"], eeFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  it("blocks cloud-only combo in EE without cloud", async () => {
    const app = createApp(["multiTenant", "billing"], eeFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.feature).toBe("multiTenant, billing");
  });

  it("allows cloud combo in cloud mode", async () => {
    const app = createApp(["multiTenant", "billing"], cloudFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// Response format verification
// ============================================================================

describe("requireFeature — response format", () => {
  it("returns correct JSON structure for blocked requests", async () => {
    const app = createApp("multiServer", ceFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = await res.json();
    expect(body).toEqual({
      error: {
        code: "FEATURE_DISABLED",
        message: "This feature requires Enterprise Edition",
        feature: "multiServer",
      },
    });
  });

  it("does not interfere with handler response on success", async () => {
    const app = createApp("chat", ceFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe("requireFeature — edge cases", () => {
  it("works with POST method", async () => {
    const app = new Hono();
    app.post(
      "/test",
      requireFeature("multiServer", { features: ceFeatures }),
      (c) => {
        return c.json({ ok: true });
      },
    );

    const res = await app.request("/test", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("works with DELETE method", async () => {
    const app = new Hono();
    app.delete(
      "/test/:id",
      requireFeature("webhooks", { features: ceFeatures }),
      (c) => {
        return c.json({ ok: true });
      },
    );

    const res = await app.request("/test/123", { method: "DELETE" });
    expect(res.status).toBe(403);
  });

  it("can chain with other middleware", async () => {
    const app = new Hono();
    let middlewareRan = false;
    app.get(
      "/test",
      async (_c, next) => {
        middlewareRan = true;
        await next();
      },
      requireFeature("multiServer", { features: ceFeatures }),
      (c) => c.json({ ok: true }),
    );

    const res = await app.request("/test");
    expect(res.status).toBe(403);
    expect(middlewareRan).toBe(true);
  });

  it("downstream middleware does not run when feature is disabled", async () => {
    const app = new Hono();
    let downstreamRan = false;
    app.get(
      "/test",
      requireFeature("multiServer", { features: ceFeatures }),
      async (_c, next) => {
        downstreamRan = true;
        await next();
      },
      (c) => c.json({ ok: true }),
    );

    const res = await app.request("/test");
    expect(res.status).toBe(403);
    expect(downstreamRan).toBe(false);
  });

  it("single-element array behaves like single feature", async () => {
    const app = createApp(["multiServer"], ceFeatures);
    const res = await app.request("/test");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.feature).toBe("multiServer");
  });

  it("works with PUT method", async () => {
    const app = new Hono();
    app.put(
      "/test/:id",
      requireFeature("teamCollaboration", { features: ceFeatures }),
      (c) => {
        return c.json({ ok: true });
      },
    );

    const res = await app.request("/test/123", { method: "PUT" });
    expect(res.status).toBe(403);
  });

  it("works with PATCH method", async () => {
    const app = new Hono();
    app.patch(
      "/test/:id",
      requireFeature("webhooks", { features: ceFeatures }),
      (c) => {
        return c.json({ ok: true });
      },
    );

    const res = await app.request("/test/123", { method: "PATCH" });
    expect(res.status).toBe(403);
  });

  it("passes request through when feature is enabled (handler receives context)", async () => {
    const app = new Hono();
    app.get(
      "/test/:id",
      requireFeature("chat", { features: ceFeatures }),
      (c) => {
        return c.json({ id: c.req.param("id") });
      },
    );

    const res = await app.request("/test/42");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "42" });
  });

  it("multiple middlewares: requireFeature can be stacked", async () => {
    const app = new Hono();
    // Both features must pass (AND semantics via chaining)
    app.get(
      "/test",
      requireFeature("chat", { features: eeFeatures }),
      requireFeature("multiServer", { features: eeFeatures }),
      (c) => c.json({ ok: true }),
    );

    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  it("stacked requireFeature blocks if second feature is disabled", async () => {
    const app = new Hono();
    app.get(
      "/test",
      requireFeature("chat", { features: ceFeatures }),
      requireFeature("multiServer", { features: ceFeatures }),
      (c) => c.json({ ok: true }),
    );

    const res = await app.request("/test");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.feature).toBe("multiServer");
  });
});

// ============================================================================
// Default FEATURES fallback (no options override)
// ============================================================================

describe("requireFeature — default FEATURES fallback", () => {
  it("uses module-level FEATURES when no options are passed", async () => {
    const app = new Hono();
    // No options override — uses the imported FEATURES singleton
    app.get("/test", requireFeature("chat"), (c) => c.json({ ok: true }));

    const res = await app.request("/test");
    // chat is always enabled in any edition
    expect(res.status).toBe(200);
  });

  it("core features always pass with default FEATURES", async () => {
    const app = new Hono();
    app.get("/chat", requireFeature("chat"), (c) => c.json({ ok: true }));
    app.get("/cmd", requireFeature("commandExecution"), (c) =>
      c.json({ ok: true }),
    );
    app.get("/kb", requireFeature("knowledgeBase"), (c) =>
      c.json({ ok: true }),
    );

    expect((await app.request("/chat")).status).toBe(200);
    expect((await app.request("/cmd")).status).toBe(200);
    expect((await app.request("/kb")).status).toBe(200);
  });

  it("EE features reflect current EDITION with default FEATURES", async () => {
    const app = new Hono();
    app.get("/test", requireFeature("multiServer"), (c) =>
      c.json({ ok: true }),
    );

    const res = await app.request("/test");
    // Should match whatever FEATURES.multiServer is at module level
    if (FEATURES.multiServer) {
      expect(res.status).toBe(200);
    } else {
      expect(res.status).toBe(403);
    }
  });
});

// ============================================================================
// Custom feature flags via options
// ============================================================================

describe("requireFeature — custom feature flags", () => {
  it("accepts fully custom feature flags", async () => {
    const customFlags: FeatureFlags = {
      chat: false, // disable even core feature
      commandExecution: true,
      knowledgeBase: true,
      multiServer: true,
      multiSession: true,
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

    const app = new Hono();
    app.get("/chat", requireFeature("chat", { features: customFlags }), (c) =>
      c.json({ ok: true }),
    );
    app.get(
      "/servers",
      requireFeature("multiServer", { features: customFlags }),
      (c) => c.json({ ok: true }),
    );

    // chat disabled in custom flags
    expect((await app.request("/chat")).status).toBe(403);
    // multiServer enabled in custom flags
    expect((await app.request("/servers")).status).toBe(200);
  });
});
