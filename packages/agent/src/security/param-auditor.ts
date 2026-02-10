/**
 * Parameter auditor module for ServerPilot Agent.
 *
 * Implements the second layer of the five-layer defense-in-depth security model:
 * dangerous parameter blacklist and protected path detection.
 *
 * Runs after command classification (Layer 1) to provide fine-grained
 * parameter-level analysis of commands before execution.
 *
 * Responsibilities:
 * - Detect dangerous parameters (--purge, --force, -rf, etc.)
 * - Detect destructive operations on protected system paths
 * - Produce structured audit results with warnings and blockers
 *
 * @module security/param-auditor
 */

import { z } from 'zod';

// ============================================================================
// Dangerous Parameters
// ============================================================================

/**
 * Parameters that bypass safety checks or enable destructive behavior.
 * Each entry includes the flag string and a human-readable description.
 */
export interface DangerousParam {
  /** The parameter flag to detect */
  flag: string;
  /** Why this parameter is dangerous */
  description: string;
}

export const DANGEROUS_PARAMS: readonly DangerousParam[] = [
  { flag: '--purge', description: '完全清除，包括配置文件' },
  { flag: '--force', description: '强制执行，跳过安全确认' },
  { flag: '--no-preserve-root', description: '允许对根目录执行危险操作' },
  { flag: '-rf', description: '递归强制删除' },
  { flag: '-fr', description: '强制递归删除' },
  { flag: '--hard', description: '硬重置，不可恢复' },
  { flag: '--no-verify', description: '跳过验证步骤' },
  { flag: '--no-check', description: '跳过检查步骤' },
  { flag: '--delete', description: '删除目标中不存在的文件（rsync）' },
  { flag: '--force-yes', description: '自动确认所有危险操作' },
  { flag: '-y', description: '跳过确认提示' },
  { flag: '--yes', description: '跳过确认提示' },
] as const;

/**
 * Plain flag strings for quick lookup.
 */
export const DANGEROUS_FLAGS: readonly string[] = DANGEROUS_PARAMS.map((p) => p.flag);

// ============================================================================
// Protected Paths
// ============================================================================

/**
 * System paths that require extra caution for destructive operations.
 * Each entry includes the path and a description of what it contains.
 */
export interface ProtectedPath {
  /** The filesystem path to protect */
  path: string;
  /** Description of what this path contains */
  description: string;
}

export const PROTECTED_PATHS: readonly ProtectedPath[] = [
  { path: '/etc', description: '系统配置目录' },
  { path: '/boot', description: '引导加载目录' },
  { path: '/usr', description: '系统程序目录' },
  { path: '/var/lib/mysql', description: 'MySQL 数据目录' },
  { path: '/var/lib/postgresql', description: 'PostgreSQL 数据目录' },
  { path: '/root', description: 'root 用户主目录' },
  { path: '/bin', description: '基础命令目录' },
  { path: '/sbin', description: '系统管理命令目录' },
  { path: '/lib', description: '系统库目录' },
  { path: '/proc', description: '进程信息伪文件系统' },
  { path: '/sys', description: '系统设备伪文件系统' },
  { path: '/dev', description: '设备文件目录' },
] as const;

/**
 * Plain path strings for quick lookup.
 */
export const PROTECTED_PATH_LIST: readonly string[] = PROTECTED_PATHS.map((p) => p.path);

// ============================================================================
// Destructive Operation Patterns
// ============================================================================

/**
 * Regex patterns that indicate destructive operations on files/directories.
 * When these appear alongside a protected path, the operation is blocked.
 */
const DESTRUCTIVE_OPS = /\b(rm|rmdir|shred|truncate|unlink)\b/i;

/**
 * Regex patterns for SQL destructive operations.
 */
const DESTRUCTIVE_SQL_OPS = /\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i;

/**
 * Regex patterns for move/overwrite operations that could damage system paths.
 */
const MOVE_OPS = /\b(mv)\b/;

// ============================================================================
// Audit Result
// ============================================================================

/** Result of auditing a command's parameters. */
export interface AuditResult {
  /** Whether the command is considered safe to execute */
  safe: boolean;
  /** Non-blocking warnings (dangerous params detected) */
  warnings: string[];
  /** Blocking issues (destructive ops on protected paths) */
  blockers: string[];
}

/** Zod schema for AuditResult. */
export const AuditResultSchema = z.object({
  safe: z.boolean(),
  warnings: z.array(z.string()),
  blockers: z.array(z.string()),
});

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Normalize a command by stripping the sudo prefix.
 * Reuses the same logic as command-classifier for consistency.
 */
function stripSudo(raw: string): string {
  let cmd = raw.trim();

  const SUDO_FLAGS_WITH_ARG = new Set(['u', 'g', 'C', 'D', 'R', 'T', 'U', 'h', 'p', 'r', 't']);

  if (/^\s*sudo\b/.test(cmd)) {
    cmd = cmd.replace(/^\s*sudo\s+/, '');
    while (/^-/.test(cmd)) {
      const longMatch = cmd.match(/^--\S+\s*/);
      if (longMatch) {
        cmd = cmd.slice(longMatch[0].length);
        continue;
      }
      const shortMatch = cmd.match(/^-([a-zA-Z]+)\s*/);
      if (shortMatch) {
        const flags = shortMatch[1];
        cmd = cmd.slice(shortMatch[0].length);
        const lastFlag = flags[flags.length - 1];
        if (SUDO_FLAGS_WITH_ARG.has(lastFlag) && cmd.length > 0 && !cmd.startsWith('-')) {
          cmd = cmd.replace(/^\S+\s*/, '');
        }
        continue;
      }
      break;
    }
  }

  return cmd.trim();
}

/**
 * Tokenize a command string into individual tokens.
 * Handles basic quoting (single and double quotes).
 */
function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += ch;
    } else if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
    } else if (ch === ' ' && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Check if a token is a flag/option (starts with -).
 */
function isFlag(token: string): boolean {
  return token.startsWith('-');
}

/**
 * Check if a token contains a specific flag.
 * Handles combined short flags like -rfv containing -rf.
 */
function tokenMatchesFlag(token: string, flag: string): boolean {
  // Exact match
  if (token === flag) return true;

  // For long flags (--xxx), only exact match works
  if (flag.startsWith('--')) return false;

  // For short combined flags like -rf: check if -rfv contains both r and f
  if (flag.startsWith('-') && !flag.startsWith('--') && token.startsWith('-') && !token.startsWith('--')) {
    const flagChars = flag.slice(1);
    const tokenChars = token.slice(1);
    return [...flagChars].every((ch) => tokenChars.includes(ch));
  }

  return false;
}

/**
 * Check if the command targets a protected path.
 * Returns matched protected paths.
 */
function findProtectedPaths(command: string): ProtectedPath[] {
  const matched: ProtectedPath[] = [];
  for (const pp of PROTECTED_PATHS) {
    // Match the exact path or path as prefix followed by / or end-of-string
    // e.g., /etc matches /etc, /etc/nginx, /etc/hosts
    // but /etc does NOT match /etcetera
    // Allow quotes before/after the path
    const pathRegex = new RegExp(`(?:^|\\s|=|:|"|')${escapeRegex(pp.path)}(?:/|\\s|$|"|')`);
    if (pathRegex.test(` ${command} `)) {
      matched.push(pp);
    }
  }
  return matched;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// Main Audit Function
// ============================================================================

/**
 * Audit a command string for dangerous parameters and protected path operations.
 *
 * This is the main entry point for Layer 2 of the security pipeline.
 * It checks for:
 * 1. Dangerous parameters that bypass safety checks
 * 2. Destructive operations targeting protected system paths
 *
 * @param command - The raw command string to audit
 * @returns Audit result with safety status, warnings, and blockers
 *
 * @example
 * ```ts
 * const result = auditCommand('rm --force /etc/nginx/nginx.conf');
 * // {
 * //   safe: false,
 * //   warnings: ['包含危险参数: --force (强制执行，跳过安全确认)'],
 * //   blockers: ['对保护路径 /etc (系统配置目录) 的破坏性操作需要额外确认']
 * // }
 * ```
 */
export function auditCommand(command: string): AuditResult {
  const result: AuditResult = { safe: true, warnings: [], blockers: [] };

  if (!command || command.trim().length === 0) {
    return result;
  }

  const normalized = stripSudo(command);
  const tokens = tokenize(normalized);

  // 1. Check dangerous parameters
  for (const dp of DANGEROUS_PARAMS) {
    for (const token of tokens) {
      if (isFlag(token) && tokenMatchesFlag(token, dp.flag)) {
        result.warnings.push(`包含危险参数: ${dp.flag} (${dp.description})`);
        break; // Only warn once per dangerous param
      }
    }
  }

  // 2. Check protected paths with destructive operations
  const isDestructiveFileOp = DESTRUCTIVE_OPS.test(normalized);
  const isDestructiveSqlOp = DESTRUCTIVE_SQL_OPS.test(normalized);
  const isMoveOp = MOVE_OPS.test(normalized);

  if (isDestructiveFileOp || isDestructiveSqlOp || isMoveOp) {
    const matchedPaths = findProtectedPaths(normalized);
    for (const pp of matchedPaths) {
      result.blockers.push(
        `对保护路径 ${pp.path} (${pp.description}) 的破坏性操作需要额外确认`,
      );
      result.safe = false;
    }
  }

  return result;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Quick check: does the command contain any dangerous parameters?
 */
export function hasDangerousParams(command: string): boolean {
  if (!command || command.trim().length === 0) return false;
  const normalized = stripSudo(command);
  const tokens = tokenize(normalized);
  return DANGEROUS_PARAMS.some((dp) =>
    tokens.some((token) => isFlag(token) && tokenMatchesFlag(token, dp.flag)),
  );
}

/**
 * Quick check: does the command target any protected paths?
 */
export function hasProtectedPaths(command: string): boolean {
  if (!command || command.trim().length === 0) return false;
  const normalized = stripSudo(command);
  return findProtectedPaths(normalized).length > 0;
}

/**
 * Get all dangerous parameter warnings for a command.
 */
export function getParamWarnings(command: string): string[] {
  return auditCommand(command).warnings;
}

/**
 * Get all protected path blockers for a command.
 */
export function getPathBlockers(command: string): string[] {
  return auditCommand(command).blockers;
}

/**
 * Check whether an audit result requires user confirmation.
 * Returns true if there are any warnings or blockers.
 */
export function requiresExtraConfirmation(result: AuditResult): boolean {
  return result.warnings.length > 0 || result.blockers.length > 0;
}

/**
 * Check whether an audit result contains blocking issues.
 * Commands with blockers should not execute without explicit escalation.
 */
export function hasBlockers(result: AuditResult): boolean {
  return result.blockers.length > 0;
}

/**
 * Parse and validate an unknown value as an AuditResult.
 */
export function parseAuditResult(data: unknown): AuditResult {
  return AuditResultSchema.parse(data);
}

/**
 * Safely parse an unknown value as an AuditResult.
 */
export function safeParseAuditResult(data: unknown): z.SafeParseReturnType<unknown, AuditResult> {
  return AuditResultSchema.safeParse(data);
}
