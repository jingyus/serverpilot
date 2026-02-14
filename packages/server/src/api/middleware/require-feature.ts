// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Feature gate middleware for Hono REST API.
 *
 * Provides a middleware factory that blocks access to routes when the
 * required feature is disabled (e.g. EE-only features in CE mode).
 *
 * @module api/middleware/require-feature
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
 * When a single feature is passed, the request is blocked if that feature
 * is disabled. When an array is passed, the request proceeds if **any**
 * of the listed features is enabled (OR semantics).
 *
 * Returns HTTP 403 with a `FEATURE_DISABLED` error code when blocked.
 *
 * @param feature - A single feature key or array of keys (any-match).
 * @param options - Optional overrides (e.g. custom feature flags for testing).
 *
 * @example
 * ```ts
 * // Single feature gate
 * app.get('/webhooks', requireFeature('webhooks'), handler);
 *
 * // Any-match gate (passes if either is enabled)
 * app.get('/monitor', requireFeature(['alerts', 'metricsMonitoring']), handler);
 * ```
 */
export function requireFeature(
  feature: FeatureKey | FeatureKey[],
  options?: RequireFeatureOptions,
) {
  const keys = Array.isArray(feature) ? feature : [feature];

  return async (c: Context, next: Next): Promise<Response | void> => {
    const flags = options?.features ?? FEATURES;
    const enabled = keys.some((k) => flags[k]);

    if (!enabled) {
      const featureLabel = keys.length === 1 ? keys[0] : keys.join(", ");
      return c.json(
        {
          error: {
            code: ErrorCode.FEATURE_DISABLED,
            message: "This feature requires Enterprise Edition",
            feature: featureLabel,
          },
        },
        403,
      );
    }

    await next();
  };
}
