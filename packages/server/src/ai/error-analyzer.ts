/**
 * Rule-based error analysis module for AI Installer.
 *
 * Provides fast, offline error classification by matching stderr/stdout
 * content against known error signatures. Complements the AI-based
 * diagnosis in agent.ts by offering instant pattern-based identification
 * without requiring an API call.
 *
 * @module ai/error-analyzer
 */

import type { ErrorContext, FixStrategy } from '@aiinstaller/shared';
import type { InstallAIAgent, TokenUsage } from './agent.js';
import type { ErrorDiagnosis } from './agent.js';
import { getBestMatch, shouldSkipAI } from './common-errors.js';

// ============================================================================
// Types
// ============================================================================

/** Known error categories that can be identified */
export type ErrorType =
  | 'network'
  | 'permission'
  | 'dependency'
  | 'version'
  | 'configuration'
  | 'unknown';

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

/** Extracted key information from an error */
export interface ExtractedErrorInfo {
  /** Error codes found (e.g., EACCES, ETIMEDOUT, ERESOLVE) */
  errorCodes: string[];
  /** Missing dependencies identified (e.g., pnpm, node modules) */
  missingDependencies: string[];
  /** Permission issues detected */
  permissionIssues: {
    /** Paths that lack permissions */
    paths: string[];
    /** Whether sudo/admin is likely needed */
    needsSudo: boolean;
  };
  /** Version conflicts detected */
  versionConflicts: {
    /** Package or tool with version issue */
    package: string;
    /** Required version */
    required: string;
    /** Current version (if detected) */
    current?: string;
  }[];
  /** Configuration issues */
  configIssues: {
    /** File with configuration problem */
    file: string;
    /** Issue description */
    issue: string;
  }[];
}

/** Internal error pattern definition */
interface ErrorPattern {
  /** The error type this pattern identifies */
  type: ErrorType;
  /** Regular expression to match against combined output */
  pattern: RegExp;
  /** Human-readable label for this pattern */
  label: string;
  /** Confidence weight for this pattern (0.0 - 1.0) */
  weight: number;
}

// ============================================================================
// Error Patterns
// ============================================================================

/**
 * Ordered list of error patterns to match against.
 *
 * Patterns are checked in order. Multiple patterns may match; the error
 * type with the highest total weighted confidence wins.
 */
const ERROR_PATTERNS: ErrorPattern[] = [
  // ---- Network errors ----
  {
    type: 'network',
    pattern: /ETIMEDOUT/i,
    label: 'connection timeout (ETIMEDOUT)',
    weight: 0.9,
  },
  {
    type: 'network',
    pattern: /ECONNREFUSED/i,
    label: 'connection refused (ECONNREFUSED)',
    weight: 0.9,
  },
  {
    type: 'network',
    pattern: /ECONNRESET/i,
    label: 'connection reset (ECONNRESET)',
    weight: 0.9,
  },
  {
    type: 'network',
    pattern: /ENOTFOUND/i,
    label: 'DNS lookup failed (ENOTFOUND)',
    weight: 0.9,
  },
  {
    type: 'network',
    pattern: /network\s+timeout/i,
    label: 'network timeout',
    weight: 0.85,
  },
  {
    type: 'network',
    pattern: /unable to get local issuer certificate/i,
    label: 'SSL certificate error',
    weight: 0.8,
  },
  {
    type: 'network',
    pattern: /ERR_SOCKET_TIMEOUT/i,
    label: 'socket timeout',
    weight: 0.85,
  },
  {
    type: 'network',
    pattern: /request to .+ failed/i,
    label: 'HTTP request failed',
    weight: 0.7,
  },
  {
    type: 'network',
    pattern: /fetch failed/i,
    label: 'fetch failed',
    weight: 0.7,
  },
  {
    type: 'network',
    pattern: /registry\.npmjs\.org/i,
    label: 'npm registry access issue',
    weight: 0.5,
  },

  // ---- Permission errors ----
  {
    type: 'permission',
    pattern: /EACCES:\s*permission denied/i,
    label: 'permission denied (EACCES)',
    weight: 0.95,
  },
  {
    type: 'permission',
    pattern: /EPERM:\s*operation not permitted/i,
    label: 'operation not permitted (EPERM)',
    weight: 0.95,
  },
  {
    type: 'permission',
    pattern: /permission denied/i,
    label: 'permission denied',
    weight: 0.8,
  },
  {
    type: 'permission',
    pattern: /Run with --force to force/i,
    label: 'needs --force flag',
    weight: 0.6,
  },
  {
    type: 'permission',
    pattern: /ENOTEMPTY/i,
    label: 'directory not empty (ENOTEMPTY)',
    weight: 0.6,
  },
  {
    type: 'permission',
    pattern: /Missing write access/i,
    label: 'missing write access',
    weight: 0.9,
  },

  // ---- Dependency errors ----
  {
    type: 'dependency',
    pattern: /ERESOLVE\s+unable to resolve/i,
    label: 'dependency resolution failed (ERESOLVE)',
    weight: 0.95,
  },
  {
    type: 'dependency',
    pattern: /peer dep/i,
    label: 'peer dependency issue',
    weight: 0.7,
  },
  {
    type: 'dependency',
    pattern: /Could not resolve dependency/i,
    label: 'unresolved dependency',
    weight: 0.9,
  },
  {
    type: 'dependency',
    pattern: /not found:\s*(npm|node|pnpm|yarn)/i,
    label: 'package manager not found',
    weight: 0.85,
  },
  {
    type: 'dependency',
    pattern: /command not found/i,
    label: 'command not found',
    weight: 0.7,
  },
  {
    type: 'dependency',
    pattern: /Cannot find module/i,
    label: 'missing module',
    weight: 0.85,
  },
  {
    type: 'dependency',
    pattern: /404 Not Found.*npm/i,
    label: 'npm package not found (404)',
    weight: 0.85,
  },
  {
    type: 'dependency',
    pattern: /ERR! 404/i,
    label: 'package not found (404)',
    weight: 0.8,
  },
  {
    type: 'dependency',
    pattern: /ENOENT:\s*no such file or directory/i,
    label: 'file or directory not found (ENOENT)',
    weight: 0.6,
  },

  // ---- Version conflicts ----
  {
    type: 'version',
    pattern: /engine .+ is incompatible/i,
    label: 'engine version incompatible',
    weight: 0.95,
  },
  {
    type: 'version',
    pattern: /Unsupported engine/i,
    label: 'unsupported engine version',
    weight: 0.9,
  },
  {
    type: 'version',
    pattern: /requires a peer of .+ but none is installed/i,
    label: 'peer version mismatch',
    weight: 0.8,
  },
  {
    type: 'version',
    pattern: /version .+ not found/i,
    label: 'version not found',
    weight: 0.8,
  },
  {
    type: 'version',
    pattern: /node:\s*v?\d+\.\d+\.\d+.*is not supported/i,
    label: 'Node.js version not supported',
    weight: 0.9,
  },
  {
    type: 'version',
    pattern: /npm WARN notsup/i,
    label: 'unsupported platform/version',
    weight: 0.75,
  },

  // ---- Configuration errors ----
  {
    type: 'configuration',
    pattern: /Invalid configuration/i,
    label: 'invalid configuration',
    weight: 0.9,
  },
  {
    type: 'configuration',
    pattern: /EJSONPARSE/i,
    label: 'JSON parse error (EJSONPARSE)',
    weight: 0.9,
  },
  {
    type: 'configuration',
    pattern: /SyntaxError.*JSON/i,
    label: 'JSON syntax error',
    weight: 0.85,
  },
  {
    type: 'configuration',
    pattern: /\.npmrc/i,
    label: '.npmrc configuration issue',
    weight: 0.6,
  },
  {
    type: 'configuration',
    pattern: /ERR_INVALID_ARG/i,
    label: 'invalid argument',
    weight: 0.7,
  },
  {
    type: 'configuration',
    pattern: /Invalid (option|flag|argument)/i,
    label: 'invalid CLI option',
    weight: 0.75,
  },
  {
    type: 'configuration',
    pattern: /proxy.*config/i,
    label: 'proxy configuration issue',
    weight: 0.6,
  },
];

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
 *
 * @example
 * ```ts
 * const info = analyzeError(errorContext);
 * if (info.missingDependencies.length > 0) {
 *   console.log('Missing:', info.missingDependencies);
 * }
 * if (info.permissionIssues.needsSudo) {
 *   console.log('Try running with sudo');
 * }
 * ```
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
 *
 * @example
 * ```ts
 * const analysis = identifyErrorType(errorContext);
 * if (analysis.type === 'network') {
 *   // suggest mirror or proxy fix
 * }
 * ```
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
  const transientPatterns = [
    /EBUSY/i,
    /EAGAIN/i,
    /resource temporarily unavailable/i,
    /npm ERR! cb\(\) never called/i,
  ];

  return transientPatterns.some((p) => p.test(combined));
}

// ============================================================================
// Internal - Error Information Extractors
// ============================================================================

/**
 * Extract error codes from output (e.g., EACCES, ETIMEDOUT, ERESOLVE).
 */
function extractErrorCodes(output: string): string[] {
  const codes = new Set<string>();

  // Match standard Node.js error codes (EXXX format)
  const nodeErrorPattern = /\b(E[A-Z]{3,})\b/g;
  let match;
  while ((match = nodeErrorPattern.exec(output)) !== null) {
    codes.add(match[1]);
  }

  // Match npm/yarn specific error codes
  const npmErrorPattern = /npm ERR! code ([A-Z_]+)/gi;
  while ((match = npmErrorPattern.exec(output)) !== null) {
    codes.add(match[1]);
  }

  return Array.from(codes);
}

/**
 * Extract missing dependencies from output.
 */
function extractMissingDependencies(output: string): string[] {
  const dependencies = new Set<string>();

  // Pattern: "bash: xxx: command not found"
  const bashCommandNotFoundPattern = /bash:\s+([a-z0-9_-]+):\s+command not found/gi;
  let match;
  while ((match = bashCommandNotFoundPattern.exec(output)) !== null) {
    dependencies.add(match[1]);
  }

  // Pattern: "command not found: xxx" or "not found: xxx"
  const commandNotFoundPattern = /(?:command\s+not\s+found|not\s+found):\s*([a-z0-9_-]+)/gi;
  while ((match = commandNotFoundPattern.exec(output)) !== null) {
    dependencies.add(match[1]);
  }

  // Pattern: "Cannot find module 'xxx'"
  const moduleNotFoundPattern = /Cannot find module ['"]([^'"]+)['"]/gi;
  while ((match = moduleNotFoundPattern.exec(output)) !== null) {
    dependencies.add(match[1]);
  }

  // Pattern: npm 404 errors - extract package name from URL
  const npm404Pattern = /404\s+Not Found[^\n]*?\/([a-z0-9@_-]+)(?:\/|$|\s)/gi;
  while ((match = npm404Pattern.exec(output)) !== null) {
    const pkg = match[1];
    // Filter out common path segments
    if (!['registry', 'api', 'npm', 'https:', 'http:'].includes(pkg)) {
      dependencies.add(pkg);
    }
  }

  // Pattern: "package not found"
  const packageNotFoundPattern = /package\s+['"]?([a-z0-9@/_-]+)['"]?\s+not found/gi;
  while ((match = packageNotFoundPattern.exec(output)) !== null) {
    dependencies.add(match[1]);
  }

  return Array.from(dependencies);
}

/**
 * Extract permission issues from output.
 */
function extractPermissionIssues(
  output: string,
): ExtractedErrorInfo['permissionIssues'] {
  const paths = new Set<string>();
  let needsSudo = false;

  // Pattern: "permission denied" or "EACCES" or "EPERM"
  if (
    /permission denied|EACCES|EPERM|Missing write access/i.test(output)
  ) {
    needsSudo = true;

    // Extract paths from permission errors
    const pathPattern =
      /(?:permission denied|EACCES|EPERM|Missing write access).*?['"]?([/\\][^'":\s]+)['"]?/gi;
    let match;
    while ((match = pathPattern.exec(output)) !== null) {
      paths.add(match[1]);
    }

    // Extract paths from "mkdir" or "write" errors
    const mkdirPattern = /(?:mkdir|write|open).*?['"]([/\\][^'"]+)['"]/gi;
    while ((match = mkdirPattern.exec(output)) !== null) {
      paths.add(match[1]);
    }
  }

  return {
    paths: Array.from(paths),
    needsSudo,
  };
}

/**
 * Extract version conflicts from output.
 */
function extractVersionConflicts(
  output: string,
): ExtractedErrorInfo['versionConflicts'] {
  const conflicts: ExtractedErrorInfo['versionConflicts'] = [];

  // Pattern: "engine is incompatible"
  const enginePattern =
    /engine\s+\{["']?([^"':}]+)["']?:\s*["']?([^"'}]+)["']?\}\s+is incompatible/gi;
  let match;
  while ((match = enginePattern.exec(output)) !== null) {
    conflicts.push({
      package: match[1],
      required: match[2],
    });
  }

  // Pattern: "Unsupported engine"
  const unsupportedPattern =
    /Unsupported engine\s+\{["']?([^"':}]+)["']?:\s*["']?([^"'}]+)["']?\}/gi;
  while ((match = unsupportedPattern.exec(output)) !== null) {
    conflicts.push({
      package: match[1],
      required: match[2],
    });
  }

  // Pattern: "requires a peer of X@version but none is installed"
  const peerPattern =
    /requires a peer of\s+([^@\s]+)@["']?([^"'\s]+)["']?\s+but/gi;
  while ((match = peerPattern.exec(output)) !== null) {
    conflicts.push({
      package: match[1],
      required: match[2],
    });
  }

  // Pattern: "node: vX.X.X is not supported"
  const nodeVersionPattern =
    /node:\s*v?(\d+\.\d+\.\d+).*?is not supported/gi;
  while ((match = nodeVersionPattern.exec(output)) !== null) {
    conflicts.push({
      package: 'node',
      current: match[1],
      required: 'unknown',
    });
  }

  return conflicts;
}

/**
 * Extract configuration issues from output.
 */
function extractConfigIssues(
  output: string,
): ExtractedErrorInfo['configIssues'] {
  const issues: ExtractedErrorInfo['configIssues'] = [];

  // Pattern: "Invalid configuration in <file>"
  const invalidConfigPattern =
    /Invalid configuration in\s+([^\s:]+)/gi;
  let match;
  while ((match = invalidConfigPattern.exec(output)) !== null) {
    issues.push({
      file: match[1],
      issue: 'Invalid configuration',
    });
  }

  // Pattern: "EJSONPARSE" - extract file from subsequent lines
  if (/EJSONPARSE/i.test(output)) {
    const fileMatch = /file\s+([/\\][^\s]+\.json)/i.exec(output);
    issues.push({
      file: fileMatch ? fileMatch[1] : 'unknown.json',
      issue: 'JSON parse error',
    });
  }

  // Pattern: "SyntaxError" in JSON
  if (/SyntaxError.*JSON/i.test(output)) {
    const fileMatch = /in\s+([^\s:]+\.json)/i.exec(output);
    issues.push({
      file: fileMatch ? fileMatch[1] : 'unknown.json',
      issue: 'JSON syntax error',
    });
  }

  // Pattern: ".npmrc" configuration issue
  if (/\.npmrc/i.test(output)) {
    issues.push({
      file: '.npmrc',
      issue: 'npm configuration problem',
    });
  }

  // Pattern: "Invalid option/flag/argument"
  const invalidArgPattern = /Invalid (option|flag|argument)[:\s]+([^\s]+)/gi;
  while ((match = invalidArgPattern.exec(output)) !== null) {
    issues.push({
      file: 'command line',
      issue: `Invalid ${match[1]}: ${match[2]}`,
    });
  }

  return issues;
}

// ============================================================================
// Internal
// ============================================================================

/** Match the combined output against all patterns, returning hits. */
function matchPatterns(combined: string): ErrorPattern[] {
  return ERROR_PATTERNS.filter((p) => p.pattern.test(combined));
}

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
 * This approach saves AI token costs for common errors while still providing
 * deep analysis for novel or complex errors.
 *
 * @param errorContext - The error context from a failed step
 * @param aiAgent - The AI agent instance for making diagnosis calls
 * @param streamCallback - Optional callback for streaming AI responses
 * @returns Diagnosis result with fix strategies (from rules or AI, sorted by confidence)
 *
 * @example
 * ```ts
 * const result = await diagnoseError(errorContext, aiAgent, (token) => {
 *   console.log('AI thinking:', token);
 * });
 *
 * if (result.success) {
 *   if (result.usedRuleLibrary) {
 *     console.log('Matched known error pattern');
 *   } else {
 *     console.log('AI diagnosis:', result.diagnosis?.rootCause);
 *   }
 *   console.log('Fix strategies:', result.fixStrategies);
 *   // fixStrategies[0] has the highest confidence
 * }
 * ```
 */
export async function diagnoseError(
  errorContext: ErrorContext,
  aiAgent: InstallAIAgent,
  streamCallback?: (token: string) => void,
): Promise<DiagnosisResult> {
  try {
    // First, perform quick rule-based analysis
    const extractedInfo = analyzeError(errorContext);
    const errorTypeAnalysis = identifyErrorType(errorContext);

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
