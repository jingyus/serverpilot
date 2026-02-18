// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * AI Provider factory — creates and manages provider instances.
 *
 * Supports dynamic provider selection via:
 * 1. Environment variable `AI_PROVIDER` (startup default)
 * 2. User settings (runtime switching via Settings API)
 * 3. Programmatic `setActiveProvider()` calls
 *
 * @module ai/providers/provider-factory
 */

import { logger } from "../../utils/logger.js";
import type { AIProviderInterface, ProviderConfig } from "./base.js";
import { ClaudeProvider } from "./claude.js";
import type { ClaudeConfig } from "./claude.js";
import { OpenAIProvider } from "./openai.js";
import type { OpenAIConfig } from "./openai.js";
import { OllamaProvider } from "./ollama.js";
import type { OllamaConfig } from "./ollama.js";
import { DeepSeekProvider } from "./deepseek.js";
import type { DeepSeekConfig } from "./deepseek.js";
import { CustomOpenAIProvider } from "./custom-openai.js";
import type { CustomOpenAIConfig } from "./custom-openai.js";

// ============================================================================
// Types
// ============================================================================

/** Supported provider names */
export type AIProviderType =
  | "claude"
  | "openai"
  | "ollama"
  | "deepseek"
  | "custom-openai";

/** Provider-specific configuration options */
export interface ProviderFactoryConfig {
  /** Which provider to use */
  provider: AIProviderType;
  /** API key (used by claude, openai, deepseek) */
  apiKey?: string;
  /** Model name */
  model?: string;
  /** Base URL override */
  baseUrl?: string;
  /** Timeout in ms */
  timeoutMs?: number;
}

/** Health check result for a provider */
export interface ProviderHealthStatus {
  provider: AIProviderType;
  available: boolean;
  tier: 1 | 2 | 3;
  error?: string;
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an AI provider instance from configuration.
 *
 * @param config - Provider configuration
 * @returns The created provider instance
 * @throws If the provider type is unknown or config is invalid
 */
export function createProvider(
  config: ProviderFactoryConfig,
): AIProviderInterface {
  switch (config.provider) {
    case "claude": {
      const claudeConfig: ClaudeConfig = {
        apiKey: config.apiKey,
        model: config.model,
        timeoutMs: config.timeoutMs,
      };
      return new ClaudeProvider(claudeConfig);
    }

    case "openai": {
      const openaiConfig: OpenAIConfig = {
        apiKey: config.apiKey,
        model: config.model,
        baseUrl: config.baseUrl,
        timeoutMs: config.timeoutMs,
      };
      return new OpenAIProvider(openaiConfig);
    }

    case "ollama": {
      const ollamaConfig: OllamaConfig = {
        model: config.model,
        baseUrl: config.baseUrl,
        timeoutMs: config.timeoutMs,
      };
      return new OllamaProvider(ollamaConfig);
    }

    case "deepseek": {
      const deepseekConfig: DeepSeekConfig = {
        apiKey: config.apiKey,
        model: config.model,
        baseUrl: config.baseUrl,
        timeoutMs: config.timeoutMs,
      };
      return new DeepSeekProvider(deepseekConfig);
    }

    case "custom-openai": {
      const customConfig: CustomOpenAIConfig = {
        baseUrl: config.baseUrl ?? "",
        apiKey: config.apiKey ?? "",
        model: config.model ?? "",
        timeoutMs: config.timeoutMs,
      };
      return new CustomOpenAIProvider(customConfig);
    }

    default:
      throw new Error(`Unknown AI provider: ${config.provider as string}`);
  }
}

/**
 * Resolve provider configuration from environment variables.
 *
 * Reads `AI_PROVIDER` to determine the provider type, then loads
 * the appropriate API key from provider-specific env vars.
 *
 * @returns Factory config, or null if no provider can be configured
 */
export function resolveProviderFromEnv(): ProviderFactoryConfig | null {
  const providerName = (process.env.AI_PROVIDER ?? "claude").toLowerCase();

  // Validate provider name
  if (!isValidProviderType(providerName)) {
    logger.warn(
      { operation: "provider_factory", provider: providerName },
      `Unknown AI_PROVIDER value "${providerName}", falling back to "claude"`,
    );
    return resolveProviderConfig("claude");
  }

  return resolveProviderConfig(providerName);
}

/**
 * Build provider config for a specific provider type from env vars.
 */
function resolveProviderConfig(
  provider: AIProviderType,
): ProviderFactoryConfig | null {
  const model = process.env.AI_MODEL;
  const timeoutMs = process.env.AI_TIMEOUT_MS
    ? parseInt(process.env.AI_TIMEOUT_MS, 10)
    : undefined;

  switch (provider) {
    case "claude": {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return null;
      return { provider, apiKey, model, timeoutMs };
    }

    case "openai": {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return null;
      return {
        provider,
        apiKey,
        model,
        baseUrl: process.env.OPENAI_BASE_URL,
        timeoutMs,
      };
    }

    case "deepseek": {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) return null;
      return {
        provider,
        apiKey,
        model,
        baseUrl: process.env.DEEPSEEK_BASE_URL,
        timeoutMs,
      };
    }

    case "ollama":
      return {
        provider,
        model,
        baseUrl: process.env.OLLAMA_BASE_URL,
        timeoutMs,
      };

    case "custom-openai": {
      const apiKey = process.env.CUSTOM_OPENAI_API_KEY;
      const baseUrl = process.env.CUSTOM_OPENAI_BASE_URL;
      if (!apiKey || !baseUrl) return null;
      return { provider, apiKey, model, baseUrl, timeoutMs };
    }

    default:
      return null;
  }
}

/**
 * 当前对话实际使用哪个 AI？
 * - 由内存中的 active provider 决定，与「设置页显示」可能不一致。
 * - 启动时：从 .env 的 AI_PROVIDER / API Key 等初始化一次。
 * - 之后：只有在「设置页点击保存」时才会用保存的配置覆盖内存。
 * 因此：.env 填了 Claude、设置页选了 DeepSeek 但没点保存 → 对话仍用 Claude；
 *       设置页选了 DeepSeek 并点击保存 → 对话改用 DeepSeek。
 */

/**
 * Check if a provider is available (health check).
 *
 * @param provider - The provider instance to check
 * @returns Health status with availability info
 */
export async function checkProviderHealth(
  provider: AIProviderInterface,
): Promise<ProviderHealthStatus> {
  const providerType = provider.name as AIProviderType;
  try {
    const available = await provider.isAvailable();
    return {
      provider: providerType,
      available,
      tier: provider.tier,
      error: available
        ? undefined
        : "健康检查未通过。请检查：API Key（Claude/OpenAI/DeepSeek）、模型名称、Base URL（Ollama 需已启动且地址可从当前环境访问）。",
    };
  } catch (err) {
    return {
      provider: providerType,
      available: false,
      tier: provider.tier,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function isValidProviderType(value: string): value is AIProviderType {
  return ["claude", "openai", "ollama", "deepseek", "custom-openai"].includes(
    value,
  );
}

// ============================================================================
// Singleton Manager
// ============================================================================

let _activeProvider: AIProviderInterface | null = null;
let _activeConfig: ProviderFactoryConfig | null = null;

/**
 * Get the active AI provider, initializing from env if needed.
 *
 * @returns The active provider instance, or null if none configured
 */
export function getActiveProvider(): AIProviderInterface | null {
  if (!_activeProvider) {
    const config = resolveProviderFromEnv();
    if (config) {
      try {
        _activeProvider = createProvider(config);
        _activeConfig = config;
        logger.info(
          { operation: "provider_factory", provider: config.provider },
          `AI provider initialized: ${config.provider}`,
        );
      } catch (err) {
        logger.error(
          {
            operation: "provider_factory",
            provider: config.provider,
            error: err instanceof Error ? err.message : String(err),
          },
          `Failed to initialize AI provider: ${config.provider}`,
        );
      }
    }
  }
  return _activeProvider;
}

/**
 * Get the current active provider configuration.
 */
export function getActiveProviderConfig(): ProviderFactoryConfig | null {
  return _activeConfig;
}

/**
 * Switch to a different AI provider at runtime.
 *
 * @param config - New provider configuration
 * @returns The new provider instance
 */
export function setActiveProvider(
  config: ProviderFactoryConfig,
): AIProviderInterface {
  const provider = createProvider(config);
  _activeProvider = provider;
  _activeConfig = config;
  logger.info(
    { operation: "provider_switch", provider: config.provider },
    `AI provider switched to: ${config.provider}`,
  );
  return provider;
}

/** Reset singleton (for testing). */
export function _resetProviderFactory(): void {
  _activeProvider = null;
  _activeConfig = null;
}
