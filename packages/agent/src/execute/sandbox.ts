// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Sandbox module for safe command execution.
 *
 * Provides security controls around command execution including:
 * - Command whitelist validation
 * - Path access control
 * - User confirmation mechanism
 * - Dry-run mode for previewing commands
 *
 * @module execute/sandbox
 */

import path from 'node:path';

import type { ExecResult } from '@aiinstaller/shared';

import { CommandExecutor } from './executor.js';
import type { ExecuteOptions } from './executor.js';

// ============================================================================
// Types
// ============================================================================

/** Configuration for the sandbox. */
export interface SandboxConfig {
  /** Commands allowed to be executed (base command names without args). */
  whitelist?: string[];
  /** Directories the sandbox is allowed to access. */
  allowedPaths?: string[];
  /** Whether to enable dry-run mode (log commands instead of executing). */
  dryRun?: boolean;
  /** Callback invoked to confirm a command before execution. Return true to allow. */
  confirmFn?: (command: string, args: string[]) => Promise<boolean>;
}

/** Result of a sandbox validation check. */
export interface ValidationResult {
  /** Whether the command passed validation. */
  allowed: boolean;
  /** Reason if the command was denied. */
  reason?: string;
}

// ============================================================================
// Default whitelist
// ============================================================================

/**
 * Default set of commands that are safe to execute in an installation context.
 */
export const DEFAULT_WHITELIST: readonly string[] = [
  // Package managers
  'npm',
  'pnpm',
  'yarn',
  'npx',
  'bun',
  // System package managers
  'brew',
  'apt',
  'apt-get',
  'yum',
  'dnf',
  'pacman',
  // Version managers
  'nvm',
  'fnm',
  'volta',
  // Common tools
  'node',
  'git',
  'curl',
  'wget',
  'tar',
  'unzip',
  // Verification commands
  'which',
  'where',
  'command',
  'type',
  'cat',
  'ls',
  'echo',
  'printenv',
  'env',
  'uname',
] as const;

// ============================================================================
// Sandbox
// ============================================================================

/**
 * Sandbox wraps a CommandExecutor to add security controls.
 *
 * Before executing any command, the sandbox validates:
 * 1. The command is on the whitelist.
 * 2. The working directory is within allowed paths (if configured).
 * 3. The user confirms execution (if a confirmFn is provided).
 *
 * In dry-run mode, commands are not actually executed but a simulated
 * ExecResult is returned.
 *
 * @example
 * ```ts
 * const sandbox = new Sandbox({
 *   whitelist: ['npm', 'node'],
 *   dryRun: false,
 *   confirmFn: async (cmd, args) => {
 *     console.log(`Run: ${cmd} ${args.join(' ')}?`);
 *     return true;
 *   },
 * });
 *
 * const result = await sandbox.execute('npm', ['install']);
 * ```
 */
export class Sandbox {
  private readonly whitelist: Set<string>;
  private readonly allowedPaths: string[];
  private readonly dryRun: boolean;
  private readonly confirmFn?: (command: string, args: string[]) => Promise<boolean>;
  private readonly executor: CommandExecutor;

  constructor(config: SandboxConfig = {}, executor?: CommandExecutor) {
    this.whitelist = new Set(config.whitelist ?? DEFAULT_WHITELIST);
    this.allowedPaths = (config.allowedPaths ?? []).map((p) => path.resolve(p));
    this.dryRun = config.dryRun ?? false;
    this.confirmFn = config.confirmFn;
    this.executor = executor ?? new CommandExecutor();
  }

  /**
   * Validate whether a command is on the whitelist.
   *
   * Extracts the base command name (without path) and checks it against
   * the configured whitelist.
   */
  validateCommand(command: string): ValidationResult {
    const baseName = path.basename(command).replace(/\.(cmd|exe|bat)$/i, '');
    if (!this.whitelist.has(baseName)) {
      return {
        allowed: false,
        reason: `Command "${baseName}" is not in the whitelist`,
      };
    }
    return { allowed: true };
  }

  /**
   * Validate whether a working directory is within the allowed paths.
   *
   * If no allowedPaths are configured, all paths are allowed.
   */
  validatePath(cwd?: string): ValidationResult {
    if (!cwd || this.allowedPaths.length === 0) {
      return { allowed: true };
    }
    const resolved = path.resolve(cwd);
    const isAllowed = this.allowedPaths.some(
      (allowed) => resolved === allowed || resolved.startsWith(allowed + path.sep),
    );
    if (!isAllowed) {
      return {
        allowed: false,
        reason: `Path "${resolved}" is not within allowed paths`,
      };
    }
    return { allowed: true };
  }

  /**
   * Run all validation checks on a command.
   *
   * Returns the first failing validation result, or a success result
   * if all checks pass.
   */
  validate(command: string, cwd?: string): ValidationResult {
    const cmdResult = this.validateCommand(command);
    if (!cmdResult.allowed) return cmdResult;

    const pathResult = this.validatePath(cwd);
    if (!pathResult.allowed) return pathResult;

    return { allowed: true };
  }

  /**
   * Check whether dry-run mode is enabled.
   */
  isDryRun(): boolean {
    return this.dryRun;
  }

  /**
   * Get the current whitelist as an array.
   */
  getWhitelist(): string[] {
    return Array.from(this.whitelist);
  }

  /**
   * Add a command to the whitelist.
   */
  addToWhitelist(command: string): void {
    this.whitelist.add(command);
  }

  /**
   * Remove a command from the whitelist.
   */
  removeFromWhitelist(command: string): void {
    this.whitelist.delete(command);
  }

  /**
   * Execute a command within the sandbox.
   *
   * Performs validation checks, optionally asks for user confirmation,
   * and either runs the command or returns a dry-run result.
   *
   * @param command - The command to execute
   * @param args - Command arguments
   * @param options - Execution options (passed to CommandExecutor)
   * @returns The execution result
   * @throws {Error} If the command fails validation or user denies execution
   */
  async execute(
    command: string,
    args: string[] = [],
    options: ExecuteOptions = {},
  ): Promise<ExecResult> {
    // 1. Validate command and path
    const validation = this.validate(command, options.cwd);
    if (!validation.allowed) {
      throw new Error(`Sandbox: ${validation.reason}`);
    }

    // 2. Ask for user confirmation if confirmFn is set
    if (this.confirmFn) {
      const confirmed = await this.confirmFn(command, args);
      if (!confirmed) {
        throw new Error(`Sandbox: User denied execution of "${command} ${args.join(' ')}"`);
      }
    }

    // 3. Dry-run mode: return simulated result without executing
    if (this.dryRun) {
      const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;
      return {
        command: fullCommand,
        exitCode: 0,
        stdout: `[dry-run] Would execute: ${fullCommand}`,
        stderr: '',
        duration: 0,
        timedOut: false,
      };
    }

    // 4. Execute the command
    return this.executor.execute(command, args, options);
  }
}
