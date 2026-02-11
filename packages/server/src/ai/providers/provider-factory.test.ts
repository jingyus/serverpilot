// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for the AI Provider factory.
 *
 * Validates provider creation, environment resolution, singleton
 * management, health checks, and dynamic switching.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createProvider,
  resolveProviderFromEnv,
  checkProviderHealth,
  getActiveProvider,
  setActiveProvider,
  getActiveProviderConfig,
  _resetProviderFactory,
} from './provider-factory.js';
import type { ProviderFactoryConfig, AIProviderType } from './provider-factory.js';
import { ClaudeProvider } from './claude.js';
import { OpenAIProvider } from './openai.js';
import { OllamaProvider } from './ollama.js';
import { DeepSeekProvider } from './deepseek.js';
import { CustomOpenAIProvider } from './custom-openai.js';
import type { AIProviderInterface } from './base.js';

// ============================================================================
// Mock logger to suppress output during tests
// ============================================================================

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ============================================================================
// Helpers
// ============================================================================

function setEnv(vars: Record<string, string | undefined>): () => void {
  const originals: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    originals[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('createProvider', () => {
  it('should create a Claude provider', () => {
    const provider = createProvider({
      provider: 'claude',
      apiKey: 'sk-test-key',
    });
    expect(provider).toBeInstanceOf(ClaudeProvider);
    expect(provider.name).toBe('claude');
    expect(provider.tier).toBe(1);
  });

  it('should create an OpenAI provider', () => {
    const provider = createProvider({
      provider: 'openai',
      apiKey: 'sk-openai-test',
    });
    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect(provider.name).toBe('openai');
    expect(provider.tier).toBe(2);
  });

  it('should create an Ollama provider', () => {
    const provider = createProvider({
      provider: 'ollama',
    });
    expect(provider).toBeInstanceOf(OllamaProvider);
    expect(provider.name).toBe('ollama');
    expect(provider.tier).toBe(3);
  });

  it('should create a DeepSeek provider', () => {
    const provider = createProvider({
      provider: 'deepseek',
      apiKey: 'sk-deepseek-test',
    });
    expect(provider).toBeInstanceOf(DeepSeekProvider);
    expect(provider.name).toBe('deepseek');
    expect(provider.tier).toBe(2);
  });

  it('should create a Custom OpenAI provider', () => {
    const provider = createProvider({
      provider: 'custom-openai',
      apiKey: 'sk-custom-test',
      baseUrl: 'https://oneapi.example.com/v1',
      model: 'gpt-4o',
    });
    expect(provider).toBeInstanceOf(CustomOpenAIProvider);
    expect(provider.name).toBe('custom-openai');
    expect(provider.tier).toBe(2);
  });

  it('should throw for unknown provider type', () => {
    expect(() =>
      createProvider({ provider: 'unknown' as AIProviderType }),
    ).toThrow('Unknown AI provider: unknown');
  });

  it('should pass model config to Claude provider', () => {
    const provider = createProvider({
      provider: 'claude',
      apiKey: 'sk-test',
      model: 'claude-3-haiku-20240307',
    });
    expect(provider).toBeInstanceOf(ClaudeProvider);
    expect((provider as ClaudeProvider).getModel()).toBe('claude-3-haiku-20240307');
  });

  it('should pass model config to OpenAI provider', () => {
    const provider = createProvider({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
    });
    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect((provider as OpenAIProvider).getModel()).toBe('gpt-4o-mini');
  });

  it('should throw when Claude API key is missing', () => {
    const restore = setEnv({ ANTHROPIC_API_KEY: undefined });
    try {
      expect(() =>
        createProvider({ provider: 'claude' }),
      ).toThrow();
    } finally {
      restore();
    }
  });

  it('should throw when OpenAI API key is missing', () => {
    const restore = setEnv({ OPENAI_API_KEY: undefined });
    try {
      expect(() =>
        createProvider({ provider: 'openai' }),
      ).toThrow();
    } finally {
      restore();
    }
  });

  it('should throw when DeepSeek API key is missing', () => {
    const restore = setEnv({ DEEPSEEK_API_KEY: undefined });
    try {
      expect(() =>
        createProvider({ provider: 'deepseek' }),
      ).toThrow();
    } finally {
      restore();
    }
  });

  it('should not require API key for Ollama', () => {
    const provider = createProvider({ provider: 'ollama' });
    expect(provider).toBeInstanceOf(OllamaProvider);
  });
});

// ============================================================================
// resolveProviderFromEnv
// ============================================================================

describe('resolveProviderFromEnv', () => {
  let restore: () => void;

  afterEach(() => {
    if (restore) restore();
  });

  it('should default to claude when AI_PROVIDER is not set', () => {
    restore = setEnv({
      AI_PROVIDER: undefined,
      ANTHROPIC_API_KEY: 'sk-test',
    });
    const config = resolveProviderFromEnv();
    expect(config).not.toBeNull();
    expect(config!.provider).toBe('claude');
    expect(config!.apiKey).toBe('sk-test');
  });

  it('should resolve openai from env', () => {
    restore = setEnv({
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-openai',
      AI_MODEL: 'gpt-4o-mini',
    });
    const config = resolveProviderFromEnv();
    expect(config).not.toBeNull();
    expect(config!.provider).toBe('openai');
    expect(config!.apiKey).toBe('sk-openai');
    expect(config!.model).toBe('gpt-4o-mini');
  });

  it('should resolve deepseek from env', () => {
    restore = setEnv({
      AI_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'sk-ds',
    });
    const config = resolveProviderFromEnv();
    expect(config).not.toBeNull();
    expect(config!.provider).toBe('deepseek');
    expect(config!.apiKey).toBe('sk-ds');
  });

  it('should resolve ollama from env (no API key required)', () => {
    restore = setEnv({
      AI_PROVIDER: 'ollama',
      AI_MODEL: 'llama3.2',
    });
    const config = resolveProviderFromEnv();
    expect(config).not.toBeNull();
    expect(config!.provider).toBe('ollama');
    expect(config!.model).toBe('llama3.2');
  });

  it('should return null when claude API key is not set', () => {
    restore = setEnv({
      AI_PROVIDER: 'claude',
      ANTHROPIC_API_KEY: undefined,
    });
    const config = resolveProviderFromEnv();
    expect(config).toBeNull();
  });

  it('should return null when openai API key is not set', () => {
    restore = setEnv({
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: undefined,
    });
    const config = resolveProviderFromEnv();
    expect(config).toBeNull();
  });

  it('should fall back to claude for unknown AI_PROVIDER', () => {
    restore = setEnv({
      AI_PROVIDER: 'grok',
      ANTHROPIC_API_KEY: 'sk-test',
    });
    const config = resolveProviderFromEnv();
    expect(config).not.toBeNull();
    expect(config!.provider).toBe('claude');
  });

  it('should handle case-insensitive provider names', () => {
    restore = setEnv({
      AI_PROVIDER: 'OpenAI',
      OPENAI_API_KEY: 'sk-test',
    });
    const config = resolveProviderFromEnv();
    // AI_PROVIDER is lowercased before matching
    expect(config).not.toBeNull();
    expect(config!.provider).toBe('openai');
  });

  it('should parse AI_TIMEOUT_MS from env', () => {
    restore = setEnv({
      AI_PROVIDER: 'ollama',
      AI_TIMEOUT_MS: '90000',
    });
    const config = resolveProviderFromEnv();
    expect(config).not.toBeNull();
    expect(config!.timeoutMs).toBe(90000);
  });

  it('should include OLLAMA_BASE_URL when set', () => {
    restore = setEnv({
      AI_PROVIDER: 'ollama',
      OLLAMA_BASE_URL: 'http://192.168.1.100:11434',
    });
    const config = resolveProviderFromEnv();
    expect(config!.baseUrl).toBe('http://192.168.1.100:11434');
  });

  it('should resolve custom-openai from env', () => {
    restore = setEnv({
      AI_PROVIDER: 'custom-openai',
      CUSTOM_OPENAI_API_KEY: 'sk-custom',
      CUSTOM_OPENAI_BASE_URL: 'https://oneapi.example.com/v1',
      AI_MODEL: 'gpt-4o',
    });
    const config = resolveProviderFromEnv();
    expect(config).not.toBeNull();
    expect(config!.provider).toBe('custom-openai');
    expect(config!.apiKey).toBe('sk-custom');
    expect(config!.baseUrl).toBe('https://oneapi.example.com/v1');
    expect(config!.model).toBe('gpt-4o');
  });

  it('should return null when custom-openai API key is missing', () => {
    restore = setEnv({
      AI_PROVIDER: 'custom-openai',
      CUSTOM_OPENAI_API_KEY: undefined,
      CUSTOM_OPENAI_BASE_URL: 'https://oneapi.example.com/v1',
    });
    const config = resolveProviderFromEnv();
    expect(config).toBeNull();
  });

  it('should return null when custom-openai base URL is missing', () => {
    restore = setEnv({
      AI_PROVIDER: 'custom-openai',
      CUSTOM_OPENAI_API_KEY: 'sk-custom',
      CUSTOM_OPENAI_BASE_URL: undefined,
    });
    const config = resolveProviderFromEnv();
    expect(config).toBeNull();
  });
});

// ============================================================================
// Singleton Management
// ============================================================================

describe('singleton management', () => {
  let restore: () => void;

  beforeEach(() => {
    _resetProviderFactory();
  });

  afterEach(() => {
    _resetProviderFactory();
    if (restore) restore();
  });

  it('should return null when no provider is configured', () => {
    restore = setEnv({
      AI_PROVIDER: 'claude',
      ANTHROPIC_API_KEY: undefined,
      OPENAI_API_KEY: undefined,
      DEEPSEEK_API_KEY: undefined,
    });
    const provider = getActiveProvider();
    expect(provider).toBeNull();
  });

  it('should lazy-initialize from env', () => {
    restore = setEnv({
      AI_PROVIDER: 'ollama',
    });
    const provider = getActiveProvider();
    expect(provider).not.toBeNull();
    expect(provider!.name).toBe('ollama');
  });

  it('should return the same instance on subsequent calls', () => {
    restore = setEnv({
      AI_PROVIDER: 'ollama',
    });
    const p1 = getActiveProvider();
    const p2 = getActiveProvider();
    expect(p1).toBe(p2);
  });

  it('should switch provider with setActiveProvider', () => {
    restore = setEnv({
      AI_PROVIDER: 'ollama',
    });
    const p1 = getActiveProvider();
    expect(p1!.name).toBe('ollama');

    setActiveProvider({
      provider: 'openai',
      apiKey: 'sk-switch-test',
    });

    const p2 = getActiveProvider();
    expect(p2!.name).toBe('openai');
    expect(p2).not.toBe(p1);
  });

  it('should update config after setActiveProvider', () => {
    setActiveProvider({
      provider: 'ollama',
      model: 'llama3.2',
    });

    const config = getActiveProviderConfig();
    expect(config).not.toBeNull();
    expect(config!.provider).toBe('ollama');
    expect(config!.model).toBe('llama3.2');
  });

  it('should reset singleton on _resetProviderFactory', () => {
    setActiveProvider({ provider: 'ollama' });
    expect(getActiveProvider()).not.toBeNull();

    _resetProviderFactory();
    // After reset with no env, should re-initialize from env
    restore = setEnv({
      AI_PROVIDER: 'claude',
      ANTHROPIC_API_KEY: undefined,
    });
    _resetProviderFactory();
    // With no valid config, returns null
    const provider = getActiveProvider();
    expect(provider).toBeNull();
  });
});

// ============================================================================
// Health Check
// ============================================================================

describe('checkProviderHealth', () => {
  it('should return available:true when isAvailable resolves true', async () => {
    const mockProvider: AIProviderInterface = {
      name: 'ollama',
      tier: 3,
      chat: vi.fn(),
      stream: vi.fn(),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const health = await checkProviderHealth(mockProvider);
    expect(health.provider).toBe('ollama');
    expect(health.available).toBe(true);
    expect(health.tier).toBe(3);
    expect(health.error).toBeUndefined();
  });

  it('should return available:false when isAvailable resolves false', async () => {
    const mockProvider: AIProviderInterface = {
      name: 'openai',
      tier: 2,
      chat: vi.fn(),
      stream: vi.fn(),
      isAvailable: vi.fn().mockResolvedValue(false),
    };

    const health = await checkProviderHealth(mockProvider);
    expect(health.available).toBe(false);
    expect(health.error).toBe('Provider health check returned false');
  });

  it('should return available:false when isAvailable throws', async () => {
    const mockProvider: AIProviderInterface = {
      name: 'claude',
      tier: 1,
      chat: vi.fn(),
      stream: vi.fn(),
      isAvailable: vi.fn().mockRejectedValue(new Error('Connection refused')),
    };

    const health = await checkProviderHealth(mockProvider);
    expect(health.available).toBe(false);
    expect(health.error).toBe('Connection refused');
  });
});

// ============================================================================
// Provider Switching (Integration-style)
// ============================================================================

describe('provider switching', () => {
  beforeEach(() => {
    _resetProviderFactory();
  });

  afterEach(() => {
    _resetProviderFactory();
  });

  it('should switch from ollama to openai', () => {
    setActiveProvider({ provider: 'ollama' });
    expect(getActiveProvider()!.name).toBe('ollama');

    setActiveProvider({ provider: 'openai', apiKey: 'sk-test' });
    expect(getActiveProvider()!.name).toBe('openai');
  });

  it('should switch from openai to deepseek', () => {
    setActiveProvider({ provider: 'openai', apiKey: 'sk-test' });
    expect(getActiveProvider()!.name).toBe('openai');

    setActiveProvider({ provider: 'deepseek', apiKey: 'sk-ds-test' });
    expect(getActiveProvider()!.name).toBe('deepseek');
  });

  it('should switch from any provider to claude', () => {
    setActiveProvider({ provider: 'ollama' });

    setActiveProvider({ provider: 'claude', apiKey: 'sk-claude-test' });
    expect(getActiveProvider()!.name).toBe('claude');
    expect(getActiveProvider()!.tier).toBe(1);
  });

  it('should switch to custom-openai provider', () => {
    setActiveProvider({ provider: 'ollama' });
    expect(getActiveProvider()!.name).toBe('ollama');

    setActiveProvider({
      provider: 'custom-openai',
      apiKey: 'sk-custom',
      baseUrl: 'https://oneapi.example.com/v1',
      model: 'gpt-4o',
    });
    expect(getActiveProvider()!.name).toBe('custom-openai');
    expect(getActiveProvider()!.tier).toBe(2);
  });

  it('should reject invalid config during switch', () => {
    setActiveProvider({ provider: 'ollama' });

    // OpenAI requires API key
    expect(() =>
      setActiveProvider({ provider: 'openai' }),
    ).toThrow();

    // Original provider should still be active
    expect(getActiveProvider()!.name).toBe('ollama');
  });
});
