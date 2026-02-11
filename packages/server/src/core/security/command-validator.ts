// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Server-side command validator — Layer 1 of the defense-in-depth model.
 *
 * Uses the shared security module to classify AI-generated commands
 * and determine whether they should be executed, require confirmation,
 * or be outright rejected.
 *
 * @module core/security/command-validator
 */

import {
  classifyCommand,
  auditCommand,
  RiskLevel,
  isForbidden,
  requiresConfirmation,
  compareRiskLevels,
  getExecutionPolicy,
  type ClassificationResult,
  type AuditResult,
} from '@aiinstaller/shared';

// ============================================================================
// Types
// ============================================================================

export type ValidationAction = 'allowed' | 'blocked' | 'requires_confirmation';

export interface ValidationResult {
  /** Whether the command can proceed */
  action: ValidationAction;
  /** Classification from the shared security engine */
  classification: ClassificationResult;
  /** Parameter-level audit result */
  audit: AuditResult;
  /** Human-readable execution policy for this risk level */
  policy: string;
  /** Combined reasons for the decision */
  reasons: string[];
}

export interface PlanValidationResult {
  /** Whether the entire plan can proceed */
  action: ValidationAction;
  /** The highest risk level across all steps */
  maxRiskLevel: RiskLevel;
  /** Per-step validation results */
  steps: StepValidationResult[];
  /** Steps that were blocked (FORBIDDEN) */
  blockedSteps: StepValidationResult[];
  /** Steps that need confirmation */
  confirmationSteps: StepValidationResult[];
}

export interface StepValidationResult {
  stepId: string;
  command: string;
  description: string;
  validation: ValidationResult;
}

// ============================================================================
// Validator
// ============================================================================

/**
 * Validate a single command using the shared security classification engine.
 *
 * Performs two-layer security check:
 * 1. Command classification (risk level assignment)
 * 2. Parameter auditing (dangerous flags, protected paths)
 *
 * Returns the appropriate action: allowed, blocked, or requires_confirmation.
 */
export function validateCommand(command: string): ValidationResult {
  const classification = classifyCommand(command);
  const audit = auditCommand(command);
  const policy = getExecutionPolicy(classification.riskLevel);
  const reasons: string[] = [classification.reason];

  // FORBIDDEN → always blocked
  if (isForbidden(classification.riskLevel)) {
    return {
      action: 'blocked',
      classification,
      audit,
      policy,
      reasons: [...reasons, 'Command is absolutely prohibited'],
    };
  }

  // Audit blockers → blocked regardless of risk level
  if (audit.blockers.length > 0) {
    return {
      action: 'blocked',
      classification,
      audit,
      policy,
      reasons: [...reasons, ...audit.blockers],
    };
  }

  // GREEN without warnings → allowed
  if (classification.riskLevel === RiskLevel.GREEN && audit.warnings.length === 0) {
    return {
      action: 'allowed',
      classification,
      audit,
      policy,
      reasons,
    };
  }

  // YELLOW+ or has warnings → requires confirmation
  if (requiresConfirmation(classification.riskLevel) || audit.warnings.length > 0) {
    return {
      action: 'requires_confirmation',
      classification,
      audit,
      policy,
      reasons: [...reasons, ...audit.warnings],
    };
  }

  // Fallback: allowed (GREEN with no issues)
  return {
    action: 'allowed',
    classification,
    audit,
    policy,
    reasons,
  };
}

/**
 * Validate an entire execution plan (multiple steps).
 *
 * If any step is FORBIDDEN, the entire plan is blocked.
 * If any step requires confirmation, the plan requires confirmation.
 */
export function validatePlan(
  steps: Array<{ id: string; command: string; description: string }>,
): PlanValidationResult {
  const stepResults: StepValidationResult[] = steps.map((step) => ({
    stepId: step.id,
    command: step.command,
    description: step.description,
    validation: validateCommand(step.command),
  }));

  const blockedSteps = stepResults.filter((s) => s.validation.action === 'blocked');
  const confirmationSteps = stepResults.filter((s) => s.validation.action === 'requires_confirmation');

  // Determine highest risk level across all steps
  let maxRiskLevel: RiskLevel = RiskLevel.GREEN;
  for (const step of stepResults) {
    if (compareRiskLevels(step.validation.classification.riskLevel, maxRiskLevel) > 0) {
      maxRiskLevel = step.validation.classification.riskLevel;
    }
  }

  // Plan action: blocked if any step blocked, otherwise check confirmations
  let action: ValidationAction = 'allowed';
  if (blockedSteps.length > 0) {
    action = 'blocked';
  } else if (confirmationSteps.length > 0) {
    action = 'requires_confirmation';
  }

  return {
    action,
    maxRiskLevel,
    steps: stepResults,
    blockedSteps,
    confirmationSteps,
  };
}
