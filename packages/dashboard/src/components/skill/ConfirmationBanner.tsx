// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useTranslation } from 'react-i18next';
import { ShieldAlert, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SkillExecution, InstalledSkill } from '@/types/skill';

// ============================================================================
// PendingConfirmationsBanner Props
// ============================================================================

export interface PendingConfirmationsBannerProps {
  executions: SkillExecution[];
  skills: InstalledSkill[];
  onConfirm: (executionId: string) => void;
  onReject: (executionId: string) => void;
}

// ============================================================================
// PendingConfirmationsBanner Component
// ============================================================================

export function PendingConfirmationsBanner({
  executions,
  skills,
  onConfirm,
  onReject,
}: PendingConfirmationsBannerProps) {
  const { t } = useTranslation();
  const skillMap = new Map(skills.map((s) => [s.id, s]));

  return (
    <div className="rounded-md border border-yellow-500/50 bg-yellow-500/10 p-4 space-y-3" data-testid="pending-confirmations">
      <div className="flex items-center gap-2 text-sm font-medium text-yellow-600 dark:text-yellow-400">
        <ShieldAlert className="h-4 w-4" />
        {t('skills.pendingConfirmations', { count: executions.length })}
      </div>
      <div className="space-y-2">
        {executions.map((exec) => {
          const skill = skillMap.get(exec.skillId);
          return (
            <div key={exec.id} className="flex items-center justify-between rounded-md bg-background p-3 text-sm">
              <div>
                <span className="font-medium">{skill?.displayName ?? skill?.name ?? exec.skillId}</span>
                <span className="ml-2 text-muted-foreground">
                  {t('skills.triggeredBy', { type: exec.triggerType })}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {new Date(exec.startedAt).toLocaleString()}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onReject(exec.id)}
                  data-testid={`reject-${exec.id}`}
                >
                  <X className="mr-1 h-3 w-3" />
                  {t('skills.reject')}
                </Button>
                <Button
                  size="sm"
                  onClick={() => onConfirm(exec.id)}
                  data-testid={`confirm-${exec.id}`}
                >
                  <Check className="mr-1 h-3 w-3" />
                  {t('skills.confirm')}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
