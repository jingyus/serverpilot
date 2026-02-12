// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useState, useEffect, useRef } from 'react';
import { ShieldAlert, Check, CheckCheck, X, Clock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { RISK_CONFIG } from '@/types/chat';
import type { PendingConfirm } from '@/stores/chat';

interface StepConfirmBarProps {
  step: PendingConfirm;
  onAllow: () => void;
  onAllowAll: () => void;
  onReject: () => void;
}

/** Format remaining milliseconds as "M:SS" */
function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function StepConfirmBar({ step, onAllow, onAllowAll, onReject }: StepConfirmBarProps) {
  const [confirmingAllowAll, setConfirmingAllowAll] = useState(false);
  const [remainingMs, setRemainingMs] = useState(step.timeoutMs ?? 0);
  const mountedAt = useRef(Date.now());
  const risk = RISK_CONFIG[step.riskLevel as keyof typeof RISK_CONFIG] ?? RISK_CONFIG.yellow;
  const isCritical = step.riskLevel === 'critical';
  const hasTimeout = (step.timeoutMs ?? 0) > 0;

  useEffect(() => {
    if (!hasTimeout) return;
    mountedAt.current = Date.now();
    setRemainingMs(step.timeoutMs!);

    const interval = setInterval(() => {
      const elapsed = Date.now() - mountedAt.current;
      const left = Math.max(0, step.timeoutMs! - elapsed);
      setRemainingMs(left);
      if (left <= 0) clearInterval(interval);
    }, 1000);

    return () => clearInterval(interval);
  }, [step.stepId, step.timeoutMs, hasTimeout]);

  return (
    <div
      className={cn(
        'mx-2 rounded-lg border-2 p-3 sm:mx-4 sm:p-4',
        risk.borderColor,
        risk.bgColor,
      )}
      data-testid="step-confirm-bar"
    >
      <div className="flex items-start gap-2 sm:gap-3">
        <ShieldAlert className={cn('mt-0.5 h-5 w-5 shrink-0', risk.color)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn('text-sm font-semibold', risk.color)}>
              {risk.label}
            </span>
            <span className="text-xs text-muted-foreground">
              {step.description}
            </span>
            {hasTimeout && (
              <span
                className={cn(
                  'ml-auto flex items-center gap-1 text-xs font-medium tabular-nums',
                  remainingMs <= 30_000 ? 'text-destructive' : 'text-muted-foreground',
                )}
                data-testid="step-countdown"
              >
                <Clock className="h-3 w-3" />
                {formatCountdown(remainingMs)}
              </span>
            )}
          </div>

          <div className="mt-1.5 rounded bg-gray-900 px-2.5 py-1.5 sm:px-3 sm:py-2">
            <code className="font-mono text-xs text-green-400 sm:text-sm">
              $ {step.command}
            </code>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={onAllow}
              data-testid="step-allow-btn"
              className="gap-1.5"
            >
              <Check className="h-3.5 w-3.5" />
              Allow
            </Button>

            {!confirmingAllowAll ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (isCritical) {
                    setConfirmingAllowAll(true);
                  } else {
                    onAllowAll();
                  }
                }}
                data-testid="step-allow-all-btn"
                className="gap-1.5"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Allow All
              </Button>
            ) : (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  setConfirmingAllowAll(false);
                  onAllowAll();
                }}
                data-testid="step-allow-all-confirm-btn"
                className="gap-1.5"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Confirm Allow All (Critical)
              </Button>
            )}

            <Button
              size="sm"
              variant="ghost"
              onClick={onReject}
              data-testid="step-reject-btn"
              className="gap-1.5 text-destructive hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
              Reject
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
