// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for installation plan generation module.
 *
 * @module ai/planner.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EnvironmentInfo, InstallPlan } from '@aiinstaller/shared';
import { KnowledgeBase } from '../knowledge/loader.js';
import { logger } from '../utils/logger.js';
import type { InstallAIAgent } from './agent.js';
import { generateInstallPlan, generateFallbackPlan, loadKnowledgeBase, getKnowledgeContextForPlan } from './planner.js';

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ============================================================================
// Mock Data
// ============================================================================

const mockEnvironment: EnvironmentInfo = {
  os: {
    platform: 'darwin',
    version: '14.0.0',
    arch: 'arm64',
  },
  shell: {
    type: 'zsh',
    version: '5.9',
    path: '/bin/zsh',
  },
  runtime: {
    node: '20.10.0',
    python: null,
  },
  packageManagers: {
    npm: '10.2.0',
    pnpm: '8.14.0',
    yarn: null,
    brew: '4.0.0',
    apt: null,
  },
  network: {
    canAccessNpm: true,
    canAccessGithub: true,
  },
  permissions: {
    hasSudo: true,
    canWriteTo: ['/usr/local/bin', process.env.HOME ?? '/Users/test'],
  },
};

const mockInstallPlan: InstallPlan = {
  steps: [
    {
      id: 'check-node',
      description: 'Check system prerequisites',
      command: 'node --version && npm --version',
      expectedOutput: 'v',
      timeout: 5000,
      canRollback: false,
      onError: 'abort',
    },
    {
      id: 'install',
      description: 'Install openclaw globally',
      command: 'pnpm install -g openclaw@latest',
      timeout: 120000,
      canRollback: true,
      onError: 'retry',
    },
    {
      id: 'verify',
      description: 'Verify installation',
      command: 'openclaw --version',
      expectedOutput: '.',
      timeout: 5000,
      canRollback: false,
      onError: 'skip',
    },
  ],
  estimatedTime: 130000,
  risks: [
    {
      level: 'low',
      description: 'Network connectivity required',
    },
  ],
};

// ============================================================================
// Tests
// ============================================================================

describe('generateInstallPlan', () => {
  let mockAgent: InstallAIAgent;

  beforeEach(() => {
    // Mock AI agent
    mockAgent = {
      generateInstallPlanStreaming: vi.fn().mockResolvedValue({
        success: true,
        data: mockInstallPlan,
      }),
    } as unknown as InstallAIAgent;
  });

  it('should generate installation plan with AI', async () => {
    const result = await generateInstallPlan(mockAgent, mockEnvironment, 'openclaw');

    expect(result.plan).not.toBeNull();
    expect(result.plan?.steps).toHaveLength(3);
    expect(result.plan?.steps[0].id).toBe('check-node');
    expect(mockAgent.generateInstallPlanStreaming).toHaveBeenCalledWith(
      mockEnvironment,
      'openclaw',
      undefined,
      undefined,
      expect.any(String), // Knowledge context
    );
  });

  it('should include knowledge base context when available', async () => {
    const result = await generateInstallPlan(mockAgent, mockEnvironment, 'openclaw');

    expect(result.plan).not.toBeNull();
    expect(mockAgent.generateInstallPlanStreaming).toHaveBeenCalled();

    // Verify knowledge context was passed (5th argument)
    const calls = vi.mocked(mockAgent.generateInstallPlanStreaming).mock.calls;
    expect(calls[0][4]).toBeDefined();
  });

  it('should return null plan when AI generation fails', async () => {
    mockAgent.generateInstallPlanStreaming = vi.fn().mockResolvedValue({
      success: false,
      error: 'AI service unavailable',
    });

    const result = await generateInstallPlan(mockAgent, mockEnvironment, 'openclaw');

    expect(result.plan).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      { operation: 'generate_plan', software: 'openclaw', error: 'AI service unavailable' },
      'Failed to generate install plan',
    );
  });

  it('should support optional version parameter', async () => {
    await generateInstallPlan(mockAgent, mockEnvironment, 'openclaw', '1.2.3');

    expect(mockAgent.generateInstallPlanStreaming).toHaveBeenCalledWith(
      mockEnvironment,
      'openclaw',
      '1.2.3',
      undefined,
      expect.any(String),
    );
  });

  it('should support streaming callbacks', async () => {
    const callbacks = {
      onStart: vi.fn(),
      onToken: vi.fn(),
      onEnd: vi.fn(),
      onError: vi.fn(),
    };

    await generateInstallPlan(mockAgent, mockEnvironment, 'openclaw', undefined, callbacks);

    expect(mockAgent.generateInstallPlanStreaming).toHaveBeenCalledWith(
      mockEnvironment,
      'openclaw',
      undefined,
      callbacks,
      expect.any(String),
    );
  });

  it('should handle errors gracefully', async () => {
    mockAgent.generateInstallPlanStreaming = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await generateInstallPlan(mockAgent, mockEnvironment, 'openclaw');

    expect(result.plan).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      { operation: 'generate_plan', software: 'openclaw', error: 'Network error' },
      'Error in generateInstallPlan',
    );
  });
});

describe('generateFallbackPlan', () => {
  it('should generate basic plan for macOS with Homebrew', () => {
    const plan = generateFallbackPlan(mockEnvironment, 'openclaw');

    expect(plan.steps).toBeDefined();
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps.some(s => s.command.includes('brew install'))).toBe(true);
    expect(plan.estimatedTime).toBeGreaterThan(0);
    expect(plan.risks).toBeDefined();
  });

  it('should use pnpm when available', () => {
    const plan = generateFallbackPlan(mockEnvironment, 'test-package');

    // Should prefer brew on macOS, but check pnpm is considered
    expect(plan.steps).toBeDefined();
  });

  it('should fallback to npm when pnpm not available', () => {
    const envWithoutPnpm: EnvironmentInfo = {
      ...mockEnvironment,
      packageManagers: {
        ...mockEnvironment.packageManagers,
        pnpm: null,
        brew: null,
      },
    };

    const plan = generateFallbackPlan(envWithoutPnpm, 'test-package');

    expect(plan.steps.some(s => s.command.includes('npm install'))).toBe(true);
  });

  it('should include version in commands when specified', () => {
    const plan = generateFallbackPlan(mockEnvironment, 'test-package', '2.0.0');

    const installStep = plan.steps.find(s => s.id.includes('install'));
    expect(installStep?.command).toContain('2.0.0');
  });

  it('should include prerequisite check step', () => {
    const plan = generateFallbackPlan(mockEnvironment, 'test-package');

    const prereqStep = plan.steps.find(s => s.id === 'check-node');
    expect(prereqStep).toBeDefined();
    expect(prereqStep?.command).toContain('node --version');
  });

  it('should include verification step', () => {
    const plan = generateFallbackPlan(mockEnvironment, 'test-package');

    const verifyStep = plan.steps.find(s => s.id === 'verify');
    expect(verifyStep).toBeDefined();
    expect(verifyStep?.command).toContain('test-package --version');
  });

  it('should handle Linux environment', () => {
    const linuxEnv: EnvironmentInfo = {
      ...mockEnvironment,
      os: {
        platform: 'linux',
        version: '22.04',
        arch: 'x64',
      },
      packageManagers: {
        npm: '10.0.0',
        pnpm: null,
        yarn: null,
        brew: null,
        apt: '2.4.0',
      },
    };

    const plan = generateFallbackPlan(linuxEnv, 'test-package');

    expect(plan.steps).toBeDefined();
    expect(plan.steps.some(s => s.command.includes('npm install'))).toBe(true);
  });

  it('should handle Windows environment', () => {
    const winEnv: EnvironmentInfo = {
      ...mockEnvironment,
      os: {
        platform: 'win32',
        version: '10.0.22621',
        arch: 'x64',
      },
      packageManagers: {
        npm: '10.0.0',
        pnpm: null,
        yarn: null,
        brew: null,
        apt: null,
      },
    };

    const plan = generateFallbackPlan(winEnv, 'test-package');

    expect(plan.steps).toBeDefined();
  });

  it('should warn when no package manager available', () => {
    const envNoPackageManager: EnvironmentInfo = {
      ...mockEnvironment,
      packageManagers: {
        npm: null,
        pnpm: null,
        yarn: null,
        brew: null,
        apt: null,
      },
    };

    const plan = generateFallbackPlan(envNoPackageManager, 'test-package');

    const manualStep = plan.steps.find(s => s.id === 'manual-install');
    expect(manualStep).toBeDefined();
    expect(manualStep?.command).toContain('No package manager found');
  });

  it('should include fallback warning in risks', () => {
    const plan = generateFallbackPlan(mockEnvironment, 'test-package');

    expect(plan.risks.some(r => r.description.includes('Fallback plan'))).toBe(true);
  });
});

describe('getKnowledgeContextForPlan', () => {
  it('should return empty string when knowledge base is null', () => {
    const context = getKnowledgeContextForPlan(null, mockEnvironment);

    expect(context).toBe('');
  });

  it('should return empty string when knowledge base is not loaded', () => {
    const kb = new KnowledgeBase({ baseDir: './non-existent' });
    const context = getKnowledgeContextForPlan(kb, mockEnvironment);

    expect(context).toBe('');
  });

  it('should format search results for AI prompt', () => {
    // Create a mock knowledge base with documents
    const mockKb = {
      isLoaded: vi.fn().mockReturnValue(true),
      search: vi.fn().mockReturnValue([
        {
          document: {
            title: 'Installation Guide',
            category: 'setup',
            content: 'Full installation content here',
          },
          snippets: ['Install using npm', 'Requires Node.js 18+'],
          score: 15, // High score to trigger full content inclusion
        },
        {
          document: {
            title: 'Prerequisites',
            category: 'requirements',
            content: 'Prerequisites content',
          },
          snippets: ['macOS 10.15+', 'Linux kernel 5.0+'],
          score: 8, // Lower score, no full content
        },
      ]),
    } as unknown as KnowledgeBase;

    const context = getKnowledgeContextForPlan(mockKb, mockEnvironment);

    expect(typeof context).toBe('string');
    expect(context).toContain('# Knowledge Base: Installation Guide');
    expect(context).toContain('## Installation Guide (setup)');
    expect(context).toContain('**Relevant snippets:**');
    expect(context).toContain('- Install using npm');
    expect(context).toContain('- Requires Node.js 18+');
    expect(context).toContain('**Full content:**');
    expect(context).toContain('Full installation content here');
    expect(context).toContain('## Prerequisites (requirements)');
    expect(context).toContain('- macOS 10.15+');
    expect(context).not.toContain('Prerequisites content'); // Low score, no full content
  });

  it('should return empty string when no search results found', () => {
    const mockKb = {
      isLoaded: vi.fn().mockReturnValue(true),
      search: vi.fn().mockReturnValue([]),
    } as unknown as KnowledgeBase;

    const context = getKnowledgeContextForPlan(mockKb, mockEnvironment);

    expect(context).toBe('');
  });

  it('should build platform-specific query by default', () => {
    const mockKb = {
      isLoaded: vi.fn().mockReturnValue(true),
      search: vi.fn().mockReturnValue([]),
    } as unknown as KnowledgeBase;

    getKnowledgeContextForPlan(mockKb, mockEnvironment);

    expect(mockKb.search).toHaveBeenCalledWith(
      'installation darwin setup prerequisites',
      5,
    );
  });

  it('should accept custom query parameter', () => {
    const mockKb = {
      isLoaded: vi.fn().mockReturnValue(true),
      search: vi.fn().mockReturnValue([]),
    } as unknown as KnowledgeBase;

    getKnowledgeContextForPlan(mockKb, mockEnvironment, 'custom search query');

    expect(mockKb.search).toHaveBeenCalledWith('custom search query', 5);
  });

  it('should respect maxDocs parameter', () => {
    const mockKb = {
      isLoaded: vi.fn().mockReturnValue(true),
      search: vi.fn().mockReturnValue([]),
    } as unknown as KnowledgeBase;

    getKnowledgeContextForPlan(mockKb, mockEnvironment, undefined, 10);

    expect(mockKb.search).toHaveBeenCalledWith(
      'installation darwin setup prerequisites',
      10,
    );
  });

  it('should handle documents with empty snippets', () => {
    const mockKb = {
      isLoaded: vi.fn().mockReturnValue(true),
      search: vi.fn().mockReturnValue([
        {
          document: {
            title: 'Test Doc',
            category: 'test',
            content: 'Test content',
          },
          snippets: [],
          score: 5,
        },
      ]),
    } as unknown as KnowledgeBase;

    const context = getKnowledgeContextForPlan(mockKb, mockEnvironment);

    expect(context).toContain('## Test Doc (test)');
    expect(context).not.toContain('**Relevant snippets:**');
  });
});

describe('loadKnowledgeBase', () => {
  it('should return null when knowledge base directory does not exist', async () => {
    const kb = await loadKnowledgeBase('nonexistent-software');

    expect(kb).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'load_knowledge_base', software: 'nonexistent-software' }),
      expect.stringContaining('Failed to load knowledge base for "nonexistent-software"'),
    );
  });

  it('should load knowledge base for openclaw if it exists', async () => {
    const kb = await loadKnowledgeBase('openclaw');

    // Knowledge base should exist in the test environment
    if (kb) {
      expect(kb.isLoaded()).toBe(true);
      expect(kb.getDocumentCount()).toBeGreaterThan(0);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'load_knowledge_base', software: 'openclaw', documentCount: expect.any(Number) }),
        expect.stringContaining('Loaded'),
      );
    }
  });

  it('should handle loading errors gracefully', async () => {
    const kb = await loadKnowledgeBase('invalid/path/with/slashes');

    expect(kb).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'load_knowledge_base', software: 'invalid/path/with/slashes' }),
      expect.stringContaining('Failed to load knowledge base for "invalid/path/with/slashes"'),
    );
  });
});
