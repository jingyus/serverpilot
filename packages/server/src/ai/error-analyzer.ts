// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Rule-based error analysis module for AI Installer.
 *
 * Provides fast, offline error classification by matching stderr/stdout
 * content against known error signatures. Complements the AI-based
 * diagnosis in agent.ts by offering instant pattern-based identification
 * without requiring an API call.
 *
 * Pattern definitions and extraction logic live in ./error-patterns.ts.
 *
 * @module ai/error-analyzer
 */

import type { ErrorContext, FixStrategy } from '@aiinstaller/shared';
import type { InstallAIAgent, TokenUsage } from './agent.js';
import type { ErrorDiagnosis } from './agent.js';
import { getBestMatch, shouldSkipAI } from './common-errors.js';
import {
  matchPatterns,
  extractErrorCodes,
  extractMissingDependencies,
  extractPermissionIssues,
  extractVersionConflicts,
  extractConfigIssues,
  TRANSIENT_PATTERNS,
} from './error-patterns.js';
import type { ErrorType, ExtractedErrorInfo } from './error-patterns.js';

// Re-export types so existing consumers continue to work
export type { ErrorType, ExtractedErrorInfo } from './error-patterns.js';

// ============================================================================
// Types
// ============================================================================

/** Result of error type identification */
export interface ErrorAnalysis {
  /** The identified error type */
  type: ErrorType;
  /** Confidence level (0.0 - 1.0) */
  confidence: number;
  /** Human-readable summary of the identified error */
  summary: string;
  /** Matched patterns that led to this identification */
  matchedPatterns: string[];
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Analyze an error context and extract key information.
 *
 * This function performs deep analysis to extract structured information from
 * error output, including error codes, missing dependencies, permission issues,
 * version conflicts, and configuration problems.
 *
 * @param errorContext - The error context collected from a failed step
 * @returns Extracted error information with structured details
 */
export function analyzeError(errorContext: ErrorContext): ExtractedErrorInfo {
  const combined = `${errorContext.stdout}\n${errorContext.stderr}`;

  return {
    errorCodes: extractErrorCodes(combined),
    missingDependencies: extractMissingDependencies(combined),
    permissionIssues: extractPermissionIssues(combined),
    versionConflicts: extractVersionConflicts(combined),
    configIssues: extractConfigIssues(combined),
  };
}

/**
 * Identify the error type from an ErrorContext using rule-based pattern matching.
 *
 * Scans the stderr and stdout fields for known error signatures,
 * aggregates confidence scores per error type, and returns the
 * best match. Returns type 'unknown' when no pattern matches.
 *
 * @param errorContext - The error context collected from a failed step
 * @returns An ErrorAnalysis with the identified type, confidence, and matched patterns
 */
export function identifyErrorType(errorContext: ErrorContext): ErrorAnalysis {
  const combined = `${errorContext.stdout}\n${errorContext.stderr}`;
  const matches = matchPatterns(combined);

  if (matches.length === 0) {
    return {
      type: 'unknown',
      confidence: 0,
      summary: `Unrecognized error from command "${errorContext.command}" (exit code ${errorContext.exitCode})`,
      matchedPatterns: [],
    };
  }

  // Aggregate confidence per error type
  const scoreMap = new Map<ErrorType, { total: number; labels: string[] }>();

  for (const match of matches) {
    const entry = scoreMap.get(match.type) ?? { total: 0, labels: [] };
    entry.total += match.weight;
    entry.labels.push(match.label);
    scoreMap.set(match.type, entry);
  }

  // Pick the type with highest aggregate score
  let bestType: ErrorType = 'unknown';
  let bestScore = 0;
  let bestLabels: string[] = [];

  for (const [type, { total, labels }] of scoreMap) {
    if (total > bestScore) {
      bestType = type;
      bestScore = total;
      bestLabels = labels;
    }
  }

  // Normalize confidence to [0, 1]
  const confidence = Math.min(bestScore, 1);

  return {
    type: bestType,
    confidence,
    summary: buildSummary(bestType, bestLabels, errorContext),
    matchedPatterns: bestLabels,
  };
}

/**
 * Identify error types from raw stderr/stdout strings.
 *
 * Convenience function when you don't have a full ErrorContext.
 *
 * @param stderr - Standard error output
 * @param stdout - Standard output (optional)
 * @returns The identified error type
 */
export function identifyErrorTypeFromOutput(
  stderr: string,
  stdout: string = '',
): ErrorType {
  const combined = `${stdout}\n${stderr}`;
  const matches = matchPatterns(combined);

  if (matches.length === 0) return 'unknown';

  const scoreMap = new Map<ErrorType, number>();
  for (const match of matches) {
    scoreMap.set(match.type, (scoreMap.get(match.type) ?? 0) + match.weight);
  }

  let bestType: ErrorType = 'unknown';
  let bestScore = 0;
  for (const [type, score] of scoreMap) {
    if (score > bestScore) {
      bestType = type;
      bestScore = score;
    }
  }

  return bestType;
}

/**
 * Check if an error is likely transient and may succeed on retry.
 *
 * Network errors and certain permission errors (busy files) are
 * considered transient.
 *
 * @param errorContext - The error context from a failed step
 * @returns Whether the error is likely transient
 */
export function isTransientError(errorContext: ErrorContext): boolean {
  const analysis = identifyErrorType(errorContext);

  if (analysis.type === 'network') return true;

  // Check for specific transient patterns
  const combined = `${errorContext.stdout}\n${errorContext.stderr}`;
  return TRANSIENT_PATTERNS.some((p) => p.test(combined));
}

// ============================================================================
// Internal
// ============================================================================

/** Build a human-readable summary from the best-match analysis. */
function buildSummary(
  type: ErrorType,
  labels: string[],
  ctx: ErrorContext,
): string {
  const typeLabels: Record<ErrorType, string> = {
    network: 'Network error',
    permission: 'Permission error',
    dependency: 'Dependency error',
    version: 'Version conflict',
    configuration: 'Configuration error',
    unknown: 'Unknown error',
  };

  const prefix = typeLabels[type];
  const details = labels.join(', ');

  return `${prefix} detected in step "${ctx.stepId}": ${details}`;
}

// ============================================================================
// AI-Powered Error Diagnosis
// ============================================================================

/**
 * Result of AI-powered error diagnosis.
 */
export interface DiagnosisResult {
  /** Whether the diagnosis was successful */
  success: boolean;
  /** The AI diagnosis (present when success is true) */
  diagnosis?: ErrorDiagnosis;
  /** Fix strategies suggested by AI or from rule library (present when success is true) */
  fixStrategies?: FixStrategy[];
  /** Error message (present when success is false) */
  error?: string;
  /** Whether the fix strategies came from the rule library (true) or AI (false) */
  usedRuleLibrary?: boolean;
  /** Token usage from AI diagnosis (present if AI was called) */
  usage?: TokenUsage;
}

/**
 * Diagnose an error using AI analysis with streaming support.
 *
 * This function implements a two-tier approach:
 * 1. First, check the common error rules library for known patterns
 * 2. If matched with high confidence (>= 0.75), use predefined fix strategies
 * 3. If not matched or low confidence, fall back to AI diagnosis
 *
 * @param errorContext - The error context from a failed step
 * @param aiAgent - The AI agent instance for making diagnosis calls
 * @param streamCallback - Optional callback for streaming AI responses
 * @returns Diagnosis result with fix strategies (from rules or AI, sorted by confidence)
 */
export async function diagnoseError(
  errorContext: ErrorContext,
  aiAgent: InstallAIAgent,
  streamCallback?: (token: string) => void,
): Promise<DiagnosisResult> {
  try {
    // First, perform quick rule-based analysis
    analyzeError(errorContext);
    identifyErrorType(errorContext);

    // Check common error rules library
    // If matched with high confidence, skip AI call to save tokens
    if (shouldSkipAI(errorContext)) {
      const ruleMatch = getBestMatch(errorContext);
      if (ruleMatch) {
        // Return fix strategies from rule library
        // Create a minimal diagnosis from rule-based analysis
        const ruleDiagnosis: ErrorDiagnosis = {
          rootCause: ruleMatch.rule.description,
          category: ruleMatch.rule.type as 'network' | 'permission' | 'dependency' | 'version' | 'configuration' | 'unknown',
          explanation: ruleMatch.rule.description,
          severity: ruleMatch.rule.priority > 70 ? 'high' : ruleMatch.rule.priority > 40 ? 'medium' : 'low',
          affectedComponent: errorContext.stepId,
          suggestedNextSteps: ruleMatch.fixStrategies.map(s => s.description).slice(0, 3),
          errorType: ruleMatch.rule.type,
          affectedComponents: [errorContext.stepId],
          isPermanent: ruleMatch.rule.type !== 'network', // Network errors are often transient
          requiresManualIntervention: ruleMatch.fixStrategies.some(s => s.requiresSudo),
        };

        return {
          success: true,
          diagnosis: ruleDiagnosis,
          fixStrategies: ruleMatch.fixStrategies,
          usedRuleLibrary: true,
        };
      }
    }

    // Fall back to AI diagnosis for unknown or low-confidence errors
    // Call AI for deep diagnosis with streaming support
    const diagnosisResult = streamCallback
      ? await aiAgent.diagnoseErrorStreaming(errorContext, {
          onToken: streamCallback,
          onStart: () => streamCallback?.(''),
          onComplete: () => {},
        })
      : await aiAgent.diagnoseError(errorContext);

    if (!diagnosisResult.success || !diagnosisResult.data) {
      return {
        success: false,
        error: diagnosisResult.error ?? 'AI diagnosis failed',
        usedRuleLibrary: false,
        usage: diagnosisResult.usage,
      };
    }

    const diagnosis = diagnosisResult.data;
    let totalUsage = diagnosisResult.usage;

    // Get fix suggestions from AI
    const fixResult = streamCallback
      ? await aiAgent.suggestFixesStreaming(errorContext, diagnosis, {
          onToken: streamCallback,
          onStart: () => streamCallback?.(''),
          onComplete: () => {},
        })
      : await aiAgent.suggestFixes(errorContext, diagnosis);

    // Accumulate token usage from both calls
    if (fixResult.usage && totalUsage) {
      totalUsage = {
        inputTokens: totalUsage.inputTokens + fixResult.usage.inputTokens,
        outputTokens: totalUsage.outputTokens + fixResult.usage.outputTokens,
      };
    } else if (fixResult.usage) {
      totalUsage = fixResult.usage;
    }

    if (!fixResult.success || !fixResult.data) {
      // Even if fix suggestions fail, return the diagnosis
      return {
        success: true,
        diagnosis,
        fixStrategies: [],
        usedRuleLibrary: false,
        usage: totalUsage,
      };
    }

    // Sort fix strategies by confidence (descending order)
    // Ensures the most likely fix appears first
    const sortedFixStrategies = [...fixResult.data].sort(
      (a, b) => b.confidence - a.confidence
    );

    return {
      success: true,
      diagnosis,
      fixStrategies: sortedFixStrategies,
      usedRuleLibrary: false,
      usage: totalUsage,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Error diagnosis failed: ${errorMsg}`,
      usedRuleLibrary: false,
    };
  }
}
