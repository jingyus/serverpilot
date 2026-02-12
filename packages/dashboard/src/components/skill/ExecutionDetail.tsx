// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  RefreshCw,
  Terminal,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { SkillExecution, ExecutionResultData, ToolCallRecord } from '@/types/skill';

// ============================================================================
// Props
// ============================================================================

interface ExecutionDetailProps {
  execution: SkillExecution;
  isLoading: boolean;
  onBack: () => void;
  onReExecute: (skillId: string, serverId: string) => void;
}

// ============================================================================
// ExecutionDetail Component
// ============================================================================

export function ExecutionDetail({ execution, isLoading, onBack, onReExecute }: ExecutionDetailProps) {
  const { t } = useTranslation();
  const resultData = parseResultData(execution.result);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with back button */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="detail-back">
          <ArrowLeft className="mr-1 h-4 w-4" />
          {t('common.back')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onReExecute(execution.skillId, execution.serverId)}
          data-testid="re-execute-btn"
        >
          <RefreshCw className="mr-1 h-4 w-4" />
          {t('skills.reExecute')}
        </Button>
      </div>

      {/* Status summary */}
      <div className="flex items-center gap-3 rounded-md border border-border p-3">
        <StatusIcon status={execution.status} />
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            {t(`skills.execStatus.${execution.status}`)}
            {execution.duration !== null && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground font-normal">
                <Clock className="h-3 w-3" />
                {formatDuration(execution.duration)}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {formatDate(execution.startedAt)}
            {' \u00b7 '}
            {execution.stepsExecuted} {t('skills.steps')}
          </p>
        </div>
      </div>

      {/* AI Output */}
      {resultData.output && (
        <section>
          <h4 className="mb-2 text-sm font-medium">{t('skills.aiOutput')}</h4>
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <pre className="whitespace-pre-wrap text-xs text-muted-foreground" data-testid="ai-output">
              {resultData.output}
            </pre>
          </div>
        </section>
      )}

      {/* Tool Calls */}
      {resultData.toolResults.length > 0 && (
        <section>
          <h4 className="mb-2 text-sm font-medium">
            {t('skills.toolCalls')} ({resultData.toolResults.length})
          </h4>
          <div className="space-y-1" data-testid="tool-calls-list">
            {resultData.toolResults.map((tc, i) => (
              <ToolCallRow key={i} record={tc} />
            ))}
          </div>
        </section>
      )}

      {/* Errors */}
      {resultData.errors.length > 0 && (
        <section>
          <h4 className="mb-2 text-sm font-medium text-destructive">{t('skills.errors')}</h4>
          <ul className="space-y-1" data-testid="error-list">
            {resultData.errors.map((err, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {err}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ============================================================================
// ToolCallRow — collapsible
// ============================================================================

function ToolCallRow({ record }: { record: ToolCallRecord }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-md border border-border text-xs">
      <button
        type="button"
        className="flex w-full items-center gap-2 p-2 text-left hover:bg-muted/50"
        onClick={() => setExpanded(!expanded)}
        data-testid="tool-call-toggle"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        {record.success ? (
          <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-500" />
        ) : (
          <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
        )}
        <Terminal className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="flex-1 font-mono font-medium truncate">{record.toolName}</span>
        <span className="flex items-center gap-0.5 text-muted-foreground shrink-0">
          <Clock className="h-3 w-3" />
          {formatDuration(record.duration)}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border bg-muted/30 p-2 space-y-2">
          {record.input && Object.keys(record.input).length > 0 && (
            <div>
              <Badge variant="outline" className="mb-1 text-[10px]">Input</Badge>
              <pre className="overflow-x-auto whitespace-pre-wrap text-muted-foreground">
                {formatInput(record.input)}
              </pre>
            </div>
          )}
          {record.result && (
            <div>
              <Badge variant="outline" className="mb-1 text-[10px]">Result</Badge>
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap text-muted-foreground">
                {record.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'success':
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case 'failed':
      return <XCircle className="h-5 w-5 text-destructive" />;
    case 'running':
      return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />;
    default:
      return <Clock className="h-5 w-5 text-muted-foreground" />;
  }
}

function parseResultData(result: SkillExecution['result']): {
  output: string;
  toolResults: ToolCallRecord[];
  errors: string[];
} {
  if (!result) return { output: '', toolResults: [], errors: [] };

  const data = result as ExecutionResultData;
  return {
    output: typeof data.output === 'string' ? data.output : '',
    toolResults: Array.isArray(data.toolResults) ? data.toolResults : [],
    errors: Array.isArray(data.errors) ? data.errors : [],
  };
}

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

function formatInput(input: Record<string, unknown>): string {
  if ('command' in input && typeof input.command === 'string') {
    return `$ ${input.command}`;
  }
  return JSON.stringify(input, null, 2);
}
