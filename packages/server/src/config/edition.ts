// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Deployment mode configuration module.
 *
 * Defines Self-Hosted vs Cloud deployment modes. All core features are
 * enabled by default (100% open source). Cloud-only features are reserved
 * for managed SaaS infrastructure.
 *
 * - CLOUD_MODE=false (default): Self-Hosted deployment, all features enabled
 * - CLOUD_MODE=true: Official Cloud SaaS, adds managed infrastructure features
 *
 * Core features (multiServer, teamCollaboration, webhooks, etc.) are always
 * enabled — no feature gating by deployment mode. Cloud-only features
 * (SAML SSO, compliance reports, billing) are infrastructure enhancements,
 * not capability restrictions.
 *
 * @module config/edition
 */

import type {
  FeatureKey as SharedFeatureKey,
  FeatureFlags as SharedFeatureFlags,
} from "@aiinstaller/shared";

// Re-export shared types for backward compatibility
export type FeatureKey = SharedFeatureKey;
export type FeatureFlags = SharedFeatureFlags;

/** Deployment mode detection constants. */
export interface DeploymentInfo {
  /** True when running Self-Hosted (open source deployment) */
  readonly isSelfHosted: boolean;
  /** True when running Cloud (official SaaS) */
  readonly isCloud: boolean;
}

/**
 * Cloud-only features (infrastructure enhancements, not capability restrictions).
 *
 * These features are specific to the managed SaaS environment and represent
 * operational conveniences (official AI keys, auto-backup) or enterprise
 * compliance (SAML SSO, audit reports) that don't make sense in self-hosted
 * deployments.
 */
export interface CloudOnlyFeatures {
  /** Official AI Provider (no need to bring your own API key) */
  readonly officialAIKey: boolean;
  /** Automated backup and disaster recovery */
  readonly autoBackup: boolean;
  /** Enterprise SAML SSO (Google Workspace, Okta, etc.) */
  readonly samlSSO: boolean;
  /** Compliance reports (SOC2, ISO27001, GDPR) */
  readonly complianceReports: boolean;
  /** Multi-tenant isolation (SaaS data isolation) */
  readonly multiTenant: boolean;
  /** Subscription billing (Stripe integration) */
  readonly billing: boolean;
  /** Managed infrastructure (PostgreSQL, Redis, S3, K8s) */
  readonly managedInfra: boolean;
}

/**
 * Resolve the current deployment mode from environment variables.
 *
 * Reads `process.env.CLOUD_MODE` (defaults to 'false').
 * Pure function — useful for testing with custom env values.
 */
export function resolveDeployment(
  env: Record<string, string | undefined> = process.env,
): DeploymentInfo {
  const isCloud = env.CLOUD_MODE === "true";

  return {
    isSelfHosted: !isCloud,
    isCloud,
  };
}

/**
 * Resolve feature flags (all core features enabled).
 *
 * Self-Hosted deployment has full access to all features:
 * - Multi-server management
 * - Team collaboration
 * - Webhooks, alerts, metrics monitoring
 * - Audit export, OAuth login, rate limiting
 *
 * No feature gating based on deployment mode.
 */
export function resolveFeatures(_info: DeploymentInfo): FeatureFlags {
  // All features enabled — 100% open source
  return {
    // Core AI features
    chat: true,
    commandExecution: true,
    knowledgeBase: true,

    // Server management (Self-Hosted supported)
    multiServer: true,
    multiSession: true,

    // Team collaboration (Self-Hosted supported)
    teamCollaboration: true,

    // Notifications & alerts (Self-Hosted supported)
    webhooks: true,
    alerts: true,

    // Monitoring & audit (Self-Hosted supported)
    metricsMonitoring: true,
    auditExport: true,

    // Security & auth (Self-Hosted supported, may require manual config)
    oauthLogin: true, // Self-Hosted: configure your own GitHub OAuth App
    rateLimiting: true,

    // Cloud features (legacy flags, kept for backward compatibility)
    // In new model, these are always true — Cloud adds *enhancements*, not restrictions
    multiTenant: true, // Self-Hosted can use tenant isolation if desired
    billing: true, // Self-Hosted can implement billing if they fork
  };
}

/**
 * Resolve Cloud-only features (infrastructure enhancements).
 *
 * These features are only available in the official Cloud SaaS deployment.
 * They represent operational conveniences (official AI, auto-backup) or
 * enterprise compliance (SAML, audit reports) that require managed infrastructure.
 */
export function resolveCloudOnlyFeatures(
  info: DeploymentInfo,
): CloudOnlyFeatures {
  return {
    officialAIKey: info.isCloud,
    autoBackup: info.isCloud,
    samlSSO: info.isCloud,
    complianceReports: info.isCloud,
    multiTenant: info.isCloud, // Cloud uses multi-tenant, Self-Hosted typically single-tenant
    billing: info.isCloud, // Stripe subscription billing
    managedInfra: info.isCloud, // PostgreSQL, Redis, S3, K8s
  };
}

// ---------------------------------------------------------------------------
// Module-level singletons (initialized from process.env on first import)
// ---------------------------------------------------------------------------

/** Current deployment mode, resolved once at module load. */
export const DEPLOYMENT: DeploymentInfo = resolveDeployment();

/** Current feature flags, resolved once at module load. */
export const FEATURES: FeatureFlags = resolveFeatures(DEPLOYMENT);

/** Cloud-only features, resolved once at module load. */
export const CLOUD_ONLY: CloudOnlyFeatures =
  resolveCloudOnlyFeatures(DEPLOYMENT);

/**
 * Legacy `EDITION` export for backward compatibility.
 *
 * @deprecated Use `DEPLOYMENT` instead. `EDITION.isCE` → `DEPLOYMENT.isSelfHosted`
 */
export const EDITION = {
  edition: DEPLOYMENT.isSelfHosted ? ("ce" as const) : ("ee" as const),
  isCE: DEPLOYMENT.isSelfHosted,
  isEE: DEPLOYMENT.isCloud,
  isCloud: DEPLOYMENT.isCloud,
};

/**
 * Check whether a specific feature is enabled.
 *
 * Convenience wrapper around `FEATURES[key]`.
 * Since all features are enabled, this always returns true.
 *
 * @deprecated All features are enabled. Use `FEATURES[key]` directly if needed.
 */
export function isFeatureEnabled(key: FeatureKey): boolean {
  return FEATURES[key];
}

/**
 * Check whether a Cloud-only feature is available.
 *
 * Use this for infrastructure features like SAML SSO, compliance reports, etc.
 */
export function isCloudOnlyFeature(key: keyof CloudOnlyFeatures): boolean {
  return CLOUD_ONLY[key];
}
