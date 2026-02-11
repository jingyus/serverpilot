// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * AI Agent for intelligent installation management.
 *
 * Uses the Anthropic Claude API to analyze environments, generate install plans,
 * diagnose errors, and suggest fixes. Provides structured JSON responses
 * parsed and validated with Zod schemas from @aiinstaller/shared.
 *
 * @module ai/agent
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  EnvironmentInfo,
  InstallPlan,
  ErrorContext,
  FixStrategy,
} from '@aiinstaller/shared';
import {
  InstallPlanSchema,
  FixStrategySchema,
} from '@aiinstaller/shared';
import { z } from 'zod';
import { streamAIResponse } from './streaming.js';
import type { StreamCallbacks, StreamResult } from './streaming.js';
import {
  retryWithBackoff,
  fallbackChain,
  getPresetEnvironmentAnalysis,
  getPresetInstallPlan,
  getPresetErrorDiagnosis,
  getPresetFixStrategies,
  DEFAULT_RETRY_CONFIG,
} from './fault-tolerance.js';
import type { RetryConfig } from './fault-tolerance.js';

// ============================================================================
// Types
// ============================================================================

/** Configuration options for the InstallAIAgent */
export interface AIAgentOptions {
  /** Anthropic API key */
  apiKey: string;
  /** Model to use (default: 'claude-sonnet-4-20250514') */
  model?: string;
  /** Request timeout in milliseconds (default: 60000) */
  timeoutMs?: number;
  /** Maximum retry attempts on failure (default: 2) */
  maxRetries?: number;
  /** Enable fallback to preset templates when AI fails (default: true) */
  enablePresetFallback?: boolean;
  /** Custom retry configuration */
  retryConfig?: RetryConfig;
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

// ============================================================================
// InstallAIAgent
// ============================================================================

/**
 * AI-powered agent for intelligent installation assistance.
 *
 * Wraps the Anthropic Claude API to provide structured analysis and
 * recommendations for software installation workflows.
 *
 * @example
 * ```ts
 * const agent = new InstallAIAgent({ apiKey: 'sk-...' });
 * const analysis = await agent.analyzeEnvironment(envInfo, 'openclaw');
 * if (analysis.success && analysis.data?.ready) {
 *   const plan = await agent.generateInstallPlan(envInfo, 'openclaw');
 * }
 * ```
 */
export class InstallAIAgent {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly enablePresetFallback: boolean;
  private readonly retryConfig: RetryConfig;

  constructor(options: AIAgentOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model ?? 'claude-sonnet-4-20250514';
    this.timeoutMs = options.timeoutMs ?? 60000;
    this.maxRetries = options.maxRetries ?? 2;
    this.enablePresetFallback = options.enablePresetFallback ?? true;
    this.retryConfig = options.retryConfig ?? {
      ...DEFAULT_RETRY_CONFIG,
      maxRetries: this.maxRetries,
    };
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Analyze the client's environment for installation readiness.
   *
   * Sends the environment information to the AI model to determine
   * whether the system is ready for installation, identify issues,
   * and provide recommendations.
   *
   * Uses fault-tolerant fallback: AI analysis → preset template fallback.
   *
   * @param environment - The client's environment information
   * @param software - The software to be installed
   * @returns Analysis result with readiness assessment
   */
  async analyzeEnvironment(
    environment: EnvironmentInfo,
    software: string,
  ): Promise<AIAnalysisResult<EnvironmentAnalysis>> {
    const prompt = this.buildEnvAnalysisPrompt(environment, software);

    // Try AI analysis with retry
    const result = await this.callAI<EnvironmentAnalysis>(prompt, EnvironmentAnalysisSchema);

    // If AI fails and preset fallback is enabled, use preset template
    // But don't fall back for validation or auth errors - those indicate bugs or config issues, not transient failures
    if (!result.success && this.enablePresetFallback &&
        result.errorType !== 'auth' && result.errorType !== 'validation') {
      const presetAnalysis = getPresetEnvironmentAnalysis(environment, software);
      return {
        success: true,
        data: presetAnalysis,
        error: `AI analysis failed, using preset template: ${result.error}`,
      };
    }

    return result;
  }

  /**
   * Generate an installation plan based on the environment.
   *
   * Creates a step-by-step installation plan tailored to the client's
   * specific environment, including appropriate commands, timeouts,
   * and error handling strategies.
   *
   * Uses fault-tolerant fallback: AI plan generation → preset template fallback.
   *
   * @param environment - The client's environment information
   * @param software - The software to install
   * @param version - Optional target version
   * @param knowledgeContext - Optional knowledge base context
   * @returns The generated installation plan
   */
  async generateInstallPlan(
    environment: EnvironmentInfo,
    software: string,
    version?: string,
    knowledgeContext?: string,
  ): Promise<AIAnalysisResult<InstallPlan>> {
    const prompt = this.buildInstallPlanPrompt(environment, software, version, knowledgeContext);

    // Try AI plan generation with retry
    const result = await this.callAI<InstallPlan>(prompt, InstallPlanSchema);

    // If AI fails and preset fallback is enabled, use preset template
    // But don't fall back for validation or auth errors - those indicate bugs or config issues, not transient failures
    if (!result.success && this.enablePresetFallback &&
        result.errorType !== 'auth' && result.errorType !== 'validation') {
      const presetPlan = getPresetInstallPlan(environment, software);
      return {
        success: true,
        data: presetPlan,
        error: `AI plan generation failed, using preset template: ${result.error}`,
      };
    }

    return result;
  }

  /**
   * Diagnose an error that occurred during installation.
   *
   * Analyzes the error context including the command, output, environment,
   * and execution history to determine the root cause.
   *
   * Uses fault-tolerant fallback: AI diagnosis → preset diagnosis fallback.
   *
   * @param errorContext - The full error context from the client
   * @returns Diagnosis with root cause and category
   */
  async diagnoseError(
    errorContext: ErrorContext,
  ): Promise<AIAnalysisResult<ErrorDiagnosis>> {
    const prompt = this.buildErrorDiagnosisPrompt(errorContext);

    // Try AI diagnosis with retry
    const result = await this.callAI<ErrorDiagnosis>(prompt, ErrorDiagnosisSchema);

    // If AI fails and preset fallback is enabled, use preset template
    // But don't fall back for validation or auth errors - those indicate bugs or config issues, not transient failures
    if (!result.success && this.enablePresetFallback &&
        result.errorType !== 'auth' && result.errorType !== 'validation') {
      const presetDiagnosis = getPresetErrorDiagnosis(errorContext);
      return {
        success: true,
        data: presetDiagnosis,
        error: `AI diagnosis failed, using preset template: ${result.error}`,
      };
    }

    return result;
  }

  /**
   * Suggest fix strategies for a diagnosed error.
   *
   * Generates multiple fix strategies ranked by confidence,
   * each with specific commands to execute.
   *
   * Uses fault-tolerant fallback: AI fix suggestions → preset fix strategies.
   *
   * @param errorContext - The full error context from the client
   * @param diagnosis - Optional prior diagnosis to inform suggestions
   * @returns Array of fix strategies ordered by confidence
   */
  async suggestFixes(
    errorContext: ErrorContext,
    diagnosis?: ErrorDiagnosis,
  ): Promise<AIAnalysisResult<FixStrategy[]>> {
    const prompt = this.buildFixSuggestionPrompt(errorContext, diagnosis);
    const schema = z.array(FixStrategySchema);

    // Try AI fix suggestions with retry
    const result = await this.callAI<FixStrategy[]>(prompt, schema);

    // If AI fails and preset fallback is enabled, use preset strategies
    // But don't fall back for validation or auth errors - those indicate bugs or config issues, not transient failures
    if (!result.success && this.enablePresetFallback &&
        result.errorType !== 'auth' && result.errorType !== 'validation') {
      const presetStrategies = getPresetFixStrategies(errorContext);
      return {
        success: true,
        data: presetStrategies,
        error: `AI fix suggestions failed, using preset strategies: ${result.error}`,
      };
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // Streaming Public API
  // --------------------------------------------------------------------------

  /**
   * Analyze environment with streaming response.
   *
   * Same as `analyzeEnvironment()` but streams tokens in real-time
   * via the provided callbacks, allowing the UI to show the AI's
   * thinking process as it happens.
   *
   * Uses fault-tolerant fallback: AI analysis → preset template fallback.
   *
   * @param environment - The client's environment information
   * @param software - The software to be installed
   * @param callbacks - Streaming event callbacks
   * @returns Analysis result with readiness assessment
   */
  async analyzeEnvironmentStreaming(
    environment: EnvironmentInfo,
    software: string,
    callbacks?: StreamCallbacks,
  ): Promise<AIAnalysisResult<EnvironmentAnalysis>> {
    const prompt = this.buildEnvAnalysisPrompt(environment, software);

    // Try AI analysis with streaming
    const result = await this.callAIStreaming<EnvironmentAnalysis>(prompt, EnvironmentAnalysisSchema, callbacks);

    // If AI fails and preset fallback is enabled, use preset template
    // But don't fall back for validation or auth errors - those indicate bugs or config issues, not transient failures
    if (!result.success && this.enablePresetFallback &&
        result.errorType !== 'auth' && result.errorType !== 'validation') {
      const presetAnalysis = getPresetEnvironmentAnalysis(environment, software);
      return {
        success: true,
        data: presetAnalysis,
        error: `AI analysis failed, using preset template: ${result.error}`,
      };
    }

    return result;
  }

  /**
   * Generate install plan with streaming response.
   *
   * Same as `generateInstallPlan()` but streams tokens in real-time.
   *
   * Uses fault-tolerant fallback: AI plan generation → preset template fallback.
   *
   * @param environment - The client's environment information
   * @param software - The software to install
   * @param version - Optional target version
   * @param callbacks - Streaming event callbacks
   * @param knowledgeContext - Optional knowledge base context
   * @returns The generated installation plan
   */
  async generateInstallPlanStreaming(
    environment: EnvironmentInfo,
    software: string,
    version?: string,
    callbacks?: StreamCallbacks,
    knowledgeContext?: string,
  ): Promise<AIAnalysisResult<InstallPlan>> {
    const prompt = this.buildInstallPlanPrompt(environment, software, version, knowledgeContext);

    // Try AI plan generation with streaming
    const result = await this.callAIStreaming<InstallPlan>(prompt, InstallPlanSchema, callbacks);

    // If AI fails and preset fallback is enabled, use preset template
    // But don't fall back for validation or auth errors - those indicate bugs or config issues, not transient failures
    if (!result.success && this.enablePresetFallback &&
        result.errorType !== 'auth' && result.errorType !== 'validation') {
      const presetPlan = getPresetInstallPlan(environment, software);
      return {
        success: true,
        data: presetPlan,
        error: `AI plan generation failed, using preset template: ${result.error}`,
      };
    }

    return result;
  }

  /**
   * Diagnose error with streaming response.
   *
   * Same as `diagnoseError()` but streams tokens in real-time.
   *
   * Uses fault-tolerant fallback: AI diagnosis → preset diagnosis fallback.
   *
   * @param errorContext - The full error context from the client
   * @param callbacks - Streaming event callbacks
   * @returns Diagnosis with root cause and category
   */
  async diagnoseErrorStreaming(
    errorContext: ErrorContext,
    callbacks?: StreamCallbacks,
  ): Promise<AIAnalysisResult<ErrorDiagnosis>> {
    const prompt = this.buildErrorDiagnosisPrompt(errorContext);

    // Try AI diagnosis with streaming
    const result = await this.callAIStreaming<ErrorDiagnosis>(prompt, ErrorDiagnosisSchema, callbacks);

    // If AI fails and preset fallback is enabled, use preset template
    // But don't fall back for validation or auth errors - those indicate bugs or config issues, not transient failures
    if (!result.success && this.enablePresetFallback &&
        result.errorType !== 'auth' && result.errorType !== 'validation') {
      const presetDiagnosis = getPresetErrorDiagnosis(errorContext);
      return {
        success: true,
        data: presetDiagnosis,
        error: `AI diagnosis failed, using preset template: ${result.error}`,
      };
    }

    return result;
  }

  /**
   * Suggest fixes with streaming response.
   *
   * Same as `suggestFixes()` but streams tokens in real-time.
   *
   * Uses fault-tolerant fallback: AI fix suggestions → preset fix strategies.
   *
   * @param errorContext - The full error context from the client
   * @param diagnosis - Optional prior diagnosis to inform suggestions
   * @param callbacks - Streaming event callbacks
   * @returns Array of fix strategies ordered by confidence
   */
  async suggestFixesStreaming(
    errorContext: ErrorContext,
    diagnosis?: ErrorDiagnosis,
    callbacks?: StreamCallbacks,
  ): Promise<AIAnalysisResult<FixStrategy[]>> {
    const prompt = this.buildFixSuggestionPrompt(errorContext, diagnosis);
    const schema = z.array(FixStrategySchema);

    // Try AI fix suggestions with streaming
    const result = await this.callAIStreaming<FixStrategy[]>(prompt, schema, callbacks);

    // If AI fails and preset fallback is enabled, use preset strategies
    // But don't fall back for validation or auth errors - those indicate bugs or config issues, not transient failures
    if (!result.success && this.enablePresetFallback &&
        result.errorType !== 'auth' && result.errorType !== 'validation') {
      const presetStrategies = getPresetFixStrategies(errorContext);
      return {
        success: true,
        data: presetStrategies,
        error: `AI fix suggestions failed, using preset strategies: ${result.error}`,
      };
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // AI Communication
  // --------------------------------------------------------------------------

  /**
   * Send a prompt to the AI and parse the JSON response.
   *
   * Uses exponential backoff retry for transient errors.
   *
   * @param prompt - The user prompt to send
   * @param schema - Zod schema to validate the response
   * @returns Parsed and validated result
   */
  private async callAI<T>(
    prompt: string,
    schema: z.ZodType<T>,
  ): Promise<AIAnalysisResult<T>> {
    // Track error type from shouldRetry callback — more reliable than post-hoc string matching
    let detectedErrorType: 'validation' | 'auth' | undefined;
    let usage: TokenUsage | undefined;

    const result = await retryWithBackoff(
      async () => {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
          system: 'You are a software installation expert. Always respond with valid JSON only. No markdown, no code fences, no extra text.',
        }, {
          timeout: this.timeoutMs,
        });

        // Extract token usage from response
        usage = {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
        };

        const text = this.extractTextFromResponse(response);
        const parsed = this.parseJSON(text);
        const validated = schema.parse(parsed);

        return validated;
      },
      this.retryConfig,
      (error) => {
        // Don't retry on validation errors (response format won't change)
        // Check for Zod errors by checking for 'issues' property which is Zod-specific
        const isZodError = error.constructor.name === 'ZodError' ||
                          (error && typeof error === 'object' && 'issues' in error);
        const isSyntaxError = error.constructor.name === 'SyntaxError' ||
                             error.name === 'SyntaxError' ||
                             error.message.includes('JSON') ||
                             error.message.includes('Unexpected token');

        if (isZodError || isSyntaxError ||
            error.message.includes('validation') ||
            error.message.includes('No text content')) {
          detectedErrorType = 'validation';
          return false;
        }
        // Don't retry on auth errors
        if (error.message.includes('authentication') || error.message.includes('401')) {
          detectedErrorType = 'auth';
          return false;
        }
        // Retry on other errors (network, rate limit, timeout, etc.)
        return true;
      },
    );

    if (result.success && result.data) {
      return { success: true, data: result.data, usage };
    }

    // Use error type captured in shouldRetry when available (most reliable),
    // fall back to classifying from the error message string
    const errorType = detectedErrorType ?? this.classifyErrorMessage(result.error ?? '');

    return { success: false, error: result.error, errorType, usage };
  }

  /**
   * Send a prompt to the AI with streaming and parse the JSON response.
   *
   * Uses the streaming API for real-time token delivery while still
   * parsing and validating the final response as JSON.
   * Uses exponential backoff retry for transient errors.
   *
   * @param prompt - The user prompt to send
   * @param schema - Zod schema to validate the response
   * @param callbacks - Optional streaming callbacks
   * @returns Parsed and validated result
   */
  private async callAIStreaming<T>(
    prompt: string,
    schema: z.ZodType<T>,
    callbacks?: StreamCallbacks,
  ): Promise<AIAnalysisResult<T>> {
    let callbacksUsed = false;
    // Track error type from shouldRetry callback
    let detectedErrorType: 'validation' | 'auth' | undefined;
    let usage: TokenUsage | undefined;

    const retryResult = await retryWithBackoff(
      async () => {
        const result = await streamAIResponse({
          client: this.client,
          model: this.model,
          maxTokens: 4096,
          prompt,
          system: 'You are a software installation expert. Always respond with valid JSON only. No markdown, no code fences, no extra text.',
          timeoutMs: this.timeoutMs,
          callbacks: !callbacksUsed ? callbacks : undefined, // Only stream on first attempt
        });

        callbacksUsed = true;

        // Extract token usage from streaming result
        usage = {
          inputTokens: result.usage?.inputTokens ?? 0,
          outputTokens: result.usage?.outputTokens ?? 0,
        };

        if (!result.success) {
          throw new Error(result.error ?? 'Streaming request failed');
        }

        const parsed = this.parseJSON(result.text);
        const validated = schema.parse(parsed);

        return validated;
      },
      this.retryConfig,
      (error) => {
        // Don't retry on validation errors
        if (error.constructor.name === 'ZodError' ||
            error.constructor.name === 'SyntaxError' ||
            error.message.includes('validation') ||
            error.message.includes('No text content')) {
          detectedErrorType = 'validation';
          return false;
        }
        // Don't retry on auth errors
        if (error.message.includes('authentication') || error.message.includes('401')) {
          detectedErrorType = 'auth';
          return false;
        }
        // Retry on other errors
        return true;
      },
    );

    if (retryResult.success && retryResult.data) {
      return { success: true, data: retryResult.data, usage };
    }

    // Use error type captured in shouldRetry when available,
    // fall back to classifying from the error message string
    const errorType = detectedErrorType ?? this.classifyErrorMessage(retryResult.error ?? '');

    return { success: false, error: retryResult.error, errorType, usage };
  }

  /**
   * Extract text content from an Anthropic API response.
   */
  private extractTextFromResponse(response: Anthropic.Message): string {
    for (const block of response.content) {
      if (block.type === 'text') {
        return block.text;
      }
    }
    throw new Error('No text content in AI response');
  }

  /**
   * Parse a JSON string, stripping markdown code fences if present.
   */
  private parseJSON(text: string): unknown {
    // Strip markdown code fences if the model wraps the response
    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    return JSON.parse(cleaned);
  }

  // --------------------------------------------------------------------------
  // Prompt Builders
  // --------------------------------------------------------------------------

  /**
   * Build the prompt for environment analysis.
   */
  private buildEnvAnalysisPrompt(environment: EnvironmentInfo, software: string): string {
    return `Analyze this environment for installing "${software}".

Environment:
- OS: ${environment.os.platform} ${environment.os.version} (${environment.os.arch})
- Shell: ${environment.shell.type} ${environment.shell.version}
- Node.js: ${environment.runtime.node ?? 'not installed'}
- Python: ${environment.runtime.python ?? 'not installed'}
- Package Managers: ${this.formatPackageManagers(environment.packageManagers)}
- Network: npm=${environment.network.canAccessNpm}, github=${environment.network.canAccessGithub}
- Permissions: sudo=${environment.permissions.hasSudo}, writable=${environment.permissions.canWriteTo.join(', ')}

Respond with a JSON object:
{
  "summary": "Brief assessment of the environment",
  "issues": ["List of issues or warnings"],
  "ready": true/false,
  "recommendations": ["Actions to take before installation"]
}`;
  }

  /**
   * Build the prompt for install plan generation.
   */
  private buildInstallPlanPrompt(
    environment: EnvironmentInfo,
    software: string,
    version?: string,
    knowledgeContext?: string,
  ): string {
    const versionStr = version ? ` version ${version}` : '';

    const knowledgeSection = knowledgeContext
      ? `\n\nKnowledge Base Context:\n${knowledgeContext}\n\nUse the knowledge base information above to inform your installation plan. Follow documented installation procedures and best practices.\n`
      : '';

    return `Generate an installation plan for "${software}"${versionStr}.

Environment:
- OS: ${environment.os.platform} ${environment.os.version} (${environment.os.arch})
- Shell: ${environment.shell.type} ${environment.shell.version}
- Node.js: ${environment.runtime.node ?? 'not installed'}
- Python: ${environment.runtime.python ?? 'not installed'}
- Package Managers: ${this.formatPackageManagers(environment.packageManagers)}
- Network: npm=${environment.network.canAccessNpm}, github=${environment.network.canAccessGithub}
- Permissions: sudo=${environment.permissions.hasSudo}, writable=${environment.permissions.canWriteTo.join(', ')}${knowledgeSection}

Respond with a JSON object matching this schema:
{
  "steps": [
    {
      "id": "step-id",
      "description": "What this step does",
      "command": "command to execute",
      "expectedOutput": "optional expected output pattern",
      "timeout": 60000,
      "canRollback": true/false,
      "onError": "retry" | "skip" | "abort" | "fallback"
    }
  ],
  "estimatedTime": 120000,
  "risks": [
    { "level": "low" | "medium" | "high", "description": "Risk description" }
  ]
}

Include prerequisite checks, installation steps, and verification.
Use appropriate commands for the detected OS and package managers.`;
  }

  /**
   * Build the prompt for error diagnosis.
   */
  private buildErrorDiagnosisPrompt(errorContext: ErrorContext): string {
    const prevStepsSummary = errorContext.previousSteps
      .map((s) => `  - ${s.stepId}: ${s.success ? 'OK' : 'FAILED'} (exit ${s.exitCode})`)
      .join('\n');

    return `You are a software installation diagnostician. A user encountered an error while installing software.

Failed Command: ${errorContext.command}
Exit Code: ${errorContext.exitCode}
Stdout: ${errorContext.stdout || '(empty)'}
Stderr: ${errorContext.stderr || '(empty)'}
Step ID: ${errorContext.stepId}

Environment:
- OS: ${errorContext.environment.os.platform} ${errorContext.environment.os.version} (${errorContext.environment.os.arch})
- Shell: ${errorContext.environment.shell.type} ${errorContext.environment.shell.version}
- Node.js: ${errorContext.environment.runtime.node ?? 'not installed'}
- Python: ${errorContext.environment.runtime.python ?? 'not installed'}
- Package Managers: ${this.formatPackageManagers(errorContext.environment.packageManagers)}
- Network: npm=${errorContext.environment.network.canAccessNpm}, github=${errorContext.environment.network.canAccessGithub}
- Permissions: sudo=${errorContext.environment.permissions.hasSudo}, writable=${errorContext.environment.permissions.canWriteTo.join(', ')}

Previous Steps:
${prevStepsSummary || '  (none)'}

Please perform a systematic diagnosis covering:
1. Root cause analysis – what exactly went wrong and why?
2. Error categorization – classify the error by its nature (network, permission, dependency, version, configuration, or unknown).
3. Severity assessment – how critical is this failure? Can the installation proceed with a workaround, or is it a complete blocker?
4. Affected component – which part of the system or toolchain is involved (e.g., package manager, runtime, OS, network)?
5. Suggested next steps – provide 2-3 concrete actions the user should take to resolve the issue, ordered by likelihood of success.

Respond with a JSON object:
{
  "rootCause": "Brief description of the root cause",
  "category": "network" | "permission" | "dependency" | "version" | "configuration" | "unknown",
  "explanation": "Detailed explanation of why this error occurred",
  "severity": "low" | "medium" | "high" | "critical",
  "affectedComponent": "The specific component or tool that is affected",
  "suggestedNextSteps": [
    "First action to try (highest likelihood of success)",
    "Second action to try",
    "Third action to try (if applicable)"
  ]
}`;
  }

  /**
   * Build the prompt for fix suggestions.
   */
  private buildFixSuggestionPrompt(
    errorContext: ErrorContext,
    diagnosis?: ErrorDiagnosis,
  ): string {
    const diagnosisInfo = diagnosis
      ? `\nDiagnosis:\n- Root Cause: ${diagnosis.rootCause}\n- Category: ${diagnosis.category}\n- Explanation: ${diagnosis.explanation}\n- Severity: ${diagnosis.severity}\n- Affected Component: ${diagnosis.affectedComponent}`
      : '';

    return `You are a software installation recovery specialist. A user encountered an error during software installation and needs actionable fix strategies.

Failed Command: ${errorContext.command}
Exit Code: ${errorContext.exitCode}
Stderr: ${errorContext.stderr || '(empty)'}

Environment:
- OS: ${errorContext.environment.os.platform} ${errorContext.environment.os.version} (${errorContext.environment.os.arch})
- Shell: ${errorContext.environment.shell.type} ${errorContext.environment.shell.version}
- Node.js: ${errorContext.environment.runtime.node ?? 'not installed'}
- Python: ${errorContext.environment.runtime.python ?? 'not installed'}
- Package Managers: ${this.formatPackageManagers(errorContext.environment.packageManagers)}
- Network: npm=${errorContext.environment.network.canAccessNpm}, github=${errorContext.environment.network.canAccessGithub}
- Permissions: sudo=${errorContext.environment.permissions.hasSudo}, writable=${errorContext.environment.permissions.canWriteTo.join(', ')}
${diagnosisInfo}

Please generate 2-3 fix strategies following these guidelines:
1. Prioritization – order strategies by confidence (highest first). The most likely fix should come first.
2. Specificity – each strategy must contain concrete, executable commands appropriate for the detected OS and environment.
3. Safety – prefer non-destructive fixes (e.g., changing config over reinstalling). Flag any strategy that requires elevated permissions or modifies system-level settings.
4. Feasibility – only suggest commands that are realistic given the user's environment (available package managers, permissions, network access).

Respond with a JSON array of fix strategies:
[
  {
    "id": "short-kebab-case-identifier",
    "description": "Clear, concise explanation of what this fix does and why it should work",
    "commands": ["command1", "command2"],
    "confidence": 0.0-1.0,
    "risk": "low" | "medium" | "high",
    "requiresSudo": true | false
  }
]

Rules:
- confidence must be between 0.0 and 1.0 (inclusive), reflecting the estimated probability of success.
- id must be a unique, descriptive kebab-case string (e.g., "use-sudo", "switch-registry", "install-missing-dep").
- commands must be an array of one or more shell commands to execute sequentially.
- risk indicates the potential for unintended side effects (low = safe, medium = minor side effects possible, high = system-level changes).
- requiresSudo indicates whether any command in the strategy needs elevated privileges.`;
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /**
   * Classify error type from an error message string.
   * Used as fallback when error type was not captured during retry.
   */
  private classifyErrorMessage(errorMsg: string): 'validation' | 'network' | 'auth' | 'other' {
    const msg = errorMsg.toLowerCase();

    if (msg.includes('json') || msg.includes('validation') ||
        msg.includes('zoderror') || msg.includes('expected') ||
        msg.includes('invalid') || msg.includes('no text content') ||
        msg.includes('content blocks') || msg.includes('parse') ||
        msg.includes('schema') || msg.includes('unexpected token') ||
        msg.includes('invalid_type') || msg.includes('required')) {
      return 'validation';
    }

    if (msg.includes('authentication') || msg.includes('401') ||
        msg.includes('unauthorized') || msg.includes('api key')) {
      return 'auth';
    }

    if (msg.includes('network') || msg.includes('timeout') ||
        msg.includes('econnrefused') || msg.includes('connection') ||
        msg.includes('etimedout') || msg.includes('fetch failed') ||
        msg.includes('dropped') || msg.includes('enotfound') ||
        msg.includes('stream') || msg.includes('request failed')) {
      return 'network';
    }

    return 'other';
  }

  /**
   * Format package managers for display in prompts.
   */
  private formatPackageManagers(
    pm: EnvironmentInfo['packageManagers'],
  ): string {
    const parts: string[] = [];
    if (pm.npm) parts.push(`npm@${pm.npm}`);
    if (pm.pnpm) parts.push(`pnpm@${pm.pnpm}`);
    if (pm.yarn) parts.push(`yarn@${pm.yarn}`);
    if (pm.brew) parts.push(`brew@${pm.brew}`);
    if (pm.apt) parts.push(`apt@${pm.apt}`);
    return parts.length > 0 ? parts.join(', ') : 'none detected';
  }
}
