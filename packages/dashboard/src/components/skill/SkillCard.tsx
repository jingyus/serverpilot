// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useTranslation } from "react-i18next";
import {
  Play,
  Pause,
  Settings,
  Trash2,
  Zap,
  ArrowUpCircle,
  Loader2,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { InstalledSkill, SkillStatus, SkillSource } from "@/types/skill";
import { SKILL_SOURCE_LABELS } from "@/types/skill";

// ============================================================================
// Status Badge Variants
// ============================================================================

const STATUS_VARIANT: Record<
  SkillStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  enabled: "default",
  paused: "secondary",
  error: "destructive",
  installed: "outline",
  configured: "outline",
};

const STATUS_LABELS: Record<SkillStatus, string> = {
  enabled: "Enabled",
  paused: "Paused",
  error: "Error",
  installed: "Installed",
  configured: "Configured",
};

const SOURCE_VARIANT: Record<SkillSource, "default" | "secondary" | "outline"> =
  {
    official: "default",
    community: "secondary",
    local: "outline",
  };

// ============================================================================
// SkillCard Component
// ============================================================================

export function SkillCard({
  skill,
  onToggle,
  onConfigure,
  onExecute,
  onUninstall,
  onUpgrade,
  isUpgrading,
  onExport,
  isExporting,
}: {
  skill: InstalledSkill;
  onToggle: () => void;
  onConfigure: () => void;
  onExecute: () => void;
  onUninstall: () => void;
  onUpgrade?: () => void;
  isUpgrading?: boolean;
  onExport?: () => void;
  isExporting?: boolean;
}) {
  const { t } = useTranslation();
  const isEnabled = skill.status === "enabled";
  const canExecute = isEnabled;
  const canToggle =
    skill.status === "enabled" ||
    skill.status === "paused" ||
    skill.status === "configured";
  const canUpgrade = skill.source === "community" && onUpgrade;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        {/* Info */}
        <div className="flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-foreground">
              {skill.displayName ?? skill.name}
            </h3>
            <Badge variant={STATUS_VARIANT[skill.status]} className="text-xs">
              {STATUS_LABELS[skill.status]}
            </Badge>
            <Badge variant={SOURCE_VARIANT[skill.source]} className="text-xs">
              {SKILL_SOURCE_LABELS[skill.source]}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            v{skill.version} &middot; {skill.name}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={onExecute}
            disabled={!canExecute}
            title={t("skills.execute")}
            aria-label={t("skills.execute")}
          >
            <Zap className="h-4 w-4" />
          </Button>
          {canToggle && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggle}
              title={isEnabled ? t("skills.pause") : t("skills.enable")}
              aria-label={isEnabled ? t("skills.pause") : t("skills.enable")}
            >
              {isEnabled ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
          )}
          {canUpgrade && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onUpgrade}
              disabled={isUpgrading}
              title={t("skills.upgrade")}
              aria-label={t("skills.upgrade")}
            >
              {isUpgrading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUpCircle className="h-4 w-4" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onConfigure}
            title={t("skills.configure")}
            aria-label={t("skills.configure")}
          >
            <Settings className="h-4 w-4" />
          </Button>
          {onExport && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onExport}
              disabled={isExporting}
              title={t("skills.export")}
              aria-label={t("skills.export")}
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onUninstall}
            title={t("skills.uninstall")}
            aria-label={t("skills.uninstall")}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
