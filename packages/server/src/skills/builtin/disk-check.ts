// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Disk Check Skill - 磁盘空间检查
 *
 * 定期检查磁盘使用情况,超过阈值时发送告警
 */

export interface DiskCheckConfig {
  /** 告警阈值(百分比,0-100) */
  threshold: number;
  /** 检查的挂载点(默认所有) */
  mountPoints?: string[];
  /** 是否启用 Webhook 通知 */
  webhookEnabled: boolean;
}

export interface DiskCheckSkill {
  /** Skill ID */
  id: string;
  /** Skill 名称 */
  name: "disk-check";
  /** Skill 描述 */
  description: string;
  /** Cron 表达式 */
  schedule: string;
  /** 配置 */
  config: DiskCheckConfig;
  /** 执行模式 */
  executionMode: "agent";
  /** 目标服务器 ID */
  targetServerId: string;
}

/**
 * 创建磁盘检查 Skill 定义
 *
 * @param serverId - 目标服务器 ID
 * @param config - 配置
 * @returns Skill 定义
 */
export function createDiskCheckSkill(
  serverId: string,
  config: DiskCheckConfig = { threshold: 80, webhookEnabled: true },
): DiskCheckSkill {
  return {
    id: `disk-check-${serverId}-${Date.now()}`,
    name: "disk-check",
    description: "磁盘空间检查 — 监控磁盘使用率并发送告警",
    schedule: "*/30 * * * *", // 每 30 分钟执行一次
    config,
    executionMode: "agent",
    targetServerId: serverId,
  };
}

/**
 * 生成磁盘检查命令
 *
 * @param config - 配置
 * @returns 命令数组
 */
export function generateDiskCheckCommands(config: DiskCheckConfig): string[] {
  const threshold = config.threshold;

  // 使用 df 命令检查磁盘使用率
  // 输出格式: Filesystem  Use%  MountedOn
  let dfCommand = "df -h";

  if (config.mountPoints && config.mountPoints.length > 0) {
    // 只检查指定的挂载点
    dfCommand += ` ${config.mountPoints.join(" ")}`;
  }

  // 使用 awk 过滤出使用率超过阈值的挂载点
  const checkCommand = `${dfCommand} | awk 'NR>1 {gsub("%","",$5); if ($5 >= ${threshold}) print "WARN: "$1" usage "$5"% on "$6}'`;

  return [checkCommand];
}

/**
 * 解析磁盘检查结果
 *
 * @param stdout - 命令输出
 * @returns 告警信息数组
 */
export function parseDiskCheckResult(stdout: string): string[] {
  if (!stdout || !stdout.trim()) {
    return []; // 没有超过阈值
  }

  return stdout
    .trim()
    .split("\n")
    .filter((line) => line.startsWith("WARN:"));
}

/**
 * 完整的 Skill 定义(用于注册到 Server)
 */
export const DISK_CHECK_SKILL_TEMPLATE = {
  name: "disk-check",
  description: "磁盘空间检查 — 监控磁盘使用率并发送告警",
  defaultSchedule: "*/30 * * * *",
  executionMode: "agent" as const,
  configSchema: {
    threshold: {
      type: "number",
      default: 80,
      min: 1,
      max: 100,
      description: "告警阈值(百分比)",
    },
    mountPoints: {
      type: "array",
      items: { type: "string" },
      optional: true,
      description: "要检查的挂载点(默认所有)",
    },
    webhookEnabled: {
      type: "boolean",
      default: true,
      description: "是否启用 Webhook 通知",
    },
  },
  generateCommands: generateDiskCheckCommands,
  parseResult: parseDiskCheckResult,
};
