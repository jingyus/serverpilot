// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Agentic Chat Engine — autonomous AI loop with tool_use.
 *
 * Replaces the one-shot plan generation pattern with a Claude Code-style
 * autonomous loop: think → call tools → observe results → think again.
 *
 * The AI decides what commands to run, observes results, and adapts its
 * approach — including retrying with alternative commands on failure.
 *
 * @module ai/agentic-chat
 */

import Anthropic from '@anthropic-ai/sdk';
import type { SSEStreamingApi } from 'hono/streaming';
import { classifyCommand, RiskLevel } from '@aiinstaller/shared';
import { getTaskExecutor } from '../core/task/executor.js';
import { findConnectedAgent } from '../core/agent/agent-connector.js';
import { validateCommand } from '../core/security/command-validator.js';
import { getAuditLogger } from '../core/security/audit-logger.js';
import { buildProfileContext, buildProfileCaveats } from './profile-context.js';
import { getRagPipeline } from '../knowledge/rag-pipeline.js';
import { logger } from '../utils/logger.js';

// ============================================================================
// Constants
// ============================================================================

/** Maximum agentic loop iterations to prevent runaway */
const MAX_TURNS = 25;

/** Maximum estimated tokens for the messages array before trimming */
const MAX_MESSAGES_TOKENS = 150_000;

/** Rough chars-per-token constant (matches profile-context.ts) */
const CHARS_PER_TOKEN = 4;

/** Timeout for waiting on user confirmation (5 minutes) */
const CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;

/** Default model */
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

// ============================================================================
// Tool Definitions
// ============================================================================

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'execute_command',
    description:
      'Execute a shell command on the target server. ' +
      'The command runs in /bin/sh. ' +
      'Use this for all server operations: checking status, installing software, reading configs, etc. ' +
      'Output (stdout + stderr) is returned. ' +
      'IMPORTANT: Commands are security-classified. ' +
      'Read-only commands (ls, cat, df, ps, etc.) execute instantly. ' +
      'Modification commands (apt install, systemctl restart, etc.) may require user approval.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
        description: {
          type: 'string',
          description: 'Brief description of what this command does (for audit logging)',
        },
        timeout_seconds: {
          type: 'number',
          description: 'Timeout in seconds (default: 30, max: 600)',
        },
      },
      required: ['command', 'description'],
    },
  },
  {
    name: 'read_file',
    description:
      'Read the contents of a file on the server. ' +
      'Shortcut for cat that handles large files by reading first/last lines.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute file path to read',
        },
        max_lines: {
          type: 'number',
          description: 'Maximum lines to read (default: 200). For large files, reads first and last portions.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_files',
    description:
      'List files and directories at a given path. ' +
      'Returns file names, sizes, and permissions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to list (default: current directory)',
        },
        show_hidden: {
          type: 'boolean',
          description: 'Include hidden files (default: false)',
        },
      },
      required: ['path'],
    },
  },
];

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Pending confirmations store
// ============================================================================

const pendingConfirmations = new Map<string, {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

/**
 * Resolve a pending confirmation from the step-decision API.
 */
export function resolveConfirmation(confirmId: string, approved: boolean): boolean {
  const pending = pendingConfirmations.get(confirmId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  pending.resolve(approved);
  pendingConfirmations.delete(confirmId);
  return true;
}

// ============================================================================
// AgenticChatEngine
// ============================================================================

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

    // Build system prompt with profile + knowledge context
    const systemPrompt = await this.buildFullSystemPrompt(
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

        // Call Claude with tools — streaming
        const collected = await this.streamAnthropicCall(
          systemPrompt, messages, stream,
        );

        // Accumulate text for return value
        if (collected.text) {
          finalText += collected.text;
        }

        // No tool calls → AI is done
        if (collected.toolUseBlocks.length === 0) {
          break;
        }

        // Process tool calls
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolCall of collected.toolUseBlocks) {
          toolCallCount++;
          const result = await this.executeToolCall(
            toolCall, serverId, userId, sessionId, clientId, stream, opts.onConfirmRequired,
          );
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: result,
          });
        }

        // Append assistant response + tool results to conversation
        messages.push({ role: 'assistant', content: collected.rawContent });
        messages.push({ role: 'user', content: toolResults });

        // Trim older messages if the array exceeds the token budget.
        // Keep the first message (original user query) and the most recent pairs.
        trimMessagesIfNeeded(messages, MAX_MESSAGES_TOKENS);
      }

      await this.writeSSE(stream, 'complete', { success: true, turns, toolCallCount });
      return { success: true, turns, toolCallCount, finalText };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(
        { operation: 'agentic_loop', serverId, error: errorMsg },
        'Agentic loop error',
      );
      await this.writeSSE(stream, 'message', {
        content: `\n\n执行过程中发生错误: ${errorMsg}`,
      });
      await this.writeSSE(stream, 'complete', { success: false, error: errorMsg });
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
  ): Promise<{
    text: string;
    toolUseBlocks: Anthropic.ToolUseBlock[];
    rawContent: Anthropic.ContentBlock[];
    stopReason: string | null;
  }> {
    let text = '';
    const toolUseBlocks: Anthropic.ToolUseBlock[] = [];

    // Track tool_use blocks being built from streaming deltas
    let currentToolId = '';
    let currentToolName = '';
    let currentToolInputJson = '';

    const response = this.client.messages.stream({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      tools: TOOLS,
    });

    // Stream text deltas to Dashboard in real-time
    response.on('text', (delta: string) => {
      text += delta;
      this.writeSSE(stream, 'message', { content: delta }).catch(() => {});
    });

    // Track tool_use content blocks as they start
    response.on('contentBlock', (block: Anthropic.ContentBlock) => {
      if (block.type === 'tool_use') {
        currentToolId = block.id;
        currentToolName = block.name;
        currentToolInputJson = '';

        // Notify frontend that a tool call is starting
        this.writeSSE(stream, 'tool_call', {
          id: block.id,
          tool: block.name,
          status: 'running',
        }).catch(() => {});
      }
    });

    // Collect input_json_delta for tool_use blocks
    response.on('inputJson', (delta: string) => {
      currentToolInputJson += delta;
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
    onConfirmRequired?: (command: string, riskLevel: string, description: string) => {
      confirmId: string;
      approved: Promise<boolean>;
    },
  ): Promise<string> {
    const { name, input } = toolCall;

    try {
      switch (name) {
        case 'execute_command':
          return await this.toolExecuteCommand(
            input as { command: string; description: string; timeout_seconds?: number },
            serverId, userId, sessionId, clientId, stream, toolCall.id,
            onConfirmRequired,
          );

        case 'read_file':
          return await this.toolReadFile(
            input as { path: string; max_lines?: number },
            serverId, userId, sessionId, clientId, stream, toolCall.id,
          );

        case 'list_files':
          return await this.toolListFiles(
            input as { path: string; show_hidden?: boolean },
            serverId, userId, sessionId, clientId, stream, toolCall.id,
          );

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
      });
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
      });
      return msg;
    }

    // YELLOW/RED/CRITICAL → ask user for confirmation
    if (riskLevel !== RiskLevel.GREEN && onConfirmRequired) {
      const confirmation = onConfirmRequired(command, riskLevel, description);

      // Include confirmId in the SSE event so frontend can respond immediately
      // without waiting for a separate confirm_id event
      await this.writeSSE(stream, 'confirm_required', {
        id: toolCallId,
        command,
        description,
        riskLevel,
        confirmId: confirmation.confirmId,
      });

      const approved = await confirmation.approved;

      if (!approved) {
        const msg = `用户拒绝执行: ${command}`;
        await this.writeSSE(stream, 'tool_result', {
          id: toolCallId,
          tool: 'execute_command',
          status: 'rejected',
          output: msg,
        });
        await auditLogger.updateExecutionResult(auditEntry.id, 'skipped');
        return msg;
      }
    }

    // Execute the command
    await this.writeSSE(stream, 'tool_executing', {
      id: toolCallId,
      tool: 'execute_command',
      command,
    });

    const executor = getTaskExecutor();

    // Register a progress listener scoped to this tool call.
    // Using toolCallId as the listener ID ensures concurrent tool executions
    // from different agentic sessions each receive only their own output.
    let hasStreamedOutput = false;
    executor.addProgressListener(toolCallId, (_executionId, _status, output) => {
      if (output) {
        hasStreamedOutput = true;
        this.writeSSE(stream, 'tool_output', {
          id: toolCallId,
          content: output,
        }).catch(() => {});
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
      // Always clean up the listener to prevent SSE stream closure leaks
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
    });

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
  ): Promise<string> {
    const maxLines = input.max_lines ?? 200;
    const command = `head -n ${maxLines} ${this.shellEscape(input.path)}`;

    return this.toolExecuteCommand(
      { command, description: `Read file: ${input.path}` },
      serverId, userId, sessionId, clientId, stream, toolCallId,
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
  ): Promise<string> {
    const flags = input.show_hidden ? '-lah' : '-lh';
    const command = `ls ${flags} ${this.shellEscape(input.path)}`;

    return this.toolExecuteCommand(
      { command, description: `List files: ${input.path}` },
      serverId, userId, sessionId, clientId, stream, toolCallId,
    );
  }

  /**
   * Build the full system prompt with profile context and knowledge base.
   */
  private async buildFullSystemPrompt(
    userMessage: string,
    serverProfile?: unknown,
    serverName?: string,
  ): Promise<string> {
    // Profile context
    let profileContext: string | undefined;
    let caveats: string[] | undefined;

    if (serverProfile) {
      const profileResult = buildProfileContext(
        serverProfile as Parameters<typeof buildProfileContext>[0],
        serverName ?? 'server',
      );
      profileContext = profileResult.text;
      caveats = buildProfileCaveats(
        serverProfile as Parameters<typeof buildProfileCaveats>[0],
      );
    }

    // Knowledge context via RAG
    let knowledgeContext: string | undefined;
    try {
      const pipeline = getRagPipeline();
      if (pipeline?.isReady()) {
        const ragResult = await pipeline.search(userMessage);
        if (ragResult.hasResults) {
          knowledgeContext = ragResult.contextText;
        }
      }
    } catch (err) {
      logger.warn(
        { operation: 'rag_search', error: String(err) },
        'RAG search failed, continuing without knowledge context',
      );
    }

    // Combine base system prompt + profile + knowledge
    const basePrompt = buildAgenticSystemPrompt();
    const parts = [basePrompt];

    if (profileContext) parts.push(profileContext);
    if (caveats?.length) {
      parts.push('## Important Caveats\n' + caveats.map((c) => `- ${c}`).join('\n'));
    }
    if (knowledgeContext) parts.push(knowledgeContext);

    return parts.join('\n\n');
  }

  /** Write a typed SSE event */
  private async writeSSE(
    stream: SSEStreamingApi,
    event: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      await stream.writeSSE({ event, data: JSON.stringify(data) });
    } catch {
      // Stream closed, ignore
    }
  }

  /** Escape a string for safe shell usage */
  private shellEscape(s: string): string {
    return `'${s.replace(/'/g, "'\\''")}'`;
  }
}

// ============================================================================
// System Prompt (Agentic Mode)
// ============================================================================

function buildAgenticSystemPrompt(): string {
  return `You are ServerPilot, an autonomous AI DevOps agent that manages servers.
You operate like an experienced sysadmin with SSH access — directly executing commands and adapting based on results.

## How You Work
- You have tools to execute commands, read files, and list directories on the target server.
- When a user asks you to do something, TAKE ACTION immediately. Don't just describe what you would do.
- Execute commands to gather information, then use those results to make decisions.
- If a command fails, analyze the error and try an alternative approach automatically.
- You can make multiple tool calls in sequence — check → diagnose → fix → verify.

## Communication Style
- Be concise. Show what you're doing, not what you're about to do.
- After executing commands, briefly explain the results in context.
- Use Chinese for all user-facing text (the user speaks Chinese).
- Don't show raw command strings unless relevant to the explanation.

## Security
- Read-only commands execute instantly (no confirmation needed).
- Commands that modify the system may require user approval — the system handles this automatically.
- Some dangerous commands are blocked by security policy — if blocked, try a safer alternative.
- NEVER try to bypass security restrictions or use sudo to circumvent blocks.

## Best Practices
- Always verify the OS and package manager before installing software.
- Check if software is already installed before attempting installation.
- After making changes, verify they took effect.
- If something fails, check logs and system state before retrying.`;
}

// ============================================================================
// Message trimming
// ============================================================================

/**
 * Estimate the total token count of the Anthropic messages array.
 * Handles both string content and structured content blocks.
 */
function estimateMessagesTokens(messages: Anthropic.MessageParam[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      chars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if ('text' in block && typeof block.text === 'string') {
          chars += block.text.length;
        } else if ('content' in block && typeof block.content === 'string') {
          chars += block.content.length;
        } else {
          // tool_use input, tool_result, etc. — rough estimate
          chars += JSON.stringify(block).length;
        }
      }
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Trim the messages array in-place if it exceeds the token budget.
 *
 * Strategy: keep the first message (original user query) and trim from
 * the middle, removing oldest assistant/user turn pairs. Anthropic requires
 * alternating user/assistant roles, so we remove in pairs.
 */
export function trimMessagesIfNeeded(
  messages: Anthropic.MessageParam[],
  maxTokens: number,
): void {
  if (messages.length <= 3) return; // first user + one turn pair minimum

  let currentTokens = estimateMessagesTokens(messages);
  if (currentTokens <= maxTokens) return;

  // Remove pairs from index 1 (after the first user message) until under budget.
  // Each "pair" is an assistant message + a user message (tool results).
  while (currentTokens > maxTokens && messages.length > 3) {
    // Remove messages at index 1 and 2 (oldest assistant + user pair after first msg)
    const removed = messages.splice(1, 2);
    const removedTokens = estimateMessagesTokens(removed);
    currentTokens -= removedTokens;
  }
}

// ============================================================================
// Singleton
// ============================================================================

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
