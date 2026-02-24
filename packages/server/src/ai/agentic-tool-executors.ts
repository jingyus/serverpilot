// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/** Tool executor functions for the Agentic Chat Engine. */

import type { SSEStreamingApi } from "hono/streaming";
import { RiskLevel } from "@aiinstaller/shared";
import { getTaskExecutor } from "../core/task/executor.js";
import { validateCommand } from "../core/security/command-validator.js";
import { getAuditLogger } from "../core/security/audit-logger.js";
import { logger } from "../utils/logger.js";
import {
  ExecuteCommandInputSchema,
  ReadFileInputSchema,
  ListFilesInputSchema,
  SearchCodeInputSchema,
  FindFilesInputSchema,
  EditFileInputSchema,
} from "./agentic-tools.js";

/** Shared abort flag interface — mirrors AbortState in agentic-chat.ts */
export interface AbortStateInterface {
  aborted: boolean;
  onAbort(cb: () => void): () => void;
}

/** Common context passed to all tool executors */
export interface ToolExecutorContext {
  serverId: string;
  userId: string;
  sessionId: string;
  clientId: string;
  stream: SSEStreamingApi;
  abort: AbortStateInterface;
}

/** Confirmation callback type */
export type OnConfirmRequired = (
  command: string,
  riskLevel: string,
  description: string,
) => {
  confirmId: string;
  approved: Promise<boolean>;
};

/** Escape a string for safe shell usage */
export function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Write SSE event; on failure sets abort.aborted immediately. */
export async function writeSSE(
  stream: SSEStreamingApi,
  event: string,
  data: Record<string, unknown>,
  abort?: AbortStateInterface,
): Promise<void> {
  try {
    await stream.writeSSE({ event, data: JSON.stringify(data) });
  } catch {
    if (abort) abort.aborted = true;
  }
}

/**
 * Returns a Promise that resolves to `false` once abort.aborted becomes true,
 * plus an `unsubscribe` function to clean up the listener.
 */
export function awaitAbort(abort: AbortStateInterface): {
  promise: Promise<false>;
  unsubscribe: () => void;
} {
  if (abort.aborted) {
    return {
      promise: Promise.resolve(false as const),
      unsubscribe: () => {},
    };
  }
  let unsubscribe: () => void = () => {};
  const promise = new Promise<false>((resolve) => {
    unsubscribe = abort.onAbort(() => resolve(false as const));
  });
  return { promise, unsubscribe };
}

/**
 * Handle Zod validation failure for tool input.
 * Sends a tool_result SSE event and logs a warning.
 */
export async function handleValidationError(
  toolName: string,
  toolCallId: string,
  issues: Array<{ message: string; path: Array<string | number> }>,
  rawInput: unknown,
  stream: SSEStreamingApi,
  abort: AbortStateInterface,
): Promise<string> {
  const errorDetail = issues.map((i) => i.message).join("; ");
  const errorMsg = `Error: Invalid tool input for ${toolName}: ${errorDetail}`;

  logger.warn(
    { operation: "tool_validation", tool: toolName, issues, rawInput },
    `Tool input validation failed for ${toolName}`,
  );

  await writeSSE(
    stream,
    "tool_result",
    {
      id: toolCallId,
      tool: toolName,
      status: "validation_error",
      error: errorDetail,
    },
    abort,
  );

  return errorMsg;
}

/**
 * Tool: execute_command — Run a shell command on the server.
 */
export async function toolExecuteCommand(
  input: { command: string; description: string; timeout_seconds?: number },
  ctx: ToolExecutorContext,
  toolCallId: string,
  onConfirmRequired?: OnConfirmRequired,
): Promise<string> {
  const { command, description } = input;
  const { serverId, userId, sessionId, clientId, stream, abort } = ctx;
  const timeoutMs = Math.min((input.timeout_seconds ?? 30) * 1000, 600_000);

  // Security classification
  const validation = validateCommand(command);
  const riskLevel = validation.classification.riskLevel;

  // Audit log
  const auditLogger = getAuditLogger();
  const auditEntry = await auditLogger.log({
    serverId,
    userId,
    sessionId,
    command,
    validation,
  });

  // FORBIDDEN → block immediately
  if (validation.action === "blocked") {
    const msg = `命令被安全策略阻止: ${validation.classification.reason}`;
    await writeSSE(
      stream,
      "tool_result",
      {
        id: toolCallId,
        tool: "execute_command",
        status: "blocked",
        output: msg,
      },
      abort,
    );
    return msg;
  }

  // YELLOW/RED/CRITICAL → ask user for confirmation
  if (riskLevel !== RiskLevel.GREEN && onConfirmRequired) {
    const confirmation = onConfirmRequired(command, riskLevel, description);

    await writeSSE(
      stream,
      "confirm_required",
      {
        id: toolCallId,
        command,
        description,
        riskLevel,
        confirmId: confirmation.confirmId,
      },
      abort,
    );

    // Race confirmation against abort to avoid hanging when client disconnects
    const abortHandle = awaitAbort(abort);
    let approved: boolean;
    try {
      approved = await Promise.race([
        confirmation.approved,
        abortHandle.promise,
      ]);
    } finally {
      abortHandle.unsubscribe();
    }

    if (!approved) {
      const msg = `用户拒绝执行: ${command}`;
      await writeSSE(
        stream,
        "tool_result",
        {
          id: toolCallId,
          tool: "execute_command",
          status: "rejected",
          output: msg,
        },
        abort,
      );
      await auditLogger.updateExecutionResult(auditEntry.id, "skipped");
      return msg;
    }
  }

  // Check abort before dispatching command to agent
  if (abort.aborted) {
    return "Error: Client disconnected, skipping command execution";
  }

  // Execute the command
  await writeSSE(
    stream,
    "tool_executing",
    {
      id: toolCallId,
      tool: "execute_command",
      command,
    },
    abort,
  );

  const executor = getTaskExecutor();

  let hasStreamedOutput = false;
  executor.addProgressListener(toolCallId, (_executionId, _status, output) => {
    if (output) {
      hasStreamedOutput = true;
      void writeSSE(
        stream,
        "tool_output",
        {
          id: toolCallId,
          content: output,
        },
        abort,
      );
    }
  });

  const validatedRiskLevel = riskLevel as
    | "green"
    | "yellow"
    | "red"
    | "critical";

  let result;
  try {
    result = await executor.executeCommand({
      serverId,
      userId,
      clientId,
      command,
      description,
      riskLevel: validatedRiskLevel,
      type: "execute",
      timeoutMs,
    });
  } finally {
    executor.removeProgressListener(toolCallId);
  }

  // Build result string for AI
  let output = "";
  if (result.stdout) output += result.stdout;
  if (result.stderr) output += (output ? "\n" : "") + result.stderr;
  if (!output)
    output = result.success
      ? "(命令执行成功，无输出)"
      : "(命令执行失败，无输出)";

  // Send tool result to frontend
  await writeSSE(
    stream,
    "tool_result",
    {
      id: toolCallId,
      tool: "execute_command",
      status: result.success ? "completed" : "failed",
      exitCode: result.exitCode,
      output: hasStreamedOutput ? undefined : output,
      duration: result.duration,
    },
    abort,
  );

  await auditLogger.updateExecutionResult(
    auditEntry.id,
    result.success ? "success" : "failed",
    result.operationId,
  );

  // Return result to AI for reasoning
  const statusLine = result.success
    ? `[Exit code: ${result.exitCode}, Duration: ${result.duration}ms]`
    : `[FAILED - Exit code: ${result.exitCode}, Duration: ${result.duration}ms]`;

  return `${statusLine}\n${output}`;
}

/**
 * Tool: read_file — Read file contents with support for line ranges.
 */
export async function toolReadFile(
  input: { path: string; max_lines?: number; offset?: number; limit?: number },
  ctx: ToolExecutorContext,
  toolCallId: string,
): Promise<string> {
  const { path, max_lines, offset, limit } = input;

  let command: string;

  // If offset/limit specified, use tail+head for precise range
  if (offset !== undefined && limit !== undefined) {
    // Read from line (offset+1) for (limit) lines
    // tail -n +N: start from line N (1-indexed)
    // head -n M: take first M lines
    const startLine = offset + 1;
    command = `tail -n +${startLine} ${shellEscape(path)} | head -n ${limit}`;
  } else if (offset !== undefined) {
    // Read from offset to end of file
    const startLine = offset + 1;
    command = `tail -n +${startLine} ${shellEscape(path)}`;
  } else if (limit !== undefined) {
    // Read first N lines
    command = `head -n ${limit} ${shellEscape(path)}`;
  } else {
    // Default: read first max_lines (or 200)
    const maxLines = max_lines ?? 200;
    command = `head -n ${maxLines} ${shellEscape(path)}`;
  }

  return toolExecuteCommand(
    { command, description: `Read file: ${path}` },
    ctx,
    toolCallId,
  );
}

/**
 * Tool: list_files — List directory via ls command.
 */
export async function toolListFiles(
  input: { path: string; show_hidden?: boolean },
  ctx: ToolExecutorContext,
  toolCallId: string,
): Promise<string> {
  const flags = input.show_hidden ? "-lah" : "-lh";
  const command = `ls ${flags} ${shellEscape(input.path)}`;

  return toolExecuteCommand(
    { command, description: `List files: ${input.path}` },
    ctx,
    toolCallId,
  );
}

/**
 * Tool: search_code — Search for patterns in files using grep.
 */
export async function toolSearchCode(
  input: {
    pattern: string;
    path?: string;
    file_pattern?: string;
    context_lines?: number;
    case_sensitive?: boolean;
    max_results?: number;
  },
  ctx: ToolExecutorContext,
  toolCallId: string,
): Promise<string> {
  const {
    pattern,
    path = ".",
    file_pattern,
    context_lines = 2,
    case_sensitive = false,
    max_results = 50,
  } = input;

  // Build grep command with options
  let grepFlags = "-rn"; // recursive + line numbers
  if (!case_sensitive) grepFlags += "i"; // case-insensitive
  if (context_lines > 0) grepFlags += `C${context_lines}`; // context lines

  let command = `grep ${grepFlags} ${shellEscape(pattern)} ${shellEscape(path)}`;

  // Add file pattern filter if specified
  if (file_pattern) {
    command += ` --include=${shellEscape(file_pattern)}`;
  }

  // Limit results
  command += ` | head -n ${max_results}`;

  return toolExecuteCommand(
    {
      command,
      description: `Search for pattern "${pattern}" in ${path}${file_pattern ? ` (${file_pattern})` : ""}`,
    },
    ctx,
    toolCallId,
  );
}

/**
 * Tool: find_files — Find files by name pattern.
 */
export async function toolFindFiles(
  input: {
    pattern: string;
    path?: string;
    max_depth?: number;
    file_type?: "f" | "d" | "all";
  },
  ctx: ToolExecutorContext,
  toolCallId: string,
): Promise<string> {
  const { pattern, path = ".", max_depth = 5, file_type = "f" } = input;

  // Build find command
  let command = `find ${shellEscape(path)}`;

  // Add depth limit
  command += ` -maxdepth ${max_depth}`;

  // Add type filter
  if (file_type !== "all") {
    command += ` -type ${file_type}`;
  }

  // Add name pattern
  command += ` -name ${shellEscape(pattern)}`;

  // Limit results to prevent overwhelming output
  command += ` | head -n 100`;

  return toolExecuteCommand(
    {
      command,
      description: `Find files matching "${pattern}" in ${path}`,
    },
    ctx,
    toolCallId,
  );
}

/**
 * Tool: edit_file — Edit file by replacing exact text matches.
 */
export async function toolEditFile(
  input: {
    path: string;
    old_string: string;
    new_string: string;
    replace_all?: boolean;
  },
  ctx: ToolExecutorContext,
  toolCallId: string,
): Promise<string> {
  const { path, old_string, new_string, replace_all = false } = input;

  // Step 1: Verify file exists and contains old_string
  const checkCmd = `grep -F ${shellEscape(old_string)} ${shellEscape(path)} || echo "PATTERN_NOT_FOUND"`;
  const checkResult = await toolExecuteCommand(
    { command: checkCmd, description: `Verify pattern exists in ${path}` },
    ctx,
    `${toolCallId}_check`,
  );

  if (checkResult.includes("PATTERN_NOT_FOUND")) {
    return `Error: Pattern not found in file ${path}. Cannot edit.`;
  }

  // Step 2: Perform the replacement using sed
  // Note: sed -i works differently on macOS vs Linux
  // Use a portable approach: create temp file then move
  const escapedOld = old_string.replace(/[\/&]/g, "\\$&").replace(/\n/g, "\\n");
  const escapedNew = new_string.replace(/[\/&]/g, "\\$&").replace(/\n/g, "\\n");

  const sedFlag = replace_all ? "g" : ""; // global flag for replace all
  const command = `sed 's/${escapedOld}/${escapedNew}/${sedFlag}' ${shellEscape(path)} > ${shellEscape(path)}.tmp && mv ${shellEscape(path)}.tmp ${shellEscape(path)}`;

  return toolExecuteCommand(
    {
      command,
      description: `Edit ${path}: replace "${old_string.substring(0, 50)}..." with "${new_string.substring(0, 50)}..."`,
      timeout_seconds: 10,
    },
    ctx,
    toolCallId,
  );
}

/**
 * Execute a single tool call and return the result string.
 * This is the router function that dispatches to specific tool executors.
 */
export async function executeToolCall(
  toolCall: { id: string; name: string; input: unknown },
  ctx: ToolExecutorContext,
  onConfirmRequired?: OnConfirmRequired,
): Promise<string> {
  const { name, input } = toolCall;
  const { stream, abort } = ctx;

  // Early exit if client already disconnected
  if (abort.aborted) {
    return "Error: Client disconnected, skipping tool execution";
  }

  try {
    switch (name) {
      case "execute_command": {
        const parsed = ExecuteCommandInputSchema.safeParse(input);
        if (!parsed.success) {
          return await handleValidationError(
            name,
            toolCall.id,
            parsed.error.issues,
            input,
            stream,
            abort,
          );
        }
        return await toolExecuteCommand(
          parsed.data,
          ctx,
          toolCall.id,
          onConfirmRequired,
        );
      }

      case "read_file": {
        const parsed = ReadFileInputSchema.safeParse(input);
        if (!parsed.success) {
          return await handleValidationError(
            name,
            toolCall.id,
            parsed.error.issues,
            input,
            stream,
            abort,
          );
        }
        return await toolReadFile(parsed.data, ctx, toolCall.id);
      }

      case "list_files": {
        const parsed = ListFilesInputSchema.safeParse(input);
        if (!parsed.success) {
          return await handleValidationError(
            name,
            toolCall.id,
            parsed.error.issues,
            input,
            stream,
            abort,
          );
        }
        return await toolListFiles(parsed.data, ctx, toolCall.id);
      }

      case "search_code": {
        const parsed = SearchCodeInputSchema.safeParse(input);
        if (!parsed.success) {
          return await handleValidationError(
            name,
            toolCall.id,
            parsed.error.issues,
            input,
            stream,
            abort,
          );
        }
        return await toolSearchCode(parsed.data, ctx, toolCall.id);
      }

      case "find_files": {
        const parsed = FindFilesInputSchema.safeParse(input);
        if (!parsed.success) {
          return await handleValidationError(
            name,
            toolCall.id,
            parsed.error.issues,
            input,
            stream,
            abort,
          );
        }
        return await toolFindFiles(parsed.data, ctx, toolCall.id);
      }

      case "edit_file": {
        const parsed = EditFileInputSchema.safeParse(input);
        if (!parsed.success) {
          return await handleValidationError(
            name,
            toolCall.id,
            parsed.error.issues,
            input,
            stream,
            abort,
          );
        }
        return await toolEditFile(parsed.data, ctx, toolCall.id);
      }

      default:
        return `Error: Unknown tool "${name}"`;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await writeSSE(
      stream,
      "tool_result",
      {
        id: toolCall.id,
        tool: name,
        status: "failed",
        error: errMsg,
      },
      abort,
    );
    return `Error executing ${name}: ${errMsg}`;
  }
}
