// SPDX-License-Identifier: MIT
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Risk level definitions for the five-layer defense-in-depth security model.
 *
 * Risk levels (from safest to most dangerous):
 * - GREEN:     Read-only commands, auto-executed
 * - YELLOW:    Installation commands, require user confirmation
 * - RED:       Modification commands, require confirmation + impact display
 * - CRITICAL:  Destructive commands, require confirmation + password + snapshot
 * - FORBIDDEN: Absolutely prohibited, never executed
 *
 * @module security/risk-levels
 */

import { z } from 'zod';

// ============================================================================
// Risk Level Definition
// ============================================================================

export const RiskLevel = {
  GREEN: 'green',
  YELLOW: 'yellow',
  RED: 'red',
  CRITICAL: 'critical',
  FORBIDDEN: 'forbidden',
} as const;

export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

export const RiskLevelSchema = z.enum(['green', 'yellow', 'red', 'critical', 'forbidden']);

// ============================================================================
// Classification Result
// ============================================================================

export interface ClassificationResult {
  command: string;
  riskLevel: RiskLevel;
  reason: string;
  matchedPattern?: string;
}

export const ClassificationResultSchema = z.object({
  command: z.string(),
  riskLevel: RiskLevelSchema,
  reason: z.string(),
  matchedPattern: z.string().optional(),
});

// ============================================================================
// Custom Rule Schema (for config-file-based rules)
// ============================================================================

export const CustomRuleSchema = z.object({
  pattern: z.string(),
  reason: z.string(),
  level: RiskLevelSchema,
});

export type CustomRule = z.infer<typeof CustomRuleSchema>;

export const CustomRulesConfigSchema = z.object({
  rules: z.array(CustomRuleSchema),
});

export type CustomRulesConfig = z.infer<typeof CustomRulesConfigSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

export function requiresConfirmation(riskLevel: RiskLevel): boolean {
  return riskLevel !== RiskLevel.GREEN;
}

export function requiresSnapshot(riskLevel: RiskLevel): boolean {
  return riskLevel === RiskLevel.CRITICAL;
}

export function isForbidden(riskLevel: RiskLevel): boolean {
  return riskLevel === RiskLevel.FORBIDDEN;
}

export function compareRiskLevels(a: RiskLevel, b: RiskLevel): number {
  const order: Record<RiskLevel, number> = {
    [RiskLevel.GREEN]: 0,
    [RiskLevel.YELLOW]: 1,
    [RiskLevel.RED]: 2,
    [RiskLevel.CRITICAL]: 3,
    [RiskLevel.FORBIDDEN]: 4,
  };
  return order[a] - order[b];
}

export function getExecutionPolicy(riskLevel: RiskLevel): string {
  const policies: Record<RiskLevel, string> = {
    [RiskLevel.GREEN]: 'Auto-execute (read-only)',
    [RiskLevel.YELLOW]: 'Requires user confirmation',
    [RiskLevel.RED]: 'Requires user confirmation + impact display',
    [RiskLevel.CRITICAL]: 'Requires user confirmation + password + pre-execution snapshot',
    [RiskLevel.FORBIDDEN]: 'Absolutely prohibited — will not execute',
  };
  return policies[riskLevel];
}
