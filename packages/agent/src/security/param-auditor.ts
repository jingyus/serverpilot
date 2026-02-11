// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Parameter auditor module for ServerPilot Agent.
 *
 * Implements the second layer of the five-layer defense-in-depth security model:
 * dangerous parameter blacklist and protected path detection.
 *
 * Runs after command classification (Layer 1) to provide fine-grained
 * parameter-level analysis of commands before execution.
 *
 * @module security/param-auditor
 */

import { z } from 'zod';
import { normalizeCommand } from './command-classifier.js';

// ============================================================================
// Dangerous Parameters
// ============================================================================

export interface DangerousParam {
  flag: string;
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
  { flag: '--no-backup', description: '不创建备份' },
  { flag: '--overwrite', description: '覆盖已有文件' },
  { flag: '--allow-empty', description: '允许空内容操作' },
  { flag: '--skip-lock', description: '跳过锁检查' },
  { flag: '--force-remove', description: '强制移除' },
  { flag: '--recursive', description: '递归操作' },
  { flag: '--no-prompt', description: '不提示确认' },
  { flag: '--assume-yes', description: '假设所有提示回答为是' },
  { flag: '--force-with-lease', description: 'Git 强制推送（带租约）' },
  { flag: '--prune', description: '清理未引用对象' },
  { flag: '--wipe-data', description: '擦除数据' },
  { flag: '--reset', description: '重置操作' },
  { flag: '--destroy', description: '销毁资源' },
  { flag: '--no-preserve', description: '不保留原有内容' },
  { flag: '--remove-all', description: '移除所有' },
  { flag: '--cascade', description: '级联操作（删除关联资源）' },
  { flag: '--no-deps', description: '忽略依赖检查' },
  { flag: '--skip-validation', description: '跳过验证' },
  { flag: '--force-conflicts', description: '强制忽略冲突' },
  { flag: '--ignore-errors', description: '忽略错误继续执行' },
  { flag: '--no-confirm', description: '跳过确认' },
  { flag: '--allow-root', description: '允许 root 权限执行' },
  { flag: '--unsafe', description: '不安全模式' },
  { flag: '--force-delete', description: '强制删除' },
  { flag: '--no-keep-alive', description: '禁用保活检查' },
  { flag: '--all', description: '操作所有目标' },
  { flag: '--no-interaction', description: '禁用交互确认' },
  { flag: '--force-renewal', description: '强制续期（证书）' },
  { flag: '--skip-checks', description: '跳过预检查' },
  { flag: '--no-preserve-env', description: '不保留环境变量' },
  { flag: '--force-overwrite', description: '强制覆盖' },
  { flag: '--disable-verification', description: '禁用验证' },
  { flag: '--skip-hooks', description: '跳过钩子执行' },
  { flag: '--no-audit', description: '跳过安全审计' },
] as const;

export const DANGEROUS_FLAGS: readonly string[] = DANGEROUS_PARAMS.map((p) => p.flag);

// ============================================================================
// Protected Paths
// ============================================================================

export interface ProtectedPath {
  path: string;
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
  { path: '/lib64', description: '64位系统库目录' },
  { path: '/proc', description: '进程信息伪文件系统' },
  { path: '/sys', description: '系统设备伪文件系统' },
  { path: '/dev', description: '设备文件目录' },
  { path: '/var/lib/docker', description: 'Docker 数据目录' },
  { path: '/var/lib/kubelet', description: 'Kubelet 数据目录' },
  { path: '/var/lib/etcd', description: 'etcd 数据目录' },
  { path: '/var/lib/redis', description: 'Redis 数据目录' },
  { path: '/var/lib/mongodb', description: 'MongoDB 数据目录' },
  { path: '/var/lib/elasticsearch', description: 'Elasticsearch 数据目录' },
  { path: '/home', description: '用户主目录根路径' },
  { path: '/opt', description: '可选应用目录' },
  { path: '/snap', description: 'Snap 包目录' },
  { path: '/var/log', description: '系统日志目录' },
  { path: '/var/spool', description: '系统队列目录' },
  { path: '/var/lib/kubelet', description: 'Kubelet 数据目录' },
  { path: '/var/lib/containerd', description: 'containerd 数据目录' },
  { path: '/var/lib/grafana', description: 'Grafana 数据目录' },
  { path: '/var/lib/prometheus', description: 'Prometheus 数据目录' },
  { path: '/var/backups', description: '系统备份目录' },
  { path: '/srv', description: '服务数据目录' },
  { path: '/var/lib/lxc', description: 'LXC 容器数据目录' },
  { path: '/var/lib/lxd', description: 'LXD 容器数据目录' },
  { path: '/var/lib/cni', description: 'CNI 网络配置目录' },
  { path: '/var/lib/rancher', description: 'Rancher 数据目录' },
  { path: '/var/lib/consul', description: 'Consul 数据目录' },
  { path: '/var/lib/nomad', description: 'Nomad 数据目录' },
  { path: '/var/lib/vault', description: 'Vault 数据目录' },
  { path: '/var/lib/minio', description: 'MinIO 数据目录' },
  { path: '/var/lib/clickhouse', description: 'ClickHouse 数据目录' },
  { path: '/var/lib/cassandra', description: 'Cassandra 数据目录' },
  { path: '/var/lib/influxdb', description: 'InfluxDB 数据目录' },
  { path: '/var/lib/rabbitmq', description: 'RabbitMQ 数据目录' },
  { path: '/var/lib/neo4j', description: 'Neo4j 数据目录' },
  { path: '/var/lib/cockroach', description: 'CockroachDB 数据目录' },
  { path: '/var/lib/ceph', description: 'Ceph 存储数据目录' },
  { path: '/var/lib/gitea', description: 'Gitea 数据目录' },
  { path: '/var/lib/gitlab', description: 'GitLab 数据目录' },
  { path: '/var/lib/jenkins', description: 'Jenkins 数据目录' },
  { path: '/var/lib/zookeeper', description: 'ZooKeeper 数据目录' },
  { path: '/var/lib/kafka', description: 'Kafka 数据目录' },
  { path: '/var/lib/haproxy', description: 'HAProxy 数据目录' },
] as const;

export const PROTECTED_PATH_LIST: readonly string[] = PROTECTED_PATHS.map((p) => p.path);

// ============================================================================
// Destructive Operation Patterns
// ============================================================================

const DESTRUCTIVE_OPS = /\b(rm|rmdir|shred|truncate|unlink)\b/i;
const DESTRUCTIVE_SQL_OPS = /\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i;
const MOVE_OPS = /\b(mv)\b/;

// ============================================================================
// Audit Result
// ============================================================================

export interface AuditResult {
  safe: boolean;
  warnings: string[];
  blockers: string[];
}

export const AuditResultSchema = z.object({
  safe: z.boolean(),
  warnings: z.array(z.string()),
  blockers: z.array(z.string()),
});

// ============================================================================
// Internal Helpers
// ============================================================================

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

function isFlag(token: string): boolean {
  return token.startsWith('-');
}

function tokenMatchesFlag(token: string, flag: string): boolean {
  if (token === flag) return true;
  if (flag.startsWith('--')) return false;
  if (flag.startsWith('-') && !flag.startsWith('--') && token.startsWith('-') && !token.startsWith('--')) {
    const flagChars = flag.slice(1);
    const tokenChars = token.slice(1);
    return [...flagChars].every((ch) => tokenChars.includes(ch));
  }
  return false;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findProtectedPaths(command: string): ProtectedPath[] {
  const matched: ProtectedPath[] = [];
  for (const pp of PROTECTED_PATHS) {
    const pathRegex = new RegExp(`(?:^|\\s|=|:|"|')${escapeRegex(pp.path)}(?:/|\\s|$|"|')`);
    if (pathRegex.test(` ${command} `)) {
      matched.push(pp);
    }
  }
  return matched;
}

// ============================================================================
// Main Audit Function
// ============================================================================

export function auditCommand(command: string): AuditResult {
  const result: AuditResult = { safe: true, warnings: [], blockers: [] };

  if (!command || command.trim().length === 0) {
    return result;
  }

  const normalized = normalizeCommand(command);
  const tokens = tokenize(normalized);

  // 1. Check dangerous parameters
  for (const dp of DANGEROUS_PARAMS) {
    for (const token of tokens) {
      if (isFlag(token) && tokenMatchesFlag(token, dp.flag)) {
        result.warnings.push(`包含危险参数: ${dp.flag} (${dp.description})`);
        break;
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

export function hasDangerousParams(command: string): boolean {
  if (!command || command.trim().length === 0) return false;
  const normalized = normalizeCommand(command);
  const tokens = tokenize(normalized);
  return DANGEROUS_PARAMS.some((dp) =>
    tokens.some((token) => isFlag(token) && tokenMatchesFlag(token, dp.flag)),
  );
}

export function hasProtectedPaths(command: string): boolean {
  if (!command || command.trim().length === 0) return false;
  const normalized = normalizeCommand(command);
  return findProtectedPaths(normalized).length > 0;
}

export function getParamWarnings(command: string): string[] {
  return auditCommand(command).warnings;
}

export function getPathBlockers(command: string): string[] {
  return auditCommand(command).blockers;
}

export function requiresExtraConfirmation(result: AuditResult): boolean {
  return result.warnings.length > 0 || result.blockers.length > 0;
}

export function hasBlockers(result: AuditResult): boolean {
  return result.blockers.length > 0;
}

export function parseAuditResult(data: unknown): AuditResult {
  return AuditResultSchema.parse(data);
}

export function safeParseAuditResult(data: unknown): z.SafeParseReturnType<unknown, AuditResult> {
  return AuditResultSchema.safeParse(data);
}
