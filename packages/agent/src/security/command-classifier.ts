// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Command classifier module for ServerPilot Agent.
 *
 * Classifies shell commands into 5 risk levels as part of the
 * first layer of the five-layer defense-in-depth security model.
 *
 * Core classification logic and rules are imported from @aiinstaller/shared.
 * This module adds Agent-specific features: custom rule loading from filesystem.
 *
 * @module security/command-classifier
 */

import { readFileSync } from 'node:fs';
import {
  RiskLevel,
  RiskLevelSchema,
  type ClassificationResult,
  ClassificationResultSchema,
  CustomRuleSchema,
  type CustomRule,
  CustomRulesConfigSchema,
  type CustomRulesConfig,
  requiresConfirmation,
  requiresSnapshot,
  isForbidden,
  compareRiskLevels,
  getExecutionPolicy,
  normalizeCommand,
  classifyCommand as sharedClassifyCommand,
  type ClassifyOptions,
  matchPatterns,
  getBuiltinRuleCount,
  type PatternRule,
} from '@aiinstaller/shared';

// Re-export everything from shared so existing imports still work
export {
  RiskLevel,
  RiskLevelSchema,
  type ClassificationResult,
  ClassificationResultSchema,
  CustomRuleSchema,
  type CustomRule,
  CustomRulesConfigSchema,
  type CustomRulesConfig,
  requiresConfirmation,
  requiresSnapshot,
  isForbidden,
  compareRiskLevels,
  getExecutionPolicy,
  normalizeCommand,
  getBuiltinRuleCount,
  matchPatterns,
};

// ============================================================================
// Mutable rule storage (Agent-specific custom rules)
// ============================================================================

let customForbidden: PatternRule[] = [];
let customCritical: PatternRule[] = [];
let customGreen: PatternRule[] = [];
let customYellow: PatternRule[] = [];
let customRed: PatternRule[] = [];

// ============================================================================
// Classifier with custom rule support
// ============================================================================

/**
 * Classify a command string into a risk level.
 *
 * Applies the five-level classification system. Commands are checked against
 * pattern lists in priority order: FORBIDDEN > CRITICAL > GREEN > YELLOW > RED.
 * Custom rules (from loadCustomRules) are checked alongside built-in rules.
 * Unknown commands default to RED (fail-safe).
 */
export function classifyCommand(command: string): ClassificationResult {
  const options: ClassifyOptions = {
    customForbidden: customForbidden.length > 0 ? customForbidden : undefined,
    customCritical: customCritical.length > 0 ? customCritical : undefined,
    customGreen: customGreen.length > 0 ? customGreen : undefined,
    customYellow: customYellow.length > 0 ? customYellow : undefined,
    customRed: customRed.length > 0 ? customRed : undefined,
  };
  return sharedClassifyCommand(command, options);
}

// ============================================================================
// Custom Rule Loading
// ============================================================================

/**
 * Load custom classification rules from a configuration object.
 * Custom rules are checked alongside built-in rules at each priority level.
 *
 * @param config - Validated custom rules configuration
 * @throws If config contains invalid patterns (bad regex)
 */
export function loadCustomRules(config: CustomRulesConfig): void {
  const parsed = CustomRulesConfigSchema.parse(config);

  customForbidden = [];
  customCritical = [];
  customGreen = [];
  customYellow = [];
  customRed = [];

  for (const rule of parsed.rules) {
    const patternRule: PatternRule = {
      pattern: new RegExp(rule.pattern),
      reason: rule.reason,
    };

    switch (rule.level) {
      case 'forbidden': customForbidden.push(patternRule); break;
      case 'critical': customCritical.push(patternRule); break;
      case 'green': customGreen.push(patternRule); break;
      case 'yellow': customYellow.push(patternRule); break;
      case 'red': customRed.push(patternRule); break;
    }
  }
}

/**
 * Load custom classification rules from a JSON configuration file.
 *
 * @param filePath - Absolute path to the JSON config file
 * @throws If the file cannot be read, parsed, or contains invalid rules
 */
export function loadCustomRulesFromFile(filePath: string): void {
  const content = readFileSync(filePath, 'utf-8');
  const data: unknown = JSON.parse(content);
  const config = CustomRulesConfigSchema.parse(data);
  loadCustomRules(config);
}

/** Clear all custom rules (useful for testing). */
export function clearCustomRules(): void {
  customForbidden = [];
  customCritical = [];
  customGreen = [];
  customYellow = [];
  customRed = [];
}

/** Get count of loaded custom rules. */
export function getCustomRuleCount(): number {
  return customForbidden.length + customCritical.length
    + customGreen.length + customYellow.length + customRed.length;
}
