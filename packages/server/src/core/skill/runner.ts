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
 * Tool execution logic is delegated to SkillToolExecutor (runner-executor.ts).
 *
 * @module core/skill/runner
 */

import type { SkillManifest } from '@aiinstaller/shared';

import { getActiveProvider } from '../../ai/providers/provider-factory.js';
import type {
  AIProviderInterface,
  ToolUseBlock,
  ChatMessage,
} from '../../ai/providers/base.js';
import { parseTimeout, buildToolDefinitions } from './runner-tools.js';
import { SkillToolExecutor } from './runner-executor.js';
import { getSkillEventBus } from './skill-event-bus.js';
import { parseSkillOutputs, buildOutputInstructions } from './output-parser.js';
import type { ParsedOutputs } from './output-parser.js';
import type { SkillRunParams } from './types.js';

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

const DRY_RUN_PROMPT_SUFFIX = `

IMPORTANT — DRY RUN MODE:
This is a dry-run preview. Do NOT call any tools. Instead, output a numbered list of the commands and actions you would execute, including:
- The exact shell commands you would run
- Any files you would read or write (with paths)
- Any notifications you would send
- Any HTTP requests you would make
Format each planned step as: "Step N: [tool_name] — description"
Do NOT use any tools. Only describe what you would do.`;

// ============================================================================
// Types
// ============================================================================

/** Result of a single skill run. */
export interface SkillRunResult {
  success: boolean;
  status: 'success' | 'failed' | 'timeout' | 'rejected' | 'cancelled';
  stepsExecuted: number;
  duration: number;
  output: string;
  errors: string[];
  toolResults: ToolCallRecord[];
  /** Structured outputs parsed from AI text, validated against manifest declarations. */
  parsedOutputs?: ParsedOutputs;
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
  /** External abort signal for cancellation support. */
  signal?: AbortSignal;
  /** When true, AI outputs planned commands without executing side-effect tools. */
  dryRun?: boolean;
}

// Re-export for convenience
export { parseTimeout, buildToolDefinitions } from './runner-tools.js';
export type { ParsedOutputs } from './output-parser.js';

// ============================================================================
// SkillRunner
// ============================================================================

export class SkillRunner {
  private provider: AIProviderInterface | null;
  private toolExecutor: SkillToolExecutor;

  constructor(provider?: AIProviderInterface | null) {
    this.provider = provider ?? null;
    this.toolExecutor = new SkillToolExecutor();
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

    // Lazy provider acquisition: try to get provider if not set
    if (!this.provider) {
      this.provider = getActiveProvider();
    }
    if (!this.provider) {
      return {
        success: false,
        status: 'failed',
        stepsExecuted: 0,
        duration: 0,
        output: '',
        errors: ['No AI provider available — configure AI_PROVIDER env var or wait for provider to become ready'],
        toolResults: [],
      };
    }

    const constraints = manifest.constraints;
    const dryRun = params.dryRun ?? false;
    this.toolExecutor.setDryRun(dryRun);

    const startTime = Date.now();
    const timeoutMs = parseTimeout(constraints.timeout);
    const maxSteps = constraints.max_steps;
    const riskLevelMax = constraints.risk_level_max;
    const runAs = constraints.run_as;
    const tools = dryRun ? [] : buildToolDefinitions(manifest.tools);

    const bus = getSkillEventBus();
    const toolResults: ToolCallRecord[] = [];
    const errors: string[] = [];
    let stepsExecuted = 0;
    let output = '';
    let timedOut = false;
    let cancelled = false;

    // Global timeout via AbortController
    const timeoutController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      timeoutController.abort();
      timedOut = true;
    }, timeoutMs);

    // Merge external signal (cancellation) with timeout signal
    const externalSignal = params.signal;
    const mergedSignal = externalSignal
      ? AbortSignal.any([timeoutController.signal, externalSignal])
      : timeoutController.signal;

    // Listen for external cancellation
    if (externalSignal) {
      const onExternalAbort = () => {
        if (!timedOut) cancelled = true;
      };
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    try {
      // Build initial messages
      const outputInstructions = buildOutputInstructions(manifest.outputs ?? []);
      const dryRunSuffix = dryRun ? DRY_RUN_PROMPT_SUFFIX : '';
      const systemPrompt = `${SYSTEM_PROMPT_PREFIX}${outputInstructions}${dryRunSuffix}\n\n--- Skill Prompt ---\n${resolvedPrompt}`;
      const userMessage = dryRun
        ? 'This is a dry-run preview. List all commands and actions you would execute, but do NOT call any tools.'
        : 'Execute the skill as described above. Use the provided tools to complete the task.';
      const messages: ChatMessage[] = [
        { role: 'user', content: userMessage },
      ];

      // Agentic loop
      while (stepsExecuted < maxSteps && !timedOut && !cancelled) {
        if (mergedSignal.aborted) {
          if (!timedOut) cancelled = true;
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
          bus.publish(executionId, {
            type: 'log',
            executionId,
            timestamp: new Date().toISOString(),
            text: response.content,
          });
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
          if (mergedSignal.aborted) {
            if (!timedOut) cancelled = true;
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

          bus.publish(executionId, {
            type: 'step',
            executionId,
            timestamp: new Date().toISOString(),
            tool: toolCall.name,
            input: toolCall.input,
            phase: 'start',
          });

          try {
            const executed = await this.toolExecutor.executeTool(
              toolCall, skillId, serverId, userId, executionId,
              riskLevelMax, manifest.metadata.name, runAs,
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

          bus.publish(executionId, {
            type: 'step',
            executionId,
            timestamp: new Date().toISOString(),
            tool: toolCall.name,
            result,
            success,
            duration: callDuration,
            phase: 'complete',
          });

          if (!success) {
            errors.push(`${toolCall.name}: ${result}`);
          }

          toolResultMessages.push(
            this.formatToolResult(toolCall.id, result, false),
          );
        }

        if (timedOut || cancelled) break;

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

    // Parse structured outputs if manifest declares them
    const declaredOutputs = manifest.outputs ?? [];
    const parsedOutputs = declaredOutputs.length > 0
      ? parseSkillOutputs(output, declaredOutputs)
      : undefined;

    if (cancelled) {
      bus.publish(executionId, {
        type: 'error',
        executionId,
        timestamp: new Date().toISOString(),
        message: 'Execution cancelled by user',
      });
      return {
        success: false,
        status: 'cancelled',
        stepsExecuted,
        duration,
        output: output || 'Execution cancelled',
        errors: [...errors, 'Execution cancelled by user'],
        toolResults,
        parsedOutputs,
      };
    }

    if (timedOut) {
      bus.publish(executionId, {
        type: 'completed',
        executionId,
        timestamp: new Date().toISOString(),
        status: 'timeout',
        stepsExecuted,
        duration,
        output: output || 'Execution timed out',
      });
      return {
        success: false,
        status: 'timeout',
        stepsExecuted,
        duration,
        output: output || 'Execution timed out',
        errors: [...errors, `Timeout after ${timeoutMs}ms`],
        toolResults,
        parsedOutputs,
      };
    }

    const hasErrors = errors.length > 0;
    const finalStatus = hasErrors ? 'failed' : 'success';
    bus.publish(executionId, {
      type: 'completed',
      executionId,
      timestamp: new Date().toISOString(),
      status: finalStatus,
      stepsExecuted,
      duration,
      output,
    });
    return {
      success: !hasErrors,
      status: finalStatus,
      stepsExecuted,
      duration,
      output,
      errors,
      toolResults,
      parsedOutputs,
    };
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
