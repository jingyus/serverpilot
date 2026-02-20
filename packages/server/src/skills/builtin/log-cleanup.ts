// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Log Cleanup Skill - 日志清理
 *
 * 自动清理过期日志文件,释放磁盘空间
 */

export interface LogCleanupConfig {
  /** 日志目录路径 */
  logPath: string;
  /** 保留最近 N 天的日志 */
  retentionDays: number;
  /** 文件匹配模式(glob) */
  pattern?: string;
  /** 是否压缩旧日志(而不是删除) */
  compressOld?: boolean;
  /** 压缩前保留天数 */
  compressAfterDays?: number;
  /** 是否启用 Webhook 通知 */
  webhookEnabled: boolean;
}

export interface LogCleanupSkill {
  /** Skill ID */
  id: string;
  /** Skill 名称 */
  name: "log-cleanup";
  /** Skill 描述 */
  description: string;
  /** Cron 表达式 */
  schedule: string;
  /** 配置 */
  config: LogCleanupConfig;
  /** 执行模式 */
  executionMode: "agent";
  /** 目标服务器 ID */
  targetServerId: string;
}

/**
 * 创建日志清理 Skill 定义
 *
 * @param serverId - 目标服务器 ID
 * @param config - 配置
 * @returns Skill 定义
 */
export function createLogCleanupSkill(
  serverId: string,
  config: LogCleanupConfig,
): LogCleanupSkill {
  return {
    id: `log-cleanup-${serverId}-${Date.now()}`,
    name: "log-cleanup",
    description: `清理 ${config.logPath} 中超过 ${config.retentionDays} 天的日志`,
    schedule: "0 3 * * *", // 每天凌晨 3 点执行
    config,
    executionMode: "agent",
    targetServerId: serverId,
  };
}

/**
 * 生成日志清理命令
 *
 * @param config - 配置
 * @returns 命令数组
 */
export function generateLogCleanupCommands(config: LogCleanupConfig): string[] {
  const commands: string[] = [];
  const pattern = config.pattern || "*.log*";

  // 统计清理前的情况
  commands.push(`echo "Before cleanup:"`);
  commands.push(`du -sh ${config.logPath} || echo "Path not found"`);
  commands.push(
    `find ${config.logPath} -name "${pattern}" -type f | wc -l | awk '{print "Total log files: "$1}'`,
  );

  if (config.compressOld && config.compressAfterDays) {
    // 压缩旧日志(超过 compressAfterDays 但未超过 retentionDays)
    commands.push(
      `find ${config.logPath} -name "${pattern}" -type f -mtime +${config.compressAfterDays} -mtime -${config.retentionDays} ! -name "*.gz" -exec gzip {} \\; -print | wc -l | awk '{print "Compressed: "$1" files"}'`,
    );
  }

  // 删除超过保留期的日志
  commands.push(
    `find ${config.logPath} -name "${pattern}" -type f -mtime +${config.retentionDays} -delete -print | wc -l | awk '{print "Deleted: "$1" files"}'`,
  );

  // 统计清理后的情况
  commands.push(`echo "After cleanup:"`);
  commands.push(`du -sh ${config.logPath} || echo "Path not found"`);
  commands.push(
    `find ${config.logPath} -name "${pattern}" -type f | wc -l | awk '{print "Remaining log files: "$1}'`,
  );

  return commands;
}

/**
 * 解析日志清理结果
 *
 * @param stdout - 命令输出
 * @returns 清理统计信息
 */
export function parseLogCleanupResult(stdout: string): {
  success: boolean;
  compressed: number;
  deleted: number;
  sizeBefore: string;
  sizeAfter: string;
} {
  const lines = stdout.trim().split("\n");

  const compressed =
    parseInt(
      lines.find((l) => l.includes("Compressed:"))?.match(/\d+/)?.[0] || "0",
      10,
    ) || 0;

  const deleted =
    parseInt(
      lines.find((l) => l.includes("Deleted:"))?.match(/\d+/)?.[0] || "0",
      10,
    ) || 0;

  const beforeIndex = lines.findIndex((l) => l.includes("Before cleanup:"));
  const sizeBefore =
    beforeIndex >= 0 ? lines[beforeIndex + 1]?.trim() || "N/A" : "N/A";

  const afterIndex = lines.findIndex((l) => l.includes("After cleanup:"));
  const sizeAfter =
    afterIndex >= 0 ? lines[afterIndex + 1]?.trim() || "N/A" : "N/A";

  return {
    success: true,
    compressed,
    deleted,
    sizeBefore,
    sizeAfter,
  };
}

/**
 * 完整的 Skill 定义(用于注册到 Server)
 */
export const LOG_CLEANUP_SKILL_TEMPLATE = {
  name: "log-cleanup",
  description: "日志清理 — 自动清理过期日志文件",
  defaultSchedule: "0 3 * * *", // 每天凌晨 3 点
  executionMode: "agent" as const,
  configSchema: {
    logPath: {
      type: "string",
      description: "日志目录路径",
    },
    retentionDays: {
      type: "number",
      default: 30,
      min: 1,
      max: 365,
      description: "保留最近 N 天的日志",
    },
    pattern: {
      type: "string",
      default: "*.log*",
      optional: true,
      description: "文件匹配模式(glob)",
    },
    compressOld: {
      type: "boolean",
      default: false,
      optional: true,
      description: "是否压缩旧日志",
    },
    compressAfterDays: {
      type: "number",
      default: 7,
      min: 1,
      optional: true,
      description: "压缩前保留天数",
    },
    webhookEnabled: {
      type: "boolean",
      default: true,
      description: "是否启用 Webhook 通知",
    },
  },
  generateCommands: generateLogCleanupCommands,
  parseResult: parseLogCleanupResult,
};
