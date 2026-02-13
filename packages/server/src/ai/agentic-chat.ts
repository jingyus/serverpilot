// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/** Agentic Chat Engine — autonomous AI loop with tool_use. */

import Anthropic from "@anthropic-ai/sdk";
import type { SSEStreamingApi } from "hono/streaming";
import type { FullServerProfile } from "../core/profile/manager.js";
import { findConnectedAgent } from "../core/agent/agent-connector.js";
import { logger } from "../utils/logger.js";
import { TOOLS } from "./agentic-tools.js";
import { buildFullSystemPrompt } from "./agentic-prompts.js";
import { trimMessagesIfNeeded } from "./agentic-message-utils.js";
import { classifyError } from "./request-retry.js";
import type { ErrorCategory } from "./request-retry.js";
import {
  executeToolCall,
  writeSSE,
  type AbortStateInterface,
} from "./agentic-tool-executors.js";

// Re-export extracted symbols for backward compatibility
export {
  ExecuteCommandInputSchema,
  ReadFileInputSchema,
  ListFilesInputSchema,
} from "./agentic-tools.js";
export {
  estimateMessagesTokens,
  trimMessagesIfNeeded,
  type TrimResult,
} from "./agentic-message-utils.js";

// Constants

/** Maximum agentic loop iterations to prevent runaway */
const MAX_TURNS = 25;

/** Maximum estimated tokens for the messages array before trimming */
const MAX_MESSAGES_TOKENS = 150_000;

/** Default model */
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

/** Shared abort flag — set by onAbort / writeSSE failure, read at every async boundary. */
class AbortState implements AbortStateInterface {
  private _aborted = false;
  private readonly listeners: Array<() => void> = [];

  get aborted(): boolean {
    return this._aborted;
  }
  set aborted(value: boolean) {
    if (value && !this._aborted) {
      this._aborted = true;
      for (const cb of this.listeners) cb();
      this.listeners.length = 0;
    }
  }

  onAbort(cb: () => void): () => void {
    if (this._aborted) {
      cb();
      return () => {};
    }
    this.listeners.push(cb);
    return () => {
      const idx = this.listeners.indexOf(cb);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }
}

// Types

export interface AgenticRunOptions {
  /** User's chat message */
  userMessage: string;
  /** Target server ID */
  serverId: string;
  /** Authenticated user ID */
  userId: string;
  /** Chat session ID (in-memory, not DB) */
  sessionId: string;
  /** SSE stream to push events to Dashboard */
  stream: SSEStreamingApi;
  /** Previous conversation messages for context */
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Server profile for context injection */
  serverProfile?: FullServerProfile | null;
  /** Server display name */
  serverName?: string;
  /** Callback when a risky command needs user confirmation. */
  onConfirmRequired?: (
    command: string,
    riskLevel: string,
    description: string,
  ) => {
    confirmId: string;
    approved: Promise<boolean>;
  };
}

export interface AgenticRunResult {
  /** Whether the agentic loop completed without error */
  success: boolean;
  /** Total number of AI turns taken */
  turns: number;
  /** Total number of tool calls executed */
  toolCallCount: number;
  /** Final text output from the AI */
  finalText: string;
}

// AgenticChatEngine

export class AgenticChatEngine {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(client: Anthropic, model?: string) {
    this.client = client;
    this.model = model ?? DEFAULT_MODEL;
  }

  /**
   * Run the autonomous agentic loop.
   *
   * Flow: user message → AI thinks → calls tools → observes → thinks again → ...
   * Continues until AI stops calling tools (end_turn) or MAX_TURNS reached.
   */
  async run(opts: AgenticRunOptions): Promise<AgenticRunResult> {
    const {
      userMessage,
      serverId,
      userId,
      sessionId,
      stream,
      conversationHistory,
      serverProfile,
      serverName,
    } = opts;

    // Check agent connectivity
    const clientId = findConnectedAgent(serverId);
    if (!clientId) {
      await writeSSE(stream, "message", {
        content:
          "该服务器当前没有 Agent 在线，无法执行命令。请确认 Agent 已安装并运行。",
      });
      await writeSSE(stream, "complete", {
        success: false,
        reason: "agent_offline",
      });
      return { success: false, turns: 0, toolCallCount: 0, finalText: "" };
    }

    const abort = new AbortState();
    stream.onAbort(() => {
      abort.aborted = true;
      logger.info(
        { operation: "agentic_loop", serverId },
        "Client disconnected, aborting agentic loop",
      );
    });

    // Build system prompt with profile + knowledge context
    const systemPrompt = await buildFullSystemPrompt(
      userMessage,
      serverProfile,
      serverName,
    );

    // Build message history
    const messages: Anthropic.MessageParam[] = [];

    if (conversationHistory?.length) {
      for (const msg of conversationHistory) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: "user", content: userMessage });

    // Pre-trim if conversation history exceeds token budget
    trimMessagesIfNeeded(messages, MAX_MESSAGES_TOKENS);

    let turns = 0;
    let toolCallCount = 0;
    let finalText = "";

    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        turns = turn + 1;

        if (abort.aborted) {
          logger.info(
            { operation: "agentic_loop", serverId, turn },
            "Agentic loop aborted: client disconnected",
          );
          return { success: false, turns, toolCallCount, finalText };
        }

        const collected = await this.streamAnthropicCall(
          systemPrompt,
          messages,
          stream,
          abort,
        );

        if (collected.text) {
          finalText += collected.text;
        }

        if (collected.toolUseBlocks.length === 0) {
          break;
        }

        if (abort.aborted) {
          logger.info(
            { operation: "agentic_loop", serverId, turn },
            "Agentic loop aborted after AI call: client disconnected",
          );
          return { success: false, turns, toolCallCount, finalText };
        }

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        const ctx = { serverId, userId, sessionId, clientId, stream, abort };

        for (const toolCall of collected.toolUseBlocks) {
          if (abort.aborted) break;
          toolCallCount++;
          const result = await executeToolCall(
            toolCall,
            ctx,
            opts.onConfirmRequired,
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: result,
          });
        }

        if (abort.aborted) {
          logger.info(
            { operation: "agentic_loop", serverId, turn },
            "Agentic loop aborted during tool execution: client disconnected",
          );
          return { success: false, turns, toolCallCount, finalText };
        }

        messages.push({ role: "assistant", content: collected.rawContent });
        messages.push({ role: "user", content: toolResults });

        trimMessagesIfNeeded(messages, MAX_MESSAGES_TOKENS);
      }

      if (!abort.aborted) {
        const maxTurnsReached = turns >= MAX_TURNS;
        if (maxTurnsReached) {
          await writeSSE(
            stream,
            "message",
            {
              content:
                "\n\n已达到最大执行轮次（25 轮）。如需继续，请发送新消息。",
            },
            abort,
          );
        }

        await writeSSE(
          stream,
          "complete",
          {
            success: true,
            turns,
            toolCallCount,
            ...(maxTurnsReached ? { reason: "max_turns_reached" } : {}),
          },
          abort,
        );
      }
      return { success: true, turns, toolCallCount, finalText };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(
        { operation: "agentic_loop", serverId, error: errorMsg },
        "Agentic loop error",
      );
      if (!abort.aborted) {
        const userMsg = getUserFacingErrorMessage(err);
        await writeSSE(
          stream,
          "message",
          {
            content: `\n\n${userMsg}`,
          },
          abort,
        );
        await writeSSE(
          stream,
          "complete",
          { success: false, error: errorMsg },
          abort,
        );
      }
      return { success: false, turns, toolCallCount, finalText };
    }
  }

  /**
   * Stream a single Anthropic API call, collecting text + tool_use blocks.
   */
  private async streamAnthropicCall(
    systemPrompt: string,
    messages: Anthropic.MessageParam[],
    stream: SSEStreamingApi,
    abort: AbortState,
  ): Promise<{
    text: string;
    toolUseBlocks: Anthropic.ToolUseBlock[];
    rawContent: Anthropic.ContentBlock[];
    stopReason: string | null;
  }> {
    let text = "";
    const toolUseBlocks: Anthropic.ToolUseBlock[] = [];

    const response = this.client.messages.stream({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      tools: TOOLS,
    });

    response.on("text", (delta: string) => {
      text += delta;
      if (abort.aborted) {
        response.abort();
        return;
      }
      void writeSSE(stream, "message", { content: delta }, abort);
    });

    response.on("contentBlock", (block: Anthropic.ContentBlock) => {
      if (block.type === "tool_use") {
        void writeSSE(
          stream,
          "tool_call",
          {
            id: block.id,
            tool: block.name,
            status: "running",
          },
          abort,
        );
      }
    });

    response.on("inputJson", (_delta: string) => {
      if (abort.aborted) {
        response.abort();
      }
    });

    const finalMessage = await response.finalMessage();

    for (const block of finalMessage.content) {
      if (block.type === "tool_use") {
        toolUseBlocks.push(block);
      }
    }

    return {
      text,
      toolUseBlocks,
      rawContent: finalMessage.content,
      stopReason: finalMessage.stop_reason,
    };
  }
}

// Error classification → user-facing message

const ERROR_MESSAGES: Record<ErrorCategory, string> = {
  authentication: "请检查 AI Provider API Key 设置，当前密钥无效或已过期。",
  rate_limit: "AI 服务请求过于频繁，请稍后重试。",
  invalid_request: "对话过长，建议新建会话后重试。",
  timeout: "AI 服务响应超时，请稍后重试。",
  network: "网络连接异常，请检查服务器网络配置。",
  overloaded: "AI 服务暂时不可用，请稍后重试。",
  server_error: "AI 服务内部错误，请稍后重试。",
  unknown: "执行过程中发生错误",
};

export function getUserFacingErrorMessage(error: unknown): string {
  const classification = classifyError(error);
  const base = ERROR_MESSAGES[classification.category];
  if (classification.category === "unknown") {
    return `${base}: ${classification.message}`;
  }
  return base;
}

// Singleton

let _engine: AgenticChatEngine | null = null;

export function initAgenticEngine(
  client: Anthropic,
  model?: string,
): AgenticChatEngine {
  _engine = new AgenticChatEngine(client, model);
  return _engine;
}

export function getAgenticEngine(): AgenticChatEngine | null {
  return _engine;
}

export function _resetAgenticEngine(): void {
  _engine = null;
}
