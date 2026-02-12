// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useState } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { RISK_CONFIG } from '@/types/chat';
import type { AgenticConfirm } from '@/stores/chat';

interface AgenticConfirmBarProps {
  confirm: AgenticConfirm;
  onApprove: () => void;
  onReject: () => void;
}

/** Timeout (ms) to wait for confirmId before showing an error */
const CONFIRM_ID_TIMEOUT_MS = 5000;

export function AgenticConfirmBar({ confirm, onApprove, onReject }: AgenticConfirmBarProps) {
  const risk = RISK_CONFIG[confirm.riskLevel as keyof typeof RISK_CONFIG] ?? RISK_CONFIG.yellow;
  const ready = !!confirm.confirmId;

  const [timedOut, setTimedOut] = useState(false);

  // If confirmId is missing (edge case), start a timeout
  useEffect(() => {
    if (ready) {
      setTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setTimedOut(true), CONFIRM_ID_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  return (
    <div
      className={cn(
        'mx-2 rounded-lg border-2 p-3 sm:mx-4 sm:p-4',
        risk.borderColor,
        risk.bgColor,
      )}
      data-testid="agentic-confirm-bar"
    >
      <div className="flex items-start gap-2 sm:gap-3">
        <AlertTriangle className={cn('mt-0.5 h-5 w-5 shrink-0', risk.color)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn('text-sm font-semibold', risk.color)}>
              {risk.label}
            </span>
            <span className="text-xs text-muted-foreground">
              {confirm.description}
            </span>
          </div>

          <div className="mt-1.5 rounded bg-gray-900 px-2.5 py-1.5 sm:px-3 sm:py-2">
            <code className="font-mono text-xs text-green-400 sm:text-sm">
              $ {confirm.command}
            </code>
          </div>

          {timedOut && (
            <div className="mt-2 text-sm text-red-700" data-testid="agentic-confirm-timeout-error">
              Unable to receive confirmation ID from server. Please try again.
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={onApprove}
              disabled={!ready}
              data-testid="agentic-allow-btn"
              className="gap-1.5"
            >
              <Check className="h-3.5 w-3.5" />
              {ready ? 'Allow' : 'Waiting...'}
            </Button>

            <Button
              size="sm"
              variant="ghost"
              onClick={onReject}
              data-testid="agentic-reject-btn"
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
