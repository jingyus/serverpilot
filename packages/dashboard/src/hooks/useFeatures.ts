// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Convenience hooks for deployment mode and feature checks.
 *
 * **Note**: In the new Self-Hosted vs Cloud model, all core features are
 * enabled by default. These hooks are kept for backward compatibility and
 * future Cloud-only feature detection.
 *
 * Built on top of `useSystemStore` with stable selectors so components
 * only re-render when the selected slice actually changes.
 *
 * @module hooks/useFeatures
 */

import { useMemo } from "react";
import { useSystemStore } from "@/stores/system";
import type { FeatureKey, FeatureFlags } from "@aiinstaller/shared";

// Re-export shared types for component convenience
export type { FeatureKey, FeatureFlags };

/**
 * Edition info returned by `useEdition()`.
 *
 * **Legacy naming**: "CE" = Self-Hosted, "EE" = Cloud
 */
export interface UseEditionResult {
  /** Whether the current deployment is Self-Hosted (Community Edition). */
  isCE: boolean;
  /** Whether the current deployment is Cloud (Enterprise Edition). */
  isEE: boolean;
  /** Raw edition string ('ce' | 'ee'), null before fetch completes. */
  edition: "ce" | "ee" | null;
  /** Convenience alias for Self-Hosted check. */
  isSelfHosted: boolean;
  /** Convenience alias for Cloud check. */
  isCloud: boolean;
}

/** Full result of `useFeatures()`. */
export interface FeaturesResult {
  /**
   * All feature flags.
   *
   * **Note**: In the new model, all core features are enabled (`true`).
   * Before fetch completes, defaults to `false` for safety.
   */
  features: FeatureFlags;
  /** Whether the edition fetch is still in-flight. */
  isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Default (all-true) feature flags for Self-Hosted/Cloud
// ---------------------------------------------------------------------------

/**
 * All core features enabled (new default for both Self-Hosted and Cloud).
 *
 * Cloud-only features (multiTenant, billing) may be false in Self-Hosted.
 */
const ALL_TRUE: FeatureFlags = {
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
  multiTenant: false, // Cloud-only
  billing: false, // Cloud-only
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Returns all feature flags plus loading state.
 *
 * **Note**: All core features are enabled by default. Cloud-only features
 * (multiTenant, billing) may be false in Self-Hosted mode.
 *
 * The `features` object is memoized — it only creates a new reference
 * when the store's `features` slice changes, avoiding unnecessary re-renders.
 *
 * @example
 * ```tsx
 * const { features, isLoading } = useFeatures();
 * if (isLoading) return <Spinner />;
 *
 * // All core features are always enabled
 * <ServersNav />  // No need to check features.multiServer
 * <TeamNav />     // No need to check features.teamCollaboration
 *
 * // Only check Cloud-only features
 * {features.multiTenant && <TenantSelector />}
 * ```
 */
export function useFeatures(): FeaturesResult {
  const storeFeatures = useSystemStore((s) => s.features);
  const isLoading = useSystemStore((s) => s.isLoading);

  const features = useMemo<FeatureFlags>(
    () => ({ ...ALL_TRUE, ...storeFeatures }),
    [storeFeatures],
  );

  return { features, isLoading };
}

/**
 * Returns deployment mode information (Self-Hosted vs Cloud).
 *
 * **Legacy naming preserved**: "CE" = Self-Hosted, "EE" = Cloud
 *
 * @example
 * ```tsx
 * const { isSelfHosted, isCloud } = useEdition();
 *
 * // Show different OAuth config UI
 * {isSelfHosted && <GitHubOAuthConfig />}
 * {isCloud && <SAMLSSOConfig />}
 * ```
 */
export function useEdition(): UseEditionResult {
  const edition = useSystemStore((s) => s.edition);

  return useMemo<UseEditionResult>(
    () => ({
      isCE: edition === "ce",
      isEE: edition === "ee",
      edition,
      isSelfHosted: edition === "ce",
      isCloud: edition === "ee",
    }),
    [edition],
  );
}
