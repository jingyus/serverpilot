// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for packages/server/src/ai/agent.ts
 *
 * Tests the InstallAIAgent class including:
 * - Constructor with provider-based initialization
 * - analyzeEnvironment() - success, invalid JSON, schema mismatch, markdown-wrapped JSON
 * - generateInstallPlan() - success, version in prompt, validation
 * - diagnoseError() - success, error context in prompt, previous steps, categories
 * - suggestFixes() - success, with/without diagnosis, risk/requiresSudo fields
 * - Error handling (auth errors, network retries, retry exhaustion, Zod no-retry, empty response)
 * - Schema validation for EnvironmentAnalysisSchema and ErrorDiagnosisSchema
 * - Multi-provider support (any AIProviderInterface implementation)
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
  ErrorDiagnosis,
} from './agent.js';
import type {
  AIProviderInterface,
  ChatOptions,
  ChatResponse,
  ProviderStreamCallbacks,
  StreamResponse,
} from './providers/base.js';

// ============================================================================
// Mock Provider Factory
// ============================================================================

/** Create a mock AIProviderInterface for testing */
function createMockProvider(overrides?: Partial<AIProviderInterface>): AIProviderInterface {
  return {
    name: 'mock',
    tier: 1 as const,
    contextWindowSize: 200_000,
    chat: vi.fn<[ChatOptions], Promise<ChatResponse>>().mockResolvedValue({
      content: '{}',
      usage: { inputTokens: 10, outputTokens: 20 },
    }),
    stream: vi.fn<[ChatOptions, ProviderStreamCallbacks?], Promise<StreamResponse>>().mockResolvedValue({
      content: '{}',
      usage: { inputTokens: 10, outputTokens: 20 },
      success: true,
    }),
    isAvailable: vi.fn<[], Promise<boolean>>().mockResolvedValue(true),
    ...overrides,
  };
}

/** Configure mock provider to return JSON content via chat() */
function mockChatResponse(provider: AIProviderInterface, jsonData: unknown): void {
  (provider.chat as ReturnType<typeof vi.fn>).mockResolvedValue({
    content: JSON.stringify(jsonData),
    usage: { inputTokens: 10, outputTokens: 20 },
  });
}

/** Configure mock provider to return markdown-wrapped JSON via chat() */
function mockChatMarkdownResponse(provider: AIProviderInterface, jsonData: unknown): void {
  (provider.chat as ReturnType<typeof vi.fn>).mockResolvedValue({
    content: '```json\n' + JSON.stringify(jsonData, null, 2) + '\n```',
    usage: { inputTokens: 10, outputTokens: 20 },
  });
}

/** Configure mock provider to return JSON via stream() */
function mockStreamResponse(provider: AIProviderInterface, jsonData: unknown): void {
  (provider.stream as ReturnType<typeof vi.fn>).mockResolvedValue({
    content: JSON.stringify(jsonData),
    usage: { inputTokens: 10, outputTokens: 20 },
    success: true,
  });
}

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
    it('should create an instance with a provider', () => {
      const provider = createMockProvider();
      const agent = new InstallAIAgent({ provider });
      expect(agent).toBeInstanceOf(InstallAIAgent);
    });

    it('should throw when no provider is available', () => {
      // Mock getActiveProvider to return null
      vi.mock('./providers/provider-factory.js', () => ({
        getActiveProvider: vi.fn().mockReturnValue(null),
      }));

      expect(() => new InstallAIAgent()).toThrow('No AI provider available');

      vi.restoreAllMocks();
    });

    it('should apply default timeoutMs of 60000 when not specified', async () => {
      const provider = createMockProvider();
      mockChatResponse(provider, VALID_ENV_ANALYSIS);
      const agent = new InstallAIAgent({ provider, maxRetries: 0 });

      await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(chatCall.timeoutMs).toBe(60000);
    });

    it('should use custom timeoutMs when provided', async () => {
      const provider = createMockProvider();
      mockChatResponse(provider, VALID_ENV_ANALYSIS);
      const agent = new InstallAIAgent({ provider, timeoutMs: 15000, maxRetries: 0 });

      await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(chatCall.timeoutMs).toBe(15000);
    });

    it('should apply default maxRetries of 2 when not specified', async () => {
      const provider = createMockProvider();
      (provider.chat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));
      const agent = new InstallAIAgent({ provider });

      await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      // default maxRetries = 2 => 3 total attempts (0, 1, 2)
      expect(provider.chat).toHaveBeenCalledTimes(3);
    });

    it('should accept all optional configuration', () => {
      const provider = createMockProvider();
      const agent = new InstallAIAgent({
        provider,
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
    let provider: AIProviderInterface;
    let agent: InstallAIAgent;

    beforeEach(() => {
      provider = createMockProvider();
      agent = new InstallAIAgent({ provider, maxRetries: 0 });
    });

    it('should return a successful analysis when AI responds correctly', async () => {
      mockChatResponse(provider, VALID_ENV_ANALYSIS);

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
      (provider.chat as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'This is not JSON at all',
        usage: { inputTokens: 10, outputTokens: 20 },
      });

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return failure when AI response does not match schema', async () => {
      mockChatResponse(provider, { invalid: 'response', missing: 'fields' });

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.errorType).toBe('validation');
    });

    it('should handle markdown-wrapped JSON responses', async () => {
      mockChatMarkdownResponse(provider, VALID_ENV_ANALYSIS);

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(true);
      expect(result.data!.summary).toBe(VALID_ENV_ANALYSIS.summary);
    });

    it('should handle markdown-wrapped JSON without language specifier', async () => {
      (provider.chat as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: '```\n' + JSON.stringify(VALID_ENV_ANALYSIS) + '\n```',
        usage: { inputTokens: 10, outputTokens: 20 },
      });

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(true);
      expect(result.data!.ready).toBe(true);
    });

    it('should include environment details in the prompt', async () => {
      mockChatResponse(provider, VALID_ENV_ANALYSIS);

      await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(provider.chat).toHaveBeenCalledTimes(1);
      const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const prompt = chatCall.messages[0].content;
      expect(prompt).toContain('openclaw');
      expect(prompt).toContain('darwin');
      expect(prompt).toContain('arm64');
      expect(prompt).toContain('zsh');
      expect(prompt).toContain('22.0.0');
      expect(prompt).toContain('npm@10.0.0');
      expect(prompt).toContain('pnpm@9.0.0');
    });

    it('should include python version when available', async () => {
      mockChatResponse(provider, VALID_ENV_ANALYSIS);

      await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const prompt = chatCall.messages[0].content;
      expect(prompt).toContain('3.12.0');
    });

    it('should show "not installed" for missing runtimes', async () => {
      mockChatResponse(provider, VALID_ENV_ANALYSIS);

      const env = createEnvInfo();
      env.runtime = {};

      await agent.analyzeEnvironment(env, 'openclaw');

      const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const prompt = chatCall.messages[0].content;
      expect(prompt).toContain('not installed');
    });

    it('should show "none detected" when no package managers exist', async () => {
      mockChatResponse(provider, VALID_ENV_ANALYSIS);

      const env = createEnvInfo();
      env.packageManagers = {};

      await agent.analyzeEnvironment(env, 'openclaw');

      const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const prompt = chatCall.messages[0].content;
      expect(prompt).toContain('none detected');
    });

    it('should set system prompt instructing JSON-only responses', async () => {
      mockChatResponse(provider, VALID_ENV_ANALYSIS);

      await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(chatCall.system).toContain('JSON');
      expect(chatCall.system).toContain('software installation expert');
    });

    it('should request maxTokens of 4096', async () => {
      mockChatResponse(provider, VALID_ENV_ANALYSIS);

      await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(chatCall.maxTokens).toBe(4096);
    });
  });

  // --------------------------------------------------------------------------
  // generateInstallPlan
  // --------------------------------------------------------------------------

  describe('generateInstallPlan', () => {
    let provider: AIProviderInterface;
    let agent: InstallAIAgent;

    beforeEach(() => {
      provider = createMockProvider();
      agent = new InstallAIAgent({ provider, maxRetries: 0 });
    });

    it('should return a valid install plan', async () => {
      mockChatResponse(provider, VALID_INSTALL_PLAN);

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
      mockChatResponse(provider, VALID_INSTALL_PLAN);

      await agent.generateInstallPlan(createEnvInfo(), 'openclaw', '2.0.0');

      const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const prompt = chatCall.messages[0].content;
      expect(prompt).toContain('version 2.0.0');
    });

    it('should not include "version undefined" when no version is specified', async () => {
      mockChatResponse(provider, VALID_INSTALL_PLAN);

      await agent.generateInstallPlan(createEnvInfo(), 'openclaw');

      const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const prompt = chatCall.messages[0].content;
      expect(prompt).not.toContain('version undefined');
      expect(prompt).not.toContain('undefined');
    });

    it('should validate plan steps against InstallPlanSchema', async () => {
      const invalidPlan = {
        steps: [{ id: 'test' }], // missing command, description, timeout, etc.
        estimatedTime: 1000,
        risks: [],
      };
      mockChatResponse(provider, invalidPlan);

      const result = await agent.generateInstallPlan(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('validation');
    });

    it('should include environment details in the prompt', async () => {
      mockChatResponse(provider, VALID_INSTALL_PLAN);

      await agent.generateInstallPlan(createEnvInfo(), 'openclaw');

      const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const prompt = chatCall.messages[0].content;
      expect(prompt).toContain('darwin');
      expect(prompt).toContain('pnpm@9.0.0');
      expect(prompt).toContain('/usr/local');
    });

    it('should include software name in the prompt', async () => {
      mockChatResponse(provider, VALID_INSTALL_PLAN);

      await agent.generateInstallPlan(createEnvInfo(), 'openclaw');

      const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const prompt = chatCall.messages[0].content;
      expect(prompt).toContain('openclaw');
    });
  });

  // --------------------------------------------------------------------------
  // diagnoseError
  // --------------------------------------------------------------------------

  describe('diagnoseError', () => {
    let provider: AIProviderInterface;
    let agent: InstallAIAgent;

    beforeEach(() => {
      provider = createMockProvider();
      agent = new InstallAIAgent({ provider, maxRetries: 0 });
    });

    it('should return a valid error diagnosis', async () => {
      mockChatResponse(provider, VALID_DIAGNOSIS);

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
      mockChatResponse(provider, VALID_DIAGNOSIS);

      await agent.diagnoseError(createErrorContext());

      const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const prompt = chatCall.messages[0].content;
      expect(prompt).toContain('pnpm install -g openclaw');
      expect(prompt).toContain('EACCES');
      expect(prompt).toContain('permission denied');
      expect(prompt).toContain('install-openclaw');
    });

    it('should include previous steps in the prompt', async () => {
      mockChatResponse(provider, VALID_DIAGNOSIS);

      await agent.diagnoseError(createErrorContext());

      const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const prompt = chatCall.messages[0].content;
      expect(prompt).toContain('check-node');
      expect(prompt).toContain('OK');
    });

    it('should show "(none)" when there are no previous steps', async () => {
      mockChatResponse(provider, VALID_DIAGNOSIS);

      const ctx = createErrorContext();
      ctx.previousSteps = [];

      await agent.diagnoseError(ctx);

      const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const prompt = chatCall.messages[0].content;
      expect(prompt).toContain('(none)');
    });

    it('should show failed previous steps with FAILED label', async () => {
      mockChatResponse(provider, VALID_DIAGNOSIS);

      const ctx = createErrorContext();
      ctx.previousSteps = [
        { stepId: 'pre-check', success: false, exitCode: 1, stdout: '', stderr: 'err', duration: 100 },
      ];

      await agent.diagnoseError(ctx);

      const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const prompt = chatCall.messages[0].content;
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
      mockChatResponse(provider, invalidDiagnosis);

      const result = await agent.diagnoseError(createErrorContext());

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('validation');
    });

    it('should include exit code and stderr in the prompt', async () => {
      mockChatResponse(provider, VALID_DIAGNOSIS);

      const ctx = createErrorContext();
      ctx.exitCode = 127;
      ctx.stderr = 'command not found: pnpm';

      await agent.diagnoseError(ctx);

      const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const prompt = chatCall.messages[0].content;
      expect(prompt).toContain('127');
      expect(prompt).toContain('command not found: pnpm');
    });

    it('should show "(empty)" for empty stdout/stderr', async () => {
      mockChatResponse(provider, VALID_DIAGNOSIS);

      const ctx = createErrorContext();
      ctx.stdout = '';
      ctx.stderr = '';

      await agent.diagnoseError(ctx);

      const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const prompt = chatCall.messages[0].content;
      expect(prompt).toContain('(empty)');
    });
  });

  // --------------------------------------------------------------------------
  // suggestFixes
  // --------------------------------------------------------------------------

  describe('suggestFixes', () => {
    let provider: AIProviderInterface;
    let agent: InstallAIAgent;

    beforeEach(() => {
      provider = createMockProvider();
      agent = new InstallAIAgent({ provider, maxRetries: 0 });
    });

    it('should return valid fix strategies', async () => {
      mockChatResponse(provider, VALID_FIX_STRATEGIES);

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
      mockChatResponse(provider, VALID_FIX_STRATEGIES);

      await agent.suggestFixes(createErrorContext(), VALID_DIAGNOSIS);

      const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const prompt = chatCall.messages[0].content;
      expect(prompt).toContain('Root Cause');
      expect(prompt).toContain(VALID_DIAGNOSIS.rootCause);
      expect(prompt).toContain('permission');
      expect(prompt).toContain('Severity');
      expect(prompt).toContain('Affected Component');
    });

    it('should work without diagnosis and not include diagnosis block', async () => {
      mockChatResponse(provider, VALID_FIX_STRATEGIES);

      const result = await agent.suggestFixes(createErrorContext());

      expect(result.success).toBe(true);

      const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const prompt = chatCall.messages[0].content;
      expect(prompt).not.toContain('Root Cause');
    });

    it('should return risk and requiresSudo fields when present', async () => {
      mockChatResponse(provider, VALID_FIX_STRATEGIES);

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
      mockChatResponse(provider, strategiesWithoutOptional);

      const result = await agent.suggestFixes(createErrorContext());

      expect(result.success).toBe(true);
      expect(result.data![0].risk).toBeUndefined();
      expect(result.data![0].requiresSudo).toBeUndefined();
    });

    it('should reject strategies with confidence above 1.0', async () => {
      mockChatResponse(provider, [{ id: 'fix-1', description: 'test', commands: ['cmd'], confidence: 1.5 }]);

      const result = await agent.suggestFixes(createErrorContext());

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('validation');
    });

    it('should reject strategies with confidence below 0.0', async () => {
      mockChatResponse(provider, [{ id: 'fix-1', description: 'test', commands: ['cmd'], confidence: -0.1 }]);

      const result = await agent.suggestFixes(createErrorContext());

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('validation');
    });

    it('should include environment details in the prompt', async () => {
      mockChatResponse(provider, VALID_FIX_STRATEGIES);

      await agent.suggestFixes(createErrorContext());

      const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const prompt = chatCall.messages[0].content;
      expect(prompt).toContain('darwin');
      expect(prompt).toContain('arm64');
      expect(prompt).toContain('pnpm@9.0.0');
      expect(prompt).toContain('npm@10.0.0');
      expect(prompt).toContain('/usr/local');
    });

    it('should reference the failed command and stderr in the prompt', async () => {
      mockChatResponse(provider, VALID_FIX_STRATEGIES);

      await agent.suggestFixes(createErrorContext());

      const chatCall = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const prompt = chatCall.messages[0].content;
      expect(prompt).toContain('pnpm install -g openclaw');
      expect(prompt).toContain('EACCES');
    });
  });

  // --------------------------------------------------------------------------
  // Error handling and retry
  // --------------------------------------------------------------------------

  describe('Error handling', () => {
    it('should return failure on authentication error without retrying', async () => {
      const provider = createMockProvider();
      const authErr = new Error('authentication failed: 401');
      (provider.chat as ReturnType<typeof vi.fn>).mockRejectedValue(authErr);
      const agent = new InstallAIAgent({ provider, maxRetries: 3 });

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      // Should not retry on auth errors (1 call only)
      expect(provider.chat).toHaveBeenCalledTimes(1);
    });

    it('should retry on network errors up to maxRetries', async () => {
      const provider = createMockProvider();
      (provider.chat as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockResolvedValueOnce({
          content: JSON.stringify(VALID_ENV_ANALYSIS),
          usage: { inputTokens: 10, outputTokens: 20 },
        });
      const agent = new InstallAIAgent({ provider, maxRetries: 2 });

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(true);
      expect(provider.chat).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    it('should return failure after exhausting all retries', async () => {
      const provider = createMockProvider();
      (provider.chat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));
      const agent = new InstallAIAgent({ provider, maxRetries: 1, enablePresetFallback: false });

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.error).toContain('2 attempts');
      expect(result.error).toContain('Network error');
      expect(provider.chat).toHaveBeenCalledTimes(2);
    });

    it('should not retry on Zod validation errors', async () => {
      const provider = createMockProvider();
      mockChatResponse(provider, { invalid: 'schema' });
      const agent = new InstallAIAgent({ provider, maxRetries: 3, enablePresetFallback: false });

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('validation');
      expect(provider.chat).toHaveBeenCalledTimes(1); // No retries for validation
    });

    it('should handle empty response content', async () => {
      const provider = createMockProvider();
      (provider.chat as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: '',
        usage: { inputTokens: 0, outputTokens: 0 },
      });
      const agent = new InstallAIAgent({ provider, maxRetries: 0 });

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should propagate error message from final network failure', async () => {
      const provider = createMockProvider();
      (provider.chat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));
      const agent = new InstallAIAgent({ provider, maxRetries: 0, enablePresetFallback: false });

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
    });

    it('should handle thrown non-Error values', async () => {
      const provider = createMockProvider();
      (provider.chat as ReturnType<typeof vi.fn>).mockRejectedValue('string error');
      const agent = new InstallAIAgent({ provider, maxRetries: 0, enablePresetFallback: false });

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.error).toContain('string error');
    });

    it('should retry across different method calls consistently', async () => {
      const provider = createMockProvider();
      (provider.chat as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce({
          content: JSON.stringify(VALID_DIAGNOSIS),
          usage: { inputTokens: 10, outputTokens: 20 },
        });
      const agent = new InstallAIAgent({ provider, maxRetries: 1 });

      const result = await agent.diagnoseError(createErrorContext());

      expect(result.success).toBe(true);
      expect(provider.chat).toHaveBeenCalledTimes(2);
    });
  });

  // --------------------------------------------------------------------------
  // Streaming variants
  // --------------------------------------------------------------------------

  describe('Streaming variants', () => {
    let provider: AIProviderInterface;
    let agent: InstallAIAgent;

    beforeEach(() => {
      provider = createMockProvider();
      agent = new InstallAIAgent({ provider, maxRetries: 0, enablePresetFallback: false });
    });

    it('analyzeEnvironmentStreaming should parse valid streamed JSON', async () => {
      mockStreamResponse(provider, VALID_ENV_ANALYSIS);

      const result = await agent.analyzeEnvironmentStreaming(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(true);
      expect(result.data!.ready).toBe(true);
    });

    it('generateInstallPlanStreaming should parse valid streamed JSON', async () => {
      mockStreamResponse(provider, VALID_INSTALL_PLAN);

      const result = await agent.generateInstallPlanStreaming(createEnvInfo(), 'openclaw', '1.0.0');

      expect(result.success).toBe(true);
      expect(result.data!.steps).toHaveLength(2);
    });

    it('diagnoseErrorStreaming should parse valid streamed JSON', async () => {
      mockStreamResponse(provider, VALID_DIAGNOSIS);

      const result = await agent.diagnoseErrorStreaming(createErrorContext());

      expect(result.success).toBe(true);
      expect(result.data!.category).toBe('permission');
    });

    it('suggestFixesStreaming should parse valid streamed JSON', async () => {
      mockStreamResponse(provider, VALID_FIX_STRATEGIES);

      const result = await agent.suggestFixesStreaming(createErrorContext(), VALID_DIAGNOSIS);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('streaming should return failure when stream itself fails', async () => {
      (provider.stream as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: '',
        usage: { inputTokens: 0, outputTokens: 0 },
        success: false,
        error: 'Connection dropped',
      });

      const result = await agent.analyzeEnvironmentStreaming(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection dropped');
    });

    it('streaming should return failure when streamed text is invalid JSON', async () => {
      (provider.stream as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'not json at all',
        usage: { inputTokens: 10, outputTokens: 20 },
        success: true,
      });

      const result = await agent.analyzeEnvironmentStreaming(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Multi-provider support
  // --------------------------------------------------------------------------

  describe('Multi-provider support', () => {
    it('should work with a custom-openai provider', async () => {
      const provider = createMockProvider({ name: 'custom-openai', tier: 2 });
      mockChatResponse(provider, VALID_ENV_ANALYSIS);
      const agent = new InstallAIAgent({ provider, maxRetries: 0 });

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(true);
      expect(result.data!.ready).toBe(true);
    });

    it('should work with an ollama provider', async () => {
      const provider = createMockProvider({ name: 'ollama', tier: 3 });
      mockChatResponse(provider, VALID_INSTALL_PLAN);
      const agent = new InstallAIAgent({ provider, maxRetries: 0 });

      const result = await agent.generateInstallPlan(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(true);
      expect(result.data!.steps).toHaveLength(2);
    });

    it('should stream with any provider implementing stream()', async () => {
      const provider = createMockProvider({ name: 'deepseek', tier: 2 });
      mockStreamResponse(provider, VALID_DIAGNOSIS);
      const agent = new InstallAIAgent({ provider, maxRetries: 0 });

      const result = await agent.diagnoseErrorStreaming(createErrorContext());

      expect(result.success).toBe(true);
      expect(result.data!.category).toBe('permission');
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
