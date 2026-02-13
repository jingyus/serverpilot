// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * AI Provider abstraction layer.
 *
 * Defines the contract all AI providers must implement to be used
 * by the ServerPilot AI engine. Supports tiered model capabilities,
 * chat, streaming, and structured JSON responses.
 *
 * @module ai/providers/base
 */

import { z } from 'zod';
import type { TokenUsage } from '../token-tracker.js';

// Re-export TokenUsage for backward compatibility
export type { TokenUsage } from '../token-tracker.js';

// ============================================================================
// Types
// ============================================================================

/** Message in a conversation */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** Tool definition for function calling / tool_use */
export interface ToolDefinition {
  /** Tool name identifier */
  name: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** JSON Schema for the tool's input parameters */
  input_schema: Record<string, unknown>;
}

/** A tool_use block returned by the AI when it wants to call a tool */
export interface ToolUseBlock {
  type: 'tool_use';
  /** Unique ID for this tool call (used to match with tool_result) */
  id: string;
  /** Tool name being called */
  name: string;
  /** Input parameters for the tool */
  input: Record<string, unknown>;
}

/** Options for a chat request */
export interface ChatOptions {
  /** Conversation messages */
  messages: ChatMessage[];
  /** System prompt */
  system?: string;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Tool definitions for function calling (tool_use) */
  tools?: ToolDefinition[];
}

/** Result of a chat request */
export interface ChatResponse {
  /** The generated text content */
  content: string;
  /** Token usage statistics */
  usage: TokenUsage;
  /** Tool calls requested by the AI (when stop_reason is 'tool_use') */
  toolCalls?: ToolUseBlock[];
  /** Why the AI stopped: 'end_turn' (done), 'tool_use' (wants to call tools), 'max_tokens' */
  stopReason?: string;
}

/** Callbacks for streaming responses */
export interface ProviderStreamCallbacks {
  /** Called when streaming starts */
  onStart?: () => void;
  /** Called for each text token */
  onToken?: (token: string, accumulated: string) => void;
  /** Called when streaming completes */
  onComplete?: (content: string, usage: TokenUsage) => void;
  /** Called on error */
  onError?: (error: Error) => void;
}

/** Result of a streaming request */
export interface StreamResponse {
  /** The full accumulated text */
  content: string;
  /** Token usage statistics */
  usage: TokenUsage;
  /** Whether the request succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Tool calls requested by the AI (when stop_reason is 'tool_use') */
  toolCalls?: ToolUseBlock[];
  /** Why the AI stopped */
  stopReason?: string;
}

/** Configuration for an AI provider */
export interface ProviderConfig {
  /** Base URL for the API */
  baseUrl?: string;
  /** API key (optional for local providers like Ollama) */
  apiKey?: string;
  /** Model name */
  model?: string;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
}

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * AI Provider contract.
 *
 * All AI providers (Claude, Ollama, OpenAI, DeepSeek) must implement
 * this interface. Providers are tiered by capability:
 * - Tier 1: Claude (highest capability)
 * - Tier 2: GPT-4o, DeepSeek
 * - Tier 3: Ollama local models
 */
export interface AIProviderInterface {
  /** Provider name identifier */
  readonly name: string;
  /** Model capability tier (1 = highest, 3 = lowest) */
  readonly tier: 1 | 2 | 3;
  /** Model context window size in tokens */
  readonly contextWindowSize: number;

  /**
   * Send a chat request and get a response.
   *
   * @param options - Chat request options
   * @returns The chat response with content and usage
   */
  chat(options: ChatOptions): Promise<ChatResponse>;

  /**
   * Send a chat request with streaming response.
   *
   * @param options - Chat request options
   * @param callbacks - Streaming event callbacks
   * @returns The complete stream response
   */
  stream(options: ChatOptions, callbacks?: ProviderStreamCallbacks): Promise<StreamResponse>;

  /**
   * Check if the provider is available and configured.
   *
   * @returns true if the provider can accept requests
   */
  isAvailable(): Promise<boolean>;
}

// ============================================================================
// Validation Helpers
// ============================================================================

/** Zod schema for provider configuration */
export const ProviderConfigSchema = z.object({
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
});
