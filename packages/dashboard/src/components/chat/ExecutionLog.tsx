import {
  CheckCircle2,
  XCircle,
  Loader2,
  Terminal,
  Clock,
} from 'lucide-react';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/utils/format';
import type { ExecutionPlan } from '@/types/chat';

interface ExecutionLogProps {
  plan: ExecutionPlan;
  activeStepId: string | null;
  outputs: Record<string, string>;
  completedSteps: Record<string, { exitCode: number; duration: number }>;
  success: boolean | null;
}

function StepLog({
  step,
  index,
  isActive,
  output,
  completed,
}: {
  step: ExecutionPlan['steps'][number];
  index: number;
  isActive: boolean;
  output: string | undefined;
  completed: { exitCode: number; duration: number } | undefined;
}) {
  const isSuccess = completed?.exitCode === 0;
  const isFailed = completed != null && completed.exitCode !== 0;

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        isActive && 'border-blue-300 bg-blue-50/50',
        isSuccess && 'border-green-200 bg-green-50/30',
        isFailed && 'border-red-200 bg-red-50/30'
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
          <span className="text-xs font-medium sm:text-sm">{step.description}</span>
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
        <div className="mt-2 max-h-40 overflow-auto rounded bg-gray-900 p-2 sm:p-3">
          <pre
            className="whitespace-pre-wrap font-mono text-[10px] text-green-400 sm:text-xs"
            data-testid={`exec-output-${step.id}`}
          >
            {output || (isActive ? 'Waiting for output...' : '')}
          </pre>
        </div>
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
}: ExecutionLogProps) {
  return (
    <Card className="mx-2 border-2 sm:mx-4" data-testid="execution-log">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Terminal className="h-5 w-5" />
            Execution Progress
          </CardTitle>
          {success != null && (
            <Badge
              variant={success ? 'default' : 'destructive'}
              data-testid="exec-result-badge"
            >
              {success ? 'Completed' : 'Failed'}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        {plan.steps.map((step, i) => (
          <StepLog
            key={step.id}
            step={step}
            index={i}
            isActive={step.id === activeStepId}
            output={outputs[step.id]}
            completed={completedSteps[step.id]}
          />
        ))}
      </CardContent>
    </Card>
  );
}
