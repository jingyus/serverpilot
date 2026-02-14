// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect } from "vitest";
import {
  resolveEdition,
  resolveFeatures,
  isFeatureEnabled,
  EDITION,
  FEATURES,
} from "./edition.js";
import type { EditionInfo, FeatureKey } from "./edition.js";

// ---------------------------------------------------------------------------
// resolveEdition()
// ---------------------------------------------------------------------------
describe("resolveEdition", () => {
  it("defaults to CE when no env vars are set", () => {
    const info = resolveEdition({});
    expect(info.edition).toBe("ce");
    expect(info.isCE).toBe(true);
    expect(info.isEE).toBe(false);
    expect(info.isCloud).toBe(false);
  });

  it("detects CE explicitly", () => {
    const info = resolveEdition({ EDITION: "ce" });
    expect(info.edition).toBe("ce");
    expect(info.isCE).toBe(true);
    expect(info.isEE).toBe(false);
    expect(info.isCloud).toBe(false);
  });

  it("detects EE", () => {
    const info = resolveEdition({ EDITION: "ee" });
    expect(info.edition).toBe("ee");
    expect(info.isCE).toBe(false);
    expect(info.isEE).toBe(true);
    expect(info.isCloud).toBe(false);
  });

  it("detects EE + cloud mode", () => {
    const info = resolveEdition({ EDITION: "ee", CLOUD_MODE: "true" });
    expect(info.edition).toBe("ee");
    expect(info.isEE).toBe(true);
    expect(info.isCloud).toBe(true);
  });

  it("ignores CLOUD_MODE in CE mode", () => {
    const info = resolveEdition({ EDITION: "ce", CLOUD_MODE: "true" });
    expect(info.isCE).toBe(true);
    expect(info.isCloud).toBe(false);
  });

  it("is case-insensitive for EDITION", () => {
    expect(resolveEdition({ EDITION: "EE" }).isEE).toBe(true);
    expect(resolveEdition({ EDITION: "Ce" }).isCE).toBe(true);
  });

  it("treats unknown EDITION values as CE", () => {
    const info = resolveEdition({ EDITION: "pro" });
    expect(info.edition).toBe("ce");
    expect(info.isCE).toBe(true);
    expect(info.isEE).toBe(false);
  });

  it("treats CLOUD_MODE=false as not cloud", () => {
    const info = resolveEdition({ EDITION: "ee", CLOUD_MODE: "false" });
    expect(info.isCloud).toBe(false);
  });

  it("treats undefined CLOUD_MODE as not cloud", () => {
    const info = resolveEdition({ EDITION: "ee" });
    expect(info.isCloud).toBe(false);
  });

  it("treats EDITION=undefined as CE", () => {
    const info = resolveEdition({ EDITION: undefined });
    expect(info.edition).toBe("ce");
    expect(info.isCE).toBe(true);
  });

  it("treats empty string EDITION as CE", () => {
    const info = resolveEdition({ EDITION: "" });
    expect(info.edition).toBe("ce");
    expect(info.isCE).toBe(true);
  });

  it("treats CLOUD_MODE=TRUE (uppercase) as not cloud (strict match)", () => {
    const info = resolveEdition({ EDITION: "ee", CLOUD_MODE: "TRUE" });
    expect(info.isCloud).toBe(false);
  });

  it("treats CLOUD_MODE=1 as not cloud (strict match)", () => {
    const info = resolveEdition({ EDITION: "ee", CLOUD_MODE: "1" });
    expect(info.isCloud).toBe(false);
  });

  it("isCE and isEE are always complementary", () => {
    const cases = [
      { EDITION: "ce" },
      { EDITION: "ee" },
      { EDITION: "pro" },
      {},
      { EDITION: undefined },
    ];
    for (const env of cases) {
      const info = resolveEdition(env);
      expect(info.isCE).toBe(!info.isEE);
    }
  });

  it("uses process.env when called with no argument", () => {
    // resolveEdition() with no args defaults to process.env
    const info = resolveEdition();
    expect(["ce", "ee"]).toContain(info.edition);
    expect(typeof info.isCE).toBe("boolean");
    expect(typeof info.isEE).toBe("boolean");
    expect(typeof info.isCloud).toBe("boolean");
    expect(info.isCE).toBe(!info.isEE);
  });

  it("handles mixed case EDITION values", () => {
    expect(resolveEdition({ EDITION: "Ee" }).isEE).toBe(true);
    expect(resolveEdition({ EDITION: "eE" }).isEE).toBe(true);
    expect(resolveEdition({ EDITION: "CE" }).isCE).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveFeatures()
// ---------------------------------------------------------------------------
describe("resolveFeatures", () => {
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

  const ceAlwaysOn: FeatureKey[] = [
    "chat",
    "commandExecution",
    "knowledgeBase",
  ];
  const eeOnly: FeatureKey[] = [
    "multiServer",
    "multiSession",
    "teamCollaboration",
    "webhooks",
    "alerts",
    "metricsMonitoring",
    "auditExport",
    "oauthLogin",
    "rateLimiting",
  ];
  const cloudOnly: FeatureKey[] = ["multiTenant", "billing"];

  describe("CE mode", () => {
    const features = resolveFeatures(ceInfo);

    it.each(ceAlwaysOn)("enables core feature: %s", (key) => {
      expect(features[key]).toBe(true);
    });

    it.each(eeOnly)("disables EE feature: %s", (key) => {
      expect(features[key]).toBe(false);
    });

    it.each(cloudOnly)("disables cloud feature: %s", (key) => {
      expect(features[key]).toBe(false);
    });
  });

  describe("EE mode (no cloud)", () => {
    const features = resolveFeatures(eeInfo);

    it.each(ceAlwaysOn)("enables core feature: %s", (key) => {
      expect(features[key]).toBe(true);
    });

    it.each(eeOnly)("enables EE feature: %s", (key) => {
      expect(features[key]).toBe(true);
    });

    it.each(cloudOnly)("disables cloud feature: %s", (key) => {
      expect(features[key]).toBe(false);
    });
  });

  describe("EE + Cloud mode", () => {
    const features = resolveFeatures(cloudInfo);

    it.each(ceAlwaysOn)("enables core feature: %s", (key) => {
      expect(features[key]).toBe(true);
    });

    it.each(eeOnly)("enables EE feature: %s", (key) => {
      expect(features[key]).toBe(true);
    });

    it.each(cloudOnly)("enables cloud feature: %s", (key) => {
      expect(features[key]).toBe(true);
    });
  });

  describe("feature count and completeness", () => {
    it("returns exactly 14 feature keys", () => {
      const features = resolveFeatures(ceInfo);
      expect(Object.keys(features)).toHaveLength(14);
    });

    it("all feature values are booleans", () => {
      const features = resolveFeatures(eeInfo);
      for (const value of Object.values(features)) {
        expect(typeof value).toBe("boolean");
      }
    });

    it("CE has exactly 3 enabled features", () => {
      const features = resolveFeatures(ceInfo);
      const enabledCount = Object.values(features).filter(Boolean).length;
      expect(enabledCount).toBe(3);
    });

    it("EE (no cloud) has exactly 12 enabled features", () => {
      const features = resolveFeatures(eeInfo);
      const enabledCount = Object.values(features).filter(Boolean).length;
      expect(enabledCount).toBe(12);
    });

    it("EE + Cloud has all 14 features enabled", () => {
      const features = resolveFeatures(cloudInfo);
      const enabledCount = Object.values(features).filter(Boolean).length;
      expect(enabledCount).toBe(14);
    });
  });

  describe("end-to-end: env → edition → features", () => {
    it("CE env resolves to only core features", () => {
      const info = resolveEdition({ EDITION: "ce" });
      const features = resolveFeatures(info);
      expect(features.chat).toBe(true);
      expect(features.multiServer).toBe(false);
      expect(features.multiTenant).toBe(false);
    });

    it("EE env resolves to EE features but not cloud", () => {
      const info = resolveEdition({ EDITION: "ee" });
      const features = resolveFeatures(info);
      expect(features.multiServer).toBe(true);
      expect(features.webhooks).toBe(true);
      expect(features.multiTenant).toBe(false);
      expect(features.billing).toBe(false);
    });

    it("EE + CLOUD_MODE=true resolves to all features", () => {
      const info = resolveEdition({ EDITION: "ee", CLOUD_MODE: "true" });
      const features = resolveFeatures(info);
      expect(features.multiServer).toBe(true);
      expect(features.multiTenant).toBe(true);
      expect(features.billing).toBe(true);
    });

    it("invalid EDITION falls back to CE features", () => {
      const info = resolveEdition({ EDITION: "enterprise" });
      const features = resolveFeatures(info);
      expect(features.chat).toBe(true);
      expect(features.multiServer).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Module-level singletons (EDITION, FEATURES, isFeatureEnabled)
// ---------------------------------------------------------------------------
describe("module singletons", () => {
  it("EDITION is a valid EditionInfo object", () => {
    expect(EDITION).toHaveProperty("edition");
    expect(EDITION).toHaveProperty("isCE");
    expect(EDITION).toHaveProperty("isEE");
    expect(EDITION).toHaveProperty("isCloud");
    expect(typeof EDITION.isCE).toBe("boolean");
    expect(typeof EDITION.isEE).toBe("boolean");
    // isCE and isEE must be mutually exclusive
    expect(EDITION.isCE).not.toBe(EDITION.isEE);
  });

  it("FEATURES has all expected keys", () => {
    const allKeys: FeatureKey[] = [
      "chat",
      "commandExecution",
      "knowledgeBase",
      "multiServer",
      "multiSession",
      "teamCollaboration",
      "webhooks",
      "alerts",
      "metricsMonitoring",
      "auditExport",
      "oauthLogin",
      "rateLimiting",
      "multiTenant",
      "billing",
    ];
    for (const key of allKeys) {
      expect(FEATURES).toHaveProperty(key);
      expect(typeof FEATURES[key]).toBe("boolean");
    }
  });

  it("isFeatureEnabled returns the same value as FEATURES[key]", () => {
    const keys: FeatureKey[] = ["chat", "multiServer", "billing"];
    for (const key of keys) {
      expect(isFeatureEnabled(key)).toBe(FEATURES[key]);
    }
  });

  it("core features are always enabled regardless of edition", () => {
    expect(isFeatureEnabled("chat")).toBe(true);
    expect(isFeatureEnabled("commandExecution")).toBe(true);
    expect(isFeatureEnabled("knowledgeBase")).toBe(true);
  });

  it("isFeatureEnabled covers all FeatureKey values", () => {
    const allKeys: FeatureKey[] = [
      "chat",
      "commandExecution",
      "knowledgeBase",
      "multiServer",
      "multiSession",
      "teamCollaboration",
      "webhooks",
      "alerts",
      "metricsMonitoring",
      "auditExport",
      "oauthLogin",
      "rateLimiting",
      "multiTenant",
      "billing",
    ];
    for (const key of allKeys) {
      expect(typeof isFeatureEnabled(key)).toBe("boolean");
    }
  });

  it("EDITION and FEATURES are consistent with each other", () => {
    // If EDITION says CE, FEATURES EE-only flags should be false
    if (EDITION.isCE) {
      expect(FEATURES.multiServer).toBe(false);
      expect(FEATURES.teamCollaboration).toBe(false);
    }
    // If EDITION says EE, EE features should be true
    if (EDITION.isEE) {
      expect(FEATURES.multiServer).toBe(true);
      expect(FEATURES.teamCollaboration).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Type safety smoke tests
// ---------------------------------------------------------------------------
describe("type safety", () => {
  it("FeatureKey only accepts valid feature names", () => {
    // This is a compile-time check — if it compiles, the type is correct.
    const validKey: FeatureKey = "multiServer";
    expect(resolveFeatures(resolveEdition({}))[validKey]).toBeDefined();
  });

  it("resolveEdition returns frozen-like EditionInfo", () => {
    const info = resolveEdition({ EDITION: "ee" });
    expect(info.edition).toBe("ee");
    // Verify the shape matches the interface
    const keys = Object.keys(info);
    expect(keys).toContain("edition");
    expect(keys).toContain("isCE");
    expect(keys).toContain("isEE");
    expect(keys).toContain("isCloud");
  });
});
