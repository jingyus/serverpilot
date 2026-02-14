// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * System store — fetches and caches edition/feature information.
 *
 * Call `fetchEdition()` once at app startup (e.g. in App.tsx or a layout).
 * Components can then use `useIsFeatureEnabled('multiServer')` to
 * conditionally render EE-only UI.
 *
 * @module stores/system
 */

import { create } from "zustand";
import { apiRequest, ApiError } from "@/api/client";
import type {
  EditionType,
  FeatureKey,
  FeatureFlags,
  EditionInfo,
  SerializableEditionLimits,
} from "@aiinstaller/shared";

// Re-export shared types so existing consumers (hooks, components) can
// continue importing from this module without breaking.
export type {
  EditionType,
  FeatureKey,
  FeatureFlags,
  EditionInfo,
  SerializableEditionLimits,
};

/** Shape of the GET /api/v1/system/edition response (alias). */
export type EditionResponse = EditionInfo;

/** Zustand store state and actions. */
export interface SystemState {
  /** Current edition ('ce' or 'ee'), null until fetched. */
  edition: EditionType | null;
  /** Feature flags, empty object until fetched (all features disabled). */
  features: Partial<Record<FeatureKey, boolean>>;
  /** Server version string, null until fetched. */
  version: string | null;
  /** Resource limits for the current edition, null until fetched. */
  limits: SerializableEditionLimits | null;
  /** Whether the edition fetch is in-flight. */
  isLoading: boolean;
  /** Error message from the most recent fetch attempt, if any. */
  error: string | null;
  /** Fetch edition info from the server. Safe to call multiple times. */
  fetchEdition: () => Promise<void>;
  /** Clear the error state. */
  clearError: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSystemStore = create<SystemState>((set, get) => ({
  edition: null,
  features: {},
  version: null,
  limits: null,
  isLoading: false,
  error: null,

  fetchEdition: async () => {
    // Skip if already loaded or currently loading
    if (get().edition !== null || get().isLoading) {
      return;
    }

    set({ isLoading: true, error: null });

    try {
      const data = await apiRequest<EditionResponse>("/system/edition");
      set({
        edition: data.edition,
        features: data.features,
        version: data.version,
        limits: data.limits,
        isLoading: false,
      });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Failed to load system information";
      set({ error: message, isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/**
 * React hook — returns whether a specific feature is enabled.
 *
 * Before the edition info is fetched, all features default to `false`,
 * preventing EE-only UI from flashing on CE installations.
 *
 * @example
 * ```tsx
 * const canUseWebhooks = useIsFeatureEnabled('webhooks');
 * ```
 */
export function useIsFeatureEnabled(key: FeatureKey): boolean {
  return useSystemStore((s) => s.features[key] === true);
}
