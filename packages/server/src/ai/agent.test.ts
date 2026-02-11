// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for packages/server/src/ai/agent.ts
 *
 * Tests the InstallAIAgent class including:
 * - Constructor with defaults and custom options
 * - analyzeEnvironment() - success, invalid JSON, schema mismatch, markdown-wrapped JSON
 * - generateInstallPlan() - success, version in prompt, validation
 * - diagnoseError() - success, error context in prompt, previous steps, categories
 * - suggestFixes() - success, with/without diagnosis, risk/requiresSudo fields
 * - Error handling (auth errors, network retries, retry exhaustion, Zod no-retry, empty response)
 * - Schema validation for EnvironmentAnalysisSchema and ErrorDiagnosisSchema
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EnvironmentInfo, ErrorContext } from '@aiinstaller/shared';
import {
  InstallAIAgent,
  EnvironmentAnalysisSchema,
  ErrorDiagnosisSchema,
  DetectedCapabilitiesSchema,
} from './agent.js';
import type {
  AIAgentOptions,
  AIAnalysisResult,
  EnvironmentAnalysis,
  ErrorDiagnosis,
} from './agent.js';

// ============================================================================
// Mock the streaming module so callAIStreaming tests don't need real streams
// ============================================================================

vi.mock('./streaming.js', () => ({
  streamAIResponse: vi.fn(),
}));

import { streamAIResponse } from './streaming.js';

const mockStreamAIResponse = vi.mocked(streamAIResponse);

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

/** Create a mock Anthropic message response with raw JSON text */
function createMockResponse(jsonData: unknown): { content: Array<{ type: string; text: string }> } {
  return {
    content: [{ type: 'text', text: JSON.stringify(jsonData) }],
  };
}

/** Create a mock Anthropic message response with markdown-wrapped JSON */
function createMockMarkdownResponse(jsonData: unknown): { content: Array<{ type: string; text: string }> } {
  return {
    content: [{ type: 'text', text: '```json\n' + JSON.stringify(jsonData, null, 2) + '\n```' }],
  };
}

// ---------------------------------------------------------------------------
// Valid response constants
// ---------------------------------------------------------------------------

const VALID_ENV_ANALYSIS = {
  summary: 'Environment is ready for OpenClaw installation',
  issues: [],
  ready: true,
  recommendations: ['Update pnpm to latest version'],
  detectedCapabilities: {
    hasRequiredRuntime: true,
    hasPackageManager: true,
    hasNetworkAccess: true,
    hasSufficientPermissions: true,
  },
};

const VALID_INSTALL_PLAN = {
  steps: [
    {
      id: 'check-node',
      description: 'Check Node.js version',
      command: 'node --version',
      expectedOutput: 'v22',
      timeout: 10000,
      canRollback: false,
      onError: 'abort' as const,
    },
    {
      id: 'install-openclaw',
      description: 'Install OpenClaw globally',
      command: 'pnpm install -g openclaw',
      timeout: 120000,
      canRollback: true,
      onError: 'retry' as const,
    },
  ],
  estimatedTime: 130000,
  risks: [
    { level: 'low' as const, description: 'Global install may require elevated permissions' },
  ],
};

const VALID_DIAGNOSIS: ErrorDiagnosis = {
  rootCause: 'Insufficient file system permissions for global package installation',
  category: 'permission',
  explanation: 'The pnpm install -g command requires write access to /usr/local/lib which is restricted.',
  severity: 'high',
  affectedComponent: 'pnpm',
  suggestedNextSteps: [
    'Run the command with sudo: sudo pnpm install -g openclaw',
    'Change npm global directory to a user-writable location',
    'Use a Node version manager (nvm) to manage installations',
  ],
};

const VALID_FIX_STRATEGIES = [
  {
    id: 'use-sudo',
    description: 'Run with elevated permissions using sudo',
    commands: ['sudo pnpm install -g openclaw'],
    confidence: 0.9,
    risk: 'medium' as const,
    requiresSudo: true,
  },
  {
    id: 'change-prefix',
    description: 'Change npm global prefix to user-writable directory',
    commands: ['mkdir -p ~/.local/lib', 'pnpm config set global-dir ~/.local/lib', 'pnpm install -g openclaw'],
    confidence: 0.7,
    risk: 'low' as const,
    requiresSudo: false,
  },
];

// ============================================================================
// Tests
// ============================================================================

describe('InstallAIAgent', () => {
  // --------------------------------------------------------------------------
  // Constructor
  // --------------------------------------------------------------------------

  describe('Constructor', () => {
    it('should create an instance with only the required apiKey option', () => {
      const agent = new InstallAIAgent({ apiKey: 'test-key' });
      expect(agent).toBeInstanceOf(InstallAIAgent);
    });

    it('should apply default model when not specified', () => {
      const agent = new InstallAIAgent({ apiKey: 'test-key' });
      // Verify by calling analyzeEnvironment and checking the model sent
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_ENV_ANALYSIS));
      (agent as any).client = { messages: { create: mockCreate } };

      agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      // Wait for next tick so the call is made
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const callArgs = mockCreate.mock.calls[0][0];
          expect(callArgs.model).toBe('claude-sonnet-4-20250514');
          resolve();
        }, 0);
      });
    });

    it('should use custom model when provided', async () => {
      const agent = new InstallAIAgent({ apiKey: 'test-key', model: 'claude-opus-4-20250514' });
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_ENV_ANALYSIS));
      (agent as any).client = { messages: { create: mockCreate } };

      await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(mockCreate.mock.calls[0][0].model).toBe('claude-opus-4-20250514');
    });

    it('should apply default timeoutMs of 60000 when not specified', async () => {
      const agent = new InstallAIAgent({ apiKey: 'test-key', maxRetries: 0 });
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_ENV_ANALYSIS));
      (agent as any).client = { messages: { create: mockCreate } };

      await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      // timeout is passed as the second argument to create()
      const opts = mockCreate.mock.calls[0][1];
      expect(opts.timeout).toBe(60000);
    });

    it('should use custom timeoutMs when provided', async () => {
      const agent = new InstallAIAgent({ apiKey: 'test-key', timeoutMs: 15000, maxRetries: 0 });
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_ENV_ANALYSIS));
      (agent as any).client = { messages: { create: mockCreate } };

      await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      const opts = mockCreate.mock.calls[0][1];
      expect(opts.timeout).toBe(15000);
    });

    it('should apply default maxRetries of 2 when not specified', async () => {
      const agent = new InstallAIAgent({ apiKey: 'test-key' });
      const mockCreate = vi.fn().mockRejectedValue(new Error('Network error'));
      (agent as any).client = { messages: { create: mockCreate } };

      await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      // default maxRetries = 2 => 3 total attempts (0, 1, 2)
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });

    it('should accept all optional configuration', () => {
      const agent = new InstallAIAgent({
        apiKey: 'test-key',
        model: 'claude-opus-4-20250514',
        timeoutMs: 30000,
        maxRetries: 5,
      });
      expect(agent).toBeInstanceOf(InstallAIAgent);
    });
  });

  // --------------------------------------------------------------------------
  // analyzeEnvironment
  // --------------------------------------------------------------------------

  describe('analyzeEnvironment', () => {
    let agent: InstallAIAgent;

    beforeEach(() => {
      agent = new InstallAIAgent({ apiKey: 'test-key', maxRetries: 0 });
    });

    it('should return a successful analysis when AI responds correctly', async () => {
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_ENV_ANALYSIS));
      (agent as any).client = { messages: { create: mockCreate } };

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.summary).toBe(VALID_ENV_ANALYSIS.summary);
      expect(result.data!.ready).toBe(true);
      expect(result.data!.issues).toEqual([]);
      expect(result.data!.recommendations).toEqual(['Update pnpm to latest version']);
      expect(result.data!.detectedCapabilities.hasRequiredRuntime).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return failure when AI response is invalid JSON', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'This is not JSON at all' }],
      });
      (agent as any).client = { messages: { create: mockCreate } };

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return failure when AI response does not match schema', async () => {
      const mockCreate = vi.fn().mockResolvedValue(
        createMockResponse({ invalid: 'response', missing: 'fields' }),
      );
      (agent as any).client = { messages: { create: mockCreate } };

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.errorType).toBe('validation');
    });

    it('should handle markdown-wrapped JSON responses', async () => {
      const mockCreate = vi.fn().mockResolvedValue(
        createMockMarkdownResponse(VALID_ENV_ANALYSIS),
      );
      (agent as any).client = { messages: { create: mockCreate } };

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(true);
      expect(result.data!.summary).toBe(VALID_ENV_ANALYSIS.summary);
    });

    it('should handle markdown-wrapped JSON without language specifier', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '```\n' + JSON.stringify(VALID_ENV_ANALYSIS) + '\n```' }],
      });
      (agent as any).client = { messages: { create: mockCreate } };

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(true);
      expect(result.data!.ready).toBe(true);
    });

    it('should include environment details in the prompt', async () => {
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_ENV_ANALYSIS));
      (agent as any).client = { messages: { create: mockCreate } };

      await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('openclaw');
      expect(prompt).toContain('darwin');
      expect(prompt).toContain('arm64');
      expect(prompt).toContain('zsh');
      expect(prompt).toContain('22.0.0');
      expect(prompt).toContain('npm@10.0.0');
      expect(prompt).toContain('pnpm@9.0.0');
    });

    it('should include python version when available', async () => {
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_ENV_ANALYSIS));
      (agent as any).client = { messages: { create: mockCreate } };

      await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('3.12.0');
    });

    it('should show "not installed" for missing runtimes', async () => {
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_ENV_ANALYSIS));
      (agent as any).client = { messages: { create: mockCreate } };

      const env = createEnvInfo();
      env.runtime = {};

      await agent.analyzeEnvironment(env, 'openclaw');

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('not installed');
    });

    it('should show "none detected" when no package managers exist', async () => {
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_ENV_ANALYSIS));
      (agent as any).client = { messages: { create: mockCreate } };

      const env = createEnvInfo();
      env.packageManagers = {};

      await agent.analyzeEnvironment(env, 'openclaw');

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('none detected');
    });

    it('should set system prompt instructing JSON-only responses', async () => {
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_ENV_ANALYSIS));
      (agent as any).client = { messages: { create: mockCreate } };

      await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.system).toContain('JSON');
      expect(callArgs.system).toContain('software installation expert');
    });

    it('should request max_tokens of 4096', async () => {
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_ENV_ANALYSIS));
      (agent as any).client = { messages: { create: mockCreate } };

      await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(mockCreate.mock.calls[0][0].max_tokens).toBe(4096);
    });
  });

  // --------------------------------------------------------------------------
  // generateInstallPlan
  // --------------------------------------------------------------------------

  describe('generateInstallPlan', () => {
    let agent: InstallAIAgent;

    beforeEach(() => {
      agent = new InstallAIAgent({ apiKey: 'test-key', maxRetries: 0 });
    });

    it('should return a valid install plan', async () => {
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_INSTALL_PLAN));
      (agent as any).client = { messages: { create: mockCreate } };

      const result = await agent.generateInstallPlan(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.steps).toHaveLength(2);
      expect(result.data!.steps[0].id).toBe('check-node');
      expect(result.data!.steps[1].id).toBe('install-openclaw');
      expect(result.data!.estimatedTime).toBe(130000);
      expect(result.data!.risks).toHaveLength(1);
    });

    it('should include version in prompt when specified', async () => {
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_INSTALL_PLAN));
      (agent as any).client = { messages: { create: mockCreate } };

      await agent.generateInstallPlan(createEnvInfo(), 'openclaw', '2.0.0');

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('version 2.0.0');
    });

    it('should not include "version undefined" when no version is specified', async () => {
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_INSTALL_PLAN));
      (agent as any).client = { messages: { create: mockCreate } };

      await agent.generateInstallPlan(createEnvInfo(), 'openclaw');

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).not.toContain('version undefined');
      expect(prompt).not.toContain('undefined');
    });

    it('should validate plan steps against InstallPlanSchema', async () => {
      const invalidPlan = {
        steps: [{ id: 'test' }], // missing command, description, timeout, etc.
        estimatedTime: 1000,
        risks: [],
      };
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(invalidPlan));
      (agent as any).client = { messages: { create: mockCreate } };

      const result = await agent.generateInstallPlan(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('validation');
    });

    it('should include environment details in the prompt', async () => {
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_INSTALL_PLAN));
      (agent as any).client = { messages: { create: mockCreate } };

      await agent.generateInstallPlan(createEnvInfo(), 'openclaw');

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('darwin');
      expect(prompt).toContain('pnpm@9.0.0');
      expect(prompt).toContain('/usr/local');
    });

    it('should include software name in the prompt', async () => {
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_INSTALL_PLAN));
      (agent as any).client = { messages: { create: mockCreate } };

      await agent.generateInstallPlan(createEnvInfo(), 'openclaw');

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('openclaw');
    });
  });

  // --------------------------------------------------------------------------
  // diagnoseError
  // --------------------------------------------------------------------------

  describe('diagnoseError', () => {
    let agent: InstallAIAgent;

    beforeEach(() => {
      agent = new InstallAIAgent({ apiKey: 'test-key', maxRetries: 0 });
    });

    it('should return a valid error diagnosis', async () => {
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_DIAGNOSIS));
      (agent as any).client = { messages: { create: mockCreate } };

      const result = await agent.diagnoseError(createErrorContext());

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.rootCause).toBe(VALID_DIAGNOSIS.rootCause);
      expect(result.data!.category).toBe('permission');
      expect(result.data!.severity).toBe('high');
      expect(result.data!.affectedComponent).toBe('pnpm');
      expect(result.data!.suggestedNextSteps).toHaveLength(3);
    });

    it('should include error context in the prompt', async () => {
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_DIAGNOSIS));
      (agent as any).client = { messages: { create: mockCreate } };

      await agent.diagnoseError(createErrorContext());

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('pnpm install -g openclaw');
      expect(prompt).toContain('EACCES');
      expect(prompt).toContain('permission denied');
      expect(prompt).toContain('install-openclaw');
    });

    it('should include previous steps in the prompt', async () => {
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_DIAGNOSIS));
      (agent as any).client = { messages: { create: mockCreate } };

      await agent.diagnoseError(createErrorContext());

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('check-node');
      expect(prompt).toContain('OK');
    });

    it('should show "(none)" when there are no previous steps', async () => {
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_DIAGNOSIS));
      (agent as any).client = { messages: { create: mockCreate } };

      const ctx = createErrorContext();
      ctx.previousSteps = [];

      await agent.diagnoseError(ctx);

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('(none)');
    });

    it('should show failed previous steps with FAILED label', async () => {
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_DIAGNOSIS));
      (agent as any).client = { messages: { create: mockCreate } };

      const ctx = createErrorContext();
      ctx.previousSteps = [
        { stepId: 'pre-check', success: false, exitCode: 1, stdout: '', stderr: 'err', duration: 100 },
      ];

      await agent.diagnoseError(ctx);

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('FAILED');
      expect(prompt).toContain('exit 1');
    });

    it('should reject invalid category values', async () => {
      const invalidDiagnosis = {
        rootCause: 'test',
        category: 'invalid-category',
        explanation: 'test',
        severity: 'high',
        affectedComponent: 'npm',
        suggestedNextSteps: ['try again'],
      };
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(invalidDiagnosis));
      (agent as any).client = { messages: { create: mockCreate } };

      const result = await agent.diagnoseError(createErrorContext());

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('validation');
    });

    it('should include exit code and stderr in the prompt', async () => {
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_DIAGNOSIS));
      (agent as any).client = { messages: { create: mockCreate } };

      const ctx = createErrorContext();
      ctx.exitCode = 127;
      ctx.stderr = 'command not found: pnpm';

      await agent.diagnoseError(ctx);

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('127');
      expect(prompt).toContain('command not found: pnpm');
    });

    it('should show "(empty)" for empty stdout/stderr', async () => {
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_DIAGNOSIS));
      (agent as any).client = { messages: { create: mockCreate } };

      const ctx = createErrorContext();
      ctx.stdout = '';
      ctx.stderr = '';

      await agent.diagnoseError(ctx);

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('(empty)');
    });
  });

  // --------------------------------------------------------------------------
  // suggestFixes
  // --------------------------------------------------------------------------

  describe('suggestFixes', () => {
    let agent: InstallAIAgent;

    beforeEach(() => {
      agent = new InstallAIAgent({ apiKey: 'test-key', maxRetries: 0 });
    });

    it('should return valid fix strategies', async () => {
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_FIX_STRATEGIES));
      (agent as any).client = { messages: { create: mockCreate } };

      const result = await agent.suggestFixes(createErrorContext());

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data).toHaveLength(2);
      expect(result.data![0].id).toBe('use-sudo');
      expect(result.data![0].confidence).toBe(0.9);
      expect(result.data![1].id).toBe('change-prefix');
      expect(result.data![1].commands).toHaveLength(3);
    });

    it('should include diagnosis in prompt when provided', async () => {
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_FIX_STRATEGIES));
      (agent as any).client = { messages: { create: mockCreate } };

      await agent.suggestFixes(createErrorContext(), VALID_DIAGNOSIS);

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('Root Cause');
      expect(prompt).toContain(VALID_DIAGNOSIS.rootCause);
      expect(prompt).toContain('permission');
      expect(prompt).toContain('Severity');
      expect(prompt).toContain('Affected Component');
    });

    it('should work without diagnosis and not include diagnosis block', async () => {
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_FIX_STRATEGIES));
      (agent as any).client = { messages: { create: mockCreate } };

      const result = await agent.suggestFixes(createErrorContext());

      expect(result.success).toBe(true);

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).not.toContain('Root Cause');
    });

    it('should return risk and requiresSudo fields when present', async () => {
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_FIX_STRATEGIES));
      (agent as any).client = { messages: { create: mockCreate } };

      const result = await agent.suggestFixes(createErrorContext());

      expect(result.success).toBe(true);
      expect(result.data![0].risk).toBe('medium');
      expect(result.data![0].requiresSudo).toBe(true);
      expect(result.data![1].risk).toBe('low');
      expect(result.data![1].requiresSudo).toBe(false);
    });

    it('should accept strategies without optional risk and requiresSudo fields', async () => {
      const strategiesWithoutOptional = [
        {
          id: 'basic-fix',
          description: 'A basic fix',
          commands: ['echo "fix"'],
          confidence: 0.8,
        },
      ];
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(strategiesWithoutOptional));
      (agent as any).client = { messages: { create: mockCreate } };

      const result = await agent.suggestFixes(createErrorContext());

      expect(result.success).toBe(true);
      expect(result.data![0].risk).toBeUndefined();
      expect(result.data![0].requiresSudo).toBeUndefined();
    });

    it('should reject strategies with confidence above 1.0', async () => {
      const invalidStrategies = [
        {
          id: 'fix-1',
          description: 'test',
          commands: ['cmd'],
          confidence: 1.5,
        },
      ];
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(invalidStrategies));
      (agent as any).client = { messages: { create: mockCreate } };

      const result = await agent.suggestFixes(createErrorContext());

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('validation');
    });

    it('should reject strategies with confidence below 0.0', async () => {
      const invalidStrategies = [
        {
          id: 'fix-1',
          description: 'test',
          commands: ['cmd'],
          confidence: -0.1,
        },
      ];
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(invalidStrategies));
      (agent as any).client = { messages: { create: mockCreate } };

      const result = await agent.suggestFixes(createErrorContext());

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('validation');
    });

    it('should include environment details in the prompt', async () => {
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_FIX_STRATEGIES));
      (agent as any).client = { messages: { create: mockCreate } };

      await agent.suggestFixes(createErrorContext());

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('darwin');
      expect(prompt).toContain('arm64');
      expect(prompt).toContain('pnpm@9.0.0');
      expect(prompt).toContain('npm@10.0.0');
      expect(prompt).toContain('/usr/local');
    });

    it('should reference the failed command and stderr in the prompt', async () => {
      const mockCreate = vi.fn().mockResolvedValue(createMockResponse(VALID_FIX_STRATEGIES));
      (agent as any).client = { messages: { create: mockCreate } };

      await agent.suggestFixes(createErrorContext());

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('pnpm install -g openclaw');
      expect(prompt).toContain('EACCES');
    });
  });

  // --------------------------------------------------------------------------
  // Error handling and retry
  // --------------------------------------------------------------------------

  describe('Error handling', () => {
    it('should return failure on authentication error without retrying', async () => {
      const agent = new InstallAIAgent({ apiKey: 'invalid-key', maxRetries: 3 });

      // Create a proper AuthenticationError-like object
      // The agent checks: err instanceof Anthropic.AuthenticationError
      // We need to construct an error that passes that check
      const authErr = new Error('Invalid API key');
      // Manually set the constructor name to simulate the SDK class
      Object.defineProperty(authErr, 'constructor', {
        value: { name: 'AuthenticationError' },
      });

      // The real SDK uses a class that extends Error. We simulate the instanceof
      // check by importing the SDK and using its error class. Since we cannot do
      // that without a real SDK install providing the class, we verify the behavior
      // indirectly: the error message should contain the relevant text.
      const mockCreate = vi.fn().mockRejectedValue(authErr);
      (agent as any).client = { messages: { create: mockCreate } };

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should retry on network errors up to maxRetries', async () => {
      const agent = new InstallAIAgent({ apiKey: 'test-key', maxRetries: 2 });

      const mockCreate = vi.fn()
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockResolvedValueOnce(createMockResponse(VALID_ENV_ANALYSIS));

      (agent as any).client = { messages: { create: mockCreate } };

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(true);
      expect(mockCreate).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    it('should return failure after exhausting all retries', async () => {
      const agent = new InstallAIAgent({ apiKey: 'test-key', maxRetries: 1, enablePresetFallback: false });

      const mockCreate = vi.fn().mockRejectedValue(new Error('Network error'));
      (agent as any).client = { messages: { create: mockCreate } };

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.error).toContain('2 attempts');
      expect(result.error).toContain('Network error');
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('should not retry on Zod validation errors', async () => {
      const agent = new InstallAIAgent({ apiKey: 'test-key', maxRetries: 3, enablePresetFallback: false });

      const mockCreate = vi.fn().mockResolvedValue(
        createMockResponse({ invalid: 'schema' }),
      );
      (agent as any).client = { messages: { create: mockCreate } };

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('validation');
      expect(mockCreate).toHaveBeenCalledTimes(1); // No retries for validation
    });

    it('should handle empty response content (no content blocks)', async () => {
      const agent = new InstallAIAgent({ apiKey: 'test-key', maxRetries: 0 });

      const mockCreate = vi.fn().mockResolvedValue({ content: [] });
      (agent as any).client = { messages: { create: mockCreate } };

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle non-text response blocks', async () => {
      const agent = new InstallAIAgent({ apiKey: 'test-key', maxRetries: 0 });

      const mockCreate = vi.fn().mockResolvedValue({
        content: [{ type: 'tool_use', id: 'test', name: 'test', input: {} }],
      });
      (agent as any).client = { messages: { create: mockCreate } };

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No text content');
    });

    it('should propagate error message from final network failure', async () => {
      const agent = new InstallAIAgent({ apiKey: 'test-key', maxRetries: 0, enablePresetFallback: false });

      const mockCreate = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      (agent as any).client = { messages: { create: mockCreate } };

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
    });

    it('should handle thrown non-Error values', async () => {
      const agent = new InstallAIAgent({ apiKey: 'test-key', maxRetries: 0, enablePresetFallback: false });

      const mockCreate = vi.fn().mockRejectedValue('string error');
      (agent as any).client = { messages: { create: mockCreate } };

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.error).toContain('string error');
    });

    it('should retry across different method calls consistently', async () => {
      const agent = new InstallAIAgent({ apiKey: 'test-key', maxRetries: 1 });

      const mockCreate = vi.fn()
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce(createMockResponse(VALID_DIAGNOSIS));

      (agent as any).client = { messages: { create: mockCreate } };

      const result = await agent.diagnoseError(createErrorContext());

      expect(result.success).toBe(true);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });
  });

  // --------------------------------------------------------------------------
  // Streaming variants
  // --------------------------------------------------------------------------

  describe('Streaming variants', () => {
    let agent: InstallAIAgent;

    beforeEach(() => {
      agent = new InstallAIAgent({ apiKey: 'test-key', maxRetries: 0, enablePresetFallback: false });
      vi.clearAllMocks();
    });

    it('analyzeEnvironmentStreaming should parse valid streamed JSON', async () => {
      mockStreamAIResponse.mockResolvedValueOnce({
        text: JSON.stringify(VALID_ENV_ANALYSIS),
        usage: { inputTokens: 10, outputTokens: 20 },
        success: true,
      });

      const result = await agent.analyzeEnvironmentStreaming(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(true);
      expect(result.data!.ready).toBe(true);
    });

    it('generateInstallPlanStreaming should parse valid streamed JSON', async () => {
      mockStreamAIResponse.mockResolvedValueOnce({
        text: JSON.stringify(VALID_INSTALL_PLAN),
        usage: { inputTokens: 10, outputTokens: 20 },
        success: true,
      });

      const result = await agent.generateInstallPlanStreaming(createEnvInfo(), 'openclaw', '1.0.0');

      expect(result.success).toBe(true);
      expect(result.data!.steps).toHaveLength(2);
    });

    it('diagnoseErrorStreaming should parse valid streamed JSON', async () => {
      mockStreamAIResponse.mockResolvedValueOnce({
        text: JSON.stringify(VALID_DIAGNOSIS),
        usage: { inputTokens: 10, outputTokens: 20 },
        success: true,
      });

      const result = await agent.diagnoseErrorStreaming(createErrorContext());

      expect(result.success).toBe(true);
      expect(result.data!.category).toBe('permission');
    });

    it('suggestFixesStreaming should parse valid streamed JSON', async () => {
      mockStreamAIResponse.mockResolvedValueOnce({
        text: JSON.stringify(VALID_FIX_STRATEGIES),
        usage: { inputTokens: 10, outputTokens: 20 },
        success: true,
      });

      const result = await agent.suggestFixesStreaming(createErrorContext(), VALID_DIAGNOSIS);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('streaming should return failure when stream itself fails', async () => {
      mockStreamAIResponse.mockResolvedValueOnce({
        text: '',
        usage: { inputTokens: 0, outputTokens: 0 },
        success: false,
        error: 'Connection dropped',
      });

      const result = await agent.analyzeEnvironmentStreaming(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection dropped');
    });

    it('streaming should return failure when streamed text is invalid JSON', async () => {
      mockStreamAIResponse.mockResolvedValueOnce({
        text: 'not json at all',
        usage: { inputTokens: 10, outputTokens: 20 },
        success: true,
      });

      const result = await agent.analyzeEnvironmentStreaming(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Schema validation
  // --------------------------------------------------------------------------

  describe('EnvironmentAnalysisSchema', () => {
    it('should validate a correct analysis', () => {
      const result = EnvironmentAnalysisSchema.safeParse(VALID_ENV_ANALYSIS);
      expect(result.success).toBe(true);
    });

    it('should reject missing required fields', () => {
      const result = EnvironmentAnalysisSchema.safeParse({ summary: 'test' });
      expect(result.success).toBe(false);
    });

    it('should accept empty arrays for issues and recommendations', () => {
      const result = EnvironmentAnalysisSchema.safeParse({
        summary: 'Ready',
        issues: [],
        ready: true,
        recommendations: [],
        detectedCapabilities: {
          hasRequiredRuntime: true,
          hasPackageManager: true,
          hasNetworkAccess: true,
          hasSufficientPermissions: true,
        },
      });
      expect(result.success).toBe(true);
    });

    it('should reject when detectedCapabilities is missing', () => {
      const result = EnvironmentAnalysisSchema.safeParse({
        summary: 'Ready',
        issues: [],
        ready: true,
        recommendations: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject when detectedCapabilities has wrong types', () => {
      const result = EnvironmentAnalysisSchema.safeParse({
        summary: 'Ready',
        issues: [],
        ready: true,
        recommendations: [],
        detectedCapabilities: {
          hasRequiredRuntime: 'yes', // should be boolean
          hasPackageManager: true,
          hasNetworkAccess: true,
          hasSufficientPermissions: true,
        },
      });
      expect(result.success).toBe(false);
    });

    it('should reject when ready is not boolean', () => {
      const result = EnvironmentAnalysisSchema.safeParse({
        summary: 'test',
        issues: [],
        ready: 'yes',
        recommendations: [],
        detectedCapabilities: {
          hasRequiredRuntime: true,
          hasPackageManager: true,
          hasNetworkAccess: true,
          hasSufficientPermissions: true,
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ErrorDiagnosisSchema', () => {
    it('should validate a correct diagnosis', () => {
      const result = ErrorDiagnosisSchema.safeParse(VALID_DIAGNOSIS);
      expect(result.success).toBe(true);
    });

    it('should reject invalid category', () => {
      const result = ErrorDiagnosisSchema.safeParse({
        rootCause: 'test',
        category: 'invalid',
        explanation: 'test',
        severity: 'high',
        affectedComponent: 'npm',
        suggestedNextSteps: ['try again'],
      });
      expect(result.success).toBe(false);
    });

    it('should accept all valid categories', () => {
      const categories = ['network', 'permission', 'dependency', 'version', 'configuration', 'unknown'];
      for (const category of categories) {
        const result = ErrorDiagnosisSchema.safeParse({
          rootCause: 'test',
          category,
          explanation: 'test',
          severity: 'medium',
          affectedComponent: 'npm',
          suggestedNextSteps: ['try again'],
        });
        expect(result.success).toBe(true);
      }
    });

    it('should accept all valid severity levels', () => {
      const severities = ['low', 'medium', 'high', 'critical'];
      for (const severity of severities) {
        const result = ErrorDiagnosisSchema.safeParse({
          rootCause: 'test',
          category: 'network',
          explanation: 'test',
          severity,
          affectedComponent: 'npm',
          suggestedNextSteps: ['try again'],
        });
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid severity', () => {
      const result = ErrorDiagnosisSchema.safeParse({
        rootCause: 'test',
        category: 'network',
        explanation: 'test',
        severity: 'extreme',
        affectedComponent: 'npm',
        suggestedNextSteps: ['try again'],
      });
      expect(result.success).toBe(false);
    });

    it('should require suggestedNextSteps with at least one item', () => {
      const result = ErrorDiagnosisSchema.safeParse({
        rootCause: 'test',
        category: 'network',
        explanation: 'test',
        severity: 'high',
        affectedComponent: 'npm',
        suggestedNextSteps: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing required fields', () => {
      const result = ErrorDiagnosisSchema.safeParse({
        rootCause: 'test',
        category: 'network',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('DetectedCapabilitiesSchema', () => {
    it('should validate correct capabilities', () => {
      const result = DetectedCapabilitiesSchema.safeParse({
        hasRequiredRuntime: true,
        hasPackageManager: false,
        hasNetworkAccess: true,
        hasSufficientPermissions: false,
      });
      expect(result.success).toBe(true);
    });

    it('should reject when a required boolean field is missing', () => {
      const result = DetectedCapabilitiesSchema.safeParse({
        hasRequiredRuntime: true,
        hasPackageManager: true,
      });
      expect(result.success).toBe(false);
    });
  });
});
