// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Command classifier module for ServerPilot Agent.
 *
 * Classifies shell commands into 5 risk levels as part of the
 * first layer of the five-layer defense-in-depth security model.
 *
 * Risk levels (from safest to most dangerous):
 * - GREEN:     Read-only commands, auto-executed
 * - YELLOW:    Installation commands, require user confirmation
 * - RED:       Modification commands, require confirmation + impact display
 * - CRITICAL:  Destructive commands, require confirmation + password + snapshot
 * - FORBIDDEN: Absolutely prohibited, never executed
 *
 * Features:
 * - 750+ built-in pattern rules across 5 risk levels
 * - Regex and wildcard pattern matching
 * - Alias recognition: sudo, doas, su -c, pkexec
 * - Custom rule loading from configuration object or JSON file
 * - Fail-safe: unknown commands default to RED
 *
 * @module security/command-classifier
 */

import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { PatternRule } from './command-rules.js';
import {
  FORBIDDEN_PATTERNS,
  CRITICAL_PATTERNS,
  GREEN_PATTERNS,
  YELLOW_PATTERNS,
  RED_PATTERNS,
} from './command-rules.js';

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
// Mutable rule storage (built-in + custom)
// ============================================================================

let customForbidden: PatternRule[] = [];
let customCritical: PatternRule[] = [];
let customGreen: PatternRule[] = [];
let customYellow: PatternRule[] = [];
let customRed: PatternRule[] = [];

// ============================================================================
// Command Alias Handling
// ============================================================================

/**
 * Privilege escalation prefixes recognized by the classifier.
 * Commands prefixed with these are normalized before classification so that
 * e.g. `doas rm file.txt` is classified the same as `rm file.txt`.
 */
const SUDO_FLAGS_WITH_ARG = new Set([
  'u', 'g', 'C', 'D', 'R', 'T', 'U', 'h', 'p', 'r', 't',
]);

function stripSudoFlags(cmd: string): string {
  while (/^-/.test(cmd)) {
    const longMatch = cmd.match(/^--\S+\s*/);
    if (longMatch) {
      cmd = cmd.slice(longMatch[0].length);
      continue;
    }
    const shortMatch = cmd.match(/^-([a-zA-Z]+)\s*/);
    if (shortMatch) {
      const flags = shortMatch[1];
      cmd = cmd.slice(shortMatch[0].length);
      const lastFlag = flags[flags.length - 1];
      if (SUDO_FLAGS_WITH_ARG.has(lastFlag) && cmd.length > 0 && !cmd.startsWith('-')) {
        cmd = cmd.replace(/^\S+\s*/, '');
      }
      continue;
    }
    break;
  }
  return cmd;
}

/**
 * Normalize a command by stripping privilege-escalation prefixes.
 * Handles: sudo, doas, pkexec, su -c
 */
export function normalizeCommand(raw: string): string {
  let cmd = raw.trim();

  // sudo: sudo [-flags] command
  if (/^\s*sudo\b/.test(cmd)) {
    cmd = cmd.replace(/^\s*sudo\s+/, '');
    cmd = stripSudoFlags(cmd);
    return cmd.trim();
  }

  // doas: doas [-flags] command (OpenBSD privilege escalation)
  if (/^\s*doas\b/.test(cmd)) {
    cmd = cmd.replace(/^\s*doas\s+/, '');
    // doas supports -u user, -s (shell), -n (non-interactive)
    while (/^-/.test(cmd)) {
      const match = cmd.match(/^-([a-zA-Z]+)\s*/);
      if (match) {
        const flags = match[1];
        cmd = cmd.slice(match[0].length);
        // -u takes a user argument
        if (flags.includes('u') && cmd.length > 0 && !cmd.startsWith('-')) {
          cmd = cmd.replace(/^\S+\s*/, '');
        }
        continue;
      }
      break;
    }
    return cmd.trim();
  }

  // pkexec: pkexec [--user user] command (PolicyKit)
  if (/^\s*pkexec\b/.test(cmd)) {
    cmd = cmd.replace(/^\s*pkexec\s+/, '');
    if (/^--user\s/.test(cmd)) {
      cmd = cmd.replace(/^--user\s+\S+\s*/, '');
    }
    return cmd.trim();
  }

  // su -c 'command': run command as another user
  const suMatch = cmd.match(/^\s*su\s+(?:-\s+)?(?:\S+\s+)?-c\s+["'](.+?)["']\s*$/);
  if (suMatch) {
    return suMatch[1].trim();
  }
  // su -c command (without quotes, single-word)
  const suMatch2 = cmd.match(/^\s*su\s+(?:-\s+)?(?:\S+\s+)?-c\s+(\S+.*)$/);
  if (suMatch2) {
    return suMatch2[1].trim();
  }

  return cmd.trim();
}

// ============================================================================
// Classifier Implementation
// ============================================================================

function matchPatterns(command: string, patterns: PatternRule[]): PatternRule | undefined {
  return patterns.find((rule) => rule.pattern.test(command));
}

/**
 * Classify a command string into a risk level.
 *
 * Applies the five-level classification system. Commands are checked against
 * pattern lists in priority order: FORBIDDEN > CRITICAL > GREEN > YELLOW > RED.
 * Custom rules (from loadCustomRules) are checked alongside built-in rules.
 * Unknown commands default to RED (fail-safe).
 */
export function classifyCommand(command: string): ClassificationResult {
  if (!command || command.trim().length === 0) {
    return {
      command,
      riskLevel: RiskLevel.FORBIDDEN,
      reason: 'Empty command is not allowed',
    };
  }

  const normalized = normalizeCommand(command);

  // 1. FORBIDDEN (highest priority)
  const forbidden = matchPatterns(normalized, FORBIDDEN_PATTERNS)
    ?? matchPatterns(normalized, customForbidden);
  if (forbidden) {
    return {
      command,
      riskLevel: RiskLevel.FORBIDDEN,
      reason: forbidden.reason,
      matchedPattern: forbidden.pattern.source,
    };
  }

  // 2. CRITICAL
  const critical = matchPatterns(normalized, CRITICAL_PATTERNS)
    ?? matchPatterns(normalized, customCritical);
  if (critical) {
    return {
      command,
      riskLevel: RiskLevel.CRITICAL,
      reason: critical.reason,
      matchedPattern: critical.pattern.source,
    };
  }

  // 3. GREEN (read-only)
  const green = matchPatterns(normalized, GREEN_PATTERNS)
    ?? matchPatterns(normalized, customGreen);
  if (green) {
    return {
      command,
      riskLevel: RiskLevel.GREEN,
      reason: green.reason,
      matchedPattern: green.pattern.source,
    };
  }

  // 4. YELLOW (installation)
  const yellow = matchPatterns(normalized, YELLOW_PATTERNS)
    ?? matchPatterns(normalized, customYellow);
  if (yellow) {
    return {
      command,
      riskLevel: RiskLevel.YELLOW,
      reason: yellow.reason,
      matchedPattern: yellow.pattern.source,
    };
  }

  // 5. RED (modification)
  const red = matchPatterns(normalized, RED_PATTERNS)
    ?? matchPatterns(normalized, customRed);
  if (red) {
    return {
      command,
      riskLevel: RiskLevel.RED,
      reason: red.reason,
      matchedPattern: red.pattern.source,
    };
  }

  // 6. Default to RED (fail-safe)
  return {
    command,
    riskLevel: RiskLevel.RED,
    reason: 'Unknown command — classified as RED by default (fail-safe)',
  };
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
 * Expected file format:
 * ```json
 * {
 *   "rules": [
 *     { "pattern": "\\bmy-tool\\b", "reason": "Custom tool", "level": "red" }
 *   ]
 * }
 * ```
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

/** Get total count of built-in rules across all levels. */
export function getBuiltinRuleCount(): number {
  return FORBIDDEN_PATTERNS.length + CRITICAL_PATTERNS.length
    + GREEN_PATTERNS.length + YELLOW_PATTERNS.length + RED_PATTERNS.length;
}

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
