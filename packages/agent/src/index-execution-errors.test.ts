// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for execution error handling in the agent.
 *
 * Verifies that permission errors and dependency errors are detected
 * and displayed with actionable suggestions to the user.
 *
 * @module index-execution-errors.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ErrorContext, EnvironmentInfo } from '@aiinstaller/shared';
import { formatPlainError, renderHighlightedError } from './ui/error-messages.js';

// ============================================================================
// Test: Permission Error Detection
// ============================================================================

describe('Execution error handling', () => {
  describe('Permission errors', () => {
    const mockEnv: EnvironmentInfo = {
      os: {
        platform: 'darwin',
        arch: 'arm64',
        version: '14.0.0',
        hostname: 'test-host',
        username: 'testuser',
        homeDir: '/Users/testuser',
      },
      runtime: {
        node: 'v22.0.0',
        npm: '10.0.0',
        pnpm: undefined,
        yarn: undefined,
      },
      packageManagers: {
        npm: { path: '/usr/local/bin/npm', version: '10.0.0' },
      },
      shell: {
        type: 'zsh',
        path: '/bin/zsh',
        envPath: '/usr/local/bin:/usr/bin:/bin',
      },
      network: {
        canAccessNpm: true,
        canAccessGithub: true,
      },
    };

    it('should detect EACCES permission denied error', () => {
      const errorContext: ErrorContext = {
        stepId: 'install-global',
        command: 'npm install -g pnpm',
        exitCode: 1,
        stdout: '',
        stderr: 'EACCES: permission denied, mkdir \'/usr/local/lib/node_modules/pnpm\'',
        environment: mockEnv,
        previousSteps: [],
      };

      const result = formatPlainError(errorContext);

      expect(result.category).toBe('permission');
      expect(result.title).toContain('Permission denied');
      expect(result.severity).toBe('high');
      expect(result.nextSteps.length).toBeGreaterThan(0);
      expect(result.nextSteps.some((step) => step.toLowerCase().includes('sudo') || step.toLowerCase().includes('pnpm setup'))).toBe(true);
    });

    it('should detect EPERM operation not permitted error', () => {
      const errorContext: ErrorContext = {
        stepId: 'install-global',
        command: 'npm install -g typescript',
        exitCode: 1,
        stdout: '',
        stderr: 'EPERM: operation not permitted, symlink \'/usr/local/lib/node_modules\'',
        environment: mockEnv,
        previousSteps: [],
      };

      const result = formatPlainError(errorContext);

      expect(result.category).toBe('permission');
      expect(result.title).toContain('Operation not allowed');
      expect(result.severity).toBe('high');
      expect(result.nextSteps.some((step) => step.toLowerCase().includes('nvm'))).toBe(true);
    });

    it('should detect "Missing write access" error', () => {
      const errorContext: ErrorContext = {
        stepId: 'install-global',
        command: 'npm install -g eslint',
        exitCode: 1,
        stdout: '',
        stderr: 'Missing write access to /usr/local/lib/node_modules',
        environment: mockEnv,
        previousSteps: [],
      };

      const result = formatPlainError(errorContext);

      expect(result.category).toBe('permission');
      expect(result.title).toContain('Cannot write to install directory');
      expect(result.severity).toBe('high');
      expect(result.nextSteps.some((step) => step.includes('pnpm setup'))).toBe(true);
    });

    it('should suggest sudo for permission errors', () => {
      const errorContext: ErrorContext = {
        stepId: 'install-global',
        command: 'npm install -g pnpm',
        exitCode: 1,
        stdout: '',
        stderr: 'EACCES: permission denied, access \'/usr/local/lib\'',
        environment: mockEnv,
        previousSteps: [],
      };

      const result = formatPlainError(errorContext);

      expect(result.nextSteps.some((step) => step.toLowerCase().includes('sudo'))).toBe(true);
    });
  });

  describe('Dependency errors', () => {
    const mockEnv: EnvironmentInfo = {
      os: {
        platform: 'darwin',
        arch: 'arm64',
        version: '14.0.0',
        hostname: 'test-host',
        username: 'testuser',
        homeDir: '/Users/testuser',
      },
      runtime: {
        node: undefined,
        npm: undefined,
        pnpm: undefined,
        yarn: undefined,
      },
      packageManagers: {},
      shell: {
        type: 'bash',
        path: '/bin/bash',
        envPath: '/usr/bin:/bin',
      },
      network: {
        canAccessNpm: true,
        canAccessGithub: true,
      },
    };

    it('should detect "node: command not found" error', () => {
      const errorContext: ErrorContext = {
        stepId: 'check-node',
        command: 'node --version',
        exitCode: 127,
        stdout: '',
        stderr: 'node: command not found',
        environment: mockEnv,
        previousSteps: [],
      };

      const result = formatPlainError(errorContext);

      expect(result.category).toBe('dependency');
      expect(result.title).toContain('Node.js is not installed');
      expect(result.severity).toBe('critical');
      expect(result.nextSteps.some((step) => step.includes('nvm') || step.includes('nodejs.org'))).toBe(true);
    });

    it('should detect "pnpm: command not found" error', () => {
      const errorContext: ErrorContext = {
        stepId: 'install-deps',
        command: 'pnpm install',
        exitCode: 127,
        stdout: '',
        stderr: 'pnpm: command not found',
        environment: mockEnv,
        previousSteps: [],
      };

      const result = formatPlainError(errorContext);

      expect(result.category).toBe('dependency');
      expect(result.title).toContain('pnpm is not installed');
      expect(result.severity).toBe('high');
      expect(result.nextSteps.some((step) => step.includes('corepack') || step.includes('npm install -g pnpm'))).toBe(true);
    });

    it('should detect generic "command not found" error', () => {
      const errorContext: ErrorContext = {
        stepId: 'run-custom-tool',
        command: 'mytool --help',
        exitCode: 127,
        stdout: '',
        stderr: 'mytool: command not found',
        environment: mockEnv,
        previousSteps: [],
      };

      const result = formatPlainError(errorContext);

      expect(result.category).toBe('dependency');
      expect(result.title).toContain('mytool');
      expect(result.title).toContain('is not installed');
      expect(result.severity).toBe('high');
      expect(result.nextSteps.length).toBeGreaterThan(0);
    });

    it('should detect "Cannot find module" error', () => {
      const errorContext: ErrorContext = {
        stepId: 'run-script',
        command: 'node index.js',
        exitCode: 1,
        stdout: '',
        stderr: 'Error: Cannot find module \'express\'',
        environment: mockEnv,
        previousSteps: [],
      };

      const result = formatPlainError(errorContext);

      expect(result.category).toBe('dependency');
      expect(result.title).toContain('Missing module');
      expect(result.technicalDetail).toContain('express');
      expect(result.nextSteps.some((step) => step.includes('npm install') || step.includes('pnpm install'))).toBe(true);
    });

    it('should detect dependency resolution error (ERESOLVE)', () => {
      const errorContext: ErrorContext = {
        stepId: 'install-deps',
        command: 'npm install',
        exitCode: 1,
        stdout: '',
        stderr: 'ERESOLVE unable to resolve dependency tree',
        environment: mockEnv,
        previousSteps: [],
      };

      const result = formatPlainError(errorContext);

      expect(result.category).toBe('dependency');
      expect(result.title).toContain('Package version conflict');
      expect(result.nextSteps.some((step) => step.includes('--legacy-peer-deps') || step.includes('--force'))).toBe(true);
    });

    it('should detect 404 package not found error', () => {
      const errorContext: ErrorContext = {
        stepId: 'install-pkg',
        command: 'npm install nonexistent-package',
        exitCode: 1,
        stdout: '',
        stderr: '404 Not Found - GET https://registry.npmjs.org/nonexistent-package',
        environment: mockEnv,
        previousSteps: [],
      };

      const result = formatPlainError(errorContext);

      expect(result.category).toBe('dependency');
      expect(result.title).toContain('Package not found');
      expect(result.nextSteps.some((step) => step.toLowerCase().includes('check'))).toBe(true);
    });

    it('should detect native build failure (node-gyp)', () => {
      const errorContext: ErrorContext = {
        stepId: 'install-native',
        command: 'npm install node-sass',
        exitCode: 1,
        stdout: '',
        stderr: 'gyp ERR! build error\ngyp ERR! stack Error: `make` failed with exit code: 2',
        environment: mockEnv,
        previousSteps: [],
      };

      const result = formatPlainError(errorContext);

      expect(result.category).toBe('dependency');
      expect(result.title).toContain('Native code build failed');
      expect(result.nextSteps.some((step) => step.includes('xcode-select') || step.includes('build-essential'))).toBe(true);
    });

    it('should auto-generate dependency installation command for missing tools', () => {
      const errorContext: ErrorContext = {
        stepId: 'check-git',
        command: 'git --version',
        exitCode: 127,
        stdout: '',
        stderr: 'git: command not found',
        environment: mockEnv,
        previousSteps: [],
      };

      const result = formatPlainError(errorContext);

      expect(result.category).toBe('dependency');
      expect(result.nextSteps.some((step) => step.toLowerCase().includes('install'))).toBe(true);
    });
  });

  describe('Error message rendering', () => {
    const mockEnv: EnvironmentInfo = {
      os: {
        platform: 'darwin',
        arch: 'arm64',
        version: '14.0.0',
        hostname: 'test-host',
        username: 'testuser',
        homeDir: '/Users/testuser',
      },
      runtime: {
        node: 'v22.0.0',
        npm: '10.0.0',
        pnpm: undefined,
        yarn: undefined,
      },
      packageManagers: {
        npm: { path: '/usr/local/bin/npm', version: '10.0.0' },
      },
      shell: {
        type: 'zsh',
        path: '/bin/zsh',
        envPath: '/usr/local/bin:/usr/bin:/bin',
      },
      network: {
        canAccessNpm: true,
        canAccessGithub: true,
      },
    };

    it('should render highlighted error message for permission errors', () => {
      const errorContext: ErrorContext = {
        stepId: 'install-global',
        command: 'npm install -g pnpm',
        exitCode: 1,
        stdout: '',
        stderr: 'EACCES: permission denied',
        environment: mockEnv,
        previousSteps: [],
      };

      const plainError = formatPlainError(errorContext);
      const rendered = renderHighlightedError(plainError);

      expect(rendered).toBeTruthy();
      expect(rendered.length).toBeGreaterThan(0);
      // Should contain title
      expect(rendered).toContain('Permission denied');
      // Should contain next steps
      expect(rendered).toContain('Next steps');
    });

    it('should render highlighted error message for dependency errors', () => {
      const errorContext: ErrorContext = {
        stepId: 'check-node',
        command: 'node --version',
        exitCode: 127,
        stdout: '',
        stderr: 'node: command not found',
        environment: mockEnv,
        previousSteps: [],
      };

      const plainError = formatPlainError(errorContext);
      const rendered = renderHighlightedError(plainError);

      expect(rendered).toBeTruthy();
      expect(rendered.length).toBeGreaterThan(0);
      // Should contain title
      expect(rendered).toContain('Node.js is not installed');
      // Should contain severity
      expect(rendered).toContain('Critical');
      // Should contain next steps
      expect(rendered).toContain('Next steps');
    });

    it('should include help links in rendered output', () => {
      const errorContext: ErrorContext = {
        stepId: 'install-deps',
        command: 'npm install',
        exitCode: 1,
        stdout: '',
        stderr: 'ENOTFOUND registry.npmjs.org',
        environment: mockEnv,
        previousSteps: [],
      };

      const plainError = formatPlainError(errorContext);
      const rendered = renderHighlightedError(plainError);

      if (plainError.helpLinks.length > 0) {
        expect(rendered).toContain('Help links');
      }
    });
  });

  describe('Error severity levels', () => {
    const mockEnv: EnvironmentInfo = {
      os: {
        platform: 'darwin',
        arch: 'arm64',
        version: '14.0.0',
        hostname: 'test-host',
        username: 'testuser',
        homeDir: '/Users/testuser',
      },
      runtime: {
        node: 'v22.0.0',
        npm: '10.0.0',
        pnpm: undefined,
        yarn: undefined,
      },
      packageManagers: {
        npm: { path: '/usr/local/bin/npm', version: '10.0.0' },
      },
      shell: {
        type: 'zsh',
        path: '/bin/zsh',
        envPath: '/usr/local/bin:/usr/bin:/bin',
      },
      network: {
        canAccessNpm: true,
        canAccessGithub: true,
      },
    };

    it('should assign critical severity to missing Node.js', () => {
      const errorContext: ErrorContext = {
        stepId: 'check-node',
        command: 'node --version',
        exitCode: 127,
        stdout: '',
        stderr: 'node: command not found',
        environment: mockEnv,
        previousSteps: [],
      };

      const result = formatPlainError(errorContext);
      expect(result.severity).toBe('critical');
    });

    it('should assign high severity to permission errors', () => {
      const errorContext: ErrorContext = {
        stepId: 'install-global',
        command: 'npm install -g pnpm',
        exitCode: 1,
        stdout: '',
        stderr: 'EACCES: permission denied',
        environment: mockEnv,
        previousSteps: [],
      };

      const result = formatPlainError(errorContext);
      expect(result.severity).toBe('high');
    });

    it('should assign high severity to missing dependencies', () => {
      const errorContext: ErrorContext = {
        stepId: 'install-deps',
        command: 'pnpm install',
        exitCode: 127,
        stdout: '',
        stderr: 'pnpm: command not found',
        environment: mockEnv,
        previousSteps: [],
      };

      const result = formatPlainError(errorContext);
      expect(result.severity).toBe('high');
    });
  });

  describe('Actionable suggestions', () => {
    const mockEnv: EnvironmentInfo = {
      os: {
        platform: 'darwin',
        arch: 'arm64',
        version: '14.0.0',
        hostname: 'test-host',
        username: 'testuser',
        homeDir: '/Users/testuser',
      },
      runtime: {
        node: 'v22.0.0',
        npm: '10.0.0',
        pnpm: undefined,
        yarn: undefined,
      },
      packageManagers: {
        npm: { path: '/usr/local/bin/npm', version: '10.0.0' },
      },
      shell: {
        type: 'zsh',
        path: '/bin/zsh',
        envPath: '/usr/local/bin:/usr/bin:/bin',
      },
      network: {
        canAccessNpm: true,
        canAccessGithub: true,
      },
    };

    it('should provide specific commands for fixing permission errors', () => {
      const errorContext: ErrorContext = {
        stepId: 'install-global',
        command: 'npm install -g pnpm',
        exitCode: 1,
        stdout: '',
        stderr: 'EACCES: permission denied',
        environment: mockEnv,
        previousSteps: [],
      };

      const result = formatPlainError(errorContext);

      // Should suggest either pnpm setup or sudo or nvm
      const hasActionableCommand = result.nextSteps.some((step) =>
        step.includes('pnpm setup') ||
        step.includes('sudo npm') ||
        step.includes('nvm')
      );
      expect(hasActionableCommand).toBe(true);
    });

    it('should provide specific commands for installing missing dependencies', () => {
      const errorContext: ErrorContext = {
        stepId: 'check-pnpm',
        command: 'pnpm --version',
        exitCode: 127,
        stdout: '',
        stderr: 'pnpm: command not found',
        environment: mockEnv,
        previousSteps: [],
      };

      const result = formatPlainError(errorContext);

      // Should suggest corepack or npm install
      const hasInstallCommand = result.nextSteps.some((step) =>
        step.includes('corepack enable') ||
        step.includes('npm install -g pnpm')
      );
      expect(hasInstallCommand).toBe(true);
    });

    it('should provide platform-specific suggestions', () => {
      const macEnv: EnvironmentInfo = {
        ...mockEnv,
        os: { ...mockEnv.os, platform: 'darwin' },
      };

      const errorContext: ErrorContext = {
        stepId: 'build-native',
        command: 'npm install node-sass',
        exitCode: 1,
        stdout: '',
        stderr: 'gyp ERR! build error',
        environment: macEnv,
        previousSteps: [],
      };

      const result = formatPlainError(errorContext);

      // Should suggest xcode-select for macOS
      const hasMacSpecific = result.nextSteps.some((step) =>
        step.includes('xcode-select')
      );
      expect(hasMacSpecific).toBe(true);
    });
  });
});
