// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * SkillRunner — AI autonomous execution layer for Skills.
 *
 * Implements the agentic loop pattern (similar to agentic-chat.ts) with
 * security constraints, audit integration, and configurable tool sets.
 *
 * Each `run()` call:
 * 1. Builds the AI conversation (system prompt + skill prompt)
 * 2. Generates tool definitions from the skill manifest
 * 3. Loops: AI → tool_use → security check → execute → result → AI
 * 4. Terminates on: end_turn | max_steps | timeout
 *
 * @module core/skill/runner
 */

import {
  classifyCommand,
  RiskLevel,
  isForbidden,
} from '@aiinstaller/shared';
import type { SkillManifest } from '@aiinstaller/shared';

import { createContextLogger } from '../../utils/logger.js';
import { getActiveProvider } from '../../ai/providers/provider-factory.js';
import type {
  AIProviderInterface,
  ToolUseBlock,
  ChatMessage,
} from '../../ai/providers/base.js';
import { getTaskExecutor } from '../task/executor.js';
import { findConnectedAgent } from '../agent/agent-connector.js';
import { getAuditLogger } from '../security/audit-logger.js';
import { getWebhookDispatcher } from '../webhook/dispatcher.js';
import { parseTimeout, exceedsRiskLimit, buildToolDefinitions } from './runner-tools.js';
import { getSkillKVStore } from './store.js';
import type { SkillRunParams } from './types.js';

const logger = createContextLogger({ module: 'skill-runner' });

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_TOKENS = 4096;
const SYSTEM_PROMPT_PREFIX = `You are a ServerPilot Skill executor. You perform server administration tasks by using the tools provided. Follow the instructions in the skill prompt precisely. When the task is complete, provide a brief summary of what was done.

Rules:
- Only use the tools that are provided to you.
- Execute commands step by step — verify each step before proceeding.
- If a command fails, assess the error and try to recover.
- Never execute destructive commands unless the skill explicitly requires it.
- Provide clear, structured output summarizing your actions.`;

// ============================================================================
// Types
// ============================================================================

/** Result of a single skill run. */
export interface SkillRunResult {
  success: boolean;
  status: 'success' | 'failed' | 'timeout' | 'rejected';
  stepsExecuted: number;
  duration: number;
  output: string;
  errors: string[];
  toolResults: ToolCallRecord[];
}

/** Record of a single tool call during execution. */
export interface ToolCallRecord {
  toolName: string;
  input: Record<string, unknown>;
  result: string;
  success: boolean;
  duration: number;
}

/** Internal parameters for SkillRunner.run(). */
export interface RunnerParams {
  manifest: SkillManifest;
  resolvedPrompt: string;
  skillId: string;
  serverId: string;
  userId: string;
  executionId: string;
  config?: Record<string, unknown>;
}

// Re-export for convenience
export { parseTimeout, buildToolDefinitions } from './runner-tools.js';

// ============================================================================
// SkillRunner
// ============================================================================

export class SkillRunner {
  private provider: AIProviderInterface;

  constructor(provider?: AIProviderInterface) {
    const active = provider ?? getActiveProvider();
    if (!active) {
      throw new Error('No AI provider available — configure AI_PROVIDER env var');
    }
    this.provider = active;
  }

  /**
   * Execute a skill through the AI agentic loop.
   *
   * Builds AI messages, generates tool definitions, and loops until:
   * - AI returns end_turn (task complete)
   * - max_steps is reached
   * - Global timeout fires
   */
  async run(params: RunnerParams): Promise<SkillRunResult> {
    const {
      manifest, resolvedPrompt, skillId, serverId, userId, executionId,
    } = params;
    const constraints = manifest.constraints;

    const startTime = Date.now();
    const timeoutMs = parseTimeout(constraints.timeout);
    const maxSteps = constraints.max_steps;
    const riskLevelMax = constraints.risk_level_max;
    const tools = buildToolDefinitions(manifest.tools);

    const toolResults: ToolCallRecord[] = [];
    const errors: string[] = [];
    let stepsExecuted = 0;
    let output = '';
    let timedOut = false;

    // Global timeout via AbortController
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
      timedOut = true;
    }, timeoutMs);

    try {
      // Build initial messages
      const systemPrompt = `${SYSTEM_PROMPT_PREFIX}\n\n--- Skill Prompt ---\n${resolvedPrompt}`;
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Execute the skill as described above. Use the provided tools to complete the task.' },
      ];

      // Agentic loop
      while (stepsExecuted < maxSteps && !timedOut) {
        if (abortController.signal.aborted) {
          timedOut = true;
          break;
        }

        const response = await this.provider.chat({
          messages,
          system: systemPrompt,
          maxTokens: DEFAULT_MAX_TOKENS,
          tools,
        });

        // Collect text output
        if (response.content) {
          output += (output ? '\n' : '') + response.content;
        }

        // No tool calls → AI is done
        if (!response.toolCalls || response.toolCalls.length === 0) {
          break;
        }

        // Process tool calls
        const assistantContent = this.buildAssistantContent(response.content, response.toolCalls);
        messages.push({ role: 'assistant', content: assistantContent });

        const toolResultMessages: string[] = [];

        for (const toolCall of response.toolCalls) {
          if (abortController.signal.aborted) {
            timedOut = true;
            break;
          }

          // Check step limit before executing
          if (stepsExecuted >= maxSteps) {
            const limitMsg = `Step limit reached (${maxSteps}). Stopping execution.`;
            errors.push(limitMsg);
            toolResultMessages.push(
              this.formatToolResult(toolCall.id, limitMsg, true),
            );
            break;
          }

          const callStart = Date.now();
          let result: string;
          let success: boolean;

          try {
            const executed = await this.executeTool(
              toolCall, skillId, serverId, userId, executionId,
              riskLevelMax, manifest.metadata.name,
            );
            result = executed.result;
            success = executed.success;
          } catch (err) {
            result = `Tool error: ${(err as Error).message}`;
            success = false;
          }

          const callDuration = Date.now() - callStart;
          stepsExecuted++;

          toolResults.push({
            toolName: toolCall.name,
            input: toolCall.input,
            result,
            success,
            duration: callDuration,
          });

          if (!success) {
            errors.push(`${toolCall.name}: ${result}`);
          }

          toolResultMessages.push(
            this.formatToolResult(toolCall.id, result, false),
          );
        }

        if (timedOut) break;

        // Add tool results back to conversation
        messages.push({
          role: 'user',
          content: toolResultMessages.join('\n\n'),
        });

        // Check if AI signaled end_turn
        if (response.stopReason === 'end_turn') {
          break;
        }
      }
    } finally {
      clearTimeout(timeoutHandle);
    }

    const duration = Date.now() - startTime;

    if (timedOut) {
      return {
        success: false,
        status: 'timeout',
        stepsExecuted,
        duration,
        output: output || 'Execution timed out',
        errors: [...errors, `Timeout after ${timeoutMs}ms`],
        toolResults,
      };
    }

    const hasErrors = errors.length > 0;
    return {
      success: !hasErrors,
      status: hasErrors ? 'failed' : 'success',
      stepsExecuted,
      duration,
      output,
      errors,
      toolResults,
    };
  }

  // --------------------------------------------------------------------------
  // Tool Execution
  // --------------------------------------------------------------------------

  /** Execute a single tool call with security checks. */
  private async executeTool(
    toolCall: ToolUseBlock,
    skillId: string,
    serverId: string,
    userId: string,
    executionId: string,
    riskLevelMax: string,
    skillName: string,
  ): Promise<{ result: string; success: boolean }> {
    const input = toolCall.input;

    switch (toolCall.name) {
      case 'shell':
        return this.executeShell(
          input as { command: string; description?: string },
          serverId, userId, executionId, riskLevelMax, skillName,
        );

      case 'read_file':
        return this.executeReadFile(
          input as { path: string },
          serverId, userId,
        );

      case 'write_file':
        return this.executeWriteFile(
          input as { path: string; content: string },
          serverId, userId,
        );

      case 'notify':
        return this.executeNotify(
          input as { title: string; message: string; level?: string },
          userId, skillName,
        );

      case 'http':
        return this.executeHttp(
          input as { url: string; method?: string; body?: string; headers?: Record<string, string> },
        );

      case 'store':
        return this.executeStore(
          input as { action: string; key: string; value?: string },
          skillId,
        );

      default:
        return { result: `Unknown tool: ${toolCall.name}`, success: false };
    }
  }

  /** Execute a shell command with security classification + audit. */
  private async executeShell(
    input: { command: string; description?: string },
    serverId: string,
    userId: string,
    executionId: string,
    riskLevelMax: string,
    skillName: string,
  ): Promise<{ result: string; success: boolean }> {
    const { command, description } = input;

    // Security classification
    const classification = classifyCommand(command);

    // Forbidden commands are always rejected
    if (isForbidden(classification.riskLevel)) {
      const msg = `BLOCKED: Command "${command}" is forbidden — ${classification.reason}`;
      logger.warn({ command, reason: classification.reason, executionId }, msg);
      await this.auditShell(serverId, userId, executionId, command, classification, 'blocked');
      return { result: msg, success: false };
    }

    // Check risk level against constraint
    if (exceedsRiskLimit(classification.riskLevel, riskLevelMax)) {
      const msg = `REJECTED: Command "${command}" has risk level ${classification.riskLevel} which exceeds the skill's max allowed level ${riskLevelMax}`;
      logger.warn({ command, risk: classification.riskLevel, max: riskLevelMax, executionId }, msg);
      await this.auditShell(serverId, userId, executionId, command, classification, 'rejected');
      return { result: msg, success: false };
    }

    // Audit log
    const auditEntry = await this.auditShell(
      serverId, userId, executionId, command, classification, 'allowed',
    );

    // Find connected agent
    const clientId = findConnectedAgent(serverId);
    if (!clientId) {
      if (auditEntry) {
        await getAuditLogger().updateExecutionResult(auditEntry.id, 'failed');
      }
      return { result: 'No agent connected to this server', success: false };
    }

    // Execute via TaskExecutor
    try {
      const executor = getTaskExecutor();
      const result = await executor.executeCommand({
        serverId,
        userId,
        clientId,
        command,
        description: description ?? `Skill: ${skillName}`,
        riskLevel: classification.riskLevel as 'green' | 'yellow' | 'red' | 'critical',
        type: 'execute',
        sessionId: executionId,
        timeoutMs: 30_000,
      });

      if (auditEntry) {
        await getAuditLogger().updateExecutionResult(
          auditEntry.id,
          result.success ? 'success' : 'failed',
          result.operationId,
        );
      }

      const output = [
        `Exit code: ${result.exitCode}`,
        result.stdout ? `stdout:\n${result.stdout}` : '',
        result.stderr ? `stderr:\n${result.stderr}` : '',
      ].filter(Boolean).join('\n');

      return { result: output, success: result.success };
    } catch (err) {
      if (auditEntry) {
        await getAuditLogger().updateExecutionResult(auditEntry.id, 'failed');
      }
      return { result: `Execution error: ${(err as Error).message}`, success: false };
    }
  }

  /** Log a shell command to the audit log. */
  private async auditShell(
    serverId: string,
    userId: string,
    sessionId: string,
    command: string,
    classification: { riskLevel: string; reason: string; matchedPattern?: string },
    action: string,
  ): Promise<{ id: string } | null> {
    try {
      const auditLogger = getAuditLogger();
      return await auditLogger.log({
        serverId,
        userId,
        sessionId,
        command,
        validation: {
          action: action as 'allowed' | 'blocked' | 'requires_confirmation',
          classification: {
            command,
            riskLevel: classification.riskLevel as RiskLevel,
            reason: classification.reason,
            matchedPattern: classification.matchedPattern,
          },
          audit: { safe: action !== 'blocked', warnings: [], blockers: [] },
          policy: `skill-runner:${action}`,
          reasons: [classification.reason],
        },
      });
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Failed to write audit log');
      return null;
    }
  }

  /** Execute read_file via shell cat command. */
  private async executeReadFile(
    input: { path: string },
    serverId: string,
    userId: string,
  ): Promise<{ result: string; success: boolean }> {
    const clientId = findConnectedAgent(serverId);
    if (!clientId) {
      return { result: 'No agent connected to this server', success: false };
    }

    try {
      const executor = getTaskExecutor();
      const result = await executor.executeCommand({
        serverId,
        userId,
        clientId,
        command: `cat ${JSON.stringify(input.path)}`,
        description: `Read file: ${input.path}`,
        riskLevel: 'green',
        type: 'execute',
        timeoutMs: 30_000,
      });

      return {
        result: result.success ? result.stdout : `Failed to read: ${result.stderr}`,
        success: result.success,
      };
    } catch (err) {
      return { result: `Read error: ${(err as Error).message}`, success: false };
    }
  }

  /** Execute write_file via shell tee command. */
  private async executeWriteFile(
    input: { path: string; content: string },
    serverId: string,
    userId: string,
  ): Promise<{ result: string; success: boolean }> {
    const clientId = findConnectedAgent(serverId);
    if (!clientId) {
      return { result: 'No agent connected to this server', success: false };
    }

    try {
      const executor = getTaskExecutor();
      // Use printf + tee to safely write content
      const escapedContent = input.content
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "'\\''");
      const result = await executor.executeCommand({
        serverId,
        userId,
        clientId,
        command: `printf '%s' '${escapedContent}' > ${JSON.stringify(input.path)}`,
        description: `Write file: ${input.path}`,
        riskLevel: 'yellow',
        type: 'execute',
        timeoutMs: 30_000,
      });

      return {
        result: result.success ? `File written: ${input.path}` : `Write failed: ${result.stderr}`,
        success: result.success,
      };
    } catch (err) {
      return { result: `Write error: ${(err as Error).message}`, success: false };
    }
  }

  /** Send a notification via the webhook dispatcher. */
  private async executeNotify(
    input: { title: string; message: string; level?: string },
    userId: string,
    skillName: string,
  ): Promise<{ result: string; success: boolean }> {
    try {
      const dispatcher = getWebhookDispatcher();
      await dispatcher.dispatch({
        type: 'alert.triggered',
        userId,
        data: {
          title: input.title,
          message: input.message,
          level: input.level ?? 'info',
          source: `skill:${skillName}`,
        },
      });
      return { result: `Notification sent: ${input.title}`, success: true };
    } catch (err) {
      return { result: `Notify error: ${(err as Error).message}`, success: false };
    }
  }

  /** Make an HTTP request. */
  private async executeHttp(
    input: { url: string; method?: string; body?: string; headers?: Record<string, string> },
  ): Promise<{ result: string; success: boolean }> {
    try {
      const method = input.method ?? 'GET';
      const fetchOptions: RequestInit = {
        method,
        headers: input.headers,
        signal: AbortSignal.timeout(30_000),
      };
      if (input.body && (method === 'POST' || method === 'PUT')) {
        fetchOptions.body = input.body;
      }

      const response = await fetch(input.url, fetchOptions);
      const text = await response.text();
      const truncated = text.length > 10_000 ? text.slice(0, 10_000) + '\n...(truncated)' : text;

      return {
        result: `HTTP ${response.status} ${response.statusText}\n${truncated}`,
        success: response.ok,
      };
    } catch (err) {
      return { result: `HTTP error: ${(err as Error).message}`, success: false };
    }
  }

  /** KV store read/write. */
  private async executeStore(
    input: { action: string; key: string; value?: string },
    skillId: string,
  ): Promise<{ result: string; success: boolean }> {
    const { action, key, value } = input;
    const store = getSkillKVStore();

    try {
      switch (action) {
        case 'get': {
          const val = await store.get(skillId, key);
          return {
            result: val !== null ? val : `Key "${key}" not found`,
            success: val !== null,
          };
        }
        case 'set': {
          if (value === undefined) {
            return { result: 'Missing "value" for set action', success: false };
          }
          await store.set(skillId, key, value);
          return { result: `Stored key "${key}"`, success: true };
        }
        case 'delete': {
          await store.delete(skillId, key);
          return { result: `Deleted key "${key}"`, success: true };
        }
        case 'list': {
          const entries = await store.list(skillId);
          return { result: JSON.stringify(entries), success: true };
        }
        default:
          return { result: `Unknown store action: ${action}`, success: false };
      }
    } catch (err) {
      return { result: `Store error: ${(err as Error).message}`, success: false };
    }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /** Build assistant message content with tool_use blocks serialized. */
  private buildAssistantContent(text: string, toolCalls: ToolUseBlock[]): string {
    const parts: string[] = [];
    if (text) parts.push(text);
    for (const tc of toolCalls) {
      parts.push(`[tool_use: ${tc.name}(${JSON.stringify(tc.input)})]`);
    }
    return parts.join('\n');
  }

  /** Format a tool result for inclusion in user message. */
  private formatToolResult(toolCallId: string, result: string, isError: boolean): string {
    const prefix = isError ? '[tool_error]' : '[tool_result]';
    return `${prefix} id=${toolCallId}\n${result}`;
  }
}
