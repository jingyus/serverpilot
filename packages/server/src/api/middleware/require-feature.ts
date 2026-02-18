// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Feature gate middleware for Hono REST API (deprecated).
 *
 * **Note**: In the new Self-Hosted vs Cloud model, all core features are
 * enabled by default. This middleware is kept for backward compatibility
 * but no longer blocks access to core features.
 *
 * Cloud-only features (SAML SSO, compliance reports, billing) should use
 * `requireCloudFeature()` instead.
 *
 * @module api/middleware/require-feature
 * @deprecated All core features are enabled. Use `requireCloudFeature()` for Cloud-only features.
 */

import type { Context, Next } from "hono";
import type { FeatureKey, FeatureFlags } from "../../config/edition.js";
import { FEATURES } from "../../config/edition.js";
import { ErrorCode } from "./error-handler.js";

/**
 * Options for the feature gate middleware.
 */
export interface RequireFeatureOptions {
  /** Override feature flags (useful for testing). */
  features?: FeatureFlags;
}

/**
 * Create middleware that requires one or more features to be enabled.
 *
 * **Deprecated**: All core features are now enabled in both Self-Hosted and Cloud
 * deployments. This middleware is kept for backward compatibility but always
 * passes (unless overridden in tests).
 *
 * For Cloud-only features (SAML SSO, compliance reports), use `requireCloudFeature()`.
 *
 * @param feature - A single feature key or array of keys (any-match).
 * @param options - Optional overrides (e.g. custom feature flags for testing).
 *
 * @example
 * ```ts
 * // This middleware now always passes (all features enabled)
 * app.get('/webhooks', requireFeature('webhooks'), handler);
 *
 * // For Cloud-only features, use requireCloudFeature() instead
 * app.get('/saml-sso', requireCloudFeature('samlSSO'), handler);
 * ```
 *
 * @deprecated All core features are enabled. Use `requireCloudFeature()` for Cloud-only features.
 */
export function requireFeature(
  feature: FeatureKey | FeatureKey[],
  options?: RequireFeatureOptions,
) {
  const keys = Array.isArray(feature) ? feature : [feature];

  return async (c: Context, next: Next): Promise<Response | void> => {
    // In the new model, all core features are enabled.
    // Only check if features are explicitly overridden (e.g., in tests).
    const flags = options?.features ?? FEATURES;
    const enabled = keys.some((k) => flags[k]);

    if (!enabled) {
      // This should only happen in tests or if someone manually overrides FEATURES
      const featureLabel = keys.length === 1 ? keys[0] : keys.join(", ");
      return c.json(
        {
          error: {
            code: ErrorCode.FEATURE_DISABLED,
            message:
              "This feature is disabled (test override or misconfiguration)",
            feature: featureLabel,
          },
        },
        403,
      );
    }

    // All core features are enabled — proceed
    await next();
  };
}

/**
 * Create middleware that requires a Cloud-only feature.
 *
 * Use this for infrastructure features that only make sense in the official
 * Cloud SaaS deployment (SAML SSO, compliance reports, managed backups, etc.).
 *
 * Returns HTTP 403 with `FEATURE_DISABLED` when accessed in Self-Hosted mode.
 *
 * @param feature - Cloud-only feature key (from CLOUD_ONLY).
 *
 * @example
 * ```ts
 * import { requireCloudFeature } from './middleware/require-feature.js';
 *
 * app.get('/api/v1/saml/sso', requireCloudFeature('samlSSO'), handler);
 * app.get('/api/v1/compliance/report', requireCloudFeature('complianceReports'), handler);
 * ```
 */
export function requireCloudFeature(
  feature: keyof import("../../config/edition.js").CloudOnlyFeatures,
) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const { CLOUD_ONLY } = await import("../../config/edition.js");

    if (!CLOUD_ONLY[feature]) {
      return c.json(
        {
          error: {
            code: ErrorCode.FEATURE_DISABLED,
            message: `This feature is only available in ServerPilot Cloud`,
            feature,
            upgradeUrl: "https://serverpilot.io/pricing",
          },
        },
        403,
      );
    }

    await next();
  };
}
