// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Chat AI ↔ Skill Integration
 *
 * 提供 AI 对话系统调用 Skill 的工具接口
 */

import { getTaskRepository } from "../db/repositories/task-repository.js";
import { getSkillRegistry } from "./skill-registry.js";
import {
  createTaskFromSkill,
  parseSkillFromDescription,
} from "./skill-task-converter.js";

/**
 * AI Tool: 列出可用的 Skill 模板
 *
 * 用于 AI 向用户推荐合适的 Skill
 *
 * @returns Skill 模板列表
 */
export function listSkillTemplatesForAI() {
  const registry = getSkillRegistry();
  const templates = registry.list();

  return templates.map((t) => ({
    name: t.name,
    description: t.description,
    defaultSchedule: t.defaultSchedule,
    configFields: Object.entries(t.configSchema).map(([key, field]) => ({
      name: key,
      type: field.type,
      description: field.description,
      required: !field.optional,
      default: field.default,
    })),
  }));
}

/**
 * AI Tool: 获取 Skill 模板详情和配置说明
 *
 * @param skillName - Skill 名称
 * @returns Skill 详情
 */
export function getSkillTemplateForAI(skillName: string) {
  const registry = getSkillRegistry();
  const template = registry.get(skillName);

  if (!template) {
    return { error: `Skill '${skillName}' not found` };
  }

  return {
    name: template.name,
    description: template.description,
    defaultSchedule: template.defaultSchedule,
    executionMode: template.executionMode,
    configSchema: template.configSchema,
    exampleConfig: generateExampleConfig(template.configSchema),
  };
}

/**
 * 为 AI 生成示例配置
 */
function generateExampleConfig(
  schema: Record<
    string,
    {
      type: string;
      default?: unknown;
      enum?: unknown[];
      min?: number;
      optional?: boolean;
    }
  >,
): Record<string, unknown> {
  const example: Record<string, unknown> = {};

  for (const [key, field] of Object.entries(schema)) {
    if (field.default !== undefined) {
      example[key] = field.default;
    } else if (field.type === "string") {
      example[key] = field.enum ? field.enum[0] : `<${key}>`;
    } else if (field.type === "number") {
      example[key] = field.min ?? 1;
    } else if (field.type === "boolean") {
      example[key] = true;
    } else if (field.type === "array") {
      example[key] = [];
    }
  }

  return example;
}

/**
 * AI Tool: 验证 Skill 配置
 *
 * 用于 AI 在创建任务前验证用户提供的配置
 *
 * @param skillName - Skill 名称
 * @param config - 配置对象
 * @returns 验证结果
 */
export function validateSkillConfigForAI(
  skillName: string,
  config: Record<string, unknown>,
) {
  const registry = getSkillRegistry();

  if (!registry.has(skillName)) {
    return {
      valid: false,
      errors: [`Skill '${skillName}' not found`],
    };
  }

  const validation = registry.validateConfig(skillName, config);

  if (validation.valid) {
    const fullConfig = registry.fillDefaults(skillName, config);
    return {
      valid: true,
      config: fullConfig,
      preview: describeSkillTask(skillName, fullConfig),
    };
  }

  return {
    valid: false,
    errors: validation.errors,
    hint: suggestMissingFields(skillName, config),
  };
}

/**
 * 为 AI 描述 Skill 任务的功能
 */
function describeSkillTask(
  skillName: string,
  config: Record<string, unknown>,
): string {
  switch (skillName) {
    case "disk-check":
      return `每 30 分钟检查一次磁盘使用率，当超过 ${config.threshold}% 时发送告警`;
    case "backup":
      return `每天凌晨 2 点备份 ${config.sourcePath} 到 ${config.backupDir}，保留最近 ${config.keepCount} 个备份`;
    case "log-cleanup":
      return `每天凌晨 3 点清理 ${config.logPath} 中超过 ${config.retentionDays} 天的日志`;
    case "ssl-check":
      return `每天检查 ${(config.domains as string[]).join(", ")} 的 SSL 证书，提前 ${config.daysBeforeExpiry} 天告警`;
    case "service-health":
      return `每 5 分钟检查 ${(config.services as string[]).join(", ")} 服务状态${config.autoRestart ? "，自动重启异常服务" : ""}`;
    default:
      return `定时执行 ${skillName} 任务`;
  }
}

/**
 * 建议缺失的配置字段
 */
function suggestMissingFields(
  skillName: string,
  config: Record<string, unknown>,
): string {
  const registry = getSkillRegistry();
  const template = registry.get(skillName);

  if (!template) return "";

  const missing: string[] = [];

  for (const [key, field] of Object.entries(template.configSchema)) {
    if (!field.optional && !(key in config)) {
      missing.push(`${key} (${field.description})`);
    }
  }

  if (missing.length === 0) return "";

  return `缺少以下必填字段:\n${missing.map((m) => `- ${m}`).join("\n")}`;
}

/**
 * AI Tool: 创建 Skill 任务
 *
 * 用于 AI 根据用户意图创建定时任务
 *
 * @param input - 创建任务输入
 * @returns 创建结果
 */
export async function createSkillTaskForAI(input: {
  skillName: string;
  serverId: string;
  userId: string;
  config: Record<string, unknown>;
  taskName?: string;
  schedule?: string;
}) {
  try {
    const task = await createTaskFromSkill(input);

    return {
      success: true,
      task: {
        id: task.id,
        name: task.name,
        description: task.description,
        cron: task.cron,
        nextRun: task.nextRun,
      },
      message: `任务创建成功！${describeSkillTask(input.skillName, input.config)}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * AI Tool: 推荐合适的 Skill
 *
 * 根据用户的描述推荐合适的 Skill 模板
 *
 * @param userIntent - 用户意图描述
 * @returns 推荐的 Skill 列表
 */
export function recommendSkillsForAI(userIntent: string): Array<{
  name: string;
  description: string;
  relevance: "high" | "medium" | "low";
  reason: string;
}> {
  const intent = userIntent.toLowerCase();
  const recommendations: Array<{
    name: string;
    description: string;
    relevance: "high" | "medium" | "low";
    reason: string;
  }> = [];

  // 备份相关关键词
  if (
    intent.includes("备份") ||
    intent.includes("backup") ||
    intent.includes("dump") ||
    intent.includes("导出")
  ) {
    const template = getSkillRegistry().get("backup");
    if (template) {
      recommendations.push({
        name: "backup",
        description: template.description,
        relevance: "high",
        reason: "用户明确提到了备份需求",
      });
    }
  }

  // 磁盘空间相关关键词
  if (
    intent.includes("磁盘") ||
    intent.includes("disk") ||
    intent.includes("空间") ||
    intent.includes("容量") ||
    intent.includes("监控")
  ) {
    const template = getSkillRegistry().get("disk-check");
    if (template) {
      recommendations.push({
        name: "disk-check",
        description: template.description,
        relevance: "high",
        reason: "用户需要监控磁盘使用情况",
      });
    }
  }

  // 日志清理相关关键词
  if (
    intent.includes("日志") ||
    intent.includes("log") ||
    intent.includes("清理") ||
    intent.includes("cleanup") ||
    intent.includes("删除旧")
  ) {
    const template = getSkillRegistry().get("log-cleanup");
    if (template) {
      recommendations.push({
        name: "log-cleanup",
        description: template.description,
        relevance: "high",
        reason: "用户需要清理过期日志",
      });
    }
  }

  // SSL 证书相关关键词
  if (
    intent.includes("ssl") ||
    intent.includes("证书") ||
    intent.includes("https") ||
    intent.includes("过期") ||
    intent.includes("certificate")
  ) {
    const template = getSkillRegistry().get("ssl-check");
    if (template) {
      recommendations.push({
        name: "ssl-check",
        description: template.description,
        relevance: "high",
        reason: "用户需要监控 SSL 证书有效期",
      });
    }
  }

  // 服务健康检查相关关键词
  if (
    intent.includes("服务") ||
    intent.includes("service") ||
    intent.includes("重启") ||
    intent.includes("restart") ||
    intent.includes("健康") ||
    intent.includes("health") ||
    intent.includes("监控")
  ) {
    const template = getSkillRegistry().get("service-health");
    if (template) {
      recommendations.push({
        name: "service-health",
        description: template.description,
        relevance: "high",
        reason: "用户需要监控服务状态",
      });
    }
  }

  // 如果没有匹配到任何 Skill，返回所有可用的作为 low relevance 建议
  if (recommendations.length === 0) {
    const allTemplates = listSkillTemplatesForAI();
    recommendations.push(
      ...allTemplates.map((t) => ({
        name: t.name,
        description: t.description,
        relevance: "low" as const,
        reason: "可能有帮助",
      })),
    );
  }

  return recommendations.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.relevance] - order[b.relevance];
  });
}

/**
 * AI Tool: 获取用户的 Skill 任务列表
 *
 * @param userId - 用户 ID
 * @returns 用户创建的 Skill 任务
 */
export async function listUserSkillTasksForAI(userId: string) {
  const taskRepo = getTaskRepository();

  // 获取所有用户的 active 任务
  const result = await taskRepo.findByStatus(userId, "active", {
    limit: 100,
    offset: 0,
  });

  // 过滤出 Skill 任务
  const skillTasks = result.tasks
    .map((task) => {
      const skillInfo = parseSkillFromDescription(task.description);
      if (!skillInfo) return null;

      return {
        id: task.id,
        name: task.name,
        skillName: skillInfo.skillName,
        config: skillInfo.skillConfig,
        cron: task.cron,
        lastStatus: task.lastStatus,
        nextRun: task.nextRun,
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  return skillTasks;
}
