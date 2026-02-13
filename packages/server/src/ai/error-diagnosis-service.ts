// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Error Diagnosis Service — auto-diagnose command failures and generate fix suggestions.
 *
 * Integrates the error-analyzer with server profile context to provide
 * environment-aware error diagnosis when plan execution steps fail.
 * Used by the chat route to push diagnosis results via SSE.
 *
 * @module ai/error-diagnosis-service
 */

import type { ErrorContext, EnvironmentInfo, FixStrategy } from '@aiinstaller/shared';
import type { FullServerProfile } from '../core/profile/manager.js';
import type { ServerProfile } from '../db/repositories/server-repository.js';
import { logger } from '../utils/logger.js';
import { diagnoseError, identifyErrorType, type DiagnosisResult } from './error-analyzer.js';
import { InstallAIAgent } from './agent.js';
import type { ErrorDiagnosis } from './agent.js';
import { getActiveProvider } from './providers/provider-factory.js';

// ============================================================================
// Types
// ============================================================================

/** Input for auto-diagnosis when a step fails */
export interface StepFailureInput {
  /** Step ID that failed */
  stepId: string;
  /** The command that failed */
  command: string;
  /** Process exit code */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Server ID */
  serverId: string;
  /** Server profile (if available) for environment-aware diagnosis */
  serverProfile?: FullServerProfile | ServerProfile | null;
  /** Previous step results (for context) */
  previousSteps?: Array<{
    stepId: string;
    success: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
    duration: number;
  }>;
}

/** Result of auto-diagnosis suitable for SSE transmission */
export interface AutoDiagnosisResult {
  /** Whether diagnosis was performed successfully */
  success: boolean;
  /** Error type classification */
  errorType: string;
  /** Root cause analysis */
  rootCause: string;
  /** Detailed explanation */
  explanation: string;
  /** Severity level */
  severity: string;
  /** Suggested fix strategies (sorted by confidence) */
  fixSuggestions: Array<{
    description: string;
    commands: string[];
    confidence: number;
    risk: string;
    requiresSudo: boolean;
  }>;
  /** Whether the diagnosis used the rule library (vs AI) */
  usedRuleLibrary: boolean;
  /** Error message if diagnosis failed */
  error?: string;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Build an EnvironmentInfo from a server profile.
 *
 * Creates a minimal EnvironmentInfo suitable for error diagnosis context
 * from whatever server profile data is available.
 */
export function buildEnvironmentFromProfile(
  profile?: FullServerProfile | ServerProfile | null,
): EnvironmentInfo {
  if (!profile?.osInfo) {
    return createDefaultEnvironment();
  }

  const os = profile.osInfo;

  // Detect package manager from OS platform
  const isDebian = /ubuntu|debian/i.test(os.platform) || /ubuntu|debian/i.test(os.version);
  const isRedHat = /centos|rhel|fedora|rocky|alma/i.test(os.platform) || /centos|rhel|fedora/i.test(os.version);
  const isMac = /darwin|macos/i.test(os.platform);

  const packageManagers: EnvironmentInfo['packageManagers'] = {};
  if (isDebian) packageManagers.apt = 'detected';
  if (isRedHat) packageManagers.yum = 'detected';
  if (isMac) packageManagers.brew = 'detected';

  // Check installed software for node/npm/pnpm
  const software = 'software' in profile ? profile.software : [];
  for (const sw of software) {
    const name = sw.name?.toLowerCase() ?? '';
    const version = sw.version ?? '';
    if (name === 'node' || name === 'nodejs') {
      // Will be used in runtime below
    }
    if (name === 'npm') packageManagers.npm = version || 'detected';
    if (name === 'pnpm') packageManagers.pnpm = version || 'detected';
    if (name === 'yarn') packageManagers.yarn = version || 'detected';
  }

  const nodeVersion = software.find(
    (s) => s.name?.toLowerCase() === 'node' || s.name?.toLowerCase() === 'nodejs',
  )?.version;

  const pythonVersion = software.find(
    (s) => s.name?.toLowerCase() === 'python' || s.name?.toLowerCase() === 'python3',
  )?.version;

  return {
    os: {
      platform: os.platform as 'darwin' | 'linux' | 'win32',
      version: os.version,
      arch: os.arch,
    },
    shell: { type: 'bash', version: '' },
    runtime: {
      node: nodeVersion ?? undefined,
      python: pythonVersion ?? undefined,
    },
    packageManagers,
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/tmp'] },
  };
}

/**
 * Auto-diagnose a step failure.
 *
 * Performs error analysis using:
 * 1. Rule-based pattern matching (fast, offline, no tokens)
 * 2. AI diagnosis fallback (for unrecognized errors)
 *
 * The diagnosis considers the server's environment (OS type, installed software)
 * so fix suggestions are environment-appropriate (e.g., apt vs yum).
 *
 * @param input - Step failure details
 * @returns Auto-diagnosis result for SSE transmission
 */
export async function autoDiagnoseStepFailure(
  input: StepFailureInput,
): Promise<AutoDiagnosisResult> {
  const environment = buildEnvironmentFromProfile(input.serverProfile);

  const errorContext: ErrorContext = {
    stepId: input.stepId,
    command: input.command,
    exitCode: input.exitCode,
    stdout: input.stdout,
    stderr: input.stderr,
    environment,
    previousSteps: input.previousSteps ?? [],
  };

  try {
    // First, try quick rule-based identification
    const errorTypeAnalysis = identifyErrorType(errorContext);

    // Try full diagnosis (rule-based first, then AI fallback)
    const provider = getActiveProvider();
    let diagnosisResult: DiagnosisResult;

    if (provider) {
      const aiAgent = new InstallAIAgent({ provider });
      diagnosisResult = await diagnoseError(errorContext, aiAgent);
    } else {
      // No AI provider — use rule-based only
      diagnosisResult = await diagnoseError(
        errorContext,
        // Create a stub that returns failure to force rule-based path
        { diagnoseError: async () => ({ success: false, error: 'No AI provider' }) } as unknown as InstallAIAgent,
      );
    }

    if (diagnosisResult.success && diagnosisResult.diagnosis) {
      return formatDiagnosisResult(
        diagnosisResult.diagnosis,
        diagnosisResult.fixStrategies ?? [],
        diagnosisResult.usedRuleLibrary ?? false,
      );
    }

    // Diagnosis failed — return basic error type analysis
    return {
      success: true,
      errorType: errorTypeAnalysis.type,
      rootCause: errorTypeAnalysis.summary,
      explanation: `Error detected: ${errorTypeAnalysis.summary}. Matched patterns: ${errorTypeAnalysis.matchedPatterns.join(', ') || 'none'}.`,
      severity: 'medium',
      fixSuggestions: [],
      usedRuleLibrary: true,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      { serverId: input.serverId, stepId: input.stepId, error: errorMsg },
      'Auto-diagnosis failed',
    );

    return {
      success: false,
      errorType: 'unknown',
      rootCause: 'Diagnosis unavailable',
      explanation: `Auto-diagnosis encountered an error: ${errorMsg}`,
      severity: 'medium',
      fixSuggestions: [],
      usedRuleLibrary: false,
      error: errorMsg,
    };
  }
}

// ============================================================================
// Internal
// ============================================================================

function createDefaultEnvironment(): EnvironmentInfo {
  return {
    os: { platform: 'linux', version: 'unknown', arch: 'x64' },
    shell: { type: 'bash', version: '' },
    runtime: {},
    packageManagers: {},
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/tmp'] },
  };
}

function formatDiagnosisResult(
  diagnosis: ErrorDiagnosis,
  fixStrategies: FixStrategy[],
  usedRuleLibrary: boolean,
): AutoDiagnosisResult {
  return {
    success: true,
    errorType: diagnosis.category,
    rootCause: diagnosis.rootCause,
    explanation: diagnosis.explanation,
    severity: diagnosis.severity,
    fixSuggestions: fixStrategies.map((s) => ({
      description: s.description,
      commands: s.commands,
      confidence: s.confidence,
      risk: s.risk ?? 'medium',
      requiresSudo: s.requiresSudo ?? false,
    })),
    usedRuleLibrary,
  };
}
