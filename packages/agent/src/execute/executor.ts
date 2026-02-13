// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Command execution module for AI Installer agent.
 *
 * Provides a CommandExecutor class that wraps child_process spawn/execFile
 * to execute shell commands safely with timeout, output capture, and
 * real-time stream handling. Inspired by openclaw-modules/process/exec.ts.
 *
 * @module execute/executor
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import type { ExecResult } from '@aiinstaller/shared';

// ============================================================================
// Types
// ============================================================================

/** Options for command execution. */
export interface ExecuteOptions {
  /** Timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Working directory for the command */
  cwd?: string;
  /** Additional environment variables (merged with process.env) */
  env?: Record<string, string>;
  /** Input to write to stdin */
  input?: string;
  /** Callback invoked on each chunk of stdout data */
  onStdout?: (data: string) => void;
  /** Callback invoked on each chunk of stderr data */
  onStderr?: (data: string) => void;
}

/** Default timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 30_000;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve a command for Windows compatibility.
 * On Windows, npm-related commands require .cmd extension.
 */
function resolveCommand(command: string): string {
  if (process.platform !== 'win32') {
    return command;
  }
  const basename = path.basename(command).toLowerCase();
  const ext = path.extname(basename);
  if (ext) {
    return command;
  }
  const cmdCommands = ['npm', 'pnpm', 'yarn', 'npx'];
  if (cmdCommands.includes(basename)) {
    return `${command}.cmd`;
  }
  return command;
}

/**
 * Format a command and its arguments into a single display string.
 */
function formatCommand(command: string, args: string[]): string {
  if (args.length === 0) {
    return command;
  }
  return `${command} ${args.join(' ')}`;
}

// ============================================================================
// CommandExecutor
// ============================================================================

/**
 * Executes shell commands with timeout protection, output capture,
 * and optional real-time stream handling.
 *
 * @example
 * ```ts
 * const executor = new CommandExecutor();
 * const result = await executor.execute('node', ['--version']);
 * console.log(result.stdout); // "v24.1.0\n"
 * console.log(result.exitCode); // 0
 * ```
 *
 * @example
 * ```ts
 * // With real-time output streaming
 * const result = await executor.execute('npm', ['install'], {
 *   timeoutMs: 60000,
 *   cwd: '/path/to/project',
 *   onStdout: (chunk) => process.stdout.write(chunk),
 *   onStderr: (chunk) => process.stderr.write(chunk),
 * });
 * ```
 */
export class CommandExecutor {
  private readonly defaultTimeoutMs: number;

  /**
   * Create a new CommandExecutor.
   *
   * @param defaultTimeoutMs - Default timeout for all commands (default: 30000ms)
   */
  constructor(defaultTimeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  /**
   * Execute a command and return the result.
   *
   * Spawns the command as a child process with pipe stdio to capture output.
   * Supports timeout, custom working directory, environment variables,
   * stdin input, and real-time output streaming via callbacks.
   *
   * @param command - The command to execute (e.g. "node", "npm")
   * @param args - Array of arguments (e.g. ["--version"])
   * @param options - Execution options
   * @returns The execution result conforming to ExecResult
   *
   * @example
   * ```ts
   * const result = await executor.execute('echo', ['hello']);
   * // result.exitCode === 0
   * // result.stdout === 'hello\n'
   * ```
   */
  async execute(
    command: string,
    args: string[] = [],
    options: ExecuteOptions = {},
  ): Promise<ExecResult> {
    const {
      timeoutMs = this.defaultTimeoutMs,
      cwd,
      env,
      input,
      onStdout,
      onStderr,
    } = options;

    const resolvedEnv = env
      ? { ...process.env, ...env }
      : { ...process.env };

    // Suppress npm fund messages
    const cmd = path.basename(command).toLowerCase();
    if (cmd === 'npm' || cmd === 'npm.cmd' || cmd === 'npm.exe') {
      resolvedEnv.NPM_CONFIG_FUND ??= 'false';
      resolvedEnv.npm_config_fund ??= 'false';
    }

    const startTime = Date.now();

    return new Promise<ExecResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      const child = spawn(resolveCommand(command), args, {
        stdio: 'pipe',
        cwd,
        env: resolvedEnv,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        if (typeof child.kill === 'function') {
          child.kill('SIGKILL');
        }
      }, timeoutMs);

      if (input !== undefined && child.stdin) {
        child.stdin.write(input);
        child.stdin.end();
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        onStdout?.(text);
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        onStderr?.(text);
      });

      const finish = (exitCode: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const duration = Date.now() - startTime;
        resolve({
          command: formatCommand(command, args),
          exitCode,
          stdout,
          stderr,
          duration,
          timedOut,
        });
      };

      child.on('error', (err) => {
        // Spawn errors (e.g. command not found) resolve with exitCode 1
        stderr += err.message;
        finish(1);
      });

      child.on('close', (code) => {
        finish(code ?? 1);
      });
    });
  }
}

/**
 * Create a CommandExecutor with default settings and execute a single command.
 *
 * Convenience function for one-off command execution without instantiating
 * a CommandExecutor explicitly.
 *
 * @param command - The command to execute
 * @param args - Array of arguments
 * @param options - Execution options
 * @returns The execution result
 *
 * @example
 * ```ts
 * const result = await executeCommand('git', ['status']);
 * ```
 */
export async function executeCommand(
  command: string,
  args: string[] = [],
  options: ExecuteOptions = {},
): Promise<ExecResult> {
  const executor = new CommandExecutor();
  return executor.execute(command, args, options);
}
