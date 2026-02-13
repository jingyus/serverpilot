// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useState, useCallback } from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Clock,
  Terminal,
  ShieldAlert,
  Ban,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatDuration } from '@/utils/format';
import type { ToolCallEntry } from '@/stores/chat-types';

interface ToolCallListProps {
  toolCalls: ToolCallEntry[];
}

function StatusIcon({ status }: { status: ToolCallEntry['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" data-testid="status-running" />;
    case 'completed':
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-600" data-testid="status-completed" />;
    case 'failed':
      return <XCircle className="h-3.5 w-3.5 text-red-600" data-testid="status-failed" />;
    case 'blocked':
      return <ShieldAlert className="h-3.5 w-3.5 text-yellow-600" data-testid="status-blocked" />;
    case 'rejected':
      return <Ban className="h-3.5 w-3.5 text-gray-500" data-testid="status-rejected" />;
  }
}

function ToolCallItem({ call }: { call: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasOutput = call.output.length > 0;
  const isDone = call.status !== 'running';

  const toggle = useCallback(() => {
    if (hasOutput) setExpanded((v) => !v);
  }, [hasOutput]);

  return (
    <div
      className={cn(
        'rounded border text-xs',
        call.status === 'running' && 'border-blue-200 bg-blue-50/40 dark:border-blue-800 dark:bg-blue-900/20',
        call.status === 'completed' && 'border-green-200/60 dark:border-green-800/60',
        call.status === 'failed' && 'border-red-200/60 dark:border-red-800/60',
        call.status === 'blocked' && 'border-yellow-200/60 dark:border-yellow-800/60',
        call.status === 'rejected' && 'border-gray-200/60 dark:border-gray-700/60',
      )}
      data-testid={`tool-call-${call.id}`}
    >
      {/* Header row */}
      <button
        type="button"
        className={cn(
          'flex w-full items-center gap-2 px-2.5 py-1.5 text-left',
          hasOutput && 'cursor-pointer hover:bg-muted/50',
          !hasOutput && 'cursor-default',
        )}
        onClick={toggle}
        data-testid={`tool-call-toggle-${call.id}`}
      >
        {hasOutput ? (
          expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="h-3 w-3 shrink-0" />
        )}

        <StatusIcon status={call.status} />

        {call.command ? (
          <code className="min-w-0 flex-1 truncate font-mono text-[11px]">
            $ {call.command}
          </code>
        ) : (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {call.tool}{call.description ? `: ${call.description}` : ''}
          </span>
        )}

        {isDone && call.duration != null && (
          <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground">
            <Clock className="h-2.5 w-2.5" />
            {formatDuration(call.duration)}
          </span>
        )}

        {isDone && call.exitCode != null && (
          <span
            className={cn(
              'shrink-0 rounded px-1 py-0.5 text-[10px] font-medium',
              call.exitCode === 0
                ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
            )}
            data-testid={`tool-call-exit-${call.id}`}
          >
            exit {call.exitCode}
          </span>
        )}
      </button>

      {/* Collapsible output */}
      {expanded && hasOutput && (
        <div className="border-t bg-gray-900 px-2.5 py-2" data-testid={`tool-call-output-${call.id}`}>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-green-400 sm:text-xs">
            {call.output}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ToolCallList({ toolCalls }: ToolCallListProps) {
  if (toolCalls.length === 0) return null;

  const runningCount = toolCalls.filter((tc) => tc.status === 'running').length;
  const completedCount = toolCalls.filter((tc) => tc.status === 'completed').length;
  const failedCount = toolCalls.filter((tc) => tc.status === 'failed' || tc.status === 'rejected').length;

  return (
    <div
      className="mx-2 mb-2 sm:mx-4"
      data-testid="tool-call-list"
    >
      {/* Summary bar */}
      <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
        <Terminal className="h-3.5 w-3.5" />
        <span data-testid="tool-call-summary">
          {toolCalls.length} tool call{toolCalls.length !== 1 ? 's' : ''}
          {runningCount > 0 && ` · ${runningCount} running`}
          {completedCount > 0 && ` · ${completedCount} done`}
          {failedCount > 0 && ` · ${failedCount} failed`}
        </span>
      </div>

      {/* Tool call items */}
      <div className="space-y-1">
        {toolCalls.map((tc) => (
          <ToolCallItem key={tc.id} call={tc} />
        ))}
      </div>
    </div>
  );
}
