// SPDX-License-Identifier: MIT
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Command classification and audit logic — pure functions.
 *
 * Provides the core classification engine (Layer 1) and parameter audit engine
 * (Layer 2) of the five-layer defense-in-depth security model.
 *
 * This module is stateless — custom rule loading is handled by consumers
 * (e.g. the Agent) that maintain their own mutable state.
 *
 * @module security/classify
 */

import type { PatternRule } from './command-rules.js';
import {
  FORBIDDEN_PATTERNS,
  CRITICAL_PATTERNS,
  GREEN_PATTERNS,
  YELLOW_PATTERNS,
  RED_PATTERNS,
} from './command-rules.js';
import { RiskLevel, type ClassificationResult } from './risk-levels.js';
import type { AuditResult, ProtectedPath } from './param-rules.js';
import { DANGEROUS_PARAMS, PROTECTED_PATHS } from './param-rules.js';

// ============================================================================
// Command Alias Handling
// ============================================================================

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

  if (/^\s*sudo\b/.test(cmd)) {
    cmd = cmd.replace(/^\s*sudo\s+/, '');
    cmd = stripSudoFlags(cmd);
    return cmd.trim();
  }

  if (/^\s*doas\b/.test(cmd)) {
    cmd = cmd.replace(/^\s*doas\s+/, '');
    while (/^-/.test(cmd)) {
      const match = cmd.match(/^-([a-zA-Z]+)\s*/);
      if (match) {
        const flags = match[1];
        cmd = cmd.slice(match[0].length);
        if (flags.includes('u') && cmd.length > 0 && !cmd.startsWith('-')) {
          cmd = cmd.replace(/^\S+\s*/, '');
        }
        continue;
      }
      break;
    }
    return cmd.trim();
  }

  if (/^\s*pkexec\b/.test(cmd)) {
    cmd = cmd.replace(/^\s*pkexec\s+/, '');
    if (/^--user\s/.test(cmd)) {
      cmd = cmd.replace(/^--user\s+\S+\s*/, '');
    }
    return cmd.trim();
  }

  const suMatch = cmd.match(/^\s*su\s+(?:-\s+)?(?:\S+\s+)?-c\s+["'](.+?)["']\s*$/);
  if (suMatch) {
    return suMatch[1].trim();
  }
  const suMatch2 = cmd.match(/^\s*su\s+(?:-\s+)?(?:\S+\s+)?-c\s+(\S+.*)$/);
  if (suMatch2) {
    return suMatch2[1].trim();
  }

  return cmd.trim();
}

// ============================================================================
// Pattern Matching
// ============================================================================

export function matchPatterns(command: string, patterns: PatternRule[]): PatternRule | undefined {
  return patterns.find((rule) => rule.pattern.test(command));
}

/**
 * Get the total count of built-in rules across all levels.
 */
export function getBuiltinRuleCount(): number {
  return FORBIDDEN_PATTERNS.length + CRITICAL_PATTERNS.length
    + GREEN_PATTERNS.length + YELLOW_PATTERNS.length + RED_PATTERNS.length;
}

// ============================================================================
// Classifier — Stateless (no custom rules)
// ============================================================================

/**
 * Options to inject custom rules into classification.
 * Custom rules are checked alongside built-in rules at each priority level.
 */
export interface ClassifyOptions {
  customForbidden?: PatternRule[];
  customCritical?: PatternRule[];
  customGreen?: PatternRule[];
  customYellow?: PatternRule[];
  customRed?: PatternRule[];
}

/**
 * Classify a command string into a risk level.
 *
 * Applies the five-level classification system. Commands are checked against
 * pattern lists in priority order: FORBIDDEN > CRITICAL > GREEN > YELLOW > RED.
 * Custom rules (via options) are checked alongside built-in rules.
 * Unknown commands default to RED (fail-safe).
 */
export function classifyCommand(command: string, options?: ClassifyOptions): ClassificationResult {
  if (!command || command.trim().length === 0) {
    return {
      command,
      riskLevel: RiskLevel.FORBIDDEN,
      reason: 'Empty command is not allowed',
    };
  }

  const normalized = normalizeCommand(command);
  const opts = options ?? {};

  // 1. FORBIDDEN (highest priority)
  const forbidden = matchPatterns(normalized, FORBIDDEN_PATTERNS)
    ?? (opts.customForbidden ? matchPatterns(normalized, opts.customForbidden) : undefined);
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
    ?? (opts.customCritical ? matchPatterns(normalized, opts.customCritical) : undefined);
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
    ?? (opts.customGreen ? matchPatterns(normalized, opts.customGreen) : undefined);
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
    ?? (opts.customYellow ? matchPatterns(normalized, opts.customYellow) : undefined);
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
    ?? (opts.customRed ? matchPatterns(normalized, opts.customRed) : undefined);
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
// Parameter Audit
// ============================================================================

function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += ch;
    } else if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
    } else if (ch === ' ' && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function isFlag(token: string): boolean {
  return token.startsWith('-');
}

function tokenMatchesFlag(token: string, flag: string): boolean {
  if (token === flag) return true;
  if (flag.startsWith('--')) return false;
  if (flag.startsWith('-') && !flag.startsWith('--') && token.startsWith('-') && !token.startsWith('--')) {
    const flagChars = flag.slice(1);
    const tokenChars = token.slice(1);
    return [...flagChars].every((ch) => tokenChars.includes(ch));
  }
  return false;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findProtectedPaths(command: string): ProtectedPath[] {
  const matched: ProtectedPath[] = [];
  for (const pp of PROTECTED_PATHS) {
    const pathRegex = new RegExp(`(?:^|\\s|=|:|"|')${escapeRegex(pp.path)}(?:/|\\s|$|"|')`);
    if (pathRegex.test(` ${command} `)) {
      matched.push(pp);
    }
  }
  return matched;
}

const DESTRUCTIVE_OPS = /\b(rm|rmdir|shred|truncate|unlink)\b/i;
const DESTRUCTIVE_SQL_OPS = /\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i;
const MOVE_OPS = /\b(mv)\b/;

/**
 * Audit a command for dangerous parameters and protected path access.
 */
export function auditCommand(command: string): AuditResult {
  const result: AuditResult = { safe: true, warnings: [], blockers: [] };

  if (!command || command.trim().length === 0) {
    return result;
  }

  const normalized = normalizeCommand(command);
  const tokens = tokenize(normalized);

  // 1. Check dangerous parameters
  for (const dp of DANGEROUS_PARAMS) {
    for (const token of tokens) {
      if (isFlag(token) && tokenMatchesFlag(token, dp.flag)) {
        result.warnings.push(`包含危险参数: ${dp.flag} (${dp.description})`);
        break;
      }
    }
  }

  // 2. Check protected paths with destructive operations
  const isDestructiveFileOp = DESTRUCTIVE_OPS.test(normalized);
  const isDestructiveSqlOp = DESTRUCTIVE_SQL_OPS.test(normalized);
  const isMoveOp = MOVE_OPS.test(normalized);

  if (isDestructiveFileOp || isDestructiveSqlOp || isMoveOp) {
    const matchedPaths = findProtectedPaths(normalized);
    for (const pp of matchedPaths) {
      result.blockers.push(
        `对保护路径 ${pp.path} (${pp.description}) 的破坏性操作需要额外确认`,
      );
      result.safe = false;
    }
  }

  return result;
}

// ============================================================================
// Audit Helper Functions
// ============================================================================

export function hasDangerousParams(command: string): boolean {
  if (!command || command.trim().length === 0) return false;
  const normalized = normalizeCommand(command);
  const tokens = tokenize(normalized);
  return DANGEROUS_PARAMS.some((dp) =>
    tokens.some((token) => isFlag(token) && tokenMatchesFlag(token, dp.flag)),
  );
}

export function hasProtectedPaths(command: string): boolean {
  if (!command || command.trim().length === 0) return false;
  const normalized = normalizeCommand(command);
  return findProtectedPaths(normalized).length > 0;
}

export function getParamWarnings(command: string): string[] {
  return auditCommand(command).warnings;
}

export function getPathBlockers(command: string): string[] {
  return auditCommand(command).blockers;
}

export function requiresExtraConfirmation(result: AuditResult): boolean {
  return result.warnings.length > 0 || result.blockers.length > 0;
}

export function hasBlockers(result: AuditResult): boolean {
  return result.blockers.length > 0;
}
