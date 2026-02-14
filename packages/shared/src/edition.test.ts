import { describe, it, expect } from "vitest";
import {
  FEATURE_KEYS,
  CE_FEATURES,
  EE_FEATURES,
  CLOUD_FEATURES,
  isCEFeature,
  isEEFeature,
  isCloudFeature,
  CE_LIMITS,
  EE_LIMITS,
  getLimitsForEdition,
  toSerializableLimits,
} from "./edition.js";
import type { FeatureKey, EditionLimits } from "./edition.js";

// ============================================================================
// Classification constants
// ============================================================================

describe("CE_FEATURES", () => {
  it("contains chat, commandExecution, knowledgeBase", () => {
    expect(CE_FEATURES).toEqual(["chat", "commandExecution", "knowledgeBase"]);
  });
});

describe("EE_FEATURES", () => {
  it("contains all enterprise features", () => {
    expect(EE_FEATURES).toEqual([
      "multiServer",
      "multiSession",
      "teamCollaboration",
      "webhooks",
      "alerts",
      "metricsMonitoring",
      "auditExport",
      "oauthLogin",
      "rateLimiting",
    ]);
  });
});

describe("CLOUD_FEATURES", () => {
  it("contains multiTenant and billing", () => {
    expect(CLOUD_FEATURES).toEqual(["multiTenant", "billing"]);
  });
});

describe("classification completeness", () => {
  it("CE + EE + CLOUD covers all FEATURE_KEYS", () => {
    const all = [...CE_FEATURES, ...EE_FEATURES, ...CLOUD_FEATURES];
    expect(all.sort()).toEqual([...FEATURE_KEYS].sort());
  });

  it("no feature appears in multiple categories", () => {
    const ceSet = new Set(CE_FEATURES);
    const eeSet = new Set(EE_FEATURES);
    const cloudSet = new Set(CLOUD_FEATURES);

    for (const key of EE_FEATURES) {
      expect(ceSet.has(key)).toBe(false);
      expect(cloudSet.has(key)).toBe(false);
    }
    for (const key of CE_FEATURES) {
      expect(eeSet.has(key)).toBe(false);
      expect(cloudSet.has(key)).toBe(false);
    }
    for (const key of CLOUD_FEATURES) {
      expect(ceSet.has(key)).toBe(false);
      expect(eeSet.has(key)).toBe(false);
    }
  });

  it("total count matches FEATURE_KEYS length", () => {
    expect(
      CE_FEATURES.length + EE_FEATURES.length + CLOUD_FEATURES.length,
    ).toBe(FEATURE_KEYS.length);
  });
});

// ============================================================================
// Helper functions
// ============================================================================

describe("isCEFeature", () => {
  it.each(CE_FEATURES as unknown as FeatureKey[])(
    'returns true for CE feature "%s"',
    (key) => {
      expect(isCEFeature(key)).toBe(true);
    },
  );

  it.each(EE_FEATURES as unknown as FeatureKey[])(
    'returns false for EE feature "%s"',
    (key) => {
      expect(isCEFeature(key)).toBe(false);
    },
  );

  it.each(CLOUD_FEATURES as unknown as FeatureKey[])(
    'returns false for cloud feature "%s"',
    (key) => {
      expect(isCEFeature(key)).toBe(false);
    },
  );
});

describe("isEEFeature", () => {
  it.each(EE_FEATURES as unknown as FeatureKey[])(
    'returns true for EE feature "%s"',
    (key) => {
      expect(isEEFeature(key)).toBe(true);
    },
  );

  it.each(CE_FEATURES as unknown as FeatureKey[])(
    'returns false for CE feature "%s"',
    (key) => {
      expect(isEEFeature(key)).toBe(false);
    },
  );

  it.each(CLOUD_FEATURES as unknown as FeatureKey[])(
    'returns false for cloud feature "%s"',
    (key) => {
      expect(isEEFeature(key)).toBe(false);
    },
  );
});

describe("isCloudFeature", () => {
  it.each(CLOUD_FEATURES as unknown as FeatureKey[])(
    'returns true for cloud feature "%s"',
    (key) => {
      expect(isCloudFeature(key)).toBe(true);
    },
  );

  it.each(CE_FEATURES as unknown as FeatureKey[])(
    'returns false for CE feature "%s"',
    (key) => {
      expect(isCloudFeature(key)).toBe(false);
    },
  );

  it.each(EE_FEATURES as unknown as FeatureKey[])(
    'returns false for EE feature "%s"',
    (key) => {
      expect(isCloudFeature(key)).toBe(false);
    },
  );
});

// ============================================================================
// Edition limits
// ============================================================================

describe("CE_LIMITS", () => {
  it("has expected CE values", () => {
    expect(CE_LIMITS).toEqual({
      maxServers: 1,
      maxSessions: 1,
      maxSkills: 5,
      maxUsers: 1,
    });
  });

  it("all values are finite positive integers", () => {
    for (const [key, value] of Object.entries(CE_LIMITS)) {
      expect(value, `${key} should be finite`).toBeLessThan(Infinity);
      expect(value, `${key} should be positive`).toBeGreaterThan(0);
      expect(Number.isInteger(value), `${key} should be integer`).toBe(true);
    }
  });
});

describe("EE_LIMITS", () => {
  it("has Infinity for all limits", () => {
    expect(EE_LIMITS).toEqual({
      maxServers: Infinity,
      maxSessions: Infinity,
      maxSkills: Infinity,
      maxUsers: Infinity,
    });
  });

  it("every value is Infinity", () => {
    for (const [key, value] of Object.entries(EE_LIMITS)) {
      expect(value, `${key} should be Infinity`).toBe(Infinity);
    }
  });
});

describe("EditionLimits type coverage", () => {
  it("CE_LIMITS and EE_LIMITS have the same keys", () => {
    const ceKeys = Object.keys(CE_LIMITS).sort();
    const eeKeys = Object.keys(EE_LIMITS).sort();
    expect(ceKeys).toEqual(eeKeys);
  });

  it("both satisfy EditionLimits interface", () => {
    const assertLimits = (limits: EditionLimits): void => {
      expect(typeof limits.maxServers).toBe("number");
      expect(typeof limits.maxSessions).toBe("number");
      expect(typeof limits.maxSkills).toBe("number");
      expect(typeof limits.maxUsers).toBe("number");
    };
    assertLimits(CE_LIMITS);
    assertLimits(EE_LIMITS);
  });
});

describe("getLimitsForEdition", () => {
  it('returns CE_LIMITS for "ce"', () => {
    expect(getLimitsForEdition("ce")).toBe(CE_LIMITS);
  });

  it('returns EE_LIMITS for "ee"', () => {
    expect(getLimitsForEdition("ee")).toBe(EE_LIMITS);
  });

  it("CE limits are stricter than EE limits", () => {
    const ce = getLimitsForEdition("ce");
    const ee = getLimitsForEdition("ee");
    for (const key of Object.keys(ce) as (keyof EditionLimits)[]) {
      expect(ce[key], `CE ${key} should be <= EE ${key}`).toBeLessThanOrEqual(
        ee[key],
      );
    }
  });
});

describe("toSerializableLimits", () => {
  it("preserves finite CE limits as-is", () => {
    const result = toSerializableLimits(CE_LIMITS);
    expect(result).toEqual({
      maxServers: 1,
      maxSessions: 1,
      maxSkills: 5,
      maxUsers: 1,
    });
  });

  it("converts Infinity to -1 for EE limits", () => {
    const result = toSerializableLimits(EE_LIMITS);
    expect(result).toEqual({
      maxServers: -1,
      maxSessions: -1,
      maxSkills: -1,
      maxUsers: -1,
    });
  });

  it("produces JSON-safe output (no Infinity)", () => {
    const result = toSerializableLimits(EE_LIMITS);
    const json = JSON.stringify(result);
    expect(json).not.toContain("null");
    expect(json).not.toContain("Infinity");
    const parsed = JSON.parse(json);
    expect(parsed).toEqual(result);
  });

  it("handles mixed finite and Infinity values", () => {
    const mixed: EditionLimits = {
      maxServers: 10,
      maxSessions: Infinity,
      maxSkills: 50,
      maxUsers: Infinity,
    };
    const result = toSerializableLimits(mixed);
    expect(result).toEqual({
      maxServers: 10,
      maxSessions: -1,
      maxSkills: 50,
      maxUsers: -1,
    });
  });
});
