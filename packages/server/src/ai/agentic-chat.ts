// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/** Agentic Chat Engine — autonomous AI loop with tool_use. */

import Anthropic from '@anthropic-ai/sdk';
import type { SSEStreamingApi } from 'hono/streaming';
import { RiskLevel } from '@aiinstaller/shared';
import { getTaskExecutor } from '../core/task/executor.js';
import { findConnectedAgent } from '../core/agent/agent-connector.js';
import { validateCommand } from '../core/security/command-validator.js';
import { getAuditLogger } from '../core/security/audit-logger.js';
import { logger } from '../utils/logger.js';
import { TOOLS, ExecuteCommandInputSchema, ReadFileInputSchema, ListFilesInputSchema } from './agentic-tools.js';
import { buildFullSystemPrompt } from './agentic-prompts.js';
import { trimMessagesIfNeeded } from './agentic-message-utils.js';

// Re-export extracted symbols for backward compatibility
export { ExecuteCommandInputSchema, ReadFileInputSchema, ListFilesInputSchema } from './agentic-tools.js';
export { estimateMessagesTokens, trimMessagesIfNeeded, type TrimResult } from './agentic-message-utils.js';

// Constants

/** Maximum agentic loop iterations to prevent runaway */
const MAX_TURNS = 25;

/** Maximum estimated tokens for the messages array before trimming */
const MAX_MESSAGES_TOKENS = 150_000;

/** Default model */
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

/** Shared abort flag — set by onAbort / writeSSE failure, read at every async boundary. */
interface AbortState { aborted: boolean }

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
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Server profile for context injection */
  serverProfile?: unknown;
  /** Server display name */
  serverName?: string;
  /** Callback when a risky command needs user confirmation.
   *  Returns confirmId (for SSE) and a Promise that resolves when the user responds. */
  onConfirmRequired?: (command: string, riskLevel: string, description: string) => {
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
      userMessage, serverId, userId, sessionId, stream,
      conversationHistory, serverProfile, serverName,
    } = opts;

    // Check agent connectivity
    const clientId = findConnectedAgent(serverId);
    if (!clientId) {
      await this.writeSSE(stream, 'message', {
        content: '该服务器当前没有 Agent 在线，无法执行命令。请确认 Agent 已安装并运行。',
      });
      await this.writeSSE(stream, 'complete', { success: false, reason: 'agent_offline' });
      return { success: false, turns: 0, toolCallCount: 0, finalText: '' };
    }

    const abort: AbortState = { aborted: false };
    stream.onAbort(() => {
      abort.aborted = true;
      logger.info({ operation: 'agentic_loop', serverId }, 'Client disconnected, aborting agentic loop');
    });

    // Build system prompt with profile + knowledge context
    const systemPrompt = await buildFullSystemPrompt(
      userMessage, serverProfile, serverName,
    );

    // Build message history
    const messages: Anthropic.MessageParam[] = [];

    // Add conversation history
    if (conversationHistory?.length) {
      for (const msg of conversationHistory) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // Add current user message
    messages.push({ role: 'user', content: userMessage });

    let turns = 0;
    let toolCallCount = 0;
    let finalText = '';

    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        turns = turn + 1;

        // Abort if client disconnected — avoid wasting API calls
        if (abort.aborted) {
          logger.info({ operation: 'agentic_loop', serverId, turn }, 'Agentic loop aborted: client disconnected');
          return { success: false, turns, toolCallCount, finalText };
        }

        // Call Claude with tools — streaming
        const collected = await this.streamAnthropicCall(
          systemPrompt, messages, stream, abort,
        );

        // Accumulate text for return value
        if (collected.text) {
          finalText += collected.text;
        }

        // No tool calls → AI is done
        if (collected.toolUseBlocks.length === 0) {
          break;
        }

        // Process tool calls — skip if client disconnected
        if (abort.aborted) {
          logger.info({ operation: 'agentic_loop', serverId, turn }, 'Agentic loop aborted after AI call: client disconnected');
          return { success: false, turns, toolCallCount, finalText };
        }

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolCall of collected.toolUseBlocks) {
          if (abort.aborted) break;
          toolCallCount++;
          const result = await this.executeToolCall(
            toolCall, serverId, userId, sessionId, clientId, stream, abort, opts.onConfirmRequired,
          );
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: result,
          });
        }

        // If aborted during tool execution, don't continue the loop
        if (abort.aborted) {
          logger.info({ operation: 'agentic_loop', serverId, turn }, 'Agentic loop aborted during tool execution: client disconnected');
          return { success: false, turns, toolCallCount, finalText };
        }

        // Append assistant response + tool results to conversation
        messages.push({ role: 'assistant', content: collected.rawContent });
        messages.push({ role: 'user', content: toolResults });

        // Trim older messages if the array exceeds the token budget.
        // Keep the first message (original user query) and the most recent pairs.
        trimMessagesIfNeeded(messages, MAX_MESSAGES_TOKENS);
      }

      if (!abort.aborted) {
        await this.writeSSE(stream, 'complete', { success: true, turns, toolCallCount }, abort);
      }
      return { success: true, turns, toolCallCount, finalText };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(
        { operation: 'agentic_loop', serverId, error: errorMsg },
        'Agentic loop error',
      );
      if (!abort.aborted) {
        await this.writeSSE(stream, 'message', {
          content: `\n\n执行过程中发生错误: ${errorMsg}`,
        }, abort);
        await this.writeSSE(stream, 'complete', { success: false, error: errorMsg }, abort);
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
    let text = '';
    const toolUseBlocks: Anthropic.ToolUseBlock[] = [];

    const response = this.client.messages.stream({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      tools: TOOLS,
    });

    // Stream text to Dashboard; abort Anthropic stream early on disconnect
    response.on('text', (delta: string) => {
      text += delta;
      if (abort.aborted) {
        response.abort();
        return;
      }
      this.writeSSE(stream, 'message', { content: delta }, abort).catch(() => {});
    });

    // Track tool_use content blocks as they start
    response.on('contentBlock', (block: Anthropic.ContentBlock) => {
      if (block.type === 'tool_use') {
        // Notify frontend that a tool call is starting
        this.writeSSE(stream, 'tool_call', {
          id: block.id,
          tool: block.name,
          status: 'running',
        }, abort).catch(() => {});
      }
    });

    response.on('inputJson', (_delta: string) => {
      if (abort.aborted) {
        response.abort();
      }
    });

    const finalMessage = await response.finalMessage();

    // Extract completed tool_use blocks from the final message
    for (const block of finalMessage.content) {
      if (block.type === 'tool_use') {
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

  /**
   * Execute a single tool call and return the result string.
   */
  private async executeToolCall(
    toolCall: Anthropic.ToolUseBlock,
    serverId: string,
    userId: string,
    sessionId: string,
    clientId: string,
    stream: SSEStreamingApi,
    abort: AbortState,
    onConfirmRequired?: (command: string, riskLevel: string, description: string) => {
      confirmId: string;
      approved: Promise<boolean>;
    },
  ): Promise<string> {
    const { name, input } = toolCall;

    // Early exit if client already disconnected
    if (abort.aborted) {
      return 'Error: Client disconnected, skipping tool execution';
    }

    try {
      switch (name) {
        case 'execute_command': {
          const parsed = ExecuteCommandInputSchema.safeParse(input);
          if (!parsed.success) {
            return `Error: Invalid tool input for execute_command: ${parsed.error.issues.map((i) => i.message).join('; ')}`;
          }
          return await this.toolExecuteCommand(
            parsed.data,
            serverId, userId, sessionId, clientId, stream, toolCall.id, abort,
            onConfirmRequired,
          );
        }

        case 'read_file': {
          const parsed = ReadFileInputSchema.safeParse(input);
          if (!parsed.success) {
            return `Error: Invalid tool input for read_file: ${parsed.error.issues.map((i) => i.message).join('; ')}`;
          }
          return await this.toolReadFile(
            parsed.data,
            serverId, userId, sessionId, clientId, stream, toolCall.id, abort,
          );
        }

        case 'list_files': {
          const parsed = ListFilesInputSchema.safeParse(input);
          if (!parsed.success) {
            return `Error: Invalid tool input for list_file: ${parsed.error.issues.map((i) => i.message).join('; ')}`;
          }
          return await this.toolListFiles(
            parsed.data,
            serverId, userId, sessionId, clientId, stream, toolCall.id, abort,
          );
        }

        default:
          return `Error: Unknown tool "${name}"`;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.writeSSE(stream, 'tool_result', {
        id: toolCall.id,
        tool: name,
        status: 'failed',
        error: errMsg,
      }, abort);
      return `Error executing ${name}: ${errMsg}`;
    }
  }

  /**
   * Tool: execute_command — Run a shell command on the server.
   */
  private async toolExecuteCommand(
    input: { command: string; description: string; timeout_seconds?: number },
    serverId: string,
    userId: string,
    sessionId: string,
    clientId: string,
    stream: SSEStreamingApi,
    toolCallId: string,
    abort: AbortState,
    onConfirmRequired?: (command: string, riskLevel: string, description: string) => {
      confirmId: string;
      approved: Promise<boolean>;
    },
  ): Promise<string> {
    const { command, description } = input;
    const timeoutMs = Math.min((input.timeout_seconds ?? 30) * 1000, 600_000);

    // Security classification
    const validation = validateCommand(command);
    const riskLevel = validation.classification.riskLevel;

    // Audit log
    const auditLogger = getAuditLogger();
    const auditEntry = await auditLogger.log({
      serverId, userId, sessionId,
      command, validation,
    });

    // FORBIDDEN → block immediately
    if (validation.action === 'blocked') {
      const msg = `命令被安全策略阻止: ${validation.classification.reason}`;
      await this.writeSSE(stream, 'tool_result', {
        id: toolCallId,
        tool: 'execute_command',
        status: 'blocked',
        output: msg,
      }, abort);
      return msg;
    }

    // YELLOW/RED/CRITICAL → ask user for confirmation
    if (riskLevel !== RiskLevel.GREEN && onConfirmRequired) {
      const confirmation = onConfirmRequired(command, riskLevel, description);

      await this.writeSSE(stream, 'confirm_required', {
        id: toolCallId,
        command,
        description,
        riskLevel,
        confirmId: confirmation.confirmId,
      }, abort);

      const approved = await confirmation.approved;

      if (!approved) {
        const msg = `用户拒绝执行: ${command}`;
        await this.writeSSE(stream, 'tool_result', {
          id: toolCallId,
          tool: 'execute_command',
          status: 'rejected',
          output: msg,
        }, abort);
        await auditLogger.updateExecutionResult(auditEntry.id, 'skipped');
        return msg;
      }
    }

    // Check abort before dispatching command to agent
    if (abort.aborted) {
      return 'Error: Client disconnected, skipping command execution';
    }

    // Execute the command
    await this.writeSSE(stream, 'tool_executing', {
      id: toolCallId,
      tool: 'execute_command',
      command,
    }, abort);

    const executor = getTaskExecutor();

    let hasStreamedOutput = false;
    executor.addProgressListener(toolCallId, (_executionId, _status, output) => {
      if (output) {
        hasStreamedOutput = true;
        this.writeSSE(stream, 'tool_output', {
          id: toolCallId,
          content: output,
        }, abort).catch(() => {});
      }
    });

    const validatedRiskLevel = riskLevel as 'green' | 'yellow' | 'red' | 'critical';

    let result;
    try {
      result = await executor.executeCommand({
        serverId, userId, clientId,
        command, description,
        riskLevel: validatedRiskLevel,
        type: 'execute',
        timeoutMs,
      });
    } finally {
      executor.removeProgressListener(toolCallId);
    }

    // Build result string for AI
    let output = '';
    if (result.stdout) output += result.stdout;
    if (result.stderr) output += (output ? '\n' : '') + result.stderr;
    if (!output) output = result.success ? '(命令执行成功，无输出)' : '(命令执行失败，无输出)';

    // Send tool result to frontend
    await this.writeSSE(stream, 'tool_result', {
      id: toolCallId,
      tool: 'execute_command',
      status: result.success ? 'completed' : 'failed',
      exitCode: result.exitCode,
      output: hasStreamedOutput ? undefined : output,
      duration: result.duration,
    }, abort);

    await auditLogger.updateExecutionResult(
      auditEntry.id,
      result.success ? 'success' : 'failed',
      result.operationId,
    );

    // Return result to AI for reasoning
    const statusLine = result.success
      ? `[Exit code: ${result.exitCode}, Duration: ${result.duration}ms]`
      : `[FAILED - Exit code: ${result.exitCode}, Duration: ${result.duration}ms]`;

    return `${statusLine}\n${output}`;
  }

  /**
   * Tool: read_file — Read file contents via cat command.
   */
  private async toolReadFile(
    input: { path: string; max_lines?: number },
    serverId: string,
    userId: string,
    sessionId: string,
    clientId: string,
    stream: SSEStreamingApi,
    toolCallId: string,
    abort: AbortState,
  ): Promise<string> {
    const maxLines = input.max_lines ?? 200;
    const command = `head -n ${maxLines} ${this.shellEscape(input.path)}`;

    return this.toolExecuteCommand(
      { command, description: `Read file: ${input.path}` },
      serverId, userId, sessionId, clientId, stream, toolCallId, abort,
    );
  }

  /**
   * Tool: list_files — List directory via ls command.
   */
  private async toolListFiles(
    input: { path: string; show_hidden?: boolean },
    serverId: string,
    userId: string,
    sessionId: string,
    clientId: string,
    stream: SSEStreamingApi,
    toolCallId: string,
    abort: AbortState,
  ): Promise<string> {
    const flags = input.show_hidden ? '-lah' : '-lh';
    const command = `ls ${flags} ${this.shellEscape(input.path)}`;

    return this.toolExecuteCommand(
      { command, description: `List files: ${input.path}` },
      serverId, userId, sessionId, clientId, stream, toolCallId, abort,
    );
  }

  /** Write SSE event; on failure sets abort.aborted immediately. */
  private async writeSSE(
    stream: SSEStreamingApi,
    event: string,
    data: Record<string, unknown>,
    abort?: AbortState,
  ): Promise<void> {
    try {
      await stream.writeSSE({ event, data: JSON.stringify(data) });
    } catch {
      if (abort) abort.aborted = true;
    }
  }

  /** Escape a string for safe shell usage */
  private shellEscape(s: string): string {
    return `'${s.replace(/'/g, "'\\''")}'`;
  }
}

// Singleton

let _engine: AgenticChatEngine | null = null;

export function initAgenticEngine(client: Anthropic, model?: string): AgenticChatEngine {
  _engine = new AgenticChatEngine(client, model);
  return _engine;
}

export function getAgenticEngine(): AgenticChatEngine | null {
  return _engine;
}

export function _resetAgenticEngine(): void {
  _engine = null;
}
