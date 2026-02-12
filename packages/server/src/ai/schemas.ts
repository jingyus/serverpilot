// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Zod schemas and types for AI agent responses.
 *
 * Contains the validation schemas for environment analysis,
 * error diagnosis, and the generic AI analysis result wrapper.
 * Extracted from agent.ts to keep each module under 500 lines.
 *
 * @module ai/schemas
 */

import { z } from 'zod';
import type { ProviderStreamCallbacks } from './providers/base.js';

// ============================================================================
// Types
// ============================================================================

/** Streaming callbacks re-exported from provider base for API compatibility */
export type StreamCallbacks = ProviderStreamCallbacks;

/** Configuration options for the InstallAIAgent */
export interface AIAgentOptions {
  /** AI provider instance (preferred — uses ProviderFactory abstraction) */
  provider?: import('./providers/base.js').AIProviderInterface;
  /** Request timeout in milliseconds (default: 60000) */
  timeoutMs?: number;
  /** Maximum retry attempts on failure (default: 2) */
  maxRetries?: number;
  /** Enable fallback to preset templates when AI fails (default: true) */
  enablePresetFallback?: boolean;
  /** Custom retry configuration */
  retryConfig?: import('./fault-tolerance.js').RetryConfig;
}

/** Token usage from AI API response */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Result of an AI analysis operation */
export interface AIAnalysisResult<T> {
  /** Whether the operation succeeded */
  success: boolean;
  /** The parsed result data (present when success is true) */
  data?: T;
  /** Error message (present when success is false) */
  error?: string;
  /** Type of error - used to determine if preset fallback should be used */
  errorType?: 'validation' | 'network' | 'auth' | 'other';
  /** Token usage statistics from the AI API call */
  usage?: TokenUsage;
}

// ============================================================================
// Zod Schemas
// ============================================================================

/** Detected environment capabilities from AI analysis */
export const DetectedCapabilitiesSchema = z.object({
  /** Whether the required runtime (e.g. Node.js) is present */
  hasRequiredRuntime: z.boolean(),
  /** Whether a suitable package manager is available */
  hasPackageManager: z.boolean(),
  /** Whether network access to registries is available */
  hasNetworkAccess: z.boolean(),
  /** Whether the user has sufficient permissions to install */
  hasSufficientPermissions: z.boolean(),
});

export type DetectedCapabilities = z.infer<typeof DetectedCapabilitiesSchema>;

/** Environment analysis result from the AI */
export const EnvironmentAnalysisSchema = z.object({
  /** Summary of the environment assessment */
  summary: z.string(),
  /** Whether the environment is ready for installation */
  ready: z.boolean(),
  /** List of identified issues or warnings */
  issues: z.array(z.string()),
  /** Recommended actions before installation */
  recommendations: z.array(z.string()),
  /** Detected environment capabilities */
  detectedCapabilities: DetectedCapabilitiesSchema,
});

export type EnvironmentAnalysis = z.infer<typeof EnvironmentAnalysisSchema>;

/** Error diagnosis result from the AI */
export const ErrorDiagnosisSchema = z.object({
  /** Root cause description */
  rootCause: z.string(),
  /** Error category */
  category: z.enum(['network', 'permission', 'dependency', 'version', 'configuration', 'unknown']),
  /** Error type (alias for category, used by rule-based analysis) */
  errorType: z.string().optional(),
  /** Detailed explanation */
  explanation: z.string(),
  /** Severity of the error */
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  /** The specific component or tool affected */
  affectedComponent: z.string(),
  /** Multiple affected components (used by rule-based analysis) */
  affectedComponents: z.array(z.string()).optional(),
  /** Whether the error is permanent or transient */
  isPermanent: z.boolean().optional(),
  /** Whether the error requires manual intervention */
  requiresManualIntervention: z.boolean().optional(),
  /** Suggested next steps to resolve the issue (2-3 items) */
  suggestedNextSteps: z.array(z.string()).min(1),
});

export type ErrorDiagnosis = z.infer<typeof ErrorDiagnosisSchema>;
