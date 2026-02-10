/**
 * Prompt templates for the AI installation assistant.
 *
 * Provides structured prompt templates for environment analysis,
 * error diagnosis, and fix suggestion generation. Templates use
 * `{placeholder}` syntax and are filled via `buildPromptWithContext()`.
 *
 * @module ai/prompts
 */

import type { EnvironmentInfo, ErrorContext } from '@aiinstaller/shared';
import type { ErrorDiagnosis } from './agent.js';

// ============================================================================
// Prompt Templates
// ============================================================================

/**
 * Prompt template for analyzing a client environment.
 *
 * Instructs the AI to act as a software installation expert, evaluate the
 * user's environment in detail, and produce a structured JSON response
 * covering readiness, issues, and actionable recommendations.
 *
 * Placeholders:
 * - `{software}` – the software to install
 * - `{environmentBlock}` – formatted environment details (OS, runtime, etc.)
 */
export const ENV_ANALYSIS_PROMPT = `You are a software installation expert. The user wants to install {software}.

{environmentBlock}

Please analyze this environment and produce a detailed assessment covering:
1. Pre-requisite checks – are the required runtimes, tools, and permissions present?
2. Dependency status – are needed package managers and libraries available?
3. Installation readiness – can {software} be installed on this system as-is?
4. Verification considerations – what should be checked after installation?

Respond with a JSON object:
{
  "summary": "Brief overall assessment of the environment",
  "ready": true | false,
  "issues": [
    "List every issue or warning that could prevent or complicate installation"
  ],
  "recommendations": [
    "Specific, actionable steps the user should take before installing"
  ],
  "detectedCapabilities": {
    "hasRequiredRuntime": true | false,
    "hasPackageManager": true | false,
    "hasNetworkAccess": true | false,
    "hasSufficientPermissions": true | false
  }
}`;

/**
 * Prompt template for generating an installation plan.
 *
 * Placeholders:
 * - `{software}` – the software to install
 * - `{versionSuffix}` – version string (e.g. " version 2.0.0") or empty
 * - `{environmentBlock}` – formatted environment details
 */
export const INSTALL_PLAN_PROMPT = `Generate an installation plan for "{software}"{versionSuffix}.

{environmentBlock}

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

/**
 * Prompt template for diagnosing an installation error.
 *
 * Instructs the AI to act as a software installation diagnostician,
 * systematically analyze the failure, and produce a structured JSON
 * response covering root cause, category, severity, and next steps.
 *
 * Placeholders:
 * - `{command}` – the command that failed
 * - `{exitCode}` – process exit code
 * - `{stdout}` – captured standard output
 * - `{stderr}` – captured standard error
 * - `{stepId}` – the ID of the failing step
 * - `{environmentBlock}` – formatted environment details
 * - `{previousStepsBlock}` – summary of previously executed steps
 */
export const ERROR_DIAGNOSIS_PROMPT = `You are a software installation diagnostician. A user encountered an error while installing software.

Failed Command: {command}
Exit Code: {exitCode}
Stdout: {stdout}
Stderr: {stderr}
Step ID: {stepId}

{environmentBlock}

Previous Steps:
{previousStepsBlock}

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

/**
 * Prompt template for suggesting fix strategies.
 *
 * Instructs the AI to act as a software installation recovery specialist,
 * analyze the failure context (including optional prior diagnosis), and
 * produce a prioritized list of fix strategies with executable commands,
 * confidence scores, and risk assessments.
 *
 * Placeholders:
 * - `{command}` – the command that failed
 * - `{exitCode}` – process exit code
 * - `{stderr}` – captured standard error
 * - `{environmentBlock}` – formatted environment details
 * - `{diagnosisBlock}` – diagnosis info (or empty string)
 */
export const FIX_SUGGESTION_PROMPT = `You are a software installation recovery specialist. A user encountered an error during software installation and needs actionable fix strategies.

Failed Command: {command}
Exit Code: {exitCode}
Stderr: {stderr}

{environmentBlock}
{diagnosisBlock}

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

/**
 * System prompt used for all AI requests.
 * Instructs the model to respond with valid JSON only.
 */
export const SYSTEM_PROMPT =
  'You are a software installation expert. Always respond with valid JSON only. No markdown, no code fences, no extra text.';

// ============================================================================
// Context Builders
// ============================================================================

/**
 * Replace `{placeholder}` tokens in a template string with values from a context object.
 *
 * Any placeholder that does not have a matching key in `context` is left as-is.
 *
 * @param template - The prompt template containing `{key}` placeholders
 * @param context - A record mapping placeholder names to their replacement values
 * @returns The filled prompt string
 *
 * @example
 * ```ts
 * const prompt = buildPromptWithContext(
 *   'Install {software} on {os}',
 *   { software: 'openclaw', os: 'macOS' },
 * );
 * // => 'Install openclaw on macOS'
 * ```
 */
export function buildPromptWithContext(
  template: string,
  context: Record<string, string>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(context)) {
    result = result.replaceAll(`{${key}}`, value);
  }
  return result;
}

/**
 * Format an EnvironmentInfo object into a human-readable block for prompts.
 *
 * @param env - The environment information
 * @returns Multi-line string with key environment details
 */
export function formatEnvironmentBlock(env: EnvironmentInfo): string {
  return `Environment:
- OS: ${env.os.platform} ${env.os.version} (${env.os.arch})
- Shell: ${env.shell.type} ${env.shell.version}
- Node.js: ${env.runtime.node ?? 'not installed'}
- Python: ${env.runtime.python ?? 'not installed'}
- Package Managers: ${formatPackageManagers(env.packageManagers)}
- Network: npm=${env.network.canAccessNpm}, github=${env.network.canAccessGithub}
- Permissions: sudo=${env.permissions.hasSudo}, writable=${env.permissions.canWriteTo.join(', ')}`;
}

/**
 * Format package manager versions into a compact display string.
 *
 * @param pm - Package managers object from EnvironmentInfo
 * @returns Formatted string like "npm@10.0.0, pnpm@9.0.0" or "none detected"
 */
export function formatPackageManagers(
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

/**
 * Format previous step results into a summary block for prompts.
 *
 * @param steps - Array of step results from ErrorContext
 * @returns Multi-line indented summary or "  (none)"
 */
export function formatPreviousSteps(
  steps: ErrorContext['previousSteps'],
): string {
  if (steps.length === 0) return '  (none)';
  return steps
    .map((s) => `  - ${s.stepId}: ${s.success ? 'OK' : 'FAILED'} (exit ${s.exitCode})`)
    .join('\n');
}

/**
 * Format an optional ErrorDiagnosis into a diagnosis block for prompts.
 *
 * @param diagnosis - The diagnosis object, or undefined
 * @returns Formatted block string, or empty string if no diagnosis
 */
export function formatDiagnosisBlock(
  diagnosis?: ErrorDiagnosis,
): string {
  if (!diagnosis) return '';
  let block = `\nDiagnosis:\n- Root Cause: ${diagnosis.rootCause}\n- Category: ${diagnosis.category}\n- Explanation: ${diagnosis.explanation}`;
  block += `\n- Severity: ${diagnosis.severity}`;
  block += `\n- Affected Component: ${diagnosis.affectedComponent}`;
  return block;
}

// ============================================================================
// High-level Prompt Factories
// ============================================================================

/**
 * Build a complete environment analysis prompt.
 *
 * @param environment - Client environment info
 * @param software - Software to install
 * @returns Filled prompt string
 */
export function buildEnvAnalysisPrompt(
  environment: EnvironmentInfo,
  software: string,
): string {
  return buildPromptWithContext(ENV_ANALYSIS_PROMPT, {
    software,
    environmentBlock: formatEnvironmentBlock(environment),
  });
}

/**
 * Build a complete install plan prompt.
 *
 * @param environment - Client environment info
 * @param software - Software to install
 * @param version - Optional target version
 * @returns Filled prompt string
 */
export function buildInstallPlanPrompt(
  environment: EnvironmentInfo,
  software: string,
  version?: string,
): string {
  return buildPromptWithContext(INSTALL_PLAN_PROMPT, {
    software,
    versionSuffix: version ? ` version ${version}` : '',
    environmentBlock: formatEnvironmentBlock(environment),
  });
}

/**
 * Build a complete error diagnosis prompt.
 *
 * @param errorContext - Full error context from the client
 * @returns Filled prompt string
 */
export function buildErrorDiagnosisPrompt(
  errorContext: ErrorContext,
): string {
  return buildPromptWithContext(ERROR_DIAGNOSIS_PROMPT, {
    command: errorContext.command,
    exitCode: String(errorContext.exitCode),
    stdout: errorContext.stdout || '(empty)',
    stderr: errorContext.stderr || '(empty)',
    stepId: errorContext.stepId,
    environmentBlock: formatEnvironmentBlock(errorContext.environment),
    previousStepsBlock: formatPreviousSteps(errorContext.previousSteps),
  });
}

/**
 * Build a complete fix suggestion prompt.
 *
 * @param errorContext - Full error context from the client
 * @param diagnosis - Optional prior error diagnosis
 * @returns Filled prompt string
 */
export function buildFixSuggestionPrompt(
  errorContext: ErrorContext,
  diagnosis?: ErrorDiagnosis,
): string {
  return buildPromptWithContext(FIX_SUGGESTION_PROMPT, {
    command: errorContext.command,
    exitCode: String(errorContext.exitCode),
    stderr: errorContext.stderr || '(empty)',
    environmentBlock: formatEnvironmentBlock(errorContext.environment),
    diagnosisBlock: formatDiagnosisBlock(diagnosis),
  });
}
