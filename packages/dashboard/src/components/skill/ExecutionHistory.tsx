// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useTranslation } from 'react-i18next';
import { Clock, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useSkillsStore } from '@/stores/skills';
import { ExecutionDetail } from './ExecutionDetail';
import type { SkillExecution, SkillExecutionStatus } from '@/types/skill';

// ============================================================================
// Status Badge Config
// ============================================================================

const EXEC_STATUS_VARIANT: Record<SkillExecutionStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  success: 'default',
  failed: 'destructive',
  running: 'secondary',
  timeout: 'outline',
  cancelled: 'outline',
  pending_confirmation: 'secondary',
};

// ============================================================================
// ExecutionHistory Component
// ============================================================================

interface ExecutionHistoryProps {
  executions: SkillExecution[];
  onReExecute: (skillId: string, serverId: string) => void;
}

export function ExecutionHistory({ executions, onReExecute }: ExecutionHistoryProps) {
  const { t } = useTranslation();
  const {
    selectedExecution,
    isLoadingDetail,
    fetchExecutionDetail,
    clearSelectedExecution,
  } = useSkillsStore();

  const handleSelectExecution = (exec: SkillExecution) => {
    fetchExecutionDetail(exec.skillId, exec.id);
  };

  // Show detail view when an execution is selected
  if (selectedExecution) {
    return (
      <ExecutionDetail
        execution={selectedExecution}
        isLoading={isLoadingDetail}
        onBack={clearSelectedExecution}
        onReExecute={onReExecute}
      />
    );
  }

  if (executions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        {t('skills.noExecutions')}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {executions.map((exec) => (
        <ExecutionRow
          key={exec.id}
          execution={exec}
          onSelect={() => handleSelectExecution(exec)}
        />
      ))}
    </div>
  );
}

// ============================================================================
// Execution Row
// ============================================================================

function ExecutionRow({
  execution,
  onSelect,
}: {
  execution: SkillExecution;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const isRunning = execution.status === 'running';

  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-md border border-border p-3 text-left text-sm hover:bg-muted/50"
      onClick={onSelect}
      data-testid={`execution-row-${execution.id}`}
    >
      <span className="flex-1 truncate text-muted-foreground">
        {formatDate(execution.startedAt)}
      </span>

      <Badge variant="outline" className="text-xs shrink-0">
        {execution.triggerType}
      </Badge>

      <Badge
        variant={EXEC_STATUS_VARIANT[execution.status]}
        className="text-xs shrink-0"
      >
        {isRunning && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
        {t(`skills.execStatus.${execution.status}`)}
      </Badge>

      {execution.duration !== null && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
          <Clock className="h-3 w-3" />
          {formatDuration(execution.duration)}
        </span>
      )}

      <span className="text-xs text-muted-foreground shrink-0">
        {execution.stepsExecuted} {t('skills.steps')}
      </span>
    </button>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}
