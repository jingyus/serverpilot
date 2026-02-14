// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * FeatureGate — conditionally renders children or an upgrade prompt.
 *
 * When the requested feature is enabled (EE), the children are rendered
 * normally.  When disabled (CE), a friendly upgrade card is shown instead,
 * explaining what the feature does and pointing users to the EE edition.
 *
 * @module components/common/FeatureGate
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Lock, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { useFeatures, type FeatureKey } from "@/hooks/useFeatures";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FeatureGateProps {
  /** The feature flag to check. */
  feature: FeatureKey;
  /** Content to render when the feature is enabled. */
  children: ReactNode;
  /** Optional fallback — overrides the default upgrade card. */
  fallback?: ReactNode;
}

// ---------------------------------------------------------------------------
// Upgrade URL
// ---------------------------------------------------------------------------

const UPGRADE_URL = "https://serverpilot.io";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FeatureGate({ feature, children, fallback }: FeatureGateProps) {
  const { features } = useFeatures();
  const { t } = useTranslation();

  if (features[feature]) {
    return <>{children}</>;
  }

  if (fallback !== undefined) {
    return <>{fallback}</>;
  }

  const featureName = t(`featureGate.features.${feature}.name`);
  const featureDesc = t(`featureGate.features.${feature}.description`);
  const highlights = t(`featureGate.features.${feature}.highlights`, {
    returnObjects: true,
    defaultValue: [],
  });
  const highlightsList = Array.isArray(highlights) ? highlights : [];

  return (
    <div
      data-testid="feature-gate-upgrade"
      className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4"
    >
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-8">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-900/30">
          <Lock className="h-8 w-8 text-blue-600 dark:text-blue-400" />
        </div>

        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          {featureName}
        </h2>

        <p className="text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">
          {featureDesc}
        </p>

        <span className="inline-block mb-4 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-3 py-1 rounded-full">
          {t("featureGate.enterpriseOnly")}
        </span>

        {highlightsList.length > 0 && (
          <div data-testid="feature-gate-highlights" className="mb-6 text-left">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
              {t("featureGate.highlights")}
            </p>
            <ul className="space-y-1.5">
              {highlightsList.map((item) => (
                <li
                  key={String(item)}
                  className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300"
                >
                  <CheckCircle2 className="h-4 w-4 text-green-500 dark:text-green-400 mt-0.5 shrink-0" />
                  <span>{String(item)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-3">
          <a
            href={UPGRADE_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="feature-gate-upgrade-link"
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            {t("featureGate.upgradeButton")}
            <ArrowUpRight className="h-4 w-4" />
          </a>
        </div>
      </div>
    </div>
  );
}
