// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Skill → Task Converter — Skill 模板到定时任务的转换
 *
 * 将 Skill 模板配置转换为 Task Repository 可以存储的定时任务
 */

import { getTaskRepository } from "../db/repositories/task-repository.js";
import { getNextRunDate } from "../core/task/scheduler.js";
import type { CreateTaskInput } from "../db/repositories/task-repository.js";
import { getSkillRegistry } from "./skill-registry.js";

export interface CreateSkillTaskInput {
  /** Skill 名称 */
  skillName: string;
  /** 任务名称(可选,不提供则使用 Skill 描述) */
  taskName?: string;
  /** 目标服务器 ID */
  serverId: string;
  /** 用户 ID */
  userId: string;
  /** Skill 配置 */
  config: Record<string, unknown>;
  /** Cron 表达式(可选,不提供则使用 Skill 默认值) */
  schedule?: string;
}

/**
 * 将 Skill 转换为 Task
 *
 * @param input - Skill Task 创建输入
 * @returns 创建的 Task
 */
export async function createTaskFromSkill(input: CreateSkillTaskInput) {
  const registry = getSkillRegistry();
  const taskRepo = getTaskRepository();

  // 1. 验证 Skill 是否存在
  const template = registry.get(input.skillName);
  if (!template) {
    throw new Error(`Skill '${input.skillName}' not found`);
  }

  // 2. 填充默认配置
  const fullConfig = registry.fillDefaults(input.skillName, input.config);

  // 3. 验证配置
  const validation = registry.validateConfig(input.skillName, fullConfig);
  if (!validation.valid) {
    throw new Error(`Invalid skill config: ${validation.errors.join(", ")}`);
  }

  // 4. 生成命令
  const commands = registry.generateCommands(input.skillName, fullConfig);
  const command = commands.join(" && ");

  // 5. 确定 Cron 表达式
  const cron = input.schedule || template.defaultSchedule;
  const nextRun = getNextRunDate(cron);
  if (!nextRun) {
    throw new Error(`Invalid cron expression: ${cron}`);
  }

  // 6. 创建 Task
  const taskName =
    input.taskName || `[${input.skillName}] ${template.description}`;
  const taskInput: CreateTaskInput = {
    serverId: input.serverId,
    userId: input.userId,
    name: taskName,
    cron,
    command,
    description: `Skill: ${input.skillName}\nConfig: ${JSON.stringify(fullConfig, null, 2)}`,
    nextRun,
  };

  const task = await taskRepo.create(taskInput);
  return task;
}

/**
 * 批量创建 Skill Tasks
 *
 * @param inputs - Skill Task 创建输入数组
 * @returns 创建的 Tasks 数组
 */
export async function createTasksFromSkills(
  inputs: CreateSkillTaskInput[],
): Promise<Awaited<ReturnType<typeof createTaskFromSkill>>[]> {
  const tasks = [];
  for (const input of inputs) {
    const task = await createTaskFromSkill(input);
    tasks.push(task);
  }
  return tasks;
}

/**
 * 从 Task description 中解析 Skill 信息
 *
 * @param description - Task description
 * @returns Skill 信息,如果不是 Skill Task 则返回 null
 */
export function parseSkillFromDescription(description: string | null): {
  skillName: string;
  skillConfig: Record<string, unknown>;
} | null {
  if (!description) return null;

  const skillMatch = description.match(/^Skill: (.+)\nConfig: (.+)$/s);
  if (!skillMatch) return null;

  try {
    const skillName = skillMatch[1].trim();
    const skillConfig = JSON.parse(skillMatch[2]) as Record<string, unknown>;
    return { skillName, skillConfig };
  } catch {
    return null;
  }
}

/**
 * 更新基于 Skill 创建的 Task
 *
 * @param taskId - Task ID
 * @param userId - 用户 ID
 * @param config - 新的 Skill 配置
 * @returns 更新后的 Task
 */
export async function updateSkillTask(
  taskId: string,
  userId: string,
  config: Record<string, unknown>,
) {
  const taskRepo = getTaskRepository();
  const registry = getSkillRegistry();

  // 1. 获取现有 Task
  const task = await taskRepo.getById(taskId, userId);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  // 2. 从 description 中解析 Skill 信息
  const skillInfo = parseSkillFromDescription(task.description);
  if (!skillInfo) {
    throw new Error("Task is not a skill-based task");
  }

  const skillName = skillInfo.skillName;

  // 3. 验证 Skill 是否存在
  const template = registry.get(skillName);
  if (!template) {
    throw new Error(`Skill '${skillName}' not found`);
  }

  // 4. 填充默认配置并验证
  const fullConfig = registry.fillDefaults(skillName, config);
  const validation = registry.validateConfig(skillName, fullConfig);
  if (!validation.valid) {
    throw new Error(`Invalid skill config: ${validation.errors.join(", ")}`);
  }

  // 5. 重新生成命令
  const commands = registry.generateCommands(skillName, fullConfig);
  const command = commands.join(" && ");

  // 6. 更新 Task
  const updatedTask = await taskRepo.update(taskId, userId, {
    command,
    description: `Skill: ${skillName}\nConfig: ${JSON.stringify(fullConfig, null, 2)}`,
  });

  return updatedTask;
}
