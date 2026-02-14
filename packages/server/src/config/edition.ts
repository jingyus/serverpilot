// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Edition configuration module.
 *
 * Defines CE (Community Edition) and EE (Enterprise Edition) constants
 * and feature flags. All feature availability is driven by the EDITION
 * and CLOUD_MODE environment variables.
 *
 * - EDITION=ce (default): single-server, single-user, local deployment
 * - EDITION=ee: multi-server, team collaboration, enterprise features
 * - CLOUD_MODE=true: cloud-only features (multi-tenant, billing)
 *
 * Primitive types (`EditionType`, `FeatureKey`, `FeatureFlags`) are the
 * canonical definitions from `@aiinstaller/shared` and re-exported here
 * for convenience. The server-specific `EditionInfo` (with `isCE`, `isEE`,
 * `isCloud`) is defined locally — it is distinct from the shared
 * `EditionInfo` API-response shape.
 *
 * @module config/edition
 */

import type {
  EditionType as SharedEditionType,
  FeatureKey as SharedFeatureKey,
  FeatureFlags as SharedFeatureFlags,
} from "@aiinstaller/shared";

// Re-export shared types so existing consumers don't break.
// Using `export type` with aliased re-exports for clarity.
export type EditionType = SharedEditionType;
export type FeatureKey = SharedFeatureKey;
export type FeatureFlags = SharedFeatureFlags;

/** Edition detection constants derived from environment variables. */
export interface EditionInfo {
  /** Current edition identifier */
  readonly edition: EditionType;
  /** True when running Community Edition */
  readonly isCE: boolean;
  /** True when running Enterprise Edition */
  readonly isEE: boolean;
  /** True when deployed in cloud mode (EE only) */
  readonly isCloud: boolean;
}

/**
 * Resolve the current edition from environment variables.
 *
 * Reads `process.env.EDITION` (defaults to 'ce') and `process.env.CLOUD_MODE`.
 * Pure function — useful for testing with custom env values.
 */
export function resolveEdition(
  env: Record<string, string | undefined> = process.env,
): EditionInfo {
  const raw = (env.EDITION ?? "ce").toLowerCase();
  const edition: EditionType = raw === "ee" ? "ee" : "ce";
  const isEE = edition === "ee";
  const isCloud = isEE && env.CLOUD_MODE === "true";

  return {
    edition,
    isCE: !isEE,
    isEE,
    isCloud,
  };
}

/**
 * Resolve feature flags from an EditionInfo.
 *
 * CE features are always enabled. EE features require `isEE`.
 * Cloud-only features additionally require `isCloud`.
 */
export function resolveFeatures(info: EditionInfo): FeatureFlags {
  return {
    // CE core features — always enabled
    chat: true,
    commandExecution: true,
    knowledgeBase: true,

    // EE features — require Enterprise Edition
    multiServer: info.isEE,
    multiSession: info.isEE,
    teamCollaboration: info.isEE,
    webhooks: info.isEE,
    alerts: info.isEE,
    metricsMonitoring: info.isEE,
    auditExport: info.isEE,
    oauthLogin: info.isEE,
    rateLimiting: info.isEE,

    // Cloud-only features — require EE + CLOUD_MODE
    multiTenant: info.isCloud,
    billing: info.isCloud,
  };
}

// ---------------------------------------------------------------------------
// Module-level singletons (initialized from process.env on first import)
// ---------------------------------------------------------------------------

/** Current edition info, resolved once at module load. */
export const EDITION: EditionInfo = resolveEdition();

/** Current feature flags, resolved once at module load. */
export const FEATURES: FeatureFlags = resolveFeatures(EDITION);

/**
 * Check whether a specific feature is enabled.
 *
 * Convenience wrapper around `FEATURES[key]`.
 */
export function isFeatureEnabled(key: FeatureKey): boolean {
  return FEATURES[key];
}
