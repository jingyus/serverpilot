// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * SSL Check Skill - SSL 证书检查
 *
 * 定期检查 SSL 证书有效期，临近过期时发送告警
 */

export interface SSLCheckConfig {
  /** 要检查的域名列表 */
  domains: string[];
  /** 提前告警天数 */
  daysBeforeExpiry: number;
  /** 是否启用 Webhook 通知 */
  webhookEnabled: boolean;
}

export interface SSLCheckSkill {
  /** Skill ID */
  id: string;
  /** Skill 名称 */
  name: "ssl-check";
  /** Skill 描述 */
  description: string;
  /** Cron 表达式 */
  schedule: string;
  /** 配置 */
  config: SSLCheckConfig;
  /** 执行模式 */
  executionMode: "agent";
  /** 目标服务器 ID */
  targetServerId: string;
}

/**
 * 创建 SSL 检查 Skill 定义
 *
 * @param serverId - 目标服务器 ID
 * @param config - 配置
 * @returns Skill 定义
 */
export function createSSLCheckSkill(
  serverId: string,
  config: SSLCheckConfig,
): SSLCheckSkill {
  return {
    id: `ssl-check-${serverId}-${Date.now()}`,
    name: "ssl-check",
    description: `检查 ${config.domains.join(", ")} 的 SSL 证书有效期`,
    schedule: "0 0 * * *", // 每天 0 点执行
    config,
    executionMode: "agent",
    targetServerId: serverId,
  };
}

/**
 * 生成 SSL 检查命令
 *
 * @param config - 配置
 * @returns 命令数组
 */
export function generateSSLCheckCommands(config: SSLCheckConfig): string[] {
  const commands: string[] = [];
  const threshold = config.daysBeforeExpiry;

  // 为每个域名生成检查命令
  for (const domain of config.domains) {
    // 获取证书过期时间
    const checkCommand = `
echo "Checking SSL for ${domain}..." && \\
expiry_date=$(echo | openssl s_client -servername ${domain} -connect ${domain}:443 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2) && \\
if [ -z "$expiry_date" ]; then \\
  echo "ERROR: Failed to retrieve SSL certificate for ${domain}"; \\
else \\
  expiry_epoch=$(date -d "$expiry_date" +%s 2>/dev/null || date -j -f "%b %d %H:%M:%S %Y %Z" "$expiry_date" +%s 2>/dev/null) && \\
  current_epoch=$(date +%s) && \\
  days_until_expiry=$(( ($expiry_epoch - $current_epoch) / 86400 )) && \\
  if [ $days_until_expiry -lt ${threshold} ]; then \\
    echo "WARN: ${domain} SSL certificate expires in $days_until_expiry days (on $expiry_date)"; \\
  else \\
    echo "OK: ${domain} SSL certificate is valid for $days_until_expiry days (expires on $expiry_date)"; \\
  fi; \\
fi
    `.trim();

    commands.push(checkCommand);
  }

  return commands;
}

/**
 * 解析 SSL 检查结果
 *
 * @param stdout - 命令输出
 * @returns SSL 证书状态
 */
export function parseSSLCheckResult(stdout: string): {
  success: boolean;
  certificates: Array<{
    domain: string;
    status: "ok" | "warning" | "error";
    daysUntilExpiry?: number;
    expiryDate?: string;
    message: string;
  }>;
} {
  const lines = stdout.trim().split("\n");
  const certificates: Array<{
    domain: string;
    status: "ok" | "warning" | "error";
    daysUntilExpiry?: number;
    expiryDate?: string;
    message: string;
  }> = [];

  let currentDomain = "";

  for (const line of lines) {
    // 检测域名开始
    const checkingMatch = line.match(/Checking SSL for (.+)\.\.\./);
    if (checkingMatch) {
      currentDomain = checkingMatch[1];
      continue;
    }

    // 错误情况
    if (line.startsWith("ERROR:")) {
      certificates.push({
        domain: currentDomain,
        status: "error",
        message: line.replace("ERROR: ", ""),
      });
    }

    // 警告情况（即将过期）
    const warnMatch = line.match(
      /WARN: (.+) SSL certificate expires in (\d+) days \(on (.+)\)/,
    );
    if (warnMatch) {
      certificates.push({
        domain: warnMatch[1],
        status: "warning",
        daysUntilExpiry: parseInt(warnMatch[2], 10),
        expiryDate: warnMatch[3],
        message: line.replace("WARN: ", ""),
      });
    }

    // 正常情况
    const okMatch = line.match(
      /OK: (.+) SSL certificate is valid for (\d+) days \(expires on (.+)\)/,
    );
    if (okMatch) {
      certificates.push({
        domain: okMatch[1],
        status: "ok",
        daysUntilExpiry: parseInt(okMatch[2], 10),
        expiryDate: okMatch[3],
        message: line.replace("OK: ", ""),
      });
    }
  }

  const hasWarnings = certificates.some(
    (c) => c.status === "warning" || c.status === "error",
  );

  return {
    success: !hasWarnings,
    certificates,
  };
}

/**
 * 完整的 Skill 定义(用于注册到 Server)
 */
export const SSL_CHECK_SKILL_TEMPLATE = {
  name: "ssl-check",
  description: "SSL 证书检查 — 监控证书有效期并发送到期告警",
  defaultSchedule: "0 0 * * *", // 每天 0 点
  executionMode: "agent" as const,
  configSchema: {
    domains: {
      type: "array",
      items: { type: "string" },
      description: "要检查的域名列表",
    },
    daysBeforeExpiry: {
      type: "number",
      default: 30,
      min: 1,
      max: 90,
      description: "提前告警天数",
    },
    webhookEnabled: {
      type: "boolean",
      default: true,
      description: "是否启用 Webhook 通知",
    },
  },
  generateCommands: generateSSLCheckCommands,
  parseResult: parseSSLCheckResult,
};
