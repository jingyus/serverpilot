// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * AI Agent for intelligent installation management.
 *
 * Uses the AIProviderInterface abstraction to analyze environments, generate
 * install plans, diagnose errors, and suggest fixes. Supports all configured
 * providers (Claude, OpenAI, DeepSeek, Ollama, custom-openai) via the
 * ProviderFactory. Provides structured JSON responses parsed and validated
 * with Zod schemas from @aiinstaller/shared.
 *
 * @module ai/agent
 */

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
import type { AIProviderInterface } from './providers/base.js';
import { getActiveProvider } from './providers/provider-factory.js';
import {
  getPresetEnvironmentAnalysis,
  getPresetInstallPlan,
  getPresetErrorDiagnosis,
  getPresetFixStrategies,
  DEFAULT_RETRY_CONFIG,
} from './fault-tolerance.js';
import { callAI, callAIStreaming } from './api-call.js';
import type { AICallConfig } from './api-call.js';
import { EnvironmentAnalysisSchema, ErrorDiagnosisSchema } from './schemas.js';
import type {
  StreamCallbacks,
  AIAgentOptions,
  AIAnalysisResult,
  EnvironmentAnalysis,
  ErrorDiagnosis,
} from './schemas.js';

// Re-export types and schemas for backward compatibility
export { EnvironmentAnalysisSchema, ErrorDiagnosisSchema } from './schemas.js';
export { DetectedCapabilitiesSchema } from './schemas.js';
export type {
  StreamCallbacks,
  AIAgentOptions,
  TokenUsage,
  AIAnalysisResult,
  DetectedCapabilities,
  EnvironmentAnalysis,
  ErrorDiagnosis,
} from './schemas.js';

// ============================================================================
// InstallAIAgent
// ============================================================================

/**
 * AI-powered agent for intelligent installation assistance.
 *
 * Uses the AIProviderInterface abstraction to provide structured analysis
 * and recommendations for software installation workflows. Supports any
 * configured provider (Claude, OpenAI, DeepSeek, Ollama, custom-openai).
 *
 * @example
 * ```ts
 * const provider = getActiveProvider();
 * const agent = new InstallAIAgent({ provider });
 * const analysis = await agent.analyzeEnvironment(envInfo, 'openclaw');
 * if (analysis.success && analysis.data?.ready) {
 *   const plan = await agent.generateInstallPlan(envInfo, 'openclaw');
 * }
 * ```
 */
export class InstallAIAgent {
  private readonly provider: AIProviderInterface;
  private readonly timeoutMs: number;
  private readonly enablePresetFallback: boolean;
  private readonly apiCallConfig: AICallConfig;

  constructor(options: AIAgentOptions = {}) {
    const provider = options.provider ?? getActiveProvider();
    if (!provider) {
      throw new Error(
        'No AI provider available. Set AI_PROVIDER and the corresponding API key, ' +
        'or pass a provider instance via AIAgentOptions.provider.',
      );
    }
    this.provider = provider;
    this.timeoutMs = options.timeoutMs ?? 60000;
    this.enablePresetFallback = options.enablePresetFallback ?? true;

    const maxRetries = options.maxRetries ?? 2;
    const retryConfig = options.retryConfig ?? {
      ...DEFAULT_RETRY_CONFIG,
      maxRetries,
    };

    this.apiCallConfig = {
      provider: this.provider,
      timeoutMs: this.timeoutMs,
      retryConfig,
    };
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  async analyzeEnvironment(
    environment: EnvironmentInfo,
    software: string,
  ): Promise<AIAnalysisResult<EnvironmentAnalysis>> {
    const prompt = this.buildEnvAnalysisPrompt(environment, software);
    const result = await callAI<EnvironmentAnalysis>(prompt, EnvironmentAnalysisSchema, this.apiCallConfig);
    return this.withPresetFallback(result, () => getPresetEnvironmentAnalysis(environment, software));
  }

  async generateInstallPlan(
    environment: EnvironmentInfo,
    software: string,
    version?: string,
    knowledgeContext?: string,
  ): Promise<AIAnalysisResult<InstallPlan>> {
    const prompt = this.buildInstallPlanPrompt(environment, software, version, knowledgeContext);
    const result = await callAI<InstallPlan>(prompt, InstallPlanSchema, this.apiCallConfig);
    return this.withPresetFallback(result, () => getPresetInstallPlan(environment, software));
  }

  async diagnoseError(
    errorContext: ErrorContext,
  ): Promise<AIAnalysisResult<ErrorDiagnosis>> {
    const prompt = this.buildErrorDiagnosisPrompt(errorContext);
    const result = await callAI<ErrorDiagnosis>(prompt, ErrorDiagnosisSchema, this.apiCallConfig);
    return this.withPresetFallback(result, () => getPresetErrorDiagnosis(errorContext));
  }

  async suggestFixes(
    errorContext: ErrorContext,
    diagnosis?: ErrorDiagnosis,
  ): Promise<AIAnalysisResult<FixStrategy[]>> {
    const prompt = this.buildFixSuggestionPrompt(errorContext, diagnosis);
    const schema = z.array(FixStrategySchema);
    const result = await callAI<FixStrategy[]>(prompt, schema, this.apiCallConfig);
    return this.withPresetFallback(result, () => getPresetFixStrategies(errorContext));
  }

  // --------------------------------------------------------------------------
  // Streaming Public API
  // --------------------------------------------------------------------------

  async analyzeEnvironmentStreaming(
    environment: EnvironmentInfo,
    software: string,
    callbacks?: StreamCallbacks,
  ): Promise<AIAnalysisResult<EnvironmentAnalysis>> {
    const prompt = this.buildEnvAnalysisPrompt(environment, software);
    const result = await callAIStreaming<EnvironmentAnalysis>(prompt, EnvironmentAnalysisSchema, this.apiCallConfig, callbacks);
    return this.withPresetFallback(result, () => getPresetEnvironmentAnalysis(environment, software));
  }

  async generateInstallPlanStreaming(
    environment: EnvironmentInfo,
    software: string,
    version?: string,
    callbacks?: StreamCallbacks,
    knowledgeContext?: string,
  ): Promise<AIAnalysisResult<InstallPlan>> {
    const prompt = this.buildInstallPlanPrompt(environment, software, version, knowledgeContext);
    const result = await callAIStreaming<InstallPlan>(prompt, InstallPlanSchema, this.apiCallConfig, callbacks);
    return this.withPresetFallback(result, () => getPresetInstallPlan(environment, software));
  }

  async diagnoseErrorStreaming(
    errorContext: ErrorContext,
    callbacks?: StreamCallbacks,
  ): Promise<AIAnalysisResult<ErrorDiagnosis>> {
    const prompt = this.buildErrorDiagnosisPrompt(errorContext);
    const result = await callAIStreaming<ErrorDiagnosis>(prompt, ErrorDiagnosisSchema, this.apiCallConfig, callbacks);
    return this.withPresetFallback(result, () => getPresetErrorDiagnosis(errorContext));
  }

  async suggestFixesStreaming(
    errorContext: ErrorContext,
    diagnosis?: ErrorDiagnosis,
    callbacks?: StreamCallbacks,
  ): Promise<AIAnalysisResult<FixStrategy[]>> {
    const prompt = this.buildFixSuggestionPrompt(errorContext, diagnosis);
    const schema = z.array(FixStrategySchema);
    const result = await callAIStreaming<FixStrategy[]>(prompt, schema, this.apiCallConfig, callbacks);
    return this.withPresetFallback(result, () => getPresetFixStrategies(errorContext));
  }

  // --------------------------------------------------------------------------
  // Preset Fallback
  // --------------------------------------------------------------------------

  private withPresetFallback<T>(
    result: AIAnalysisResult<T>,
    getPreset: () => T,
  ): AIAnalysisResult<T> {
    if (!result.success && this.enablePresetFallback &&
        result.errorType !== 'auth' && result.errorType !== 'validation') {
      return {
        success: true,
        data: getPreset(),
        error: `AI analysis failed, using preset template: ${result.error}`,
      };
    }
    return result;
  }

  // --------------------------------------------------------------------------
  // Prompt Builders
  // --------------------------------------------------------------------------

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
