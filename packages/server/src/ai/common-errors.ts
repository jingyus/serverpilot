// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Common error rules library for AI Installer.
 *
 * Provides a comprehensive catalogue of common installation errors across
 * different software and package managers, with predefined fix strategies.
 * This allows fast, offline error resolution without consuming AI tokens.
 *
 * The rule-based approach complements AI-powered diagnosis:
 * 1. First, check if error matches a known pattern in this library
 * 2. If matched with high confidence, return predefined fix strategies
 * 3. If not matched or low confidence, fall back to AI diagnosis
 *
 * Rule data is defined in error-rules-data.ts; this module provides
 * the type definitions and matching functions.
 *
 * @module ai/common-errors
 */

import type { ErrorContext, FixStrategy } from '@aiinstaller/shared';
import type { ErrorType } from './error-analyzer.js';
import { ERROR_RULES } from './error-rules-data.js';

// Re-export ERROR_RULES so existing consumers keep working
export { ERROR_RULES };

// ============================================================================
// Types
// ============================================================================

/**
 * A predefined error pattern with fix strategies.
 *
 * Each rule defines:
 * - A pattern to match against error output
 * - The error type classification
 * - One or more fix strategies with confidence scores
 */
export interface ErrorRule {
  /** Unique identifier for this rule */
  id: string;
  /** Regex pattern to match against stderr/stdout */
  pattern: RegExp;
  /** The error type this rule identifies */
  type: ErrorType;
  /** Human-readable description of the error */
  description: string;
  /** Fix strategies for this error, ordered by confidence (highest first) */
  fixStrategies: FixStrategy[];
  /** Priority of this rule (higher priority rules are checked first) */
  priority: number;
}

/**
 * Result of matching error output against the rule library.
 */
export interface ErrorMatch {
  /** The matched rule */
  rule: ErrorRule;
  /** Confidence score for this match (0.0 - 1.0) */
  confidence: number;
  /** Fix strategies from the rule (already sorted by confidence) */
  fixStrategies: FixStrategy[];
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Match an error context against the common error rules library.
 *
 * Returns all matching rules sorted by priority (highest first), with
 * confidence scores based on pattern match quality.
 *
 * @param errorContext - The error context from a failed step
 * @returns Array of error matches, sorted by priority and confidence
 *
 * @example
 * ```ts
 * const matches = matchCommonErrors(errorContext);
 * if (matches.length > 0) {
 *   const bestMatch = matches[0];
 *   console.log('Matched rule:', bestMatch.rule.description);
 *   console.log('Fix strategies:', bestMatch.fixStrategies);
 * }
 * ```
 */
export function matchCommonErrors(errorContext: ErrorContext): ErrorMatch[] {
  const combined = `${errorContext.stdout}\n${errorContext.stderr}`;
  const matches: ErrorMatch[] = [];

  for (const rule of ERROR_RULES) {
    if (rule.pattern.test(combined)) {
      // Calculate confidence based on pattern specificity
      // More specific patterns (higher priority) get higher confidence
      const baseConfidence = Math.min(rule.priority / 100, 1.0);

      matches.push({
        rule,
        confidence: baseConfidence,
        fixStrategies: rule.fixStrategies,
      });
    }
  }

  // Sort by priority (descending), then by confidence (descending)
  matches.sort((a, b) => {
    if (b.rule.priority !== a.rule.priority) {
      return b.rule.priority - a.rule.priority;
    }
    return b.confidence - a.confidence;
  });

  return matches;
}

/**
 * Get the best matching error rule for the given error context.
 *
 * Returns the highest priority and confidence match, or null if no rules match.
 *
 * @param errorContext - The error context from a failed step
 * @returns The best error match, or null if no match found
 *
 * @example
 * ```ts
 * const match = getBestMatch(errorContext);
 * if (match && match.confidence > 0.7) {
 *   // Use predefined fix strategies instead of AI
 *   return match.fixStrategies;
 * }
 * ```
 */
export function getBestMatch(errorContext: ErrorContext): ErrorMatch | null {
  const matches = matchCommonErrors(errorContext);
  return matches.length > 0 ? matches[0] : null;
}

/**
 * Check if an error should skip AI diagnosis based on rule match confidence.
 *
 * If a high-confidence rule match is found, AI diagnosis can be skipped to
 * save token costs and reduce latency.
 *
 * @param errorContext - The error context from a failed step
 * @param confidenceThreshold - Minimum confidence to skip AI (default: 0.75)
 * @returns True if AI diagnosis can be skipped, false otherwise
 *
 * @example
 * ```ts
 * if (shouldSkipAI(errorContext)) {
 *   // Use predefined fix strategies
 *   const match = getBestMatch(errorContext);
 *   return match.fixStrategies;
 * } else {
 *   // Fall back to AI diagnosis
 *   return await diagnoseWithAI(errorContext);
 * }
 * ```
 */
export function shouldSkipAI(
  errorContext: ErrorContext,
  confidenceThreshold: number = 0.75,
): boolean {
  const match = getBestMatch(errorContext);
  return match !== null && match.confidence >= confidenceThreshold;
}

/**
 * Get all fix strategies from matching rules, deduplicated and sorted by confidence.
 *
 * Combines fix strategies from all matching rules, removes duplicates based on
 * description, and sorts by confidence in descending order.
 *
 * @param errorContext - The error context from a failed step
 * @returns Deduplicated fix strategies sorted by confidence (highest first)
 *
 * @example
 * ```ts
 * const strategies = getAllFixStrategies(errorContext);
 * for (const strategy of strategies) {
 *   console.log(`[${strategy.confidence}] ${strategy.description}`);
 * }
 * ```
 */
export function getAllFixStrategies(errorContext: ErrorContext): FixStrategy[] {
  const matches = matchCommonErrors(errorContext);
  const allStrategies: FixStrategy[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    for (const strategy of match.fixStrategies) {
      // Deduplicate by description
      if (!seen.has(strategy.description)) {
        seen.add(strategy.description);
        allStrategies.push(strategy);
      }
    }
  }

  // Sort by confidence descending
  allStrategies.sort((a, b) => b.confidence - a.confidence);

  return allStrategies;
}

/**
 * Get statistics about the rule library.
 *
 * @returns Statistics about the error rules library
 */
export function getRuleStats(): {
  totalRules: number;
  rulesByType: Record<ErrorType, number>;
  averagePriority: number;
  highPriorityRules: number;
} {
  const rulesByType: Record<string, number> = {};
  let totalPriority = 0;
  let highPriorityCount = 0;

  for (const rule of ERROR_RULES) {
    rulesByType[rule.type] = (rulesByType[rule.type] || 0) + 1;
    totalPriority += rule.priority;
    if (rule.priority >= 80) {
      highPriorityCount++;
    }
  }

  return {
    totalRules: ERROR_RULES.length,
    rulesByType: rulesByType as Record<ErrorType, number>,
    averagePriority: totalPriority / ERROR_RULES.length,
    highPriorityRules: highPriorityCount,
  };
}
