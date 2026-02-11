// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Chat-specific AI agent wrapper.
 *
 * Provides a conversational interface to the AI that can generate
 * both text responses and structured install plans from user messages.
 * Supports multiple AI providers via the provider factory.
 *
 * @module api/routes/chat-ai
 */

import { InstallPlanSchema } from '@aiinstaller/shared';
import type { InstallPlan } from '@aiinstaller/shared';
import type { AIProviderInterface } from '../../ai/providers/base.js';
import { getActiveProvider } from '../../ai/providers/provider-factory.js';
import { estimateTokens } from '../../ai/profile-context.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface ChatStreamCallbacks {
  onToken?: (token: string) => void | Promise<void>;
}

export interface ChatResult {
  text: string;
  plan: (InstallPlan & { description?: string }) | null;
  /** Estimated token usage for profile context portion */
  profileTokens?: number;
}

// ============================================================================
// ChatAIAgent
// ============================================================================

const BASE_SYSTEM_PROMPT = `You are ServerPilot, an AI DevOps assistant that helps users manage servers.

When users ask to install, configure, or manage software on their servers, you should:
1. Analyze the request and the server environment
2. Provide a clear explanation of what you will do
3. Generate an installation/configuration plan when appropriate

When generating a plan, output it in a JSON block marked with \`\`\`json-plan markers:

\`\`\`json-plan
{
  "description": "Brief description of the plan",
  "steps": [
    {
      "id": "step-1",
      "description": "What this step does",
      "command": "command to execute",
      "timeout": 60000,
      "canRollback": false,
      "onError": "abort"
    }
  ],
  "estimatedTime": 120000,
  "risks": [
    { "level": "low", "description": "Risk description" }
  ]
}
\`\`\`

For general questions or discussions that don't require execution, just respond conversationally.
Always be concise, security-aware, and explain risks clearly.`;

/**
 * Build the full system prompt with optional server profile and knowledge context.
 *
 * When profile context is provided, it is appended to the base prompt
 * so the AI is aware of the server's environment, installed software,
 * and any user-specified notes or caveats. Knowledge context (from RAG
 * search) provides relevant documentation snippets.
 */
export function buildSystemPrompt(
  profileContext?: string,
  caveats?: string[],
  knowledgeContext?: string,
): string {
  const parts = [BASE_SYSTEM_PROMPT];

  if (profileContext) {
    parts.push(profileContext);
  }

  if (caveats && caveats.length > 0) {
    parts.push('## Important Caveats\n' + caveats.map((c) => `- ${c}`).join('\n'));
  }

  if (knowledgeContext) {
    parts.push(knowledgeContext);
  }

  return parts.join('\n\n');
}

export class ChatAIAgent {
  private readonly provider: AIProviderInterface;

  constructor(provider: AIProviderInterface) {
    this.provider = provider;
  }

  /**
   * Send a chat message and stream the response.
   *
   * Parses the AI response for embedded plan JSON blocks. If found,
   * the plan is extracted and returned separately from the text.
   *
   * @param message - User message
   * @param serverContext - Minimal server identifier (e.g. "Server: web-01")
   * @param conversationHistory - Formatted conversation history
   * @param callbacks - Optional streaming callbacks
   * @param profileContext - Rich server profile context for system prompt
   * @param caveats - One-line cautions about existing software/services
   * @param knowledgeContext - RAG knowledge base context for system prompt
   */
  async chat(
    message: string,
    serverContext: string,
    conversationHistory: string,
    callbacks?: ChatStreamCallbacks,
    profileContext?: string,
    caveats?: string[],
    knowledgeContext?: string,
  ): Promise<ChatResult> {
    const systemPrompt = buildSystemPrompt(profileContext, caveats, knowledgeContext);
    const profileTokens = profileContext ? estimateTokens(profileContext) : 0;

    const userPrompt = conversationHistory
      ? `${serverContext}\n\nConversation history:\n${conversationHistory}\n\nUser: ${message}`
      : `${serverContext}\n\nUser: ${message}`;

    const result = await this.provider.stream(
      {
        messages: [{ role: 'user', content: userPrompt }],
        system: systemPrompt,
        maxTokens: 4096,
      },
      {
        onToken: (token) => {
          if (callbacks?.onToken) {
            const cbResult = callbacks.onToken(token);
            if (cbResult && typeof (cbResult as Promise<void>).catch === 'function') {
              (cbResult as Promise<void>).catch((err) => {
                logger.error(
                  { operation: 'chat_stream_token_error', error: String(err) },
                  'Token callback error',
                );
              });
            }
          }
        },
      },
    );

    if (!result.success) {
      throw new Error(result.error ?? 'AI streaming request failed');
    }

    // Extract plan from response if present
    const plan = this.extractPlan(result.content);

    return {
      text: result.content,
      plan,
      profileTokens,
    };
  }

  /**
   * Extract a JSON plan block from the AI response text.
   * Looks for ```json-plan ... ``` markers.
   */
  private extractPlan(text: string): (InstallPlan & { description?: string }) | null {
    const planMatch = text.match(/```json-plan\s*\n([\s\S]*?)```/);
    if (!planMatch) return null;

    try {
      const raw = JSON.parse(planMatch[1]);
      const description = raw.description as string | undefined;
      const plan = InstallPlanSchema.parse(raw);
      return { ...plan, description };
    } catch (err) {
      logger.warn(
        { operation: 'plan_parse_error', error: String(err) },
        'Failed to parse plan from AI response',
      );
      return null;
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _agent: ChatAIAgent | null = null;

/**
 * Initialize the chat AI agent with a specific provider.
 */
export function initChatAIAgent(provider: AIProviderInterface): ChatAIAgent {
  _agent = new ChatAIAgent(provider);
  return _agent;
}

/**
 * Get the chat AI agent, lazily initializing from the active provider.
 */
export function getChatAIAgent(): ChatAIAgent | null {
  if (!_agent) {
    const provider = getActiveProvider();
    if (provider) {
      _agent = new ChatAIAgent(provider);
    }
  }
  return _agent;
}

/**
 * Reinitialize the chat AI agent with the current active provider.
 * Called after provider switch to ensure chat uses the new provider.
 */
export function refreshChatAIAgent(): void {
  _agent = null;
}

/** Reset for testing */
export function _resetChatAIAgent(): void {
  _agent = null;
}
