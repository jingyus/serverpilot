// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useState } from 'react';
import {
  Shield,
  ChevronDown,
  ChevronRight,
  Play,
  X,
  Undo2,
  Clock,
  Terminal,
  AlertTriangle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { RISK_CONFIG } from '@/types/chat';
import type { ExecutionPlan, PlanStep, RiskLevel } from '@/types/chat';

interface PlanPreviewProps {
  plan: ExecutionPlan;
  onConfirm: () => void;
  onReject: () => void;
  isExecuting: boolean;
}

const CARD_BORDER_COLORS: Record<RiskLevel, string> = {
  green: 'border-green-300 dark:border-green-700',
  yellow: 'border-yellow-300 dark:border-yellow-700',
  red: 'border-red-400 dark:border-red-600',
  critical: 'border-red-500 dark:border-red-500 animate-pulse',
};

function RiskBadge({ level }: { level: string }) {
  const config = RISK_CONFIG[level as keyof typeof RISK_CONFIG] ?? RISK_CONFIG.green;
  return (
    <Badge
      variant="outline"
      className={cn('gap-1', config.color, config.bgColor, config.borderColor)}
      data-testid={`risk-badge-${level}`}
    >
      <Shield className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}

function StepItem({ step, index }: { step: PlanStep; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const ChevronIcon = expanded ? ChevronDown : ChevronRight;
  const stepConfig = RISK_CONFIG[step.riskLevel as keyof typeof RISK_CONFIG] ?? RISK_CONFIG.green;

  return (
    <div
      className={cn('rounded-lg border bg-background p-3', stepConfig.borderColor)}
      data-testid={`plan-step-${step.id}`}
    >
      <button
        type="button"
        className="flex w-full items-center gap-3 text-left"
        onClick={() => setExpanded(!expanded)}
        data-testid={`step-toggle-${step.id}`}
      >
        <ChevronIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
          {index + 1}
        </span>
        <span className="flex-1 text-sm font-medium">{step.description}</span>
        <RiskBadge level={step.riskLevel} />
      </button>

      {expanded && (
        <div className="mt-3 space-y-2 pl-4 sm:pl-[3.25rem]">
          <div className="flex items-start gap-2 overflow-x-auto rounded bg-muted/50 px-2 py-2 font-mono text-xs sm:items-center sm:px-3">
            <Terminal className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground sm:mt-0" />
            <code className="break-all" data-testid={`step-command-${step.id}`}>{step.command}</code>
          </div>

          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {step.timeout && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Timeout: {Math.round(step.timeout / 1000)}s
              </span>
            )}
            {step.canRollback && step.rollbackCommand && (
              <span className="flex items-center gap-1">
                <Undo2 className="h-3 w-3" />
                Rollback: <code>{step.rollbackCommand}</code>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function hasHighRiskSteps(plan: ExecutionPlan): boolean {
  return plan.totalRisk === 'red' || plan.totalRisk === 'critical' ||
    plan.steps.some((s) => s.riskLevel === 'red' || s.riskLevel === 'critical');
}

function ConfirmDialog({
  open,
  onOpenChange,
  plan,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  plan: ExecutionPlan;
  onConfirm: () => void;
}) {
  const highRiskSteps = plan.steps.filter(
    (s) => s.riskLevel === 'red' || s.riskLevel === 'critical'
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="confirm-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Confirm High-Risk Execution
          </DialogTitle>
          <DialogDescription>
            This plan contains commands that may modify or damage your system.
            Please review the following steps carefully before proceeding.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-60 space-y-2 overflow-y-auto" data-testid="confirm-steps">
          {highRiskSteps.map((step) => {
            const config = RISK_CONFIG[step.riskLevel as keyof typeof RISK_CONFIG];
            return (
              <div
                key={step.id}
                className={cn('rounded border p-2', config.borderColor, config.bgColor)}
                data-testid={`confirm-step-${step.id}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{step.description}</span>
                  <RiskBadge level={step.riskLevel} />
                </div>
                <code className="mt-1 block font-mono text-xs text-muted-foreground">
                  {step.command}
                </code>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => { onOpenChange(false); onConfirm(); }}
            data-testid="confirm-execute-btn"
          >
            <AlertTriangle className="mr-2 h-4 w-4" />
            Confirm Execution
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PlanPreview({
  plan,
  onConfirm,
  onReject,
  isExecuting,
}: PlanPreviewProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const isHighRisk = hasHighRiskSteps(plan);
  const cardBorder = CARD_BORDER_COLORS[plan.totalRisk as RiskLevel] ?? CARD_BORDER_COLORS.green;

  const handleConfirm = () => {
    if (isHighRisk) {
      setShowConfirm(true);
    } else {
      onConfirm();
    }
  };

  return (
    <>
      <Card
        className={cn('mx-2 border-2 sm:mx-4', cardBorder)}
        data-testid="plan-preview"
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-5 w-5" />
              Execution Plan
            </CardTitle>
            <RiskBadge level={plan.totalRisk} />
          </div>
          <p className="text-sm text-muted-foreground">{plan.description}</p>
          {plan.estimatedTime && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              Estimated time: {Math.round(plan.estimatedTime / 1000)}s
            </p>
          )}

          {isHighRisk && (
            <div
              className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300"
              data-testid="risk-warning"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              This plan contains high-risk commands that may modify your system. Review carefully.
            </div>
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2" data-testid="plan-steps">
            {plan.steps.map((step, i) => (
              <StepItem key={step.id} step={step} index={i} />
            ))}
          </div>

          {plan.requiresConfirmation && (
            <div className="flex items-center gap-3 pt-2">
              <Button
                onClick={handleConfirm}
                disabled={isExecuting}
                variant={isHighRisk ? 'destructive' : 'default'}
                className="flex-1"
                data-testid="plan-confirm-btn"
              >
                <Play className="mr-2 h-4 w-4" />
                {isExecuting ? 'Executing...' : 'Execute Plan'}
              </Button>
              <Button
                variant="outline"
                onClick={onReject}
                disabled={isExecuting}
                data-testid="plan-reject-btn"
              >
                <X className="mr-2 h-4 w-4" />
                Reject
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {isHighRisk && (
        <ConfirmDialog
          open={showConfirm}
          onOpenChange={setShowConfirm}
          plan={plan}
          onConfirm={onConfirm}
        />
      )}
    </>
  );
}
