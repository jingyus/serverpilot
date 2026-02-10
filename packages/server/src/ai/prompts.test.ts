/**
 * Tests for AI prompt templates and context builders.
 */

import { describe, it, expect } from 'vitest';
import type { EnvironmentInfo, ErrorContext } from '@aiinstaller/shared';
import type { ErrorDiagnosis } from './agent.js';
import {
  ENV_ANALYSIS_PROMPT,
  INSTALL_PLAN_PROMPT,
  ERROR_DIAGNOSIS_PROMPT,
  FIX_SUGGESTION_PROMPT,
  SYSTEM_PROMPT,
  buildPromptWithContext,
  formatEnvironmentBlock,
  formatPackageManagers,
  formatPreviousSteps,
  formatDiagnosisBlock,
  buildEnvAnalysisPrompt,
  buildInstallPlanPrompt,
  buildErrorDiagnosisPrompt,
  buildFixSuggestionPrompt,
} from './prompts.js';

// ============================================================================
// Helpers
// ============================================================================

function createEnv(overrides?: Partial<EnvironmentInfo>): EnvironmentInfo {
  return {
    os: { platform: 'darwin', version: '24.0.0', arch: 'arm64' },
    shell: { type: 'zsh', version: '5.9' },
    runtime: { node: '22.1.0' },
    packageManagers: { pnpm: '9.1.0', npm: '10.2.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
    ...overrides,
  };
}

function createErrorContext(overrides?: Partial<ErrorContext>): ErrorContext {
  return {
    stepId: 'test-step',
    command: 'npm install -g openclaw',
    exitCode: 1,
    stdout: '',
    stderr: 'npm ERR! some error',
    environment: createEnv(),
    previousSteps: [],
    ...overrides,
  };
}

// ============================================================================
// ENV_ANALYSIS_PROMPT template
// ============================================================================

describe('ENV_ANALYSIS_PROMPT', () => {
  it('should contain software placeholder', () => {
    expect(ENV_ANALYSIS_PROMPT).toContain('{software}');
  });

  it('should contain environmentBlock placeholder', () => {
    expect(ENV_ANALYSIS_PROMPT).toContain('{environmentBlock}');
  });

  it('should instruct the AI to act as a software installation expert', () => {
    expect(ENV_ANALYSIS_PROMPT).toContain('software installation expert');
  });

  it('should request pre-requisite checks', () => {
    expect(ENV_ANALYSIS_PROMPT).toMatch(/[Pp]re-?requisite/);
  });

  it('should request dependency status analysis', () => {
    expect(ENV_ANALYSIS_PROMPT).toMatch(/[Dd]ependency/);
  });

  it('should request installation readiness assessment', () => {
    expect(ENV_ANALYSIS_PROMPT).toMatch(/readiness|ready/i);
  });

  it('should request verification considerations', () => {
    expect(ENV_ANALYSIS_PROMPT).toMatch(/[Vv]erification/);
  });

  it('should request JSON response format', () => {
    expect(ENV_ANALYSIS_PROMPT).toContain('JSON');
  });

  it('should include detectedCapabilities in expected JSON schema', () => {
    expect(ENV_ANALYSIS_PROMPT).toContain('detectedCapabilities');
    expect(ENV_ANALYSIS_PROMPT).toContain('hasRequiredRuntime');
    expect(ENV_ANALYSIS_PROMPT).toContain('hasPackageManager');
    expect(ENV_ANALYSIS_PROMPT).toContain('hasNetworkAccess');
    expect(ENV_ANALYSIS_PROMPT).toContain('hasSufficientPermissions');
  });

  it('should include summary, ready, issues, and recommendations fields', () => {
    expect(ENV_ANALYSIS_PROMPT).toContain('"summary"');
    expect(ENV_ANALYSIS_PROMPT).toContain('"ready"');
    expect(ENV_ANALYSIS_PROMPT).toContain('"issues"');
    expect(ENV_ANALYSIS_PROMPT).toContain('"recommendations"');
  });
});

// ============================================================================
// Other prompt templates (basic assertions)
// ============================================================================

describe('INSTALL_PLAN_PROMPT', () => {
  it('should contain software and environmentBlock placeholders', () => {
    expect(INSTALL_PLAN_PROMPT).toContain('{software}');
    expect(INSTALL_PLAN_PROMPT).toContain('{environmentBlock}');
    expect(INSTALL_PLAN_PROMPT).toContain('{versionSuffix}');
  });

  it('should request JSON with steps array', () => {
    expect(INSTALL_PLAN_PROMPT).toContain('"steps"');
  });
});

describe('ERROR_DIAGNOSIS_PROMPT', () => {
  it('should contain expected placeholders', () => {
    expect(ERROR_DIAGNOSIS_PROMPT).toContain('{command}');
    expect(ERROR_DIAGNOSIS_PROMPT).toContain('{exitCode}');
    expect(ERROR_DIAGNOSIS_PROMPT).toContain('{stderr}');
    expect(ERROR_DIAGNOSIS_PROMPT).toContain('{stdout}');
    expect(ERROR_DIAGNOSIS_PROMPT).toContain('{stepId}');
    expect(ERROR_DIAGNOSIS_PROMPT).toContain('{environmentBlock}');
    expect(ERROR_DIAGNOSIS_PROMPT).toContain('{previousStepsBlock}');
  });

  it('should instruct the AI to act as a diagnostician', () => {
    expect(ERROR_DIAGNOSIS_PROMPT).toContain('software installation diagnostician');
  });

  it('should request root cause analysis', () => {
    expect(ERROR_DIAGNOSIS_PROMPT).toMatch(/[Rr]oot cause/);
  });

  it('should request error categorization', () => {
    expect(ERROR_DIAGNOSIS_PROMPT).toMatch(/categoriz/i);
  });

  it('should request severity assessment', () => {
    expect(ERROR_DIAGNOSIS_PROMPT).toMatch(/[Ss]everity/);
  });

  it('should request affected component identification', () => {
    expect(ERROR_DIAGNOSIS_PROMPT).toMatch(/[Aa]ffected component/i);
  });

  it('should request suggested next steps', () => {
    expect(ERROR_DIAGNOSIS_PROMPT).toMatch(/next steps/i);
  });

  it('should request JSON response format', () => {
    expect(ERROR_DIAGNOSIS_PROMPT).toContain('JSON');
  });

  it('should include severity levels in expected JSON schema', () => {
    expect(ERROR_DIAGNOSIS_PROMPT).toContain('"severity"');
    expect(ERROR_DIAGNOSIS_PROMPT).toContain('"low"');
    expect(ERROR_DIAGNOSIS_PROMPT).toContain('"medium"');
    expect(ERROR_DIAGNOSIS_PROMPT).toContain('"high"');
    expect(ERROR_DIAGNOSIS_PROMPT).toContain('"critical"');
  });

  it('should include all error category options', () => {
    expect(ERROR_DIAGNOSIS_PROMPT).toContain('"network"');
    expect(ERROR_DIAGNOSIS_PROMPT).toContain('"permission"');
    expect(ERROR_DIAGNOSIS_PROMPT).toContain('"dependency"');
    expect(ERROR_DIAGNOSIS_PROMPT).toContain('"version"');
    expect(ERROR_DIAGNOSIS_PROMPT).toContain('"configuration"');
    expect(ERROR_DIAGNOSIS_PROMPT).toContain('"unknown"');
  });

  it('should include affectedComponent and suggestedNextSteps in expected JSON schema', () => {
    expect(ERROR_DIAGNOSIS_PROMPT).toContain('"affectedComponent"');
    expect(ERROR_DIAGNOSIS_PROMPT).toContain('"suggestedNextSteps"');
  });

  it('should include rootCause, category, and explanation fields', () => {
    expect(ERROR_DIAGNOSIS_PROMPT).toContain('"rootCause"');
    expect(ERROR_DIAGNOSIS_PROMPT).toContain('"category"');
    expect(ERROR_DIAGNOSIS_PROMPT).toContain('"explanation"');
  });
});

describe('FIX_SUGGESTION_PROMPT', () => {
  it('should contain expected placeholders', () => {
    expect(FIX_SUGGESTION_PROMPT).toContain('{command}');
    expect(FIX_SUGGESTION_PROMPT).toContain('{exitCode}');
    expect(FIX_SUGGESTION_PROMPT).toContain('{stderr}');
    expect(FIX_SUGGESTION_PROMPT).toContain('{diagnosisBlock}');
    expect(FIX_SUGGESTION_PROMPT).toContain('{environmentBlock}');
  });

  it('should instruct the AI to act as a recovery specialist', () => {
    expect(FIX_SUGGESTION_PROMPT).toContain('software installation recovery specialist');
  });

  it('should request prioritization by confidence', () => {
    expect(FIX_SUGGESTION_PROMPT).toMatch(/[Pp]rioritiz/);
    expect(FIX_SUGGESTION_PROMPT).toContain('confidence');
  });

  it('should request specificity with executable commands', () => {
    expect(FIX_SUGGESTION_PROMPT).toMatch(/[Ss]pecificity/);
    expect(FIX_SUGGESTION_PROMPT).toContain('executable commands');
  });

  it('should request safety considerations', () => {
    expect(FIX_SUGGESTION_PROMPT).toMatch(/[Ss]afety/);
    expect(FIX_SUGGESTION_PROMPT).toContain('non-destructive');
  });

  it('should request feasibility assessment', () => {
    expect(FIX_SUGGESTION_PROMPT).toMatch(/[Ff]easibility/);
  });

  it('should request JSON response format', () => {
    expect(FIX_SUGGESTION_PROMPT).toContain('JSON');
  });

  it('should include fix strategy fields in expected JSON schema', () => {
    expect(FIX_SUGGESTION_PROMPT).toContain('"id"');
    expect(FIX_SUGGESTION_PROMPT).toContain('"description"');
    expect(FIX_SUGGESTION_PROMPT).toContain('"commands"');
    expect(FIX_SUGGESTION_PROMPT).toContain('"confidence"');
    expect(FIX_SUGGESTION_PROMPT).toContain('"risk"');
    expect(FIX_SUGGESTION_PROMPT).toContain('"requiresSudo"');
  });

  it('should include risk levels', () => {
    expect(FIX_SUGGESTION_PROMPT).toContain('"low"');
    expect(FIX_SUGGESTION_PROMPT).toContain('"medium"');
    expect(FIX_SUGGESTION_PROMPT).toContain('"high"');
  });

  it('should describe confidence range', () => {
    expect(FIX_SUGGESTION_PROMPT).toContain('0.0');
    expect(FIX_SUGGESTION_PROMPT).toContain('1.0');
  });

  it('should describe kebab-case id format', () => {
    expect(FIX_SUGGESTION_PROMPT).toContain('kebab-case');
  });
});

describe('SYSTEM_PROMPT', () => {
  it('should instruct JSON-only responses', () => {
    expect(SYSTEM_PROMPT).toContain('valid JSON only');
  });
});

// ============================================================================
// buildPromptWithContext
// ============================================================================

describe('buildPromptWithContext', () => {
  it('should replace single placeholder', () => {
    const result = buildPromptWithContext('Hello {name}', { name: 'World' });
    expect(result).toBe('Hello World');
  });

  it('should replace multiple different placeholders', () => {
    const result = buildPromptWithContext('Install {software} on {os}', {
      software: 'openclaw',
      os: 'macOS',
    });
    expect(result).toBe('Install openclaw on macOS');
  });

  it('should replace repeated occurrences of the same placeholder', () => {
    const result = buildPromptWithContext('{x} and {x}', { x: 'hello' });
    expect(result).toBe('hello and hello');
  });

  it('should leave unknown placeholders as-is', () => {
    const result = buildPromptWithContext('Hello {name} {unknown}', { name: 'World' });
    expect(result).toBe('Hello World {unknown}');
  });

  it('should handle empty context', () => {
    const result = buildPromptWithContext('No placeholders here', {});
    expect(result).toBe('No placeholders here');
  });

  it('should handle empty template', () => {
    const result = buildPromptWithContext('', { key: 'value' });
    expect(result).toBe('');
  });

  it('should handle multiline templates', () => {
    const template = 'Line 1: {a}\nLine 2: {b}';
    const result = buildPromptWithContext(template, { a: 'X', b: 'Y' });
    expect(result).toBe('Line 1: X\nLine 2: Y');
  });
});

// ============================================================================
// formatEnvironmentBlock
// ============================================================================

describe('formatEnvironmentBlock', () => {
  it('should include OS info', () => {
    const env = createEnv();
    const block = formatEnvironmentBlock(env);
    expect(block).toContain('darwin');
    expect(block).toContain('24.0.0');
    expect(block).toContain('arm64');
  });

  it('should include shell info', () => {
    const env = createEnv();
    const block = formatEnvironmentBlock(env);
    expect(block).toContain('zsh');
    expect(block).toContain('5.9');
  });

  it('should include Node.js version', () => {
    const env = createEnv();
    const block = formatEnvironmentBlock(env);
    expect(block).toContain('22.1.0');
  });

  it('should show "not installed" for missing Node.js', () => {
    const env = createEnv({ runtime: {} });
    const block = formatEnvironmentBlock(env);
    expect(block).toContain('not installed');
  });

  it('should show "not installed" for missing Python', () => {
    const env = createEnv();
    const block = formatEnvironmentBlock(env);
    expect(block).toMatch(/Python.*not installed/);
  });

  it('should include Python version when available', () => {
    const env = createEnv({ runtime: { node: '22.1.0', python: '3.11.0' } });
    const block = formatEnvironmentBlock(env);
    expect(block).toContain('3.11.0');
  });

  it('should include package manager info', () => {
    const env = createEnv();
    const block = formatEnvironmentBlock(env);
    expect(block).toContain('pnpm@9.1.0');
    expect(block).toContain('npm@10.2.0');
  });

  it('should include network status', () => {
    const env = createEnv();
    const block = formatEnvironmentBlock(env);
    expect(block).toContain('npm=true');
    expect(block).toContain('github=true');
  });

  it('should include permission info', () => {
    const env = createEnv();
    const block = formatEnvironmentBlock(env);
    expect(block).toContain('sudo=true');
    expect(block).toContain('/usr/local');
  });

  it('should handle env with no network access', () => {
    const env = createEnv({
      network: { canAccessNpm: false, canAccessGithub: false },
    });
    const block = formatEnvironmentBlock(env);
    expect(block).toContain('npm=false');
    expect(block).toContain('github=false');
  });
});

// ============================================================================
// formatPackageManagers
// ============================================================================

describe('formatPackageManagers', () => {
  it('should format multiple package managers', () => {
    const result = formatPackageManagers({ npm: '10.0.0', pnpm: '9.0.0' });
    expect(result).toBe('npm@10.0.0, pnpm@9.0.0');
  });

  it('should format single package manager', () => {
    const result = formatPackageManagers({ npm: '10.0.0' });
    expect(result).toBe('npm@10.0.0');
  });

  it('should return "none detected" when empty', () => {
    const result = formatPackageManagers({});
    expect(result).toBe('none detected');
  });

  it('should include brew when present', () => {
    const result = formatPackageManagers({ brew: '4.2.0' });
    expect(result).toContain('brew@4.2.0');
  });

  it('should include apt when present', () => {
    const result = formatPackageManagers({ apt: '2.4.0' });
    expect(result).toContain('apt@2.4.0');
  });

  it('should include yarn when present', () => {
    const result = formatPackageManagers({ yarn: '1.22.0' });
    expect(result).toContain('yarn@1.22.0');
  });

  it('should format all package managers', () => {
    const result = formatPackageManagers({
      npm: '10.0.0',
      pnpm: '9.0.0',
      yarn: '1.22.0',
      brew: '4.2.0',
      apt: '2.4.0',
    });
    expect(result).toContain('npm@10.0.0');
    expect(result).toContain('pnpm@9.0.0');
    expect(result).toContain('yarn@1.22.0');
    expect(result).toContain('brew@4.2.0');
    expect(result).toContain('apt@2.4.0');
  });

  it('should skip undefined entries', () => {
    const result = formatPackageManagers({ npm: '10.0.0', pnpm: undefined });
    expect(result).toBe('npm@10.0.0');
    expect(result).not.toContain('pnpm');
  });
});

// ============================================================================
// formatPreviousSteps
// ============================================================================

describe('formatPreviousSteps', () => {
  it('should return "(none)" for empty array', () => {
    const result = formatPreviousSteps([]);
    expect(result).toBe('  (none)');
  });

  it('should format successful step', () => {
    const result = formatPreviousSteps([
      { stepId: 'check-node', success: true, exitCode: 0 },
    ]);
    expect(result).toContain('check-node');
    expect(result).toContain('OK');
    expect(result).toContain('exit 0');
  });

  it('should format failed step', () => {
    const result = formatPreviousSteps([
      { stepId: 'install-pnpm', success: false, exitCode: 1 },
    ]);
    expect(result).toContain('install-pnpm');
    expect(result).toContain('FAILED');
    expect(result).toContain('exit 1');
  });

  it('should format multiple steps', () => {
    const result = formatPreviousSteps([
      { stepId: 'step-1', success: true, exitCode: 0 },
      { stepId: 'step-2', success: false, exitCode: 127 },
    ]);
    expect(result).toContain('step-1: OK');
    expect(result).toContain('step-2: FAILED');
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
  });
});

// ============================================================================
// formatDiagnosisBlock
// ============================================================================

describe('formatDiagnosisBlock', () => {
  it('should return empty string when no diagnosis', () => {
    expect(formatDiagnosisBlock()).toBe('');
    expect(formatDiagnosisBlock(undefined)).toBe('');
  });

  it('should format diagnosis with all fields', () => {
    const diagnosis: ErrorDiagnosis = {
      rootCause: 'npm registry unreachable',
      category: 'network',
      explanation: 'The npm registry at registry.npmjs.org is not accessible.',
      severity: 'high',
      affectedComponent: 'npm',
      suggestedNextSteps: ['Check network connection', 'Use a mirror'],
    };
    const result = formatDiagnosisBlock(diagnosis);
    expect(result).toContain('Root Cause: npm registry unreachable');
    expect(result).toContain('Category: network');
    expect(result).toContain('Explanation: The npm registry');
    expect(result).toContain('Severity: high');
    expect(result).toContain('Affected Component: npm');
  });

  it('should include severity and affected component', () => {
    const diagnosis: ErrorDiagnosis = {
      rootCause: 'Permission denied',
      category: 'permission',
      explanation: 'Cannot write to /usr/local.',
      severity: 'critical',
      affectedComponent: 'file system',
      suggestedNextSteps: ['Use sudo'],
    };
    const result = formatDiagnosisBlock(diagnosis);
    expect(result).toContain('Severity: critical');
    expect(result).toContain('Affected Component: file system');
  });
});

// ============================================================================
// buildEnvAnalysisPrompt
// ============================================================================

describe('buildEnvAnalysisPrompt', () => {
  it('should include the software name', () => {
    const env = createEnv();
    const prompt = buildEnvAnalysisPrompt(env, 'openclaw');
    expect(prompt).toContain('openclaw');
  });

  it('should include environment details', () => {
    const env = createEnv();
    const prompt = buildEnvAnalysisPrompt(env, 'openclaw');
    expect(prompt).toContain('darwin');
    expect(prompt).toContain('arm64');
    expect(prompt).toContain('22.1.0');
  });

  it('should not contain raw placeholders', () => {
    const env = createEnv();
    const prompt = buildEnvAnalysisPrompt(env, 'openclaw');
    expect(prompt).not.toContain('{software}');
    expect(prompt).not.toContain('{environmentBlock}');
  });

  it('should mention the software installation expert role', () => {
    const env = createEnv();
    const prompt = buildEnvAnalysisPrompt(env, 'openclaw');
    expect(prompt).toContain('software installation expert');
  });

  it('should include detectedCapabilities in JSON schema', () => {
    const env = createEnv();
    const prompt = buildEnvAnalysisPrompt(env, 'openclaw');
    expect(prompt).toContain('detectedCapabilities');
  });

  it('should replace {software} in all occurrences', () => {
    const env = createEnv();
    const prompt = buildEnvAnalysisPrompt(env, 'testpkg');
    // The software name appears at least twice in the template
    const matches = prompt.match(/testpkg/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it('should handle Linux environment', () => {
    const env = createEnv({
      os: { platform: 'linux', version: '22.04', arch: 'x64' },
      shell: { type: 'bash', version: '5.1' },
      packageManagers: { apt: '2.4.0', npm: '10.0.0' },
    });
    const prompt = buildEnvAnalysisPrompt(env, 'openclaw');
    expect(prompt).toContain('linux');
    expect(prompt).toContain('22.04');
    expect(prompt).toContain('x64');
    expect(prompt).toContain('apt@2.4.0');
  });

  it('should handle environment with no package managers', () => {
    const env = createEnv({ packageManagers: {} });
    const prompt = buildEnvAnalysisPrompt(env, 'openclaw');
    expect(prompt).toContain('none detected');
  });
});

// ============================================================================
// buildInstallPlanPrompt
// ============================================================================

describe('buildInstallPlanPrompt', () => {
  it('should include software name and environment', () => {
    const env = createEnv();
    const prompt = buildInstallPlanPrompt(env, 'openclaw');
    expect(prompt).toContain('openclaw');
    expect(prompt).toContain('darwin');
  });

  it('should include version when specified', () => {
    const env = createEnv();
    const prompt = buildInstallPlanPrompt(env, 'openclaw', '2.0.0');
    expect(prompt).toContain('version 2.0.0');
  });

  it('should not include version suffix when not specified', () => {
    const env = createEnv();
    const prompt = buildInstallPlanPrompt(env, 'openclaw');
    expect(prompt).not.toContain('version ');
  });

  it('should not contain raw placeholders', () => {
    const env = createEnv();
    const prompt = buildInstallPlanPrompt(env, 'openclaw');
    expect(prompt).not.toContain('{software}');
    expect(prompt).not.toContain('{versionSuffix}');
    expect(prompt).not.toContain('{environmentBlock}');
  });
});

// ============================================================================
// buildErrorDiagnosisPrompt
// ============================================================================

describe('buildErrorDiagnosisPrompt', () => {
  it('should include error details', () => {
    const ctx = createErrorContext({
      command: 'pnpm install -g openclaw',
      exitCode: 127,
      stderr: 'command not found: pnpm',
    });
    const prompt = buildErrorDiagnosisPrompt(ctx);
    expect(prompt).toContain('pnpm install -g openclaw');
    expect(prompt).toContain('127');
    expect(prompt).toContain('command not found: pnpm');
  });

  it('should include environment info', () => {
    const ctx = createErrorContext();
    const prompt = buildErrorDiagnosisPrompt(ctx);
    expect(prompt).toContain('darwin');
    expect(prompt).toContain('arm64');
    expect(prompt).toContain('22.1.0');
  });

  it('should show "(empty)" for empty stdout/stderr', () => {
    const ctx = createErrorContext({ stdout: '', stderr: '' });
    const prompt = buildErrorDiagnosisPrompt(ctx);
    expect(prompt).toContain('(empty)');
  });

  it('should include previous steps when present', () => {
    const ctx = createErrorContext({
      previousSteps: [
        { stepId: 'check-node', success: true, exitCode: 0 },
      ],
    });
    const prompt = buildErrorDiagnosisPrompt(ctx);
    expect(prompt).toContain('check-node');
    expect(prompt).toContain('OK');
  });

  it('should show "(none)" when no previous steps', () => {
    const ctx = createErrorContext({ previousSteps: [] });
    const prompt = buildErrorDiagnosisPrompt(ctx);
    expect(prompt).toContain('(none)');
  });

  it('should not contain raw placeholders', () => {
    const ctx = createErrorContext();
    const prompt = buildErrorDiagnosisPrompt(ctx);
    expect(prompt).not.toContain('{command}');
    expect(prompt).not.toContain('{exitCode}');
    expect(prompt).not.toContain('{stderr}');
    expect(prompt).not.toContain('{environmentBlock}');
    expect(prompt).not.toContain('{previousStepsBlock}');
  });

  it('should mention the diagnostician role', () => {
    const ctx = createErrorContext();
    const prompt = buildErrorDiagnosisPrompt(ctx);
    expect(prompt).toContain('software installation diagnostician');
  });

  it('should request severity assessment', () => {
    const ctx = createErrorContext();
    const prompt = buildErrorDiagnosisPrompt(ctx);
    expect(prompt).toMatch(/[Ss]everity/);
  });

  it('should request affected component', () => {
    const ctx = createErrorContext();
    const prompt = buildErrorDiagnosisPrompt(ctx);
    expect(prompt).toContain('affectedComponent');
  });

  it('should request suggested next steps', () => {
    const ctx = createErrorContext();
    const prompt = buildErrorDiagnosisPrompt(ctx);
    expect(prompt).toContain('suggestedNextSteps');
  });

  it('should include step ID', () => {
    const ctx = createErrorContext({ stepId: 'install-pnpm' });
    const prompt = buildErrorDiagnosisPrompt(ctx);
    expect(prompt).toContain('install-pnpm');
  });

  it('should include package manager info from environment', () => {
    const ctx = createErrorContext();
    const prompt = buildErrorDiagnosisPrompt(ctx);
    expect(prompt).toContain('pnpm@9.1.0');
    expect(prompt).toContain('npm@10.2.0');
  });

  it('should include network status from environment', () => {
    const ctx = createErrorContext();
    const prompt = buildErrorDiagnosisPrompt(ctx);
    expect(prompt).toContain('npm=true');
    expect(prompt).toContain('github=true');
  });

  it('should include permission info from environment', () => {
    const ctx = createErrorContext();
    const prompt = buildErrorDiagnosisPrompt(ctx);
    expect(prompt).toContain('sudo=true');
    expect(prompt).toContain('/usr/local');
  });

  it('should handle Linux environment', () => {
    const ctx = createErrorContext({
      environment: createEnv({
        os: { platform: 'linux', version: '22.04', arch: 'x64' },
        shell: { type: 'bash', version: '5.1' },
        packageManagers: { apt: '2.4.0', npm: '10.0.0' },
      }),
    });
    const prompt = buildErrorDiagnosisPrompt(ctx);
    expect(prompt).toContain('linux');
    expect(prompt).toContain('22.04');
    expect(prompt).toContain('x64');
    expect(prompt).toContain('apt@2.4.0');
  });

  it('should handle multiple failed previous steps', () => {
    const ctx = createErrorContext({
      previousSteps: [
        { stepId: 'step-1', success: true, exitCode: 0 },
        { stepId: 'step-2', success: false, exitCode: 1 },
        { stepId: 'step-3', success: false, exitCode: 127 },
      ],
    });
    const prompt = buildErrorDiagnosisPrompt(ctx);
    expect(prompt).toContain('step-1: OK');
    expect(prompt).toContain('step-2: FAILED');
    expect(prompt).toContain('step-3: FAILED');
  });
});

// ============================================================================
// buildFixSuggestionPrompt
// ============================================================================

describe('buildFixSuggestionPrompt', () => {
  it('should include error details', () => {
    const ctx = createErrorContext({
      command: 'npm install -g openclaw',
      exitCode: 1,
      stderr: 'EACCES: permission denied',
    });
    const prompt = buildFixSuggestionPrompt(ctx);
    expect(prompt).toContain('npm install -g openclaw');
    expect(prompt).toContain('EACCES: permission denied');
  });

  it('should include diagnosis when provided', () => {
    const ctx = createErrorContext();
    const diagnosis: ErrorDiagnosis = {
      rootCause: 'Permission denied',
      category: 'permission',
      explanation: 'Insufficient permissions to write to global node_modules.',
      severity: 'high',
      affectedComponent: 'npm',
      suggestedNextSteps: ['Use sudo', 'Change npm prefix'],
    };
    const prompt = buildFixSuggestionPrompt(ctx, diagnosis);
    expect(prompt).toContain('Permission denied');
    expect(prompt).toContain('permission');
    expect(prompt).toContain('Insufficient permissions');
    expect(prompt).toContain('Severity: high');
    expect(prompt).toContain('Affected Component: npm');
  });

  it('should work without diagnosis', () => {
    const ctx = createErrorContext();
    const prompt = buildFixSuggestionPrompt(ctx);
    expect(prompt).not.toContain('Diagnosis:');
    expect(prompt).not.toContain('Root Cause:');
  });

  it('should not contain raw placeholders', () => {
    const ctx = createErrorContext();
    const prompt = buildFixSuggestionPrompt(ctx);
    expect(prompt).not.toContain('{command}');
    expect(prompt).not.toContain('{exitCode}');
    expect(prompt).not.toContain('{stderr}');
    expect(prompt).not.toContain('{diagnosisBlock}');
    expect(prompt).not.toContain('{environmentBlock}');
  });

  it('should mention the recovery specialist role', () => {
    const ctx = createErrorContext();
    const prompt = buildFixSuggestionPrompt(ctx);
    expect(prompt).toContain('software installation recovery specialist');
  });

  it('should include environment details', () => {
    const ctx = createErrorContext();
    const prompt = buildFixSuggestionPrompt(ctx);
    expect(prompt).toContain('darwin');
    expect(prompt).toContain('arm64');
    expect(prompt).toContain('pnpm@9.1.0');
    expect(prompt).toContain('npm@10.2.0');
  });

  it('should include network status from environment', () => {
    const ctx = createErrorContext();
    const prompt = buildFixSuggestionPrompt(ctx);
    expect(prompt).toContain('npm=true');
    expect(prompt).toContain('github=true');
  });

  it('should include permission info from environment', () => {
    const ctx = createErrorContext();
    const prompt = buildFixSuggestionPrompt(ctx);
    expect(prompt).toContain('sudo=true');
    expect(prompt).toContain('/usr/local');
  });

  it('should show "(empty)" for empty stderr', () => {
    const ctx = createErrorContext({ stderr: '' });
    const prompt = buildFixSuggestionPrompt(ctx);
    expect(prompt).toContain('(empty)');
  });

  it('should handle Linux environment', () => {
    const ctx = createErrorContext({
      environment: createEnv({
        os: { platform: 'linux', version: '22.04', arch: 'x64' },
        shell: { type: 'bash', version: '5.1' },
        packageManagers: { apt: '2.4.0', npm: '10.0.0' },
      }),
    });
    const prompt = buildFixSuggestionPrompt(ctx);
    expect(prompt).toContain('linux');
    expect(prompt).toContain('22.04');
    expect(prompt).toContain('x64');
    expect(prompt).toContain('apt@2.4.0');
  });

  it('should include shell info from environment', () => {
    const ctx = createErrorContext();
    const prompt = buildFixSuggestionPrompt(ctx);
    expect(prompt).toContain('zsh');
    expect(prompt).toContain('5.9');
  });

  it('should request prioritization and safety guidelines', () => {
    const ctx = createErrorContext();
    const prompt = buildFixSuggestionPrompt(ctx);
    expect(prompt).toMatch(/[Pp]rioritiz/);
    expect(prompt).toMatch(/[Ss]afety/);
  });

  it('should include risk and requiresSudo fields in expected output', () => {
    const ctx = createErrorContext();
    const prompt = buildFixSuggestionPrompt(ctx);
    expect(prompt).toContain('"risk"');
    expect(prompt).toContain('"requiresSudo"');
  });
});
