// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * AI 日志巡检 Skill — 收集日志 → AI 分析 → 结构化报告 → 存储 → high/critical 告警。
 *
 * 供 Cloud 模式 /scan-logs 与定时巡检使用。
 *
 * @module cloud/skills/log-scanner
 */

import type { PlanId } from '../ai/types.js';
import { getCloudAIProvider } from '../ai/cloud-provider.js';
import { getSkillExecutionRepository } from './skill-execution-repository.js';

// ---------------------------------------------------------------------------
// Types（与开发指南一致）
// ---------------------------------------------------------------------------

/** 问题分类 */
export type ScanIssueCategory = 'performance' | 'security' | 'config' | 'capacity';

/** 严重程度 */
export type ScanIssueSeverity = 'low' | 'medium' | 'high' | 'critical';

/** 单条问题 */
export interface ScanIssue {
  category: ScanIssueCategory;
  severity: ScanIssueSeverity;
  summary: string;
  evidence: string[];
  impact: string;
  recommendation: string;
}

/** 扫描报告 */
export interface ScanReport {
  issues: ScanIssue[];
  trends: string[];
  healthScore: number;
}

/** 拉取近期日志的选项 */
export interface FetchRecentLogsOptions {
  sources?: string[];
  since?: string;
  maxLines?: number;
}

/** 日志拉取函数：在目标机器上执行命令获取日志内容 */
export type LogFetcher = (
  serverId: string,
  options: FetchRecentLogsOptions,
) => Promise<string>;

/** scanLogs 的调用上下文（认证与配额） */
export interface ScanLogsContext {
  userId: string;
  tenantId: string;
  userPlan: PlanId;
  /** 可选：自定义日志拉取；不传则使用默认（未配置时返回占位内容） */
  logFetcher?: LogFetcher;
}

// ---------------------------------------------------------------------------
// 默认日志拉取（可由上层注入）
// ---------------------------------------------------------------------------

let defaultLogFetcher: LogFetcher | null = null;

export function setLogFetcher(fetcher: LogFetcher | null): void {
  defaultLogFetcher = fetcher;
}

export function getLogFetcher(): LogFetcher | null {
  return defaultLogFetcher;
}

/** 默认选项 */
const DEFAULT_FETCH_OPTIONS: FetchRecentLogsOptions = {
  sources: ['/var/log/syslog', '/var/log/nginx/error.log', '/var/log/mysql/error.log'],
  since: '1 hour ago',
  maxLines: 5000,
};

// ---------------------------------------------------------------------------
// AI 分析用系统提示
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `你是一名资深 DevOps 工程师，擅长分析服务器日志。

任务：分析以下日志，识别潜在问题并给出修复建议。

分类标准：
1. **性能瓶颈(performance)**：慢查询、高 CPU、内存泄漏
2. **安全威胁(security)**：登录失败、可疑请求、权限异常
3. **配置错误(config)**：服务启动失败、依赖缺失、端口冲突
4. **容量问题(capacity)**：磁盘满、连接池耗尽、队列积压

输出格式（仅返回合法 JSON，无 markdown 包裹）：
{
  "issues": [
    {
      "category": "performance|security|config|capacity",
      "severity": "low|medium|high|critical",
      "summary": "一句话问题描述",
      "evidence": ["日志片段1", "日志片段2"],
      "impact": "对系统的影响",
      "recommendation": "修复建议（具体步骤）"
    }
  ],
  "trends": ["长期趋势观察"],
  "healthScore": 0-100
}`;

// ---------------------------------------------------------------------------
// 解析 AI 返回为 ScanReport（带兜底）
// ---------------------------------------------------------------------------

function parseReport(content: string): ScanReport {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    const raw = JSON.parse(trimmed) as unknown;
    if (raw && typeof raw === 'object' && Array.isArray((raw as ScanReport).issues)) {
      const r = raw as ScanReport;
      return {
        issues: Array.isArray(r.issues) ? r.issues : [],
        trends: Array.isArray(r.trends) ? r.trends : [],
        healthScore: typeof r.healthScore === 'number' ? Math.max(0, Math.min(100, r.healthScore)) : 0,
      };
    }
  } catch {
    // ignore
  }
  return { issues: [], trends: [], healthScore: 0 };
}

// ---------------------------------------------------------------------------
// 告警（先日志，后续可接邮件）
// ---------------------------------------------------------------------------

function triggerAlert(serverId: string, report: ScanReport): void {
  const critical = report.issues.filter(
    (i) => i.severity === 'high' || i.severity === 'critical',
  );
  if (critical.length === 0) return;
  // 先打日志；后续可接 SMTP / webhook
  console.warn(
    `[log-scanner] server=${serverId} high/critical issues=${critical.length} healthScore=${report.healthScore}`,
    critical.map((i) => ({ severity: i.severity, summary: i.summary })),
  );
}

// ---------------------------------------------------------------------------
// scanLogs
// ---------------------------------------------------------------------------

/**
 * 执行一次日志巡检：拉取日志 → AI 分析 → 写 skill_executions → high/critical 告警。
 *
 * @param serverId 目标服务器 ID
 * @param context 用户/租户/计划及可选的 logFetcher
 * @returns 解析后的 ScanReport
 */
export async function scanLogs(
  serverId: string,
  context: ScanLogsContext,
): Promise<ScanReport> {
  const start = Date.now();
  const repo = getSkillExecutionRepository();
  const fetcher = context.logFetcher ?? defaultLogFetcher ?? (async () => 'No log content (log fetcher not configured).');
  const logs = await fetcher(serverId, DEFAULT_FETCH_OPTIONS);

  try {
    const provider = getCloudAIProvider();
    const response = await provider.chat(
      {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: logs },
        ],
      },
      {
        userId: context.userId,
        tenantId: context.tenantId,
        userPlan: context.userPlan,
        conversationLength: 1,
        riskLevel: 'red',
      },
    );

    const report = parseReport(response.content);
    const duration = Date.now() - start;

    await repo.create({
      userId: context.userId,
      tenantId: context.tenantId,
      serverId,
      skillName: 'log-scanner',
      status: 'success',
      report: report as unknown as Record<string, unknown>,
      duration,
    });

    if (report.issues.some((i) => i.severity === 'high' || i.severity === 'critical')) {
      triggerAlert(serverId, report);
    }

    return report;
  } catch (err) {
    const duration = Date.now() - start;
    const fallback: ScanReport = { issues: [], trends: [], healthScore: 0 };
    await repo.create({
      userId: context.userId,
      tenantId: context.tenantId,
      serverId,
      skillName: 'log-scanner',
      status: 'failed',
      report: { error: String(err) },
      duration,
    }).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 定时巡检（与现有 cron/任务系统对接：由调用方按小时调用 runScheduledScans）
// ---------------------------------------------------------------------------

const autoScanServerIds = new Set<string>();

/**
 * 为指定服务器启用自动巡检；实际执行需由上层 cron 调用 runScheduledScans。
 */
export function enableAutoScan(serverId: string): void {
  autoScanServerIds.add(serverId);
}

/**
 * 取消自动巡检。
 */
export function disableAutoScan(serverId: string): void {
  autoScanServerIds.delete(serverId);
}

/**
 * 返回当前启用自动巡检的服务器 ID 列表（供 cron 使用）。
 */
export function getAutoScanServerIds(): string[] {
  return Array.from(autoScanServerIds);
}

/**
 * 对当前所有启用自动巡检的服务器执行一次 scanLogs。
 * 由上层定时任务（如每小时）调用；context 需包含每个 server 对应的 userId/tenantId/userPlan（此处简化：单 context 用于全部，实际可按 server 解析）。
 */
export async function runScheduledScans(
  contextPerServer: (serverId: string) => ScanLogsContext,
): Promise<void> {
  for (const serverId of autoScanServerIds) {
    try {
      await scanLogs(serverId, contextPerServer(serverId));
    } catch (e) {
      console.warn(`[log-scanner] scheduled scan failed server=${serverId}`, e);
    }
  }
}
