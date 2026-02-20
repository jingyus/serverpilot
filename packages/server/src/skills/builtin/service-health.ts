// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Service Health Skill - 服务健康检查
 *
 * 定期检查关键服务状态，自动重启异常服务
 */

export interface ServiceHealthConfig {
  /** 要监控的服务列表 */
  services: string[];
  /** 是否自动重启失败的服务 */
  autoRestart: boolean;
  /** 重启失败后是否发送告警 */
  alertOnRestartFailure: boolean;
  /** 是否启用 Webhook 通知 */
  webhookEnabled: boolean;
}

export interface ServiceHealthSkill {
  /** Skill ID */
  id: string;
  /** Skill 名称 */
  name: "service-health";
  /** Skill 描述 */
  description: string;
  /** Cron 表达式 */
  schedule: string;
  /** 配置 */
  config: ServiceHealthConfig;
  /** 执行模式 */
  executionMode: "agent";
  /** 目标服务器 ID */
  targetServerId: string;
}

/**
 * 创建服务健康检查 Skill 定义
 *
 * @param serverId - 目标服务器 ID
 * @param config - 配置
 * @returns Skill 定义
 */
export function createServiceHealthSkill(
  serverId: string,
  config: ServiceHealthConfig,
): ServiceHealthSkill {
  return {
    id: `service-health-${serverId}-${Date.now()}`,
    name: "service-health",
    description: `监控 ${config.services.join(", ")} 服务状态`,
    schedule: "*/5 * * * *", // 每 5 分钟执行一次
    config,
    executionMode: "agent",
    targetServerId: serverId,
  };
}

/**
 * 生成服务健康检查命令
 *
 * @param config - 配置
 * @returns 命令数组
 */
export function generateServiceHealthCommands(
  config: ServiceHealthConfig,
): string[] {
  const commands: string[] = [];

  for (const service of config.services) {
    if (config.autoRestart) {
      // 检查 + 自动重启模式
      const restartCommand = `
if systemctl is-active --quiet ${service}; then \\
  echo "OK: ${service} is running"; \\
else \\
  echo "WARN: ${service} is not running, attempting restart..."; \\
  if systemctl restart ${service}; then \\
    echo "OK: ${service} restarted successfully"; \\
  else \\
    echo "ERROR: Failed to restart ${service}"; \\
  fi; \\
fi
      `.trim();
      commands.push(restartCommand);
    } else {
      // 仅检查模式
      const checkCommand = `
if systemctl is-active --quiet ${service}; then \\
  echo "OK: ${service} is running"; \\
else \\
  echo "WARN: ${service} is not running"; \\
fi
      `.trim();
      commands.push(checkCommand);
    }
  }

  // 汇总健康状态
  commands.push(
    `echo "Health check completed for ${config.services.length} services"`,
  );

  return commands;
}

/**
 * 解析服务健康检查结果
 *
 * @param stdout - 命令输出
 * @returns 服务健康状态
 */
export function parseServiceHealthResult(stdout: string): {
  success: boolean;
  services: Array<{
    name: string;
    status: "running" | "stopped" | "restarted" | "restart_failed";
    message: string;
  }>;
  summary: {
    total: number;
    running: number;
    stopped: number;
    restarted: number;
    failed: number;
  };
} {
  const lines = stdout.trim().split("\n");
  const services: Array<{
    name: string;
    status: "running" | "stopped" | "restarted" | "restart_failed";
    message: string;
  }> = [];

  for (const line of lines) {
    // 正常运行
    const runningMatch = line.match(/OK: (.+) is running/);
    if (runningMatch) {
      services.push({
        name: runningMatch[1],
        status: "running",
        message: line,
      });
      continue;
    }

    // 服务停止
    const stoppedMatch = line.match(
      /WARN: (.+) is not running(?:, attempting restart)?/,
    );
    if (stoppedMatch) {
      services.push({
        name: stoppedMatch[1],
        status: "stopped",
        message: line,
      });
      continue;
    }

    // 重启成功
    const restartedMatch = line.match(/OK: (.+) restarted successfully/);
    if (restartedMatch) {
      // 更新之前的 stopped 状态为 restarted
      const existing = services.find((s) => s.name === restartedMatch[1]);
      if (existing) {
        existing.status = "restarted";
        existing.message = line;
      }
      continue;
    }

    // 重启失败
    const failedMatch = line.match(/ERROR: Failed to restart (.+)/);
    if (failedMatch) {
      const existing = services.find((s) => s.name === failedMatch[1]);
      if (existing) {
        existing.status = "restart_failed";
        existing.message = line;
      }
    }
  }

  const summary = {
    total: services.length,
    running: services.filter((s) => s.status === "running").length,
    stopped: services.filter((s) => s.status === "stopped").length,
    restarted: services.filter((s) => s.status === "restarted").length,
    failed: services.filter((s) => s.status === "restart_failed").length,
  };

  // 如果有服务停止或重启失败，则标记为不成功
  const success = summary.stopped === 0 && summary.failed === 0;

  return {
    success,
    services,
    summary,
  };
}

/**
 * 完整的 Skill 定义(用于注册到 Server)
 */
export const SERVICE_HEALTH_SKILL_TEMPLATE = {
  name: "service-health",
  description: "服务健康检查 — 监控关键服务状态并自动重启",
  defaultSchedule: "*/5 * * * *", // 每 5 分钟
  executionMode: "agent" as const,
  configSchema: {
    services: {
      type: "array",
      items: { type: "string" },
      description: "要监控的服务列表（如 nginx, mysql）",
    },
    autoRestart: {
      type: "boolean",
      default: true,
      description: "是否自动重启失败的服务",
    },
    alertOnRestartFailure: {
      type: "boolean",
      default: true,
      description: "重启失败后是否发送告警",
    },
    webhookEnabled: {
      type: "boolean",
      default: true,
      description: "是否启用 Webhook 通知",
    },
  },
  generateCommands: generateServiceHealthCommands,
  parseResult: parseServiceHealthResult,
};
