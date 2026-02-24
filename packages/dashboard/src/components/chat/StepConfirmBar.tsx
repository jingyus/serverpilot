// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useState, useEffect, useRef, useMemo } from "react";
import { ShieldAlert, Check, CheckCheck, X, Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { RISK_CONFIG } from "@/types/chat";
import type { PendingConfirm } from "@/stores/chat";

/** Generate a simple math challenge (addition or subtraction) */
function generateMathChallenge(): { question: string; answer: number } {
  const a = Math.floor(Math.random() * 20) + 1; // 1-20
  const b = Math.floor(Math.random() * 20) + 1; // 1-20
  const isAddition = Math.random() > 0.5;

  if (isAddition) {
    return { question: `${a} + ${b}`, answer: a + b };
  } else {
    // For subtraction, ensure result is positive
    const larger = Math.max(a, b);
    const smaller = Math.min(a, b);
    return { question: `${larger} - ${smaller}`, answer: larger - smaller };
  }
}

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
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function StepConfirmBar({
  step,
  onAllow,
  onAllowAll,
  onReject,
}: StepConfirmBarProps) {
  const [confirmingAllowAll, setConfirmingAllowAll] = useState(false);
  const [remainingMs, setRemainingMs] = useState(step.timeoutMs ?? 0);
  const [mathAnswer, setMathAnswer] = useState("");
  const mountedAt = useRef(Date.now());
  const risk =
    RISK_CONFIG[step.riskLevel as keyof typeof RISK_CONFIG] ??
    RISK_CONFIG.yellow;
  const isCritical = step.riskLevel === "critical";
  const hasTimeout = (step.timeoutMs ?? 0) > 0;

  // Generate a new math challenge for critical commands
  const mathChallenge = useMemo(
    () => (isCritical ? generateMathChallenge() : null),
    [isCritical],
  );

  // Check if math answer is correct
  const isMathCorrect =
    !isCritical ||
    (mathChallenge && parseInt(mathAnswer, 10) === mathChallenge.answer);

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
        "mx-2 rounded-lg border-2 p-3 sm:mx-4 sm:p-4",
        risk.borderColor,
        risk.bgColor,
      )}
      data-testid="step-confirm-bar"
    >
      <div className="flex items-start gap-2 sm:gap-3">
        <ShieldAlert className={cn("mt-0.5 h-5 w-5 shrink-0", risk.color)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn("text-sm font-semibold", risk.color)}>
              {risk.label}
            </span>
            <span className="text-xs text-muted-foreground">
              {step.description}
            </span>
            {hasTimeout && (
              <span
                className={cn(
                  "ml-auto flex items-center gap-1 text-xs font-medium tabular-nums",
                  remainingMs <= 30_000
                    ? "text-destructive"
                    : "text-muted-foreground",
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

          {isCritical && mathChallenge && (
            <div className="mt-3 rounded-md bg-yellow-50 dark:bg-yellow-900/20 p-3 border border-yellow-200 dark:border-yellow-800">
              <div className="text-sm font-medium text-yellow-900 dark:text-yellow-200 mb-2">
                ⚠️ Critical Command - Math Verification Required
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-yellow-800 dark:text-yellow-300">
                  What is{" "}
                  <span className="font-mono font-bold">
                    {mathChallenge.question}
                  </span>
                  ?
                </span>
                <Input
                  type="number"
                  value={mathAnswer}
                  onChange={(e) => setMathAnswer(e.target.value)}
                  placeholder="Answer"
                  className="w-20 h-8 text-center"
                  data-testid="math-verification-input"
                />
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={onAllow}
              disabled={!isMathCorrect}
              data-testid="step-allow-btn"
              className="gap-1.5"
              title={
                isCritical && !isMathCorrect
                  ? "Please answer the math question correctly"
                  : ""
              }
            >
              <Check className="h-3.5 w-3.5" />
              {isCritical && !isMathCorrect ? "Answer Required" : "Allow"}
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
                disabled={!isMathCorrect}
                data-testid="step-allow-all-confirm-btn"
                className="gap-1.5"
                title={
                  isCritical && !isMathCorrect
                    ? "Please answer the math question correctly"
                    : ""
                }
              >
                <CheckCheck className="h-3.5 w-3.5" />
                {isCritical && !isMathCorrect
                  ? "Answer Required"
                  : "Confirm Allow All (Critical)"}
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
