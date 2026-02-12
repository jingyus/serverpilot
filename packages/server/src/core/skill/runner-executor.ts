// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * SkillToolExecutor — executes individual tool calls for SkillRunner.
 *
 * Extracted from runner.ts to keep file sizes within the 500-line limit.
 * Contains the 6 tool execution methods (shell, read_file, write_file,
 * notify, http, store) plus the auditShell helper.
 *
 * @module core/skill/runner-executor
 */

import {
  classifyCommand,
  RiskLevel,
  isForbidden,
} from '@aiinstaller/shared';

import { createContextLogger } from '../../utils/logger.js';
import type { ToolUseBlock } from '../../ai/providers/base.js';
import { getTaskExecutor } from '../task/executor.js';
import { findConnectedAgent } from '../agent/agent-connector.js';
import { getAuditLogger } from '../security/audit-logger.js';
import { getWebhookDispatcher } from '../webhook/dispatcher.js';
import { exceedsRiskLimit } from './runner-tools.js';
import { getSkillKVStore } from './store.js';

const logger = createContextLogger({ module: 'skill-runner' });

// ============================================================================
// SkillToolExecutor
// ============================================================================

/**
 * Executes individual tool calls dispatched by SkillRunner.
 *
 * Each tool type has a dedicated method handling security checks,
 * audit logging, agent communication, and error handling.
 */
export class SkillToolExecutor {
  /**
   * Dispatch a tool call to the appropriate executor method.
   *
   * @returns result string and success flag
   */
  async executeTool(
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
          input as { action: string; key?: string; value?: string },
          skillId,
        );

      default:
        return { result: `Unknown tool: ${toolCall.name}`, success: false };
    }
  }

  // --------------------------------------------------------------------------
  // Shell
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // Audit Helper
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // Read File
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // Write File
  // --------------------------------------------------------------------------

  /** Execute write_file via shell printf command. */
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
      // Use printf to safely write content
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

  // --------------------------------------------------------------------------
  // Notify
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // HTTP
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // Store
  // --------------------------------------------------------------------------

  /** KV store read/write/list. */
  private async executeStore(
    input: { action: string; key?: string; value?: string },
    skillId: string,
  ): Promise<{ result: string; success: boolean }> {
    const { action, key, value } = input;
    const store = getSkillKVStore();

    try {
      switch (action) {
        case 'get': {
          if (!key) {
            return { result: 'Missing "key" for get action', success: false };
          }
          const val = await store.get(skillId, key);
          return {
            result: val !== null ? val : `Key "${key}" not found`,
            success: val !== null,
          };
        }
        case 'set': {
          if (!key) {
            return { result: 'Missing "key" for set action', success: false };
          }
          if (value === undefined) {
            return { result: 'Missing "value" for set action', success: false };
          }
          await store.set(skillId, key, value);
          return { result: `Stored key "${key}"`, success: true };
        }
        case 'delete': {
          if (!key) {
            return { result: 'Missing "key" for delete action', success: false };
          }
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
}
