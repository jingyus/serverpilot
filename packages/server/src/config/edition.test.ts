// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect } from "vitest";
import {
  resolveDeployment,
  resolveFeatures,
  DEPLOYMENT,
  FEATURES,
  EDITION, // Legacy export
} from "./edition.js";

// All core features enabled in new model
describe("resolveDeployment", () => {
  it("defaults to Self-Hosted when no env vars are set", () => {
    const info = resolveDeployment({});
    expect(info.isSelfHosted).toBe(true);
    expect(info.isCloud).toBe(false);
  });

  it("detects Cloud (CLOUD_MODE=true)", () => {
    const info = resolveDeployment({ CLOUD_MODE: "true" });
    expect(info.isCloud).toBe(true);
    expect(info.isSelfHosted).toBe(false);
  });
});

describe("resolveFeatures", () => {
  it("returns all features enabled", () => {
    const info = resolveDeployment({});
    const features = resolveFeatures(info);
    expect(features.chat).toBe(true);
    expect(features.multiServer).toBe(true);
    expect(features.teamCollaboration).toBe(true);
  });
});

describe("FEATURES", () => {
  it("has all core features enabled", () => {
    expect(FEATURES.chat).toBe(true);
    expect(FEATURES.multiServer).toBe(true);
    expect(FEATURES.teamCollaboration).toBe(true);
  });
});

describe("EDITION (legacy)", () => {
  it("maps to DEPLOYMENT", () => {
    expect(EDITION.isCE).toBe(DEPLOYMENT.isSelfHosted);
    expect(EDITION.isEE).toBe(DEPLOYMENT.isCloud);
  });
});
