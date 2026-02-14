// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * CE Welcome Guide — shown on first launch when no agent is connected.
 *
 * Displays the agent install command and connection instructions.
 * Once dismissed, the guide does not reappear (localStorage marker).
 *
 * @module components/chat/CeWelcomeGuide
 */

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Terminal,
  Check,
  Copy,
  RefreshCw,
  WifiOff,
  Rocket,
} from "lucide-react";

import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const GUIDE_DISMISSED_KEY = "ce_welcome_guide_dismissed";

export function isGuideDismissed(): boolean {
  try {
    return localStorage.getItem(GUIDE_DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function markGuideDismissed(): void {
  try {
    localStorage.setItem(GUIDE_DISMISSED_KEY, "true");
  } catch {
    // Ignore — localStorage may be unavailable in some environments
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CeWelcomeGuideProps {
  /** 'no-server' = no server registered; 'offline' = server exists but agent is disconnected. */
  variant: "no-server" | "offline";
  /** Called when the user clicks the retry / refresh button. */
  onRetry: () => void;
  /** Called when the user dismisses the guide (only for 'no-server'). */
  onDismiss?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const INSTALL_COMMAND = "curl -fsSL https://get.serverpilot.io | bash";

export function CeWelcomeGuide({
  variant,
  onRetry,
  onDismiss,
}: CeWelcomeGuideProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail in insecure contexts — ignore
    }
  }, []);

  if (variant === "offline") {
    return (
      <div
        className="flex h-[calc(100vh-3.5rem)] items-center justify-center"
        data-testid="ce-agent-offline"
      >
        <div className="mx-4 w-full max-w-md space-y-4 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900/30">
            <WifiOff className="h-8 w-8 text-yellow-600 dark:text-yellow-400" />
          </div>
          <h2 className="text-lg font-semibold">{t("ceGuide.offlineTitle")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("ceGuide.offlineDesc")}
          </p>
          <Button onClick={onRetry} data-testid="ce-retry-connection">
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("ceGuide.retry")}
          </Button>
        </div>
      </div>
    );
  }

  // variant === 'no-server'
  return (
    <div
      className="flex h-[calc(100vh-3.5rem)] items-center justify-center"
      data-testid="ce-welcome-guide"
    >
      <div className="mx-4 w-full max-w-lg space-y-6">
        {/* Title */}
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Rocket className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold">{t("ceGuide.title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("ceGuide.subtitle")}
          </p>
        </div>

        {/* Steps */}
        <div className="space-y-4">
          {/* Step 1: Install agent */}
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                1
              </span>
              <span className="font-medium">{t("ceGuide.step1Title")}</span>
            </div>
            <p className="text-sm text-muted-foreground pl-8">
              {t("ceGuide.step1Desc")}
            </p>
            <div className="ml-8 flex items-center gap-2 rounded-md bg-muted p-3 font-mono text-sm">
              <Terminal className="h-4 w-4 shrink-0 text-muted-foreground" />
              <code className="flex-1 break-all" data-testid="install-command">
                {INSTALL_COMMAND}
              </code>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                className="shrink-0"
                data-testid="copy-install-command"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Step 2: Wait for connection */}
          <div className="rounded-lg border p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                2
              </span>
              <span className="font-medium">{t("ceGuide.step2Title")}</span>
            </div>
            <p className="text-sm text-muted-foreground pl-8">
              {t("ceGuide.step2Desc")}
            </p>
          </div>

          {/* Step 3: Start chatting */}
          <div className="rounded-lg border p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                3
              </span>
              <span className="font-medium">{t("ceGuide.step3Title")}</span>
            </div>
            <p className="text-sm text-muted-foreground pl-8">
              {t("ceGuide.step3Desc")}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-center gap-3">
          <Button onClick={onRetry} data-testid="ce-check-connection">
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("ceGuide.checkConnection")}
          </Button>
          {onDismiss && (
            <Button
              variant="ghost"
              onClick={onDismiss}
              data-testid="ce-dismiss-guide"
            >
              {t("ceGuide.dismiss")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
