/**
 * Chat-specific AI agent wrapper.
 *
 * Provides a conversational interface to the AI that can generate
 * both text responses and structured install plans from user messages.
 *
 * @module api/routes/chat-ai
 */

import Anthropic from '@anthropic-ai/sdk';
import { InstallPlanSchema } from '@aiinstaller/shared';
import type { InstallPlan } from '@aiinstaller/shared';
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
}

// ============================================================================
// ChatAIAgent
// ============================================================================

const SYSTEM_PROMPT = `You are ServerPilot, an AI DevOps assistant that helps users manage servers.

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

export class ChatAIAgent {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: { apiKey: string; model?: string; timeoutMs?: number }) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model ?? 'claude-sonnet-4-20250514';
    this.timeoutMs = options.timeoutMs ?? 60000;
  }

  /**
   * Send a chat message and stream the response.
   *
   * Parses the AI response for embedded plan JSON blocks. If found,
   * the plan is extracted and returned separately from the text.
   */
  async chat(
    message: string,
    serverContext: string,
    conversationHistory: string,
    callbacks?: ChatStreamCallbacks,
  ): Promise<ChatResult> {
    const userPrompt = conversationHistory
      ? `${serverContext}\n\nConversation history:\n${conversationHistory}\n\nUser: ${message}`
      : `${serverContext}\n\nUser: ${message}`;

    let accumulated = '';

    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      },
      { timeout: this.timeoutMs },
    );

    stream.on('text', (delta: string) => {
      accumulated += delta;
      // Fire token callback (may be async, but we don't await during event)
      if (callbacks?.onToken) {
        const result = callbacks.onToken(delta);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch((err) => {
            logger.error({ operation: 'chat_stream_token_error', error: String(err) }, 'Token callback error');
          });
        }
      }
    });

    await stream.finalMessage();

    // Extract plan from response if present
    const plan = this.extractPlan(accumulated);

    return {
      text: accumulated,
      plan,
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

export function initChatAIAgent(options: {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}): ChatAIAgent {
  _agent = new ChatAIAgent(options);
  return _agent;
}

export function getChatAIAgent(): ChatAIAgent | null {
  // Lazy init from environment if not explicitly set
  if (!_agent && process.env.ANTHROPIC_API_KEY) {
    _agent = new ChatAIAgent({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.AI_MODEL,
    });
  }
  return _agent;
}

/** Reset for testing */
export function _resetChatAIAgent(): void {
  _agent = null;
}
