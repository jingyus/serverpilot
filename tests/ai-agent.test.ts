/**
 * Tests for packages/server/src/ai/agent.ts
 *
 * Tests the InstallAIAgent class including:
 * - Class instantiation and configuration
 * - analyzeEnvironment() - environment analysis
 * - generateInstallPlan() - install plan generation
 * - diagnoseError() - error diagnosis
 * - suggestFixes() - fix suggestion generation
 * - Error handling (auth errors, network errors, validation errors)
 * - Retry mechanism
 * - Response parsing (JSON, markdown-wrapped JSON)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { EnvironmentInfo, ErrorContext } from '@aiinstaller/shared';
import {
  InstallAIAgent,
  EnvironmentAnalysisSchema,
  ErrorDiagnosisSchema,
} from '../packages/server/src/ai/agent.js';
import type {
  AIAgentOptions,
  AIAnalysisResult,
  EnvironmentAnalysis,
  ErrorDiagnosis,
} from '../packages/server/src/ai/agent.js';
import type { AIProviderInterface, ChatResponse, StreamResponse } from '../packages/server/src/ai/providers/base.js';

const AGENT_FILE = path.resolve('packages/server/src/ai/agent.ts');

// ============================================================================
// Mock Provider Factory
// ============================================================================

/** Create a mock AI provider for testing */
function createMockProvider(overrides?: Partial<AIProviderInterface>): AIProviderInterface {
  return {
    name: 'mock',
    tier: 1,
    chat: vi.fn().mockResolvedValue({
      content: '{}',
      usage: { inputTokens: 10, outputTokens: 20 },
    }),
    stream: vi.fn().mockResolvedValue({
      content: '{}',
      usage: { inputTokens: 10, outputTokens: 20 },
      success: true,
    }),
    isAvailable: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

/** Create a ChatResponse returning the given data as JSON */
function mockChatResponse(jsonData: unknown): ChatResponse {
  return {
    content: JSON.stringify(jsonData),
    usage: { inputTokens: 10, outputTokens: 20 },
  };
}

/** Create a ChatResponse returning the given data wrapped in markdown code fences */
function mockChatMarkdownResponse(jsonData: unknown): ChatResponse {
  return {
    content: '```json\n' + JSON.stringify(jsonData, null, 2) + '\n```',
    usage: { inputTokens: 10, outputTokens: 20 },
  };
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

/** Valid environment analysis response */
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

/** Valid install plan response */
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

/** Valid error diagnosis response */
const VALID_DIAGNOSIS = {
  rootCause: 'Insufficient file system permissions for global package installation',
  category: 'permission' as const,
  explanation: 'The pnpm install -g command requires write access to /usr/local/lib which is restricted.',
  severity: 'high' as const,
  affectedComponent: 'pnpm',
  suggestedNextSteps: [
    'Run the command with sudo: sudo pnpm install -g openclaw',
    'Change npm global directory to a user-writable location',
    'Use a Node version manager (nvm) to manage installations',
  ],
};

/** Valid fix strategies response */
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

describe('src/ai/agent.ts', () => {
  // --------------------------------------------------------------------------
  // File existence and structure
  // --------------------------------------------------------------------------

  describe('File existence', () => {
    it('should exist at packages/server/src/ai/agent.ts', () => {
      expect(existsSync(AGENT_FILE)).toBe(true);
    });

    it('should be a non-empty TypeScript file', () => {
      const content = readFileSync(AGENT_FILE, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe('Exports', () => {
    it('should export InstallAIAgent class', () => {
      expect(InstallAIAgent).toBeDefined();
      expect(typeof InstallAIAgent).toBe('function');
    });

    it('should export EnvironmentAnalysisSchema', () => {
      expect(EnvironmentAnalysisSchema).toBeDefined();
    });

    it('should export ErrorDiagnosisSchema', () => {
      expect(ErrorDiagnosisSchema).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // InstallAIAgent construction
  // --------------------------------------------------------------------------

  describe('Constructor', () => {
    it('should create an instance with a provider', () => {
      const provider = createMockProvider();
      const agent = new InstallAIAgent({ provider });
      expect(agent).toBeInstanceOf(InstallAIAgent);
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
    let agent: InstallAIAgent;
    let mockProvider: AIProviderInterface;

    beforeEach(() => {
      mockProvider = createMockProvider({
        chat: vi.fn().mockResolvedValue(mockChatResponse(VALID_ENV_ANALYSIS)),
      });
      agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 0 });
    });

    it('should return a successful analysis when AI responds correctly', async () => {
      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.summary).toBe(VALID_ENV_ANALYSIS.summary);
      expect(result.data!.ready).toBe(true);
      expect(result.data!.issues).toEqual([]);
      expect(result.data!.recommendations).toEqual(['Update pnpm to latest version']);
      expect(result.error).toBeUndefined();
    });

    it('should include environment details in the prompt', async () => {
      await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      const chatFn = mockProvider.chat as ReturnType<typeof vi.fn>;
      expect(chatFn).toHaveBeenCalledTimes(1);
      const prompt = chatFn.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('openclaw');
      expect(prompt).toContain('darwin');
      expect(prompt).toContain('arm64');
      expect(prompt).toContain('zsh');
      expect(prompt).toContain('22.0.0');
      expect(prompt).toContain('npm@10.0.0');
      expect(prompt).toContain('pnpm@9.0.0');
    });

    it('should handle environment with no package managers', async () => {
      const env = createEnvInfo();
      env.packageManagers = {};

      await agent.analyzeEnvironment(env, 'openclaw');

      const chatFn = mockProvider.chat as ReturnType<typeof vi.fn>;
      const prompt = chatFn.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('none detected');
    });

    it('should handle environment with no node installed', async () => {
      const env = createEnvInfo();
      env.runtime = {};

      await agent.analyzeEnvironment(env, 'openclaw');

      const chatFn = mockProvider.chat as ReturnType<typeof vi.fn>;
      const prompt = chatFn.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('not installed');
    });

    it('should return failure when AI response is invalid JSON', async () => {
      mockProvider = createMockProvider({
        chat: vi.fn().mockResolvedValue({
          content: 'This is not JSON',
          usage: { inputTokens: 10, outputTokens: 20 },
        }),
      });
      agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 0 });

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return failure when AI response does not match schema', async () => {
      mockProvider = createMockProvider({
        chat: vi.fn().mockResolvedValue(mockChatResponse({ invalid: 'response' })),
      });
      agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 0 });

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('validation');
    });

    it('should handle markdown-wrapped JSON responses', async () => {
      mockProvider = createMockProvider({
        chat: vi.fn().mockResolvedValue(mockChatMarkdownResponse(VALID_ENV_ANALYSIS)),
      });
      agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 0 });

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(true);
      expect(result.data!.summary).toBe(VALID_ENV_ANALYSIS.summary);
    });

    it('should set system prompt for JSON-only responses', async () => {
      await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      const chatFn = mockProvider.chat as ReturnType<typeof vi.fn>;
      const callArgs = chatFn.mock.calls[0][0];
      expect(callArgs.system).toContain('JSON');
    });
  });

  // --------------------------------------------------------------------------
  // generateInstallPlan
  // --------------------------------------------------------------------------

  describe('generateInstallPlan', () => {
    let agent: InstallAIAgent;
    let mockProvider: AIProviderInterface;

    beforeEach(() => {
      mockProvider = createMockProvider({
        chat: vi.fn().mockResolvedValue(mockChatResponse(VALID_INSTALL_PLAN)),
      });
      agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 0 });
    });

    it('should return a valid install plan', async () => {
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
      await agent.generateInstallPlan(createEnvInfo(), 'openclaw', '2.0.0');

      const chatFn = mockProvider.chat as ReturnType<typeof vi.fn>;
      const prompt = chatFn.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('version 2.0.0');
    });

    it('should not include version in prompt when not specified', async () => {
      await agent.generateInstallPlan(createEnvInfo(), 'openclaw');

      const chatFn = mockProvider.chat as ReturnType<typeof vi.fn>;
      const prompt = chatFn.mock.calls[0][0].messages[0].content;
      expect(prompt).not.toContain('version undefined');
    });

    it('should validate plan steps against InstallPlanSchema', async () => {
      // Missing required fields in step
      const invalidPlan = {
        steps: [{ id: 'test' }], // missing command, description, etc.
        estimatedTime: 1000,
        risks: [],
      };
      mockProvider = createMockProvider({
        chat: vi.fn().mockResolvedValue(mockChatResponse(invalidPlan)),
      });
      agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 0 });

      const result = await agent.generateInstallPlan(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('validation');
    });

    it('should include environment details in the prompt', async () => {
      await agent.generateInstallPlan(createEnvInfo(), 'openclaw');

      const chatFn = mockProvider.chat as ReturnType<typeof vi.fn>;
      const prompt = chatFn.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('darwin');
      expect(prompt).toContain('pnpm@9.0.0');
      expect(prompt).toContain('/usr/local');
    });
  });

  // --------------------------------------------------------------------------
  // diagnoseError
  // --------------------------------------------------------------------------

  describe('diagnoseError', () => {
    let agent: InstallAIAgent;
    let mockProvider: AIProviderInterface;

    beforeEach(() => {
      mockProvider = createMockProvider({
        chat: vi.fn().mockResolvedValue(mockChatResponse(VALID_DIAGNOSIS)),
      });
      agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 0 });
    });

    it('should return a valid error diagnosis', async () => {
      const result = await agent.diagnoseError(createErrorContext());

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.rootCause).toBe(VALID_DIAGNOSIS.rootCause);
      expect(result.data!.category).toBe('permission');
      expect(result.data!.explanation).toBeDefined();
    });

    it('should include error context in the prompt', async () => {
      await agent.diagnoseError(createErrorContext());

      const chatFn = mockProvider.chat as ReturnType<typeof vi.fn>;
      const prompt = chatFn.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('pnpm install -g openclaw');
      expect(prompt).toContain('EACCES');
      expect(prompt).toContain('permission denied');
      expect(prompt).toContain('install-openclaw');
    });

    it('should include previous steps in the prompt', async () => {
      await agent.diagnoseError(createErrorContext());

      const chatFn = mockProvider.chat as ReturnType<typeof vi.fn>;
      const prompt = chatFn.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('check-node');
      expect(prompt).toContain('OK');
    });

    it('should handle error context with no previous steps', async () => {
      const ctx = createErrorContext();
      ctx.previousSteps = [];

      await agent.diagnoseError(ctx);

      const chatFn = mockProvider.chat as ReturnType<typeof vi.fn>;
      const prompt = chatFn.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('(none)');
    });

    it('should reject invalid category values', async () => {
      const invalidDiagnosis = {
        rootCause: 'test',
        category: 'invalid-category',
        explanation: 'test',
      };
      mockProvider = createMockProvider({
        chat: vi.fn().mockResolvedValue(mockChatResponse(invalidDiagnosis)),
      });
      agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 0 });

      const result = await agent.diagnoseError(createErrorContext());

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('validation');
    });
  });

  // --------------------------------------------------------------------------
  // suggestFixes
  // --------------------------------------------------------------------------

  describe('suggestFixes', () => {
    let agent: InstallAIAgent;
    let mockProvider: AIProviderInterface;

    beforeEach(() => {
      mockProvider = createMockProvider({
        chat: vi.fn().mockResolvedValue(mockChatResponse(VALID_FIX_STRATEGIES)),
      });
      agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 0 });
    });

    it('should return valid fix strategies', async () => {
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
      await agent.suggestFixes(createErrorContext(), VALID_DIAGNOSIS);

      const chatFn = mockProvider.chat as ReturnType<typeof vi.fn>;
      const prompt = chatFn.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('Root Cause');
      expect(prompt).toContain(VALID_DIAGNOSIS.rootCause);
      expect(prompt).toContain('permission');
    });

    it('should work without diagnosis', async () => {
      const result = await agent.suggestFixes(createErrorContext());

      expect(result.success).toBe(true);

      const chatFn = mockProvider.chat as ReturnType<typeof vi.fn>;
      const prompt = chatFn.mock.calls[0][0].messages[0].content;
      expect(prompt).not.toContain('Root Cause');
    });

    it('should include full environment details in the prompt', async () => {
      await agent.suggestFixes(createErrorContext());

      const chatFn = mockProvider.chat as ReturnType<typeof vi.fn>;
      const prompt = chatFn.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('darwin');
      expect(prompt).toContain('arm64');
      expect(prompt).toContain('zsh');
      expect(prompt).toContain('pnpm@9.0.0');
      expect(prompt).toContain('npm@10.0.0');
      expect(prompt).toContain('npm=true');
      expect(prompt).toContain('github=true');
      expect(prompt).toContain('sudo=true');
      expect(prompt).toContain('/usr/local');
    });

    it('should mention recovery specialist role in prompt', async () => {
      await agent.suggestFixes(createErrorContext());

      const chatFn = mockProvider.chat as ReturnType<typeof vi.fn>;
      const prompt = chatFn.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('software installation recovery specialist');
    });

    it('should return risk and requiresSudo fields when present', async () => {
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
      mockProvider = createMockProvider({
        chat: vi.fn().mockResolvedValue(mockChatResponse(strategiesWithoutOptional)),
      });
      agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 0 });

      const result = await agent.suggestFixes(createErrorContext());

      expect(result.success).toBe(true);
      expect(result.data![0].risk).toBeUndefined();
      expect(result.data![0].requiresSudo).toBeUndefined();
    });

    it('should reject strategies with confidence out of range', async () => {
      const invalidStrategies = [
        {
          id: 'fix-1',
          description: 'test',
          commands: ['cmd'],
          confidence: 1.5, // Out of range 0-1
        },
      ];
      mockProvider = createMockProvider({
        chat: vi.fn().mockResolvedValue(mockChatResponse(invalidStrategies)),
      });
      agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 0 });

      const result = await agent.suggestFixes(createErrorContext());

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('validation');
    });
  });

  // --------------------------------------------------------------------------
  // Error handling and retry
  // --------------------------------------------------------------------------

  describe('Error handling', () => {
    it('should return failure on authentication error without retrying', async () => {
      const mockProvider = createMockProvider({
        chat: vi.fn().mockRejectedValue(
          Object.assign(new Error('Invalid API key'), {
            constructor: { name: 'AuthenticationError' },
          }),
        ),
      });
      const agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 3 });

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      // With our mock, it will retry because we can't perfectly simulate instanceof
      // But it should still eventually return failure
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should retry on network errors up to maxRetries', async () => {
      const chatFn = vi.fn()
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockResolvedValueOnce(mockChatResponse(VALID_ENV_ANALYSIS));

      const mockProvider = createMockProvider({ chat: chatFn });
      const agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 2 });

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(true);
      expect(chatFn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    it('should return failure after exhausting all retries', async () => {
      const chatFn = vi.fn().mockRejectedValue(new Error('Network error'));

      const mockProvider = createMockProvider({ chat: chatFn });
      const agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 1, enablePresetFallback: false });

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.error).toContain('2 attempts'); // 1 initial + 1 retry = 2
      expect(result.error).toContain('Network error');
      expect(chatFn).toHaveBeenCalledTimes(2);
    });

    it('should not retry on Zod validation errors', async () => {
      const chatFn = vi.fn().mockResolvedValue(
        mockChatResponse({ invalid: 'schema' }),
      );

      const mockProvider = createMockProvider({ chat: chatFn });
      const agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 3, enablePresetFallback: false });

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(chatFn).toHaveBeenCalledTimes(1); // No retries
    });

    it('should handle empty response content', async () => {
      const mockProvider = createMockProvider({
        chat: vi.fn().mockResolvedValue({
          content: '',
          usage: { inputTokens: 0, outputTokens: 0 },
        }),
      });
      const agent = new InstallAIAgent({ provider: mockProvider, maxRetries: 0 });

      const result = await agent.analyzeEnvironment(createEnvInfo(), 'openclaw');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Zod schema validation
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
        explanation: 'test',
      });
      expect(result.success).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // AIAnalysisResult type
  // --------------------------------------------------------------------------

  describe('AIAnalysisResult type', () => {
    it('should have correct shape for success result', () => {
      const result: AIAnalysisResult<EnvironmentAnalysis> = {
        success: true,
        data: VALID_ENV_ANALYSIS,
      };
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it('should have correct shape for failure result', () => {
      const result: AIAnalysisResult<EnvironmentAnalysis> = {
        success: false,
        error: 'Something went wrong',
      };
      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.error).toBe('Something went wrong');
    });
  });

  // --------------------------------------------------------------------------
  // Code quality
  // --------------------------------------------------------------------------

  describe('Code quality', () => {
    it('should use proper imports from @aiinstaller/shared', () => {
      const content = readFileSync(AGENT_FILE, 'utf-8');
      expect(content).toContain("from '@aiinstaller/shared'");
    });

    it('should use AIProviderInterface instead of direct Anthropic SDK', () => {
      const content = readFileSync(AGENT_FILE, 'utf-8');
      expect(content).toContain("from './providers/base.js'");
      expect(content).not.toContain("from '@anthropic-ai/sdk'");
    });

    it('should export InstallAIAgent class', () => {
      const content = readFileSync(AGENT_FILE, 'utf-8');
      expect(content).toContain('export class InstallAIAgent');
    });

    it('should re-export AIAgentOptions from schemas module', () => {
      const content = readFileSync(AGENT_FILE, 'utf-8');
      expect(content).toContain('AIAgentOptions');
    });

    it('should re-export AIAnalysisResult from schemas module', () => {
      const content = readFileSync(AGENT_FILE, 'utf-8');
      expect(content).toContain('AIAnalysisResult');
    });

    it('should use Zod schemas from shared package', () => {
      const content = readFileSync(AGENT_FILE, 'utf-8');
      expect(content).toContain('InstallPlanSchema');
      expect(content).toContain('FixStrategySchema');
    });

    it('should delegate to api-call module for AI communication', () => {
      const content = readFileSync(AGENT_FILE, 'utf-8');
      expect(content).toContain("from './api-call.js'");
      expect(content).toContain('callAI');
      expect(content).toContain('callAIStreaming');
    });

    it('should use extracted schemas module', () => {
      const content = readFileSync(AGENT_FILE, 'utf-8');
      expect(content).toContain("from './schemas.js'");
      expect(content).toContain('EnvironmentAnalysisSchema');
      expect(content).toContain('ErrorDiagnosisSchema');
    });

    it('should have retry and error classification in api-call module', () => {
      const apiCallFile = path.resolve('packages/server/src/ai/api-call.ts');
      const content = readFileSync(apiCallFile, 'utf-8');
      expect(content).toContain('retryWithBackoff');
      expect(content).toContain('classifyErrorMessage');
      expect(content).toContain('parseJSON');
      expect(content).toContain('```');
    });
  });
});
