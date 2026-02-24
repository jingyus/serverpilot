// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useEffect, useState, useMemo } from "react";
import { AlertTriangle, Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { RISK_CONFIG } from "@/types/chat";
import type { AgenticConfirm } from "@/stores/chat";

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

interface AgenticConfirmBarProps {
  confirm: AgenticConfirm;
  onApprove: () => void;
  onReject: () => void;
}

/** Timeout (ms) to wait for confirmId before showing an error */
const CONFIRM_ID_TIMEOUT_MS = 5000;

export function AgenticConfirmBar({
  confirm,
  onApprove,
  onReject,
}: AgenticConfirmBarProps) {
  const risk =
    RISK_CONFIG[confirm.riskLevel as keyof typeof RISK_CONFIG] ??
    RISK_CONFIG.yellow;
  const ready = !!confirm.confirmId;
  const isCritical = confirm.riskLevel === "critical";

  const [timedOut, setTimedOut] = useState(false);
  const [mathAnswer, setMathAnswer] = useState("");

  // Generate a new math challenge for critical commands
  const mathChallenge = useMemo(
    () => (isCritical ? generateMathChallenge() : null),
    [isCritical],
  );

  // Check if math answer is correct
  const isMathCorrect =
    !isCritical ||
    (mathChallenge && parseInt(mathAnswer, 10) === mathChallenge.answer);
  const canApprove = ready && isMathCorrect;

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
        "mx-2 rounded-lg border-2 p-3 sm:mx-4 sm:p-4",
        risk.borderColor,
        risk.bgColor,
      )}
      data-testid="agentic-confirm-bar"
    >
      <div className="flex items-start gap-2 sm:gap-3">
        <AlertTriangle className={cn("mt-0.5 h-5 w-5 shrink-0", risk.color)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn("text-sm font-semibold", risk.color)}>
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
            <div
              className="mt-2 text-sm text-red-700"
              data-testid="agentic-confirm-timeout-error"
            >
              Unable to receive confirmation ID from server. Please try again.
            </div>
          )}

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
              onClick={onApprove}
              disabled={!canApprove}
              data-testid="agentic-allow-btn"
              className="gap-1.5"
              title={
                isCritical && !isMathCorrect
                  ? "Please answer the math question correctly"
                  : ""
              }
            >
              <Check className="h-3.5 w-3.5" />
              {!ready
                ? "Waiting..."
                : isCritical && !isMathCorrect
                  ? "Answer Required"
                  : "Allow"}
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
