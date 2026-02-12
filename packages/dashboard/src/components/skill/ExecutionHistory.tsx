// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Clock, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { SkillExecution, SkillExecutionStatus } from '@/types/skill';

// ============================================================================
// Status Badge Config
// ============================================================================

const EXEC_STATUS_VARIANT: Record<SkillExecutionStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  success: 'default',
  failed: 'destructive',
  running: 'secondary',
  timeout: 'outline',
};

const EXEC_STATUS_LABELS: Record<SkillExecutionStatus, string> = {
  success: 'Success',
  failed: 'Failed',
  running: 'Running',
  timeout: 'Timeout',
};

// ============================================================================
// ExecutionHistory Component
// ============================================================================

export function ExecutionHistory({ executions }: { executions: SkillExecution[] }) {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
          expanded={expandedId === exec.id}
          onToggle={() => setExpandedId(expandedId === exec.id ? null : exec.id)}
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
  expanded,
  onToggle,
}: {
  execution: SkillExecution;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isRunning = execution.status === 'running';

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        className="flex w-full items-center gap-3 p-3 text-left text-sm hover:bg-muted/50"
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}

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
          {EXEC_STATUS_LABELS[execution.status]}
        </Badge>

        {execution.duration !== null && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
            <Clock className="h-3 w-3" />
            {formatDuration(execution.duration)}
          </span>
        )}

        <span className="text-xs text-muted-foreground shrink-0">
          {execution.stepsExecuted} steps
        </span>
      </button>

      {expanded && execution.result && (
        <div className="border-t border-border bg-muted/30 p-3">
          <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
            {JSON.stringify(execution.result, null, 2)}
          </pre>
        </div>
      )}
    </div>
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
