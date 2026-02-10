/**
 * Tests for rule-based error analysis module.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ErrorContext, EnvironmentInfo } from '@aiinstaller/shared';
import {
  analyzeError,
  identifyErrorType,
  identifyErrorTypeFromOutput,
  isTransientError,
  diagnoseError,
  type ErrorType,
  type ErrorAnalysis,
  type ExtractedErrorInfo,
  type DiagnosisResult,
} from './error-analyzer.js';
import type { InstallAIAgent } from './agent.js';
import type { ErrorDiagnosis } from './agent.js';

// ============================================================================
// Helpers
// ============================================================================

function createEnv(): EnvironmentInfo {
  return {
    os: { platform: 'darwin', version: '24.0.0', arch: 'arm64' },
    shell: { type: 'zsh', version: '5.9' },
    runtime: { node: '22.1.0' },
    packageManagers: { pnpm: '9.1.0', npm: '10.2.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
  };
}

function createErrorContext(overrides?: Partial<ErrorContext>): ErrorContext {
  return {
    stepId: 'test-step',
    command: 'npm install -g openclaw',
    exitCode: 1,
    stdout: '',
    stderr: '',
    environment: createEnv(),
    previousSteps: [],
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('error-analyzer', () => {
  // --------------------------------------------------------------------------
  // identifyErrorType - network errors
  // --------------------------------------------------------------------------

  describe('identifyErrorType - network errors', () => {
    it('should identify ETIMEDOUT as network error', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! code ETIMEDOUT\nnpm ERR! errno ETIMEDOUT',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('network');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.matchedPatterns.length).toBeGreaterThan(0);
    });

    it('should identify ECONNREFUSED as network error', () => {
      const ctx = createErrorContext({
        stderr: 'Error: connect ECONNREFUSED 127.0.0.1:443',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('network');
    });

    it('should identify ECONNRESET as network error', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! code ECONNRESET',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('network');
    });

    it('should identify ENOTFOUND as network error', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! code ENOTFOUND\nnpm ERR! errno ENOTFOUND\nnpm ERR! request to https://registry.npmjs.org/ failed',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('network');
    });

    it('should identify "network timeout" as network error', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! network timeout at: https://registry.npmjs.org/openclaw',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('network');
    });

    it('should identify SSL certificate error as network error', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! unable to get local issuer certificate',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('network');
    });

    it('should identify ERR_SOCKET_TIMEOUT as network error', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! code ERR_SOCKET_TIMEOUT',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('network');
    });

    it('should identify "fetch failed" as network error', () => {
      const ctx = createErrorContext({
        stderr: 'TypeError: fetch failed',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('network');
    });
  });

  // --------------------------------------------------------------------------
  // identifyErrorType - permission errors
  // --------------------------------------------------------------------------

  describe('identifyErrorType - permission errors', () => {
    it('should identify EACCES as permission error', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! code EACCES\nnpm ERR! EACCES: permission denied, mkdir \'/usr/local/lib\'',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('permission');
    });

    it('should identify EPERM as permission error', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! code EPERM\nnpm ERR! EPERM: operation not permitted',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('permission');
    });

    it('should identify generic permission denied as permission error', () => {
      const ctx = createErrorContext({
        stderr: 'bash: /usr/local/bin/pnpm: Permission denied',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('permission');
    });

    it('should identify "Missing write access" as permission error', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! Missing write access to /usr/local/lib/node_modules',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('permission');
    });
  });

  // --------------------------------------------------------------------------
  // identifyErrorType - dependency errors
  // --------------------------------------------------------------------------

  describe('identifyErrorType - dependency errors', () => {
    it('should identify ERESOLVE as dependency error', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! code ERESOLVE\nnpm ERR! ERESOLVE unable to resolve dependency tree',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('dependency');
    });

    it('should identify "Could not resolve dependency" as dependency error', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! Could not resolve dependency: peer react@"^17.0.0"',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('dependency');
    });

    it('should identify "command not found" as dependency error', () => {
      const ctx = createErrorContext({
        stderr: 'bash: pnpm: command not found',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('dependency');
    });

    it('should identify "Cannot find module" as dependency error', () => {
      const ctx = createErrorContext({
        stderr: 'Error: Cannot find module \'express\'',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('dependency');
    });

    it('should identify npm 404 as dependency error', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! 404 Not Found - GET https://registry.npmjs.org/nonexistent-pkg',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('dependency');
    });

    it('should identify ENOENT as dependency error', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! code ENOENT\nnpm ERR! ENOENT: no such file or directory, open \'/app/package.json\'',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('dependency');
    });
  });

  // --------------------------------------------------------------------------
  // identifyErrorType - version conflicts
  // --------------------------------------------------------------------------

  describe('identifyErrorType - version errors', () => {
    it('should identify engine incompatibility as version error', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! engine {"node":">=22.0.0"} is incompatible with this module',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('version');
    });

    it('should identify "Unsupported engine" as version error', () => {
      const ctx = createErrorContext({
        stderr: 'npm WARN EBADENGINE Unsupported engine {"node":">=22.0.0"}',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('version');
    });

    it('should identify "version not found" as version error', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! version 99.0.0 not found for package openclaw',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('version');
    });

    it('should identify npm WARN notsup as version error', () => {
      const ctx = createErrorContext({
        stderr: 'npm WARN notsup Unsupported platform for openclaw@1.0.0',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('version');
    });
  });

  // --------------------------------------------------------------------------
  // identifyErrorType - configuration errors
  // --------------------------------------------------------------------------

  describe('identifyErrorType - configuration errors', () => {
    it('should identify EJSONPARSE as configuration error', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! code EJSONPARSE\nnpm ERR! Failed to parse JSON data',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('configuration');
    });

    it('should identify "Invalid configuration" as configuration error', () => {
      const ctx = createErrorContext({
        stderr: 'Error: Invalid configuration in tsconfig.json',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('configuration');
    });

    it('should identify JSON syntax error as configuration error', () => {
      const ctx = createErrorContext({
        stderr: 'SyntaxError: Unexpected token in JSON at position 42',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('configuration');
    });

    it('should identify ERR_INVALID_ARG as configuration error', () => {
      const ctx = createErrorContext({
        stderr: 'TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('configuration');
    });

    it('should identify invalid option as configuration error', () => {
      const ctx = createErrorContext({
        stderr: 'Error: Invalid option "--foo"',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('configuration');
    });
  });

  // --------------------------------------------------------------------------
  // identifyErrorType - unknown errors
  // --------------------------------------------------------------------------

  describe('identifyErrorType - unknown errors', () => {
    it('should return unknown for unrecognized error', () => {
      const ctx = createErrorContext({
        stderr: 'Something completely unexpected happened',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('unknown');
      expect(result.confidence).toBe(0);
      expect(result.matchedPatterns).toEqual([]);
    });

    it('should return unknown for empty output', () => {
      const ctx = createErrorContext({
        stdout: '',
        stderr: '',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('unknown');
    });

    it('should include command and exit code in unknown summary', () => {
      const ctx = createErrorContext({
        command: 'pnpm install',
        exitCode: 127,
        stderr: 'xyz',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('unknown');
      expect(result.summary).toContain('pnpm install');
      expect(result.summary).toContain('127');
    });
  });

  // --------------------------------------------------------------------------
  // identifyErrorType - mixed patterns
  // --------------------------------------------------------------------------

  describe('identifyErrorType - mixed patterns', () => {
    it('should prefer the type with highest aggregate confidence', () => {
      // Contains both network and permission patterns, but multiple network patterns
      const ctx = createErrorContext({
        stderr: 'ETIMEDOUT ECONNRESET permission denied',
      });
      const result = identifyErrorType(ctx);
      // network has 0.9 + 0.9 = 1.8 aggregate, permission has 0.8
      expect(result.type).toBe('network');
    });

    it('should cap confidence at 1.0', () => {
      const ctx = createErrorContext({
        stderr: 'ETIMEDOUT ECONNREFUSED ECONNRESET ENOTFOUND network timeout',
      });
      const result = identifyErrorType(ctx);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should match patterns in stdout as well', () => {
      const ctx = createErrorContext({
        stdout: 'npm ERR! code EACCES\nnpm ERR! EACCES: permission denied',
        stderr: '',
      });
      const result = identifyErrorType(ctx);
      expect(result.type).toBe('permission');
    });
  });

  // --------------------------------------------------------------------------
  // identifyErrorType - summary format
  // --------------------------------------------------------------------------

  describe('identifyErrorType - summary', () => {
    it('should include step ID in summary', () => {
      const ctx = createErrorContext({
        stepId: 'install-pnpm',
        stderr: 'EACCES: permission denied',
      });
      const result = identifyErrorType(ctx);
      expect(result.summary).toContain('install-pnpm');
    });

    it('should include error type label in summary', () => {
      const ctx = createErrorContext({
        stderr: 'ETIMEDOUT',
      });
      const result = identifyErrorType(ctx);
      expect(result.summary).toContain('Network error');
    });

    it('should include matched pattern labels in summary', () => {
      const ctx = createErrorContext({
        stderr: 'ETIMEDOUT',
      });
      const result = identifyErrorType(ctx);
      expect(result.summary).toContain('ETIMEDOUT');
    });
  });

  // --------------------------------------------------------------------------
  // identifyErrorTypeFromOutput
  // --------------------------------------------------------------------------

  describe('identifyErrorTypeFromOutput', () => {
    it('should identify network error from stderr only', () => {
      expect(identifyErrorTypeFromOutput('ETIMEDOUT')).toBe('network');
    });

    it('should identify permission error from stderr', () => {
      expect(identifyErrorTypeFromOutput('EACCES: permission denied')).toBe('permission');
    });

    it('should identify dependency error from stderr', () => {
      expect(identifyErrorTypeFromOutput('command not found')).toBe('dependency');
    });

    it('should identify version error from stderr', () => {
      expect(identifyErrorTypeFromOutput('Unsupported engine')).toBe('version');
    });

    it('should identify configuration error from stderr', () => {
      expect(identifyErrorTypeFromOutput('EJSONPARSE')).toBe('configuration');
    });

    it('should return unknown for unrecognized output', () => {
      expect(identifyErrorTypeFromOutput('everything is fine')).toBe('unknown');
    });

    it('should use both stdout and stderr', () => {
      const result = identifyErrorTypeFromOutput('', 'EACCES: permission denied');
      expect(result).toBe('permission');
    });

    it('should return unknown for empty strings', () => {
      expect(identifyErrorTypeFromOutput('', '')).toBe('unknown');
    });
  });

  // --------------------------------------------------------------------------
  // isTransientError
  // --------------------------------------------------------------------------

  describe('isTransientError', () => {
    it('should return true for network errors', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! code ETIMEDOUT',
      });
      expect(isTransientError(ctx)).toBe(true);
    });

    it('should return true for EBUSY errors', () => {
      const ctx = createErrorContext({
        stderr: 'EBUSY: resource busy or locked',
      });
      expect(isTransientError(ctx)).toBe(true);
    });

    it('should return true for EAGAIN errors', () => {
      const ctx = createErrorContext({
        stderr: 'Error: EAGAIN: resource temporarily unavailable',
      });
      expect(isTransientError(ctx)).toBe(true);
    });

    it('should return true for "resource temporarily unavailable"', () => {
      const ctx = createErrorContext({
        stderr: 'resource temporarily unavailable, read',
      });
      expect(isTransientError(ctx)).toBe(true);
    });

    it('should return true for npm cb() never called', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! cb() never called!',
      });
      expect(isTransientError(ctx)).toBe(true);
    });

    it('should return false for permission errors', () => {
      const ctx = createErrorContext({
        stderr: 'EACCES: permission denied',
      });
      expect(isTransientError(ctx)).toBe(false);
    });

    it('should return false for dependency errors', () => {
      const ctx = createErrorContext({
        stderr: 'command not found',
      });
      expect(isTransientError(ctx)).toBe(false);
    });

    it('should return false for version errors', () => {
      const ctx = createErrorContext({
        stderr: 'Unsupported engine',
      });
      expect(isTransientError(ctx)).toBe(false);
    });

    it('should return false for configuration errors', () => {
      const ctx = createErrorContext({
        stderr: 'Invalid configuration',
      });
      expect(isTransientError(ctx)).toBe(false);
    });

    it('should return false for unknown errors', () => {
      const ctx = createErrorContext({
        stderr: 'some random error',
      });
      expect(isTransientError(ctx)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // analyzeError - comprehensive error extraction
  // --------------------------------------------------------------------------

  describe('analyzeError', () => {
    it('should extract error codes from output', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! code EACCES\nnpm ERR! code ETIMEDOUT',
      });
      const result = analyzeError(ctx);
      expect(result.errorCodes).toContain('EACCES');
      expect(result.errorCodes).toContain('ETIMEDOUT');
    });

    it('should extract multiple error codes', () => {
      const ctx = createErrorContext({
        stderr: 'ENOENT EPERM ERESOLVE',
      });
      const result = analyzeError(ctx);
      expect(result.errorCodes).toContain('ENOENT');
      expect(result.errorCodes).toContain('EPERM');
      expect(result.errorCodes).toContain('ERESOLVE');
    });

    it('should extract missing dependencies from "command not found"', () => {
      const ctx = createErrorContext({
        stderr: 'bash: pnpm: command not found',
      });
      const result = analyzeError(ctx);
      expect(result.missingDependencies).toContain('pnpm');
    });

    it('should extract missing dependencies from "Cannot find module"', () => {
      const ctx = createErrorContext({
        stderr: "Error: Cannot find module 'express'",
      });
      const result = analyzeError(ctx);
      expect(result.missingDependencies).toContain('express');
    });

    it('should extract missing dependencies from npm 404', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! 404 Not Found - GET https://registry.npmjs.org/nonexistent-package',
      });
      const result = analyzeError(ctx);
      expect(result.missingDependencies).toContain('nonexistent-package');
    });

    it('should detect permission issues and extract paths', () => {
      const ctx = createErrorContext({
        stderr: "npm ERR! EACCES: permission denied, mkdir '/usr/local/lib/node_modules'",
      });
      const result = analyzeError(ctx);
      expect(result.permissionIssues.needsSudo).toBe(true);
      expect(result.permissionIssues.paths).toContain('/usr/local/lib/node_modules');
    });

    it('should detect permission issues with EPERM', () => {
      const ctx = createErrorContext({
        stderr: "npm ERR! EPERM: operation not permitted, unlink '/usr/local/bin/node'",
      });
      const result = analyzeError(ctx);
      expect(result.permissionIssues.needsSudo).toBe(true);
      expect(result.permissionIssues.paths.length).toBeGreaterThan(0);
    });

    it('should detect permission issues with "Missing write access"', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! Missing write access to /usr/local/lib/node_modules',
      });
      const result = analyzeError(ctx);
      expect(result.permissionIssues.needsSudo).toBe(true);
    });

    it('should extract version conflicts from engine incompatibility', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! engine {"node":">=22.0.0"} is incompatible with this module',
      });
      const result = analyzeError(ctx);
      expect(result.versionConflicts).toHaveLength(1);
      expect(result.versionConflicts[0].package).toBe('node');
      expect(result.versionConflicts[0].required).toBe('>=22.0.0');
    });

    it('should extract version conflicts from unsupported engine', () => {
      const ctx = createErrorContext({
        stderr: 'npm WARN EBADENGINE Unsupported engine {"node":">=18.0.0"}',
      });
      const result = analyzeError(ctx);
      expect(result.versionConflicts).toHaveLength(1);
      expect(result.versionConflicts[0].package).toBe('node');
      expect(result.versionConflicts[0].required).toBe('>=18.0.0');
    });

    it('should extract version conflicts from peer dependencies', () => {
      const ctx = createErrorContext({
        stderr: 'requires a peer of react@"^18.0.0" but none is installed',
      });
      const result = analyzeError(ctx);
      expect(result.versionConflicts).toHaveLength(1);
      expect(result.versionConflicts[0].package).toBe('react');
      expect(result.versionConflicts[0].required).toBe('^18.0.0');
    });

    it('should extract configuration issues from invalid config', () => {
      const ctx = createErrorContext({
        stderr: 'Error: Invalid configuration in tsconfig.json',
      });
      const result = analyzeError(ctx);
      expect(result.configIssues).toHaveLength(1);
      expect(result.configIssues[0].file).toBe('tsconfig.json');
      expect(result.configIssues[0].issue).toBe('Invalid configuration');
    });

    it('should extract configuration issues from EJSONPARSE', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! code EJSONPARSE\nnpm ERR! Failed to parse json\nnpm ERR! file /app/package.json',
      });
      const result = analyzeError(ctx);
      expect(result.configIssues.length).toBeGreaterThan(0);
    });

    it('should extract configuration issues from .npmrc', () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! Error reading .npmrc configuration',
      });
      const result = analyzeError(ctx);
      expect(result.configIssues).toHaveLength(1);
      expect(result.configIssues[0].file).toBe('.npmrc');
    });

    it('should extract configuration issues from invalid arguments', () => {
      const ctx = createErrorContext({
        stderr: 'Error: Invalid option --foo',
      });
      const result = analyzeError(ctx);
      expect(result.configIssues).toHaveLength(1);
      expect(result.configIssues[0].file).toBe('command line');
      expect(result.configIssues[0].issue).toContain('--foo');
    });

    it('should handle complex errors with multiple issues', () => {
      const ctx = createErrorContext({
        stderr: `npm ERR! code EACCES
npm ERR! EACCES: permission denied, mkdir '/usr/local/lib'
npm ERR! code ERESOLVE
npm ERR! ERESOLVE unable to resolve dependency tree
bash: pnpm: command not found
Error: Cannot find module 'typescript'`,
      });
      const result = analyzeError(ctx);

      // Should extract multiple error codes
      expect(result.errorCodes).toContain('EACCES');
      expect(result.errorCodes).toContain('ERESOLVE');

      // Should identify missing dependencies
      expect(result.missingDependencies).toContain('pnpm');
      expect(result.missingDependencies).toContain('typescript');

      // Should detect permission issues
      expect(result.permissionIssues.needsSudo).toBe(true);
      expect(result.permissionIssues.paths.length).toBeGreaterThan(0);
    });

    it('should return empty arrays/objects for clean output', () => {
      const ctx = createErrorContext({
        stdout: 'Everything is fine',
        stderr: '',
      });
      const result = analyzeError(ctx);
      expect(result.errorCodes).toEqual([]);
      expect(result.missingDependencies).toEqual([]);
      expect(result.permissionIssues.needsSudo).toBe(false);
      expect(result.permissionIssues.paths).toEqual([]);
      expect(result.versionConflicts).toEqual([]);
      expect(result.configIssues).toEqual([]);
    });

    it('should check stdout as well as stderr', () => {
      const ctx = createErrorContext({
        stdout: 'npm ERR! code EACCES\nbash: node: command not found',
        stderr: '',
      });
      const result = analyzeError(ctx);
      expect(result.errorCodes).toContain('EACCES');
      expect(result.missingDependencies).toContain('node');
    });
  });

  // --------------------------------------------------------------------------
  // diagnoseError - AI-powered diagnosis
  // --------------------------------------------------------------------------

  describe('diagnoseError', () => {
    it('should call AI agent and return diagnosis with fix strategies', async () => {
      // Use an unknown error that won't match rule library to test AI diagnosis
      const ctx = createErrorContext({
        stderr: 'Obscure custom installation error ABC456',
      });

      const mockDiagnosis: ErrorDiagnosis = {
        rootCause: 'Custom installation error',
        errorType: 'unknown',
        affectedComponents: ['test-step'],
        isPermanent: true,
        requiresManualIntervention: false,
      };

      const mockFixStrategies = [
        {
          description: 'Retry with different configuration',
          commands: ['npm install -g openclaw --verbose'],
          confidence: 0.6,
          estimatedTime: 120,
          riskLevel: 'low' as const,
          requiresSudo: false,
          reasoning: 'Verbose mode may reveal the issue',
        },
      ];

      const mockAIAgent = {
        diagnoseError: vi.fn().mockResolvedValue({
          success: true,
          data: mockDiagnosis,
        }),
        suggestFixes: vi.fn().mockResolvedValue({
          success: true,
          data: mockFixStrategies,
        }),
      } as unknown as InstallAIAgent;

      const result = await diagnoseError(ctx, mockAIAgent);

      expect(result.success).toBe(true);
      expect(result.diagnosis).toEqual(mockDiagnosis);
      expect(result.fixStrategies).toEqual(mockFixStrategies);
      expect(result.usedRuleLibrary).toBe(false);
      expect(mockAIAgent.diagnoseError).toHaveBeenCalledWith(ctx);
      expect(mockAIAgent.suggestFixes).toHaveBeenCalledWith(ctx, mockDiagnosis);
    });

    it('should handle AI diagnosis failure gracefully', async () => {
      const ctx = createErrorContext({
        stderr: 'Some error',
      });

      const mockAIAgent = {
        diagnoseError: vi.fn().mockResolvedValue({
          success: false,
          error: 'AI API call failed',
        }),
        suggestFixes: vi.fn(),
      } as unknown as InstallAIAgent;

      const result = await diagnoseError(ctx, mockAIAgent);

      expect(result.success).toBe(false);
      expect(result.error).toBe('AI API call failed');
      expect(mockAIAgent.suggestFixes).not.toHaveBeenCalled();
    });

    it('should return diagnosis even if fix suggestions fail', async () => {
      const ctx = createErrorContext({
        stderr: 'npm ERR! code EACCES',
      });

      const mockDiagnosis: ErrorDiagnosis = {
        rootCause: 'Permission denied',
        category: 'permission',
        explanation: 'Insufficient permissions',
        severity: 'medium',
        affectedComponent: 'npm',
        suggestedNextSteps: ['Use sudo'],
      };

      const mockAIAgent = {
        diagnoseError: vi.fn().mockResolvedValue({
          success: true,
          data: mockDiagnosis,
        }),
        suggestFixes: vi.fn().mockResolvedValue({
          success: false,
          error: 'Fix suggestion failed',
        }),
      } as unknown as InstallAIAgent;

      const result = await diagnoseError(ctx, mockAIAgent);

      expect(result.success).toBe(true);
      expect(result.diagnosis).toEqual(mockDiagnosis);
      expect(result.fixStrategies).toEqual([]);
    });

    it('should support streaming callbacks', async () => {
      // Use an error that won't match common rules to test AI streaming
      const ctx = createErrorContext({
        stderr: 'Obscure custom error that needs AI diagnosis XYZ123',
      });

      const mockDiagnosis: ErrorDiagnosis = {
        rootCause: 'Custom error',
        errorType: 'unknown',
        affectedComponents: ['test-step'],
        isPermanent: false,
        requiresManualIntervention: false,
      };

      const mockFixStrategies = [
        {
          description: 'Retry the installation',
          commands: ['npm install -g openclaw'],
          confidence: 0.7,
          estimatedTime: 60,
          riskLevel: 'low' as const,
          requiresSudo: false,
          reasoning: 'Unknown error, try retrying',
        },
      ];

      const streamedTokens: string[] = [];
      const streamCallback = vi.fn((token: string) => {
        streamedTokens.push(token);
      });

      const mockAIAgent = {
        diagnoseErrorStreaming: vi.fn().mockResolvedValue({
          success: true,
          data: mockDiagnosis,
        }),
        suggestFixesStreaming: vi.fn().mockResolvedValue({
          success: true,
          data: mockFixStrategies,
        }),
      } as unknown as InstallAIAgent;

      const result = await diagnoseError(ctx, mockAIAgent, streamCallback);

      expect(result.success).toBe(true);
      expect(result.diagnosis).toEqual(mockDiagnosis);
      expect(result.fixStrategies).toEqual(mockFixStrategies);
      expect(result.usedRuleLibrary).toBe(false);
      expect(mockAIAgent.diagnoseErrorStreaming).toHaveBeenCalled();
      expect(mockAIAgent.suggestFixesStreaming).toHaveBeenCalled();
    });

    it('should handle exceptions during AI calls', async () => {
      const ctx = createErrorContext({
        stderr: 'Some error',
      });

      const mockAIAgent = {
        diagnoseError: vi.fn().mockRejectedValue(new Error('Network error')),
      } as unknown as InstallAIAgent;

      const result = await diagnoseError(ctx, mockAIAgent);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Error diagnosis failed');
      expect(result.error).toContain('Network error');
    });

    it('should perform rule-based analysis and skip AI for known errors', async () => {
      // EACCES error should match rule library and skip AI
      const ctx = createErrorContext({
        stderr: 'npm ERR! code EACCES\nnpm ERR! EACCES: permission denied, mkdir \'/usr/local/lib\'',
      });

      const mockAIAgent = {
        diagnoseError: vi.fn(),
        suggestFixes: vi.fn(),
      } as unknown as InstallAIAgent;

      const result = await diagnoseError(ctx, mockAIAgent);

      // Should succeed using rule library
      expect(result.success).toBe(true);
      expect(result.usedRuleLibrary).toBe(true);

      // Should NOT have called AI for known error
      expect(mockAIAgent.diagnoseError).not.toHaveBeenCalled();
      expect(mockAIAgent.suggestFixes).not.toHaveBeenCalled();

      // Should have diagnosis from rules
      expect(result.diagnosis).toBeDefined();
      expect(result.diagnosis!.errorType).toBe('permission');
      expect(result.fixStrategies).toBeDefined();
      expect(result.fixStrategies!.length).toBeGreaterThan(0);
    });

    it('should sort fix strategies by confidence in descending order', async () => {
      // Use an unknown error that won't match rules to test AI sorting
      const ctx = createErrorContext({
        stderr: 'Unknown dependency conflict XYZ789',
      });

      const mockDiagnosis: ErrorDiagnosis = {
        rootCause: 'Dependency resolution conflict',
        category: 'dependency',
        explanation: 'Multiple packages require incompatible versions',
        severity: 'medium',
        affectedComponent: 'npm',
        suggestedNextSteps: ['Update dependencies', 'Use --force flag'],
      };

      // Create fix strategies with unsorted confidence values
      const unsortedFixStrategies = [
        {
          id: 'medium-fix',
          description: 'Try updating package-lock.json',
          commands: ['rm package-lock.json', 'npm install'],
          confidence: 0.6,
          risk: 'medium',
          requiresSudo: false,
        },
        {
          id: 'high-fix',
          description: 'Use --legacy-peer-deps flag',
          commands: ['npm install --legacy-peer-deps'],
          confidence: 0.9,
          risk: 'low',
          requiresSudo: false,
        },
        {
          id: 'low-fix',
          description: 'Force install with --force',
          commands: ['npm install --force'],
          confidence: 0.4,
          risk: 'high',
          requiresSudo: false,
        },
      ];

      const mockAIAgent = {
        diagnoseError: vi.fn().mockResolvedValue({
          success: true,
          data: mockDiagnosis,
        }),
        suggestFixes: vi.fn().mockResolvedValue({
          success: true,
          data: unsortedFixStrategies,
        }),
      } as unknown as InstallAIAgent;

      const result = await diagnoseError(ctx, mockAIAgent);

      expect(result.success).toBe(true);
      expect(result.fixStrategies).toBeDefined();
      expect(result.fixStrategies).toHaveLength(3);

      // Verify strategies are sorted by confidence (descending)
      expect(result.fixStrategies![0].confidence).toBe(0.9);
      expect(result.fixStrategies![0].id).toBe('high-fix');
      expect(result.fixStrategies![1].confidence).toBe(0.6);
      expect(result.fixStrategies![1].id).toBe('medium-fix');
      expect(result.fixStrategies![2].confidence).toBe(0.4);
      expect(result.fixStrategies![2].id).toBe('low-fix');

      // Verify confidence is in descending order
      for (let i = 1; i < result.fixStrategies!.length; i++) {
        expect(result.fixStrategies![i - 1].confidence).toBeGreaterThanOrEqual(
          result.fixStrategies![i].confidence
        );
      }
    });
  });

  describe('Common Error Rules Integration', () => {
    it('should use rule library for high-confidence matches', async () => {
      // EACCES error should match with high confidence and skip AI
      const ctx = createErrorContext({
        stderr: 'EACCES: permission denied, mkdir \'/usr/local/lib/node_modules/pnpm\'',
      });

      const mockAIAgent = {
        diagnoseError: vi.fn(),
        suggestFixes: vi.fn(),
      } as unknown as InstallAIAgent;

      const result = await diagnoseError(ctx, mockAIAgent);

      // Should succeed using rule library
      expect(result.success).toBe(true);
      expect(result.usedRuleLibrary).toBe(true);

      // Should not have called AI
      expect(mockAIAgent.diagnoseError).not.toHaveBeenCalled();
      expect(mockAIAgent.suggestFixes).not.toHaveBeenCalled();

      // Should have fix strategies from rule library
      expect(result.fixStrategies).toBeDefined();
      expect(result.fixStrategies!.length).toBeGreaterThan(0);

      // Should have a basic diagnosis from rule analysis
      expect(result.diagnosis).toBeDefined();
      expect(result.diagnosis!.rootCause).toContain('permission');
      expect(result.diagnosis!.errorType).toBe('permission');
    });

    it('should fall back to AI for unknown errors', async () => {
      const ctx = createErrorContext({
        stderr: 'A completely unknown and obscure error message xyz123',
      });

      const mockDiagnosis: ErrorDiagnosis = {
        rootCause: 'Unknown error',
        errorType: 'unknown',
        affectedComponents: ['test-step'],
        isPermanent: false,
        requiresManualIntervention: false,
      };

      const mockFixStrategies = [
        {
          description: 'AI suggested fix',
          commands: ['retry'],
          confidence: 0.5,
          estimatedTime: 60,
          requiresSudo: false,
          riskLevel: 'low' as const,
          reasoning: 'Unknown error, try retrying',
        },
      ];

      const mockAIAgent = {
        diagnoseError: vi.fn().mockResolvedValue({
          success: true,
          data: mockDiagnosis,
        }),
        suggestFixes: vi.fn().mockResolvedValue({
          success: true,
          data: mockFixStrategies,
        }),
      } as unknown as InstallAIAgent;

      const result = await diagnoseError(ctx, mockAIAgent);

      // Should succeed using AI
      expect(result.success).toBe(true);
      expect(result.usedRuleLibrary).toBe(false);

      // Should have called AI
      expect(mockAIAgent.diagnoseError).toHaveBeenCalledOnce();
      expect(mockAIAgent.suggestFixes).toHaveBeenCalledOnce();

      // Should have diagnosis and fix strategies from AI
      expect(result.diagnosis).toEqual(mockDiagnosis);
      expect(result.fixStrategies).toEqual(mockFixStrategies);
    });

    it('should provide sorted fix strategies from rule library', async () => {
      const ctx = createErrorContext({
        stderr: 'ETIMEDOUT connecting to registry',
      });

      const mockAIAgent = {
        diagnoseError: vi.fn(),
        suggestFixes: vi.fn(),
      } as unknown as InstallAIAgent;

      const result = await diagnoseError(ctx, mockAIAgent);

      expect(result.success).toBe(true);
      expect(result.usedRuleLibrary).toBe(true);
      expect(result.fixStrategies).toBeDefined();
      expect(result.fixStrategies!.length).toBeGreaterThan(0);

      // Verify strategies are sorted by confidence (descending)
      for (let i = 1; i < result.fixStrategies!.length; i++) {
        expect(result.fixStrategies![i - 1].confidence).toBeGreaterThanOrEqual(
          result.fixStrategies![i].confidence
        );
      }
    });

    it('should set isPermanent correctly based on error type', async () => {
      // Network errors are transient
      const networkCtx = createErrorContext({
        stderr: 'ETIMEDOUT network timeout',
      });

      const mockAIAgent = {
        diagnoseError: vi.fn(),
        suggestFixes: vi.fn(),
      } as unknown as InstallAIAgent;

      const networkResult = await diagnoseError(networkCtx, mockAIAgent);
      expect(networkResult.success).toBe(true);
      expect(networkResult.diagnosis!.isPermanent).toBe(false);

      // Permission errors are permanent
      const permissionCtx = createErrorContext({
        stderr: 'EACCES: permission denied',
      });

      const permissionResult = await diagnoseError(permissionCtx, mockAIAgent);
      expect(permissionResult.success).toBe(true);
      expect(permissionResult.diagnosis!.isPermanent).toBe(true);
    });

    it('should set requiresManualIntervention based on sudo requirement', async () => {
      const ctx = createErrorContext({
        stderr: 'EACCES: permission denied, mkdir',
      });

      const mockAIAgent = {
        diagnoseError: vi.fn(),
        suggestFixes: vi.fn(),
      } as unknown as InstallAIAgent;

      const result = await diagnoseError(ctx, mockAIAgent);

      expect(result.success).toBe(true);
      expect(result.usedRuleLibrary).toBe(true);

      // At least one fix strategy should require sudo for permission errors
      const hasSudoStrategy = result.fixStrategies!.some(s => s.requiresSudo);
      expect(hasSudoStrategy).toBe(true);

      // requiresManualIntervention should be true if any strategy requires sudo
      expect(result.diagnosis!.requiresManualIntervention).toBe(true);
    });

    it('should handle AI fallback when rule match is below threshold', async () => {
      // This would need a lower confidence match, but our current rules
      // are designed to be high confidence. This test verifies the fallback
      // behavior when shouldSkipAI returns false.

      const ctx = createErrorContext({
        stderr: 'Some error that might match a rule with low confidence',
      });

      const mockDiagnosis: ErrorDiagnosis = {
        rootCause: 'AI analyzed error',
        errorType: 'configuration',
        affectedComponents: ['test-step'],
        isPermanent: true,
        requiresManualIntervention: false,
      };

      const mockFixStrategies = [
        {
          description: 'AI fix',
          commands: ['fix-command'],
          confidence: 0.8,
          estimatedTime: 120,
          requiresSudo: false,
          riskLevel: 'low' as const,
          reasoning: 'AI reasoning',
        },
      ];

      const mockAIAgent = {
        diagnoseError: vi.fn().mockResolvedValue({
          success: true,
          data: mockDiagnosis,
        }),
        suggestFixes: vi.fn().mockResolvedValue({
          success: true,
          data: mockFixStrategies,
        }),
      } as unknown as InstallAIAgent;

      const result = await diagnoseError(ctx, mockAIAgent);

      // For unknown errors, should use AI
      expect(result.usedRuleLibrary).toBe(false);
      expect(mockAIAgent.diagnoseError).toHaveBeenCalled();
    });
  });
});
