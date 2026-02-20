// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * AI 安全扫描 Skill — 收集安全相关数据 → Opus 分析 → 漏洞/配置/异常报告；
 * Enterprise 可做合规检查。
 *
 * @module cloud/skills/security-scanner
 */

import type { PlanId } from '../ai/types.js';
import { getCloudAIProvider } from '../ai/cloud-provider.js';
import { getSkillExecutionRepository } from './skill-execution-repository.js';

// ---------------------------------------------------------------------------
// Types（与开发指南一致）
// ---------------------------------------------------------------------------

export interface Vulnerability {
  cve: string;
  package: string;
  currentVersion: string;
  fixedVersion: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  exploit?: string;
}

export interface Misconfiguration {
  type: 'ssh' | 'firewall' | 'service';
  issue: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  remediation: string;
}

export interface Anomaly {
  type: 'login' | 'process' | 'network';
  evidence: string;
  risk: string;
}

export interface AuditReport {
  vulnerabilities: Vulnerability[];
  misconfigurations: Misconfiguration[];
  anomalies: Anomaly[];
  autoFixScript?: string;
  /** Enterprise 专属：合规检查结果 */
  compliance?: ComplianceResult[];
}

export interface ComplianceResult {
  standard: string;
  passed: boolean;
  findings: string[];
}

/** 在目标机器执行单条命令 */
export type CommandRunner = (serverId: string, command: string) => Promise<string>;

/** securityAudit 的调用上下文 */
export interface SecurityAuditContext {
  userId: string;
  tenantId: string;
  userPlan: PlanId;
  /** 在目标服务器执行命令的 runner；不传则使用默认（未配置时返回占位） */
  commandRunner?: CommandRunner;
  /** 是否为 Enterprise（启用合规检查） */
  enterprise?: boolean;
}

/** 默认执行的安全相关命令 */
const DEFAULT_SECURITY_COMMANDS = [
  'apt list --installed 2>/dev/null || true',
  'dpkg -l 2>/dev/null | grep -i security || true',
  'cat /etc/ssh/sshd_config 2>/dev/null || true',
  'iptables -L -n 2>/dev/null || true',
  'last -n 100 2>/dev/null || true',
  'ps aux 2>/dev/null || true',
  'ss -tuln 2>/dev/null || netstat -tuln 2>/dev/null || true',
];

// ---------------------------------------------------------------------------
// 默认 CommandRunner（可由上层注入）
// ---------------------------------------------------------------------------

let defaultCommandRunner: CommandRunner | null = null;

export function setCommandRunner(runner: CommandRunner | null): void {
  defaultCommandRunner = runner;
}

export function getCommandRunner(): CommandRunner | null {
  return defaultCommandRunner;
}

// ---------------------------------------------------------------------------
// AI 系统提示
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `你是一名资深安全工程师，擅长 Linux 服务器加固。

任务：安全审计，检测以下威胁：

1. **已知漏洞**：
   - 对比 NVD 数据库，检查已安装包的 CVE
   - 识别过期软件版本

2. **配置风险**：
   - SSH: PermitRootLogin, PasswordAuthentication, 弱加密算法
   - 防火墙：过度暴露端口、默认 ACCEPT 策略
   - 进程：不必要的服务、root 权限滥用

3. **异常行为**：
   - 异常登录（时间、地点、失败次数）
   - 可疑进程（未知二进制、高 CPU）
   - 异常网络连接（未授权端口）

输出格式（仅返回合法 JSON，无 markdown 包裹）：
{
  "vulnerabilities": [
    {
      "cve": "CVE-2024-1234",
      "package": "openssl",
      "currentVersion": "1.1.1f",
      "fixedVersion": "1.1.1g",
      "severity": "high",
      "exploit": "远程代码执行"
    }
  ],
  "misconfigurations": [
    {
      "type": "ssh|firewall|service",
      "issue": "问题描述",
      "severity": "low|medium|high|critical",
      "remediation": "修复步骤"
    }
  ],
  "anomalies": [
    {
      "type": "login|process|network",
      "evidence": "日志片段",
      "risk": "风险评估"
    }
  ],
  "autoFixScript": "#!/bin/bash\\n自动加固脚本"
}`;

// ---------------------------------------------------------------------------
// 解析 AI 返回为 AuditReport
// ---------------------------------------------------------------------------

function parseAuditReport(content: string): AuditReport {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    const raw = JSON.parse(trimmed) as unknown;
    if (raw && typeof raw === 'object') {
      const r = raw as Record<string, unknown>;
      return {
        vulnerabilities: Array.isArray(r.vulnerabilities) ? r.vulnerabilities : [],
        misconfigurations: Array.isArray(r.misconfigurations) ? r.misconfigurations : [],
        anomalies: Array.isArray(r.anomalies) ? r.anomalies : [],
        autoFixScript: typeof r.autoFixScript === 'string' ? r.autoFixScript : undefined,
      };
    }
  } catch {
    // ignore
  }
  return { vulnerabilities: [], misconfigurations: [], anomalies: [] };
}

// ---------------------------------------------------------------------------
// Enterprise 合规检查（占位 / 简单规则）
// ---------------------------------------------------------------------------

const COMPLIANCE_STANDARDS = ['PCI-DSS', 'SOC2', 'ISO27001', 'GDPR'] as const;

function checkCompliance(
  report: AuditReport,
  standards: readonly string[],
): ComplianceResult[] {
  const results: ComplianceResult[] = [];
  for (const standard of standards) {
    const findings: string[] = [];
    if (report.vulnerabilities.some((v) => v.severity === 'critical' || v.severity === 'high')) {
      findings.push('存在高/严重漏洞，需尽快修复');
    }
    const sshMis = report.misconfigurations.filter((m) => m.type === 'ssh' && (m.issue.includes('PermitRootLogin') || m.issue.includes('PasswordAuthentication')));
    if (sshMis.length > 0) {
      findings.push(`SSH 配置风险: ${sshMis.map((m) => m.issue).join('; ')}`);
    }
    const passed = findings.length === 0;
    results.push({ standard, passed, findings });
  }
  return results;
}

// ---------------------------------------------------------------------------
// securityAudit
// ---------------------------------------------------------------------------

/**
 * 执行一次安全审计：并行收集安全数据 → Opus 分析 → 写 skill_executions；
 * Enterprise 时附加合规检查。
 */
export async function securityAudit(
  serverId: string,
  context: SecurityAuditContext,
): Promise<AuditReport> {
  const start = Date.now();
  const repo = getSkillExecutionRepository();
  const runner = context.commandRunner ?? defaultCommandRunner ?? (async () => 'Command runner not configured.');

  const securityData = await Promise.all(
    DEFAULT_SECURITY_COMMANDS.map((cmd) => runner(serverId, cmd)),
  );
  const userMessage = JSON.stringify(
    DEFAULT_SECURITY_COMMANDS.map((cmd, i) => ({ command: cmd, output: securityData[i] })),
  );

  try {
    const provider = getCloudAIProvider();
    const response = await provider.chat(
      {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
      },
      {
        userId: context.userId,
        tenantId: context.tenantId,
        userPlan: context.userPlan,
        conversationLength: 1,
        forceOpus: true,
      },
    );

    const report = parseAuditReport(response.content);
    const duration = Date.now() - start;

    if (context.enterprise) {
      report.compliance = checkCompliance(report, COMPLIANCE_STANDARDS);
    }

    await repo.create({
      userId: context.userId,
      tenantId: context.tenantId,
      serverId,
      skillName: 'security-audit',
      status: 'success',
      report: report as unknown as Record<string, unknown>,
      duration,
    });

    return report;
  } catch (err) {
    const duration = Date.now() - start;
    await repo
      .create({
        userId: context.userId,
        tenantId: context.tenantId,
        serverId,
        skillName: 'security-audit',
        status: 'failed',
        report: { error: String(err) },
        duration,
      })
      .catch(() => {});
    throw err;
  }
}
