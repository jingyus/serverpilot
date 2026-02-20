// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Backup Skill - 数据备份
 *
 * 自动备份指定目录/数据库,支持压缩和清理旧备份
 */

export interface BackupConfig {
  /** 备份源路径 */
  sourcePath: string;
  /** 备份目标目录 */
  backupDir: string;
  /** 保留最近 N 个备份 */
  keepCount: number;
  /** 是否压缩 */
  compress: boolean;
  /** 数据库类型(可选) */
  dbType?: "mysql" | "postgresql" | "mongodb";
  /** 数据库名称(数据库备份时必需) */
  dbName?: string;
  /** 是否启用 Webhook 通知 */
  webhookEnabled: boolean;
}

export interface BackupSkill {
  /** Skill ID */
  id: string;
  /** Skill 名称 */
  name: "backup";
  /** Skill 描述 */
  description: string;
  /** Cron 表达式 */
  schedule: string;
  /** 配置 */
  config: BackupConfig;
  /** 执行模式 */
  executionMode: "agent";
  /** 目标服务器 ID */
  targetServerId: string;
}

/**
 * 创建备份 Skill 定义
 *
 * @param serverId - 目标服务器 ID
 * @param config - 配置
 * @returns Skill 定义
 */
export function createBackupSkill(
  serverId: string,
  config: BackupConfig,
): BackupSkill {
  return {
    id: `backup-${serverId}-${Date.now()}`,
    name: "backup",
    description: `备份 ${config.sourcePath} 到 ${config.backupDir}`,
    schedule: "0 2 * * *", // 每天凌晨 2 点执行
    config,
    executionMode: "agent",
    targetServerId: serverId,
  };
}

/**
 * 生成备份命令
 *
 * @param config - 配置
 * @returns 命令数组
 */
export function generateBackupCommands(config: BackupConfig): string[] {
  const timestamp = "$(date +%Y%m%d_%H%M%S)";
  const commands: string[] = [];

  // 确保备份目录存在
  commands.push(`mkdir -p ${config.backupDir}`);

  if (config.dbType && config.dbName) {
    // 数据库备份
    const backupFile = `${config.backupDir}/${config.dbName}_${timestamp}.sql`;

    switch (config.dbType) {
      case "mysql":
        commands.push(
          `mysqldump ${config.dbName} > ${backupFile}${config.compress ? " && gzip " + backupFile : ""}`,
        );
        break;
      case "postgresql":
        commands.push(
          `pg_dump ${config.dbName} > ${backupFile}${config.compress ? " && gzip " + backupFile : ""}`,
        );
        break;
      case "mongodb":
        commands.push(
          `mongodump --db ${config.dbName} --out ${config.backupDir}/mongo_${timestamp}${config.compress ? " && tar -czf " + config.backupDir + "/mongo_" + timestamp + ".tar.gz -C " + config.backupDir + " mongo_" + timestamp + " && rm -rf " + config.backupDir + "/mongo_" + timestamp : ""}`,
        );
        break;
    }
  } else {
    // 文件/目录备份
    const backupFile = `${config.backupDir}/backup_${timestamp}.tar${config.compress ? ".gz" : ""}`;
    const tarFlags = config.compress ? "czf" : "cf";
    commands.push(
      `tar -${tarFlags} ${backupFile} -C $(dirname ${config.sourcePath}) $(basename ${config.sourcePath})`,
    );
  }

  // 清理旧备份
  if (config.keepCount > 0) {
    const extension = config.compress ? "*.gz" : "*";
    commands.push(
      `cd ${config.backupDir} && ls -t ${extension} | tail -n +${config.keepCount + 1} | xargs -r rm -f`,
    );
  }

  // 输出备份结果
  commands.push(`echo "Backup completed: ${config.backupDir}"`);
  commands.push(`ls -lh ${config.backupDir} | tail -n 5`);

  return commands;
}

/**
 * 解析备份结果
 *
 * @param stdout - 命令输出
 * @returns 备份信息
 */
export function parseBackupResult(stdout: string): {
  success: boolean;
  backupFiles: string[];
  message: string;
} {
  const lines = stdout.trim().split("\n");
  const completedLine = lines.find((l) => l.includes("Backup completed:"));

  if (!completedLine) {
    return {
      success: false,
      backupFiles: [],
      message: "Backup did not complete successfully",
    };
  }

  // 提取备份文件列表(最后 5 行 ls 输出)
  const lsOutput = lines.slice(-5);
  const backupFiles = lsOutput
    .filter((l) => l.match(/^-/)) // 只保留文件行(以 - 开头)
    .map((l) => l.split(/\s+/).pop() || "");

  return {
    success: true,
    backupFiles,
    message: completedLine,
  };
}

/**
 * 完整的 Skill 定义(用于注册到 Server)
 */
export const BACKUP_SKILL_TEMPLATE = {
  name: "backup",
  description: "数据备份 — 自动备份文件或数据库",
  defaultSchedule: "0 2 * * *", // 每天凌晨 2 点
  executionMode: "agent" as const,
  configSchema: {
    sourcePath: {
      type: "string",
      description: "备份源路径(文件/目录)",
    },
    backupDir: {
      type: "string",
      description: "备份目标目录",
    },
    keepCount: {
      type: "number",
      default: 7,
      min: 1,
      max: 30,
      description: "保留最近 N 个备份",
    },
    compress: {
      type: "boolean",
      default: true,
      description: "是否压缩备份文件",
    },
    dbType: {
      type: "string",
      enum: ["mysql", "postgresql", "mongodb"],
      optional: true,
      description: "数据库类型(可选)",
    },
    dbName: {
      type: "string",
      optional: true,
      description: "数据库名称",
    },
    webhookEnabled: {
      type: "boolean",
      default: true,
      description: "是否启用 Webhook 通知",
    },
  },
  generateCommands: generateBackupCommands,
  parseResult: parseBackupResult,
};
