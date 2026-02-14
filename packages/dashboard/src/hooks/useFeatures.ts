// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Convenience hooks for edition / feature-flag checks.
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

/** Edition info returned by `useEdition()`. */
export interface UseEditionResult {
  /** Whether the current edition is Community Edition. */
  isCE: boolean;
  /** Whether the current edition is Enterprise Edition. */
  isEE: boolean;
  /** Raw edition string ('ce' | 'ee'), null before fetch completes. */
  edition: "ce" | "ee" | null;
}

/** Full result of `useFeatures()`. */
export interface FeaturesResult {
  /** All feature flags. Before fetch, every key defaults to `false`. */
  features: FeatureFlags;
  /** Whether the edition fetch is still in-flight. */
  isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Default (all-false) feature flags — used before the fetch completes
// ---------------------------------------------------------------------------

const ALL_FALSE: FeatureFlags = {
  chat: false,
  commandExecution: false,
  knowledgeBase: false,
  multiServer: false,
  multiSession: false,
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

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Returns all feature flags plus loading state.
 *
 * The `features` object is memoized — it only creates a new reference
 * when the store's `features` slice changes, avoiding unnecessary re-renders.
 *
 * @example
 * ```tsx
 * const { features, isLoading } = useFeatures();
 * if (isLoading) return <Spinner />;
 * {features.multiServer && <ServersNav />}
 * ```
 */
export function useFeatures(): FeaturesResult {
  const storeFeatures = useSystemStore((s) => s.features);
  const isLoading = useSystemStore((s) => s.isLoading);

  const features = useMemo<FeatureFlags>(
    () => ({ ...ALL_FALSE, ...storeFeatures }),
    [storeFeatures],
  );

  return { features, isLoading };
}

/**
 * Returns edition information (isCE, isEE, raw edition string).
 *
 * @example
 * ```tsx
 * const { isCE, isEE } = useEdition();
 * {isCE && <CeBadge />}
 * ```
 */
export function useEdition(): UseEditionResult {
  const edition = useSystemStore((s) => s.edition);

  return useMemo<UseEditionResult>(
    () => ({
      isCE: edition === "ce",
      isEE: edition === "ee",
      edition,
    }),
    [edition],
  );
}
