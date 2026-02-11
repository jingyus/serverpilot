// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Terminal,
  Clock,
  OctagonX,
  AlertTriangle,
} from 'lucide-react';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/utils/format';
import { parseAnsi } from '@/utils/ansi';
import type { ExecutionPlan } from '@/types/chat';

interface ExecutionLogProps {
  plan: ExecutionPlan;
  activeStepId: string | null;
  outputs: Record<string, string>;
  completedSteps: Record<string, { exitCode: number; duration: number }>;
  success: boolean | null;
  onEmergencyStop?: () => void;
  isExecuting?: boolean;
  startTime?: number | null;
  cancelled?: boolean;
}

function AnsiOutput({ text }: { text: string }) {
  const segments = useMemo(() => parseAnsi(text), [text]);
  return (
    <>
      {segments.map((seg, i) =>
        seg.className ? (
          <span key={i} className={seg.className}>{seg.text}</span>
        ) : (
          seg.text
        )
      )}
    </>
  );
}

function ProgressBar({
  completed,
  total,
  hasFailure,
}: {
  completed: number;
  total: number;
  hasFailure: boolean;
}) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="space-y-1" data-testid="execution-progress-bar">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{completed}/{total} steps completed</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            hasFailure ? 'bg-red-500' : 'bg-green-500'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StepLog({
  step,
  index,
  totalSteps,
  isActive,
  output,
  completed,
}: {
  step: ExecutionPlan['steps'][number];
  index: number;
  totalSteps: number;
  isActive: boolean;
  output: string | undefined;
  completed: { exitCode: number; duration: number } | undefined;
}) {
  const outputRef = useRef<HTMLPreElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  // Auto-scroll output as new content arrives
  useEffect(() => {
    if (!userScrolledUp && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [output, userScrolledUp]);

  const handleOutputScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    setUserScrolledUp(!isAtBottom);
  }, []);

  const isSuccess = completed?.exitCode === 0;
  const isFailed = completed != null && completed.exitCode !== 0;

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        isActive && 'border-blue-300 bg-blue-50/50 dark:border-blue-700 dark:bg-blue-900/20',
        isSuccess && 'border-green-200 bg-green-50/30 dark:border-green-800 dark:bg-green-900/20',
        isFailed && 'border-red-200 bg-red-50/30 dark:border-red-800 dark:bg-red-900/20'
      )}
      data-testid={`exec-step-${step.id}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          {isActive && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600" />}
          {isSuccess && <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />}
          {isFailed && <XCircle className="h-4 w-4 shrink-0 text-red-600" />}
          {!isActive && !completed && (
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px]">
              {index + 1}
            </span>
          )}
          <span className="text-xs font-medium sm:text-sm">
            <span className="text-muted-foreground" data-testid={`step-progress-${step.id}`}>
              [{index + 1}/{totalSteps}]
            </span>{' '}
            {step.description}
          </span>
        </div>

        {completed && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDuration(completed.duration)}
            </span>
            <Badge
              variant={isSuccess ? 'default' : 'destructive'}
              className="text-xs"
            >
              Exit: {completed.exitCode}
            </Badge>
          </div>
        )}
      </div>

      {(output || isActive) && (
        <div
          ref={containerRef}
          className="mt-2 max-h-40 overflow-auto rounded bg-gray-900 p-2 sm:p-3"
          onScroll={handleOutputScroll}
          data-testid={`exec-output-container-${step.id}`}
        >
          <pre
            ref={outputRef}
            className="whitespace-pre-wrap font-mono text-[10px] text-green-400 sm:text-xs"
            data-testid={`exec-output-${step.id}`}
          >
            {output ? <AnsiOutput text={output} /> : (isActive ? 'Waiting for output...' : '')}
          </pre>
          {userScrolledUp && isActive && (
            <button
              type="button"
              className="sticky bottom-0 mt-1 w-full rounded bg-blue-600/80 px-2 py-0.5 text-center text-[10px] text-white hover:bg-blue-600"
              onClick={() => {
                setUserScrolledUp(false);
                if (containerRef.current) {
                  containerRef.current.scrollTop = containerRef.current.scrollHeight;
                }
              }}
              data-testid={`scroll-to-bottom-${step.id}`}
            >
              Scroll to latest
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ExecutionSummary({
  plan,
  completedSteps,
  success,
  startTime,
  cancelled,
}: {
  plan: ExecutionPlan;
  completedSteps: Record<string, { exitCode: number; duration: number }>;
  success: boolean;
  startTime: number | null;
  cancelled: boolean;
}) {
  const completedCount = Object.keys(completedSteps).length;
  const successCount = Object.values(completedSteps).filter((s) => s.exitCode === 0).length;
  const failedCount = completedCount - successCount;
  const skippedCount = plan.steps.length - completedCount;
  const totalDuration = startTime ? Date.now() - startTime : 0;

  return (
    <div
      className="mt-3 rounded-lg border bg-muted/30 p-3"
      data-testid="execution-summary"
    >
      <h4 className="mb-2 text-sm font-semibold">
        {cancelled ? 'Execution Stopped' : success ? 'Execution Complete' : 'Execution Failed'}
      </h4>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="flex items-center gap-1.5" data-testid="summary-success">
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
          <span>{successCount} passed</span>
        </div>
        <div className="flex items-center gap-1.5" data-testid="summary-failed">
          <XCircle className="h-3.5 w-3.5 text-red-600" />
          <span>{failedCount} failed</span>
        </div>
        <div className="flex items-center gap-1.5" data-testid="summary-skipped">
          <AlertTriangle className="h-3.5 w-3.5 text-yellow-600" />
          <span>{skippedCount} skipped</span>
        </div>
        <div className="flex items-center gap-1.5" data-testid="summary-duration">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{formatDuration(totalDuration)}</span>
        </div>
      </div>
      {cancelled && (
        <p className="mt-2 text-xs text-muted-foreground">
          Execution was stopped by user. Remaining steps were not executed.
        </p>
      )}
      {!cancelled && !success && (
        <p className="mt-2 text-xs text-muted-foreground">
          Execution stopped at the first failed step. Remaining steps were skipped.
        </p>
      )}
    </div>
  );
}

export function ExecutionLog({
  plan,
  activeStepId,
  outputs,
  completedSteps,
  success,
  onEmergencyStop,
  isExecuting = false,
  startTime = null,
  cancelled = false,
}: ExecutionLogProps) {
  return (
    <Card className="mx-2 border-2 sm:mx-4" data-testid="execution-log">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Terminal className="h-5 w-5" />
            Execution Progress
          </CardTitle>
          <div className="flex items-center gap-2">
            {isExecuting && onEmergencyStop && (
              <Button
                variant="destructive"
                size="sm"
                onClick={onEmergencyStop}
                data-testid="emergency-stop-btn"
                className="gap-1"
              >
                <OctagonX className="h-4 w-4" />
                <span className="hidden sm:inline">Emergency Stop</span>
                <span className="sm:hidden">Stop</span>
              </Button>
            )}
            {success != null && (
              <Badge
                variant={cancelled ? 'outline' : success ? 'default' : 'destructive'}
                data-testid="exec-result-badge"
              >
                {cancelled ? 'Stopped' : success ? 'Completed' : 'Failed'}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        <ProgressBar
          completed={Object.keys(completedSteps).length}
          total={plan.steps.length}
          hasFailure={Object.values(completedSteps).some((s) => s.exitCode !== 0)}
        />

        {plan.steps.map((step, i) => (
          <StepLog
            key={step.id}
            step={step}
            index={i}
            totalSteps={plan.steps.length}
            isActive={step.id === activeStepId}
            output={outputs[step.id]}
            completed={completedSteps[step.id]}
          />
        ))}

        {success != null && (
          <ExecutionSummary
            plan={plan}
            completedSteps={completedSteps}
            success={success}
            startTime={startTime}
            cancelled={cancelled}
          />
        )}
      </CardContent>
    </Card>
  );
}
