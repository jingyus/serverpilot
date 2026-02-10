/**
 * Tests for packages/server/src/ai/prompts.ts
 *
 * Tests the prompt templates and builder functions:
 * - ENV_ANALYSIS_PROMPT template
 * - INSTALL_PLAN_PROMPT template
 * - ERROR_DIAGNOSIS_PROMPT template
 * - FIX_SUGGESTION_PROMPT template
 * - SYSTEM_PROMPT constant
 * - buildPromptWithContext() - generic template filling
 * - formatEnvironmentBlock() - environment info formatting
 * - formatPackageManagers() - package manager formatting
 * - formatPreviousSteps() - step history formatting
 * - formatDiagnosisBlock() - diagnosis formatting
 * - buildEnvAnalysisPrompt() - high-level env analysis prompt
 * - buildInstallPlanPrompt() - high-level install plan prompt
 * - buildErrorDiagnosisPrompt() - high-level error diagnosis prompt
 * - buildFixSuggestionPrompt() - high-level fix suggestion prompt
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { EnvironmentInfo, ErrorContext } from '@aiinstaller/shared';
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
} from '../packages/server/src/ai/prompts.js';

const PROMPTS_FILE = path.resolve('packages/server/src/ai/prompts.ts');

// ============================================================================
// Test Fixtures
// ============================================================================

function createEnvInfo(): EnvironmentInfo {
  return {
    os: { platform: 'darwin', version: '24.0.0', arch: 'arm64' },
    shell: { type: 'zsh', version: '5.9' },
    runtime: { node: '22.0.0', python: '3.12.0' },
    packageManagers: { npm: '10.0.0', pnpm: '9.0.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
  };
}

function createErrorContext(): ErrorContext {
  return {
    stepId: 'install-openclaw',
    command: 'pnpm install -g openclaw',
    exitCode: 1,
    stdout: '',
    stderr: 'EACCES: permission denied, access \'/usr/local/lib\'',
    environment: createEnvInfo(),
    previousSteps: [
      {
        stepId: 'check-node',
        success: true,
        exitCode: 0,
        stdout: 'v22.0.0',
        stderr: '',
        duration: 150,
      },
    ],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('src/ai/prompts.ts', () => {
  // --------------------------------------------------------------------------
  // File existence and exports
  // --------------------------------------------------------------------------

  describe('File existence', () => {
    it('should exist at packages/server/src/ai/prompts.ts', () => {
      expect(existsSync(PROMPTS_FILE)).toBe(true);
    });

    it('should be a non-empty TypeScript file', () => {
      const content = readFileSync(PROMPTS_FILE, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe('Exports', () => {
    it('should export ENV_ANALYSIS_PROMPT template', () => {
      expect(typeof ENV_ANALYSIS_PROMPT).toBe('string');
      expect(ENV_ANALYSIS_PROMPT.length).toBeGreaterThan(0);
    });

    it('should export INSTALL_PLAN_PROMPT template', () => {
      expect(typeof INSTALL_PLAN_PROMPT).toBe('string');
      expect(INSTALL_PLAN_PROMPT.length).toBeGreaterThan(0);
    });

    it('should export ERROR_DIAGNOSIS_PROMPT template', () => {
      expect(typeof ERROR_DIAGNOSIS_PROMPT).toBe('string');
      expect(ERROR_DIAGNOSIS_PROMPT.length).toBeGreaterThan(0);
    });

    it('should export FIX_SUGGESTION_PROMPT template', () => {
      expect(typeof FIX_SUGGESTION_PROMPT).toBe('string');
      expect(FIX_SUGGESTION_PROMPT.length).toBeGreaterThan(0);
    });

    it('should export SYSTEM_PROMPT constant', () => {
      expect(typeof SYSTEM_PROMPT).toBe('string');
      expect(SYSTEM_PROMPT.length).toBeGreaterThan(0);
    });

    it('should export buildPromptWithContext function', () => {
      expect(typeof buildPromptWithContext).toBe('function');
    });

    it('should export formatEnvironmentBlock function', () => {
      expect(typeof formatEnvironmentBlock).toBe('function');
    });

    it('should export formatPackageManagers function', () => {
      expect(typeof formatPackageManagers).toBe('function');
    });

    it('should export formatPreviousSteps function', () => {
      expect(typeof formatPreviousSteps).toBe('function');
    });

    it('should export formatDiagnosisBlock function', () => {
      expect(typeof formatDiagnosisBlock).toBe('function');
    });

    it('should export buildEnvAnalysisPrompt function', () => {
      expect(typeof buildEnvAnalysisPrompt).toBe('function');
    });

    it('should export buildInstallPlanPrompt function', () => {
      expect(typeof buildInstallPlanPrompt).toBe('function');
    });

    it('should export buildErrorDiagnosisPrompt function', () => {
      expect(typeof buildErrorDiagnosisPrompt).toBe('function');
    });

    it('should export buildFixSuggestionPrompt function', () => {
      expect(typeof buildFixSuggestionPrompt).toBe('function');
    });
  });

  // --------------------------------------------------------------------------
  // Prompt template content
  // --------------------------------------------------------------------------

  describe('ENV_ANALYSIS_PROMPT', () => {
    it('should contain {software} placeholder', () => {
      expect(ENV_ANALYSIS_PROMPT).toContain('{software}');
    });

    it('should contain {environmentBlock} placeholder', () => {
      expect(ENV_ANALYSIS_PROMPT).toContain('{environmentBlock}');
    });

    it('should request JSON response format', () => {
      expect(ENV_ANALYSIS_PROMPT).toContain('JSON');
    });

    it('should describe expected response fields', () => {
      expect(ENV_ANALYSIS_PROMPT).toContain('summary');
      expect(ENV_ANALYSIS_PROMPT).toContain('issues');
      expect(ENV_ANALYSIS_PROMPT).toContain('ready');
      expect(ENV_ANALYSIS_PROMPT).toContain('recommendations');
    });
  });

  describe('INSTALL_PLAN_PROMPT', () => {
    it('should contain {software} placeholder', () => {
      expect(INSTALL_PLAN_PROMPT).toContain('{software}');
    });

    it('should contain {versionSuffix} placeholder', () => {
      expect(INSTALL_PLAN_PROMPT).toContain('{versionSuffix}');
    });

    it('should contain {environmentBlock} placeholder', () => {
      expect(INSTALL_PLAN_PROMPT).toContain('{environmentBlock}');
    });

    it('should describe expected response schema with steps', () => {
      expect(INSTALL_PLAN_PROMPT).toContain('steps');
      expect(INSTALL_PLAN_PROMPT).toContain('estimatedTime');
      expect(INSTALL_PLAN_PROMPT).toContain('risks');
      expect(INSTALL_PLAN_PROMPT).toContain('onError');
    });
  });

  describe('ERROR_DIAGNOSIS_PROMPT', () => {
    it('should contain error context placeholders', () => {
      expect(ERROR_DIAGNOSIS_PROMPT).toContain('{command}');
      expect(ERROR_DIAGNOSIS_PROMPT).toContain('{exitCode}');
      expect(ERROR_DIAGNOSIS_PROMPT).toContain('{stdout}');
      expect(ERROR_DIAGNOSIS_PROMPT).toContain('{stderr}');
      expect(ERROR_DIAGNOSIS_PROMPT).toContain('{stepId}');
    });

    it('should contain {environmentBlock} placeholder', () => {
      expect(ERROR_DIAGNOSIS_PROMPT).toContain('{environmentBlock}');
    });

    it('should contain {previousStepsBlock} placeholder', () => {
      expect(ERROR_DIAGNOSIS_PROMPT).toContain('{previousStepsBlock}');
    });

    it('should describe expected response with category enum', () => {
      expect(ERROR_DIAGNOSIS_PROMPT).toContain('rootCause');
      expect(ERROR_DIAGNOSIS_PROMPT).toContain('category');
      expect(ERROR_DIAGNOSIS_PROMPT).toContain('explanation');
      expect(ERROR_DIAGNOSIS_PROMPT).toContain('network');
      expect(ERROR_DIAGNOSIS_PROMPT).toContain('permission');
    });
  });

  describe('FIX_SUGGESTION_PROMPT', () => {
    it('should contain error context placeholders', () => {
      expect(FIX_SUGGESTION_PROMPT).toContain('{command}');
      expect(FIX_SUGGESTION_PROMPT).toContain('{exitCode}');
      expect(FIX_SUGGESTION_PROMPT).toContain('{stderr}');
    });

    it('should contain {environmentBlock} placeholder', () => {
      expect(FIX_SUGGESTION_PROMPT).toContain('{environmentBlock}');
    });

    it('should contain {diagnosisBlock} placeholder', () => {
      expect(FIX_SUGGESTION_PROMPT).toContain('{diagnosisBlock}');
    });

    it('should describe expected response with fix strategy fields', () => {
      expect(FIX_SUGGESTION_PROMPT).toContain('id');
      expect(FIX_SUGGESTION_PROMPT).toContain('description');
      expect(FIX_SUGGESTION_PROMPT).toContain('commands');
      expect(FIX_SUGGESTION_PROMPT).toContain('confidence');
    });

    it('should instruct the AI to act as a recovery specialist', () => {
      expect(FIX_SUGGESTION_PROMPT).toContain('software installation recovery specialist');
    });

    it('should request prioritization by confidence', () => {
      expect(FIX_SUGGESTION_PROMPT).toMatch(/[Pp]rioritiz/);
    });

    it('should request safety considerations', () => {
      expect(FIX_SUGGESTION_PROMPT).toMatch(/[Ss]afety/);
      expect(FIX_SUGGESTION_PROMPT).toContain('non-destructive');
    });

    it('should request feasibility assessment', () => {
      expect(FIX_SUGGESTION_PROMPT).toMatch(/[Ff]easibility/);
    });

    it('should include risk and requiresSudo fields', () => {
      expect(FIX_SUGGESTION_PROMPT).toContain('"risk"');
      expect(FIX_SUGGESTION_PROMPT).toContain('"requiresSudo"');
    });

    it('should include risk levels', () => {
      expect(FIX_SUGGESTION_PROMPT).toContain('"low"');
      expect(FIX_SUGGESTION_PROMPT).toContain('"medium"');
      expect(FIX_SUGGESTION_PROMPT).toContain('"high"');
    });

    it('should describe kebab-case id format', () => {
      expect(FIX_SUGGESTION_PROMPT).toContain('kebab-case');
    });
  });

  describe('SYSTEM_PROMPT', () => {
    it('should mention JSON response requirement', () => {
      expect(SYSTEM_PROMPT).toContain('JSON');
    });

    it('should describe the role as installation expert', () => {
      expect(SYSTEM_PROMPT).toContain('installation expert');
    });
  });

  // --------------------------------------------------------------------------
  // buildPromptWithContext
  // --------------------------------------------------------------------------

  describe('buildPromptWithContext', () => {
    it('should replace single placeholder', () => {
      const result = buildPromptWithContext('Hello {name}', { name: 'World' });
      expect(result).toBe('Hello World');
    });

    it('should replace multiple different placeholders', () => {
      const result = buildPromptWithContext('{a} and {b}', { a: 'X', b: 'Y' });
      expect(result).toBe('X and Y');
    });

    it('should replace all occurrences of the same placeholder', () => {
      const result = buildPromptWithContext('{x} plus {x}', { x: '1' });
      expect(result).toBe('1 plus 1');
    });

    it('should leave unmatched placeholders as-is', () => {
      const result = buildPromptWithContext('{a} and {b}', { a: 'X' });
      expect(result).toBe('X and {b}');
    });

    it('should handle empty context', () => {
      const result = buildPromptWithContext('Hello {name}', {});
      expect(result).toBe('Hello {name}');
    });

    it('should handle template with no placeholders', () => {
      const result = buildPromptWithContext('No placeholders here', { key: 'value' });
      expect(result).toBe('No placeholders here');
    });

    it('should handle empty string values', () => {
      const result = buildPromptWithContext('Value: {val}', { val: '' });
      expect(result).toBe('Value: ');
    });

    it('should handle multiline templates', () => {
      const template = 'Line 1: {a}\nLine 2: {b}';
      const result = buildPromptWithContext(template, { a: 'X', b: 'Y' });
      expect(result).toBe('Line 1: X\nLine 2: Y');
    });
  });

  // --------------------------------------------------------------------------
  // formatEnvironmentBlock
  // --------------------------------------------------------------------------

  describe('formatEnvironmentBlock', () => {
    it('should contain OS information', () => {
      const block = formatEnvironmentBlock(createEnvInfo());
      expect(block).toContain('darwin');
      expect(block).toContain('24.0.0');
      expect(block).toContain('arm64');
    });

    it('should contain shell information', () => {
      const block = formatEnvironmentBlock(createEnvInfo());
      expect(block).toContain('zsh');
      expect(block).toContain('5.9');
    });

    it('should contain runtime information', () => {
      const block = formatEnvironmentBlock(createEnvInfo());
      expect(block).toContain('Node.js: 22.0.0');
      expect(block).toContain('Python: 3.12.0');
    });

    it('should show "not installed" for missing runtimes', () => {
      const env = createEnvInfo();
      env.runtime = {};
      const block = formatEnvironmentBlock(env);
      expect(block).toContain('Node.js: not installed');
      expect(block).toContain('Python: not installed');
    });

    it('should contain package manager info', () => {
      const block = formatEnvironmentBlock(createEnvInfo());
      expect(block).toContain('npm@10.0.0');
      expect(block).toContain('pnpm@9.0.0');
    });

    it('should contain network info', () => {
      const block = formatEnvironmentBlock(createEnvInfo());
      expect(block).toContain('npm=true');
      expect(block).toContain('github=true');
    });

    it('should contain permission info', () => {
      const block = formatEnvironmentBlock(createEnvInfo());
      expect(block).toContain('sudo=true');
      expect(block).toContain('/usr/local');
    });

    it('should start with "Environment:"', () => {
      const block = formatEnvironmentBlock(createEnvInfo());
      expect(block.startsWith('Environment:')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // formatPackageManagers
  // --------------------------------------------------------------------------

  describe('formatPackageManagers', () => {
    it('should format npm and pnpm', () => {
      const result = formatPackageManagers({ npm: '10.0.0', pnpm: '9.0.0' });
      expect(result).toBe('npm@10.0.0, pnpm@9.0.0');
    });

    it('should format single package manager', () => {
      const result = formatPackageManagers({ npm: '10.0.0' });
      expect(result).toBe('npm@10.0.0');
    });

    it('should return "none detected" for empty package managers', () => {
      const result = formatPackageManagers({});
      expect(result).toBe('none detected');
    });

    it('should include all supported package managers', () => {
      const result = formatPackageManagers({
        npm: '10.0.0',
        pnpm: '9.0.0',
        yarn: '4.0.0',
        brew: '4.2.0',
        apt: '2.6.0',
      });
      expect(result).toContain('npm@10.0.0');
      expect(result).toContain('pnpm@9.0.0');
      expect(result).toContain('yarn@4.0.0');
      expect(result).toContain('brew@4.2.0');
      expect(result).toContain('apt@2.6.0');
    });

    it('should skip undefined package managers', () => {
      const result = formatPackageManagers({ npm: '10.0.0', yarn: undefined });
      expect(result).toBe('npm@10.0.0');
      expect(result).not.toContain('yarn');
    });
  });

  // --------------------------------------------------------------------------
  // formatPreviousSteps
  // --------------------------------------------------------------------------

  describe('formatPreviousSteps', () => {
    it('should format successful steps', () => {
      const result = formatPreviousSteps([
        { stepId: 'check-node', success: true, exitCode: 0, stdout: '', stderr: '', duration: 100 },
      ]);
      expect(result).toContain('check-node');
      expect(result).toContain('OK');
      expect(result).toContain('exit 0');
    });

    it('should format failed steps', () => {
      const result = formatPreviousSteps([
        { stepId: 'install-dep', success: false, exitCode: 1, stdout: '', stderr: 'err', duration: 200 },
      ]);
      expect(result).toContain('install-dep');
      expect(result).toContain('FAILED');
      expect(result).toContain('exit 1');
    });

    it('should return "(none)" for empty steps', () => {
      const result = formatPreviousSteps([]);
      expect(result).toContain('(none)');
    });

    it('should format multiple steps', () => {
      const result = formatPreviousSteps([
        { stepId: 'step-1', success: true, exitCode: 0, stdout: '', stderr: '', duration: 50 },
        { stepId: 'step-2', success: false, exitCode: 2, stdout: '', stderr: '', duration: 100 },
      ]);
      expect(result).toContain('step-1');
      expect(result).toContain('step-2');
      expect(result).toContain('OK');
      expect(result).toContain('FAILED');
    });
  });

  // --------------------------------------------------------------------------
  // formatDiagnosisBlock
  // --------------------------------------------------------------------------

  describe('formatDiagnosisBlock', () => {
    it('should format diagnosis with all fields', () => {
      const result = formatDiagnosisBlock({
        rootCause: 'Permission denied',
        category: 'permission',
        explanation: 'User lacks write access',
        severity: 'high',
        affectedComponent: 'file system',
        suggestedNextSteps: ['Use sudo'],
      });
      expect(result).toContain('Root Cause: Permission denied');
      expect(result).toContain('Category: permission');
      expect(result).toContain('Explanation: User lacks write access');
      expect(result).toContain('Severity: high');
      expect(result).toContain('Affected Component: file system');
    });

    it('should return empty string when diagnosis is undefined', () => {
      const result = formatDiagnosisBlock(undefined);
      expect(result).toBe('');
    });

    it('should start with newline for non-empty result', () => {
      const result = formatDiagnosisBlock({
        rootCause: 'test',
        category: 'unknown',
        explanation: 'test',
        severity: 'low',
        affectedComponent: 'npm',
        suggestedNextSteps: ['try again'],
      });
      expect(result.startsWith('\n')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // High-level prompt builders
  // --------------------------------------------------------------------------

  describe('buildEnvAnalysisPrompt', () => {
    it('should include the software name', () => {
      const prompt = buildEnvAnalysisPrompt(createEnvInfo(), 'openclaw');
      expect(prompt).toContain('openclaw');
    });

    it('should include environment details', () => {
      const prompt = buildEnvAnalysisPrompt(createEnvInfo(), 'openclaw');
      expect(prompt).toContain('darwin');
      expect(prompt).toContain('arm64');
      expect(prompt).toContain('zsh');
      expect(prompt).toContain('22.0.0');
      expect(prompt).toContain('npm@10.0.0');
    });

    it('should not contain unreplaced placeholders', () => {
      const prompt = buildEnvAnalysisPrompt(createEnvInfo(), 'openclaw');
      expect(prompt).not.toContain('{software}');
      expect(prompt).not.toContain('{environmentBlock}');
    });

    it('should request JSON output', () => {
      const prompt = buildEnvAnalysisPrompt(createEnvInfo(), 'openclaw');
      expect(prompt).toContain('JSON');
    });
  });

  describe('buildInstallPlanPrompt', () => {
    it('should include software name', () => {
      const prompt = buildInstallPlanPrompt(createEnvInfo(), 'openclaw');
      expect(prompt).toContain('openclaw');
    });

    it('should include version when specified', () => {
      const prompt = buildInstallPlanPrompt(createEnvInfo(), 'openclaw', '2.0.0');
      expect(prompt).toContain('version 2.0.0');
    });

    it('should not include version text when not specified', () => {
      const prompt = buildInstallPlanPrompt(createEnvInfo(), 'openclaw');
      expect(prompt).not.toContain('version undefined');
      expect(prompt).not.toContain('{versionSuffix}');
    });

    it('should include environment details', () => {
      const prompt = buildInstallPlanPrompt(createEnvInfo(), 'openclaw');
      expect(prompt).toContain('darwin');
      expect(prompt).toContain('pnpm@9.0.0');
    });

    it('should not contain unreplaced placeholders', () => {
      const prompt = buildInstallPlanPrompt(createEnvInfo(), 'openclaw');
      expect(prompt).not.toContain('{software}');
      expect(prompt).not.toContain('{environmentBlock}');
    });
  });

  describe('buildErrorDiagnosisPrompt', () => {
    it('should include error context details', () => {
      const prompt = buildErrorDiagnosisPrompt(createErrorContext());
      expect(prompt).toContain('pnpm install -g openclaw');
      expect(prompt).toContain('EACCES');
      expect(prompt).toContain('permission denied');
      expect(prompt).toContain('install-openclaw');
    });

    it('should include exit code', () => {
      const prompt = buildErrorDiagnosisPrompt(createErrorContext());
      expect(prompt).toContain('Exit Code: 1');
    });

    it('should include previous steps', () => {
      const prompt = buildErrorDiagnosisPrompt(createErrorContext());
      expect(prompt).toContain('check-node');
      expect(prompt).toContain('OK');
    });

    it('should show "(none)" for no previous steps', () => {
      const ctx = createErrorContext();
      ctx.previousSteps = [];
      const prompt = buildErrorDiagnosisPrompt(ctx);
      expect(prompt).toContain('(none)');
    });

    it('should show "(empty)" for empty stdout', () => {
      const prompt = buildErrorDiagnosisPrompt(createErrorContext());
      expect(prompt).toContain('Stdout: (empty)');
    });

    it('should include environment details', () => {
      const prompt = buildErrorDiagnosisPrompt(createErrorContext());
      expect(prompt).toContain('darwin');
      expect(prompt).toContain('zsh');
    });

    it('should not contain unreplaced placeholders', () => {
      const prompt = buildErrorDiagnosisPrompt(createErrorContext());
      expect(prompt).not.toContain('{command}');
      expect(prompt).not.toContain('{exitCode}');
      expect(prompt).not.toContain('{stderr}');
      expect(prompt).not.toContain('{stepId}');
      expect(prompt).not.toContain('{environmentBlock}');
      expect(prompt).not.toContain('{previousStepsBlock}');
    });
  });

  describe('buildFixSuggestionPrompt', () => {
    it('should include error context', () => {
      const prompt = buildFixSuggestionPrompt(createErrorContext());
      expect(prompt).toContain('pnpm install -g openclaw');
      expect(prompt).toContain('EACCES');
    });

    it('should include diagnosis when provided', () => {
      const diagnosis = {
        rootCause: 'Permission denied',
        category: 'permission' as const,
        explanation: 'User lacks write access',
        severity: 'high' as const,
        affectedComponent: 'file system',
        suggestedNextSteps: ['Use sudo'],
      };
      const prompt = buildFixSuggestionPrompt(createErrorContext(), diagnosis);
      expect(prompt).toContain('Root Cause: Permission denied');
      expect(prompt).toContain('Category: permission');
      expect(prompt).toContain('Severity: high');
      expect(prompt).toContain('Affected Component: file system');
    });

    it('should work without diagnosis', () => {
      const prompt = buildFixSuggestionPrompt(createErrorContext());
      expect(prompt).not.toContain('Root Cause');
      expect(prompt).not.toContain('Category:');
    });

    it('should include environment details', () => {
      const prompt = buildFixSuggestionPrompt(createErrorContext());
      expect(prompt).toContain('darwin');
      expect(prompt).toContain('sudo=true');
    });

    it('should include full environment info', () => {
      const prompt = buildFixSuggestionPrompt(createErrorContext());
      expect(prompt).toContain('arm64');
      expect(prompt).toContain('zsh');
      expect(prompt).toContain('npm@10.0.0');
      expect(prompt).toContain('pnpm@9.0.0');
      expect(prompt).toContain('npm=true');
      expect(prompt).toContain('github=true');
      expect(prompt).toContain('/usr/local');
    });

    it('should mention the recovery specialist role', () => {
      const prompt = buildFixSuggestionPrompt(createErrorContext());
      expect(prompt).toContain('software installation recovery specialist');
    });

    it('should request prioritization and safety', () => {
      const prompt = buildFixSuggestionPrompt(createErrorContext());
      expect(prompt).toMatch(/[Pp]rioritiz/);
      expect(prompt).toMatch(/[Ss]afety/);
    });

    it('should include risk and requiresSudo in expected output', () => {
      const prompt = buildFixSuggestionPrompt(createErrorContext());
      expect(prompt).toContain('"risk"');
      expect(prompt).toContain('"requiresSudo"');
    });

    it('should show "(empty)" for empty stderr', () => {
      const ctx = createErrorContext();
      ctx.stderr = '';
      const prompt = buildFixSuggestionPrompt(ctx);
      expect(prompt).toContain('(empty)');
    });

    it('should not contain unreplaced placeholders', () => {
      const prompt = buildFixSuggestionPrompt(createErrorContext());
      expect(prompt).not.toContain('{command}');
      expect(prompt).not.toContain('{exitCode}');
      expect(prompt).not.toContain('{stderr}');
      expect(prompt).not.toContain('{environmentBlock}');
      expect(prompt).not.toContain('{diagnosisBlock}');
    });
  });

  // --------------------------------------------------------------------------
  // Code quality
  // --------------------------------------------------------------------------

  describe('Code quality', () => {
    it('should import types from @aiinstaller/shared', () => {
      const content = readFileSync(PROMPTS_FILE, 'utf-8');
      expect(content).toContain("from '@aiinstaller/shared'");
    });

    it('should import ErrorDiagnosis type from agent', () => {
      const content = readFileSync(PROMPTS_FILE, 'utf-8');
      expect(content).toContain("from './agent.js'");
    });

    it('should have JSDoc on all exported functions', () => {
      const content = readFileSync(PROMPTS_FILE, 'utf-8');
      expect(content).toContain('* Replace `{placeholder}` tokens');
      expect(content).toContain('* Format an EnvironmentInfo object');
      expect(content).toContain('* Format package manager versions');
      expect(content).toContain('* Format previous step results');
      expect(content).toContain('* Format an optional ErrorDiagnosis');
      expect(content).toContain('* Build a complete environment analysis prompt');
      expect(content).toContain('* Build a complete install plan prompt');
      expect(content).toContain('* Build a complete error diagnosis prompt');
      expect(content).toContain('* Build a complete fix suggestion prompt');
    });

    it('should have JSDoc on all exported template constants', () => {
      const content = readFileSync(PROMPTS_FILE, 'utf-8');
      expect(content).toContain('* Prompt template for analyzing a client environment');
      expect(content).toContain('* Prompt template for generating an installation plan');
      expect(content).toContain('* Prompt template for diagnosing an installation error');
      expect(content).toContain('* Prompt template for suggesting fix strategies');
      expect(content).toContain('* System prompt used for all AI requests');
    });

    it('should use export keyword on all constants and functions', () => {
      const content = readFileSync(PROMPTS_FILE, 'utf-8');
      expect(content).toContain('export const ENV_ANALYSIS_PROMPT');
      expect(content).toContain('export const INSTALL_PLAN_PROMPT');
      expect(content).toContain('export const ERROR_DIAGNOSIS_PROMPT');
      expect(content).toContain('export const FIX_SUGGESTION_PROMPT');
      expect(content).toContain('export const SYSTEM_PROMPT');
      expect(content).toContain('export function buildPromptWithContext');
      expect(content).toContain('export function formatEnvironmentBlock');
      expect(content).toContain('export function formatPackageManagers');
      expect(content).toContain('export function formatPreviousSteps');
      expect(content).toContain('export function formatDiagnosisBlock');
      expect(content).toContain('export function buildEnvAnalysisPrompt');
      expect(content).toContain('export function buildInstallPlanPrompt');
      expect(content).toContain('export function buildErrorDiagnosisPrompt');
      expect(content).toContain('export function buildFixSuggestionPrompt');
    });

    it('should use type imports where appropriate', () => {
      const content = readFileSync(PROMPTS_FILE, 'utf-8');
      expect(content).toContain('import type');
    });
  });
});
