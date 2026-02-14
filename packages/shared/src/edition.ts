// SPDX-License-Identifier: MIT
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Edition types — single source of truth for Self-Hosted vs Cloud feature flags.
 *
 * Both the server (`@aiinstaller/server`) and the dashboard
 * (`@aiinstaller/dashboard`) import these types to ensure
 * consistent deployment mode and feature definitions across the stack.
 *
 * **Key change**: All core features are enabled in both Self-Hosted and Cloud.
 * Cloud-only features are infrastructure enhancements (SAML SSO, compliance
 * reports, managed backups), not capability restrictions.
 *
 * @module edition
 */

// ---------------------------------------------------------------------------
// Edition type (legacy naming, semantic shift)
// ---------------------------------------------------------------------------

/**
 * Valid edition identifiers (legacy naming, preserved for compatibility).
 *
 * - "ce" (Community Edition) → Self-Hosted deployment (100% open source)
 * - "ee" (Enterprise Edition) → Cloud deployment (official SaaS)
 *
 * **Note**: This is a semantic shift. Previously "ee" meant "paid features".
 * Now it means "Cloud SaaS deployment". All features are open source.
 */
export type EditionType = "ce" | "ee";

// ---------------------------------------------------------------------------
// Feature keys
// ---------------------------------------------------------------------------

/** All available feature flag names. */
export type FeatureKey =
  | "chat"
  | "commandExecution"
  | "knowledgeBase"
  | "multiServer"
  | "multiSession"
  | "teamCollaboration"
  | "webhooks"
  | "alerts"
  | "metricsMonitoring"
  | "auditExport"
  | "oauthLogin"
  | "rateLimiting"
  | "multiTenant"
  | "billing";

/**
 * All feature keys as a constant array — handy for iteration and validation.
 *
 * Order: Core features (all Self-Hosted), then cloud-specific features.
 */
export const FEATURE_KEYS: readonly FeatureKey[] = [
  // Core features — enabled in both Self-Hosted and Cloud
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
  // Cloud-specific features (infrastructure enhancements, not restrictions)
  "multiTenant",
  "billing",
] as const;

// ---------------------------------------------------------------------------
// Feature classification — Self-Hosted vs Cloud-only
// ---------------------------------------------------------------------------

/**
 * Features available in Self-Hosted deployment (all core features).
 *
 * **New model**: Self-Hosted has 100% of core functionality:
 * - Multi-server management
 * - Team collaboration
 * - Webhooks, alerts, metrics
 * - Audit export, OAuth, rate limiting
 */
export const SELF_HOSTED_FEATURES: readonly FeatureKey[] = [
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
] as const;

/**
 * Cloud-only features (infrastructure enhancements, not capability restrictions).
 *
 * These features require managed SaaS infrastructure and represent operational
 * conveniences (official AI keys, auto-backup) or enterprise compliance
 * (SAML SSO, audit reports) that don't make sense in self-hosted deployments.
 *
 * **Examples**:
 * - `multiTenant`: Data isolation between SaaS customers (Self-Hosted typically single-tenant)
 * - `billing`: Stripe subscription billing (Self-Hosted doesn't need this)
 *
 * **Note**: Cloud also has all `SELF_HOSTED_FEATURES` plus these enhancements.
 */
export const CLOUD_ONLY_FEATURES: readonly FeatureKey[] = [
  "multiTenant",
  "billing",
] as const;

// Pre-computed Sets for O(1) lookups
const selfHostedSet = new Set<FeatureKey>(SELF_HOSTED_FEATURES);
const cloudOnlySet = new Set<FeatureKey>(CLOUD_ONLY_FEATURES);

/** Returns `true` if the feature is available in Self-Hosted deployments. */
export function isSelfHostedFeature(key: FeatureKey): boolean {
  return selfHostedSet.has(key);
}

/** Returns `true` if the feature is Cloud-only (infrastructure enhancement). */
export function isCloudOnlyFeature(key: FeatureKey): boolean {
  return cloudOnlySet.has(key);
}

// ---------------------------------------------------------------------------
// Legacy aliases (backward compatibility)
// ---------------------------------------------------------------------------

/**
 * @deprecated Use `SELF_HOSTED_FEATURES` instead. CE = Self-Hosted.
 */
export const CE_FEATURES = SELF_HOSTED_FEATURES;

/**
 * @deprecated No longer applicable. All features except Cloud-only are Self-Hosted.
 */
export const EE_FEATURES: readonly FeatureKey[] = [] as const;

/**
 * @deprecated Use `CLOUD_ONLY_FEATURES` instead.
 */
export const CLOUD_FEATURES = CLOUD_ONLY_FEATURES;

/**
 * @deprecated Use `isSelfHostedFeature()` instead.
 */
export function isCEFeature(key: FeatureKey): boolean {
  return isSelfHostedFeature(key);
}

/**
 * @deprecated No longer applicable. All core features are Self-Hosted.
 */
export function isEEFeature(_key: FeatureKey): boolean {
  return false; // All "EE features" are now Self-Hosted features
}

/**
 * @deprecated Use `isCloudOnlyFeature()` instead.
 */
export function isCloudFeature(key: FeatureKey): boolean {
  return isCloudOnlyFeature(key);
}

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

/** Feature flags record — each key maps to whether the feature is enabled. */
export type FeatureFlags = Readonly<Record<FeatureKey, boolean>>;

// ---------------------------------------------------------------------------
// Edition info
// ---------------------------------------------------------------------------

/** Edition metadata returned by the system API and used across packages. */
export interface EditionInfo {
  /**
   * Current edition identifier (legacy naming).
   *
   * - "ce" = Self-Hosted deployment
   * - "ee" = Cloud deployment
   */
  edition: EditionType;
  /** Feature availability map (all core features enabled). */
  features: FeatureFlags;
  /** Server version string (semver). */
  version: string;
  /** Resource limits for the current edition (-1 means unlimited). */
  limits: SerializableEditionLimits;
}

// ---------------------------------------------------------------------------
// Edition limits (deprecated — all deployments are unlimited)
// ---------------------------------------------------------------------------

/**
 * Numeric limits that vary between deployments.
 *
 * **Note**: In the new model (Self-Hosted vs Cloud), limits are deprecated.
 * Self-Hosted deployments have no artificial restrictions. Cloud deployments
 * use subscription tiers (Free/Pro/Team/Enterprise) for pricing, not feature limits.
 */
export interface EditionLimits {
  /** Maximum number of managed servers. */
  readonly maxServers: number;
  /** Maximum number of concurrent chat sessions per user. */
  readonly maxSessions: number;
  /** Maximum number of installed skills per user. */
  readonly maxSkills: number;
  /** Maximum number of user accounts. */
  readonly maxUsers: number;
}

/**
 * Self-Hosted limits — effectively unlimited.
 *
 * @deprecated Self-Hosted has no artificial limits. Use `Infinity` or skip checks.
 */
export const CE_LIMITS: EditionLimits = {
  maxServers: Infinity,
  maxSessions: Infinity,
  maxSkills: Infinity,
  maxUsers: Infinity,
} as const;

/**
 * Cloud limits — also unlimited (pricing is tier-based, not feature-restricted).
 *
 * Cloud Free tier may have subscription-based limits (e.g., 1 server, 1 user),
 * but these are enforced by the billing system, not feature flags.
 *
 * @deprecated Use subscription tier limits instead.
 */
export const EE_LIMITS: EditionLimits = {
  maxServers: Infinity,
  maxSessions: Infinity,
  maxSkills: Infinity,
  maxUsers: Infinity,
} as const;

/**
 * Return the applicable limits for the given edition.
 *
 * @deprecated All limits are `Infinity` now. Use subscription tiers instead.
 */
export function getLimitsForEdition(_edition: EditionType): EditionLimits {
  return EE_LIMITS; // Both Self-Hosted and Cloud are unlimited
}

/**
 * JSON-safe edition limits where `Infinity` is replaced with `-1`.
 *
 * Use this type in API responses. A value of `-1` means "unlimited".
 */
export type SerializableEditionLimits = {
  readonly [K in keyof EditionLimits]: number;
};

/**
 * Convert `EditionLimits` to a JSON-safe form (`Infinity` → `-1`).
 *
 * ```ts
 * const safe = toSerializableLimits(getLimitsForEdition('ee'));
 * // { maxServers: -1, maxSessions: -1, maxSkills: -1, maxUsers: -1 }
 * ```
 */
export function toSerializableLimits(
  limits: EditionLimits,
): SerializableEditionLimits {
  return {
    maxServers: Number.isFinite(limits.maxServers) ? limits.maxServers : -1,
    maxSessions: Number.isFinite(limits.maxSessions) ? limits.maxSessions : -1,
    maxSkills: Number.isFinite(limits.maxSkills) ? limits.maxSkills : -1,
    maxUsers: Number.isFinite(limits.maxUsers) ? limits.maxUsers : -1,
  };
}
