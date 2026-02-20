// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Skill Registry — Skill 模板注册中心
 *
 * 管理所有可用的 Skill 模板,提供查询和配置验证功能
 */

import { DISK_CHECK_SKILL_TEMPLATE } from "./builtin/disk-check.js";
import { BACKUP_SKILL_TEMPLATE } from "./builtin/backup.js";
import { LOG_CLEANUP_SKILL_TEMPLATE } from "./builtin/log-cleanup.js";
import { SSL_CHECK_SKILL_TEMPLATE } from "./builtin/ssl-check.js";
import { SERVICE_HEALTH_SKILL_TEMPLATE } from "./builtin/service-health.js";

export interface SkillConfigField {
  type: string; // Allow broader type for flexibility
  description: string;
  default?: unknown;
  optional?: boolean;
  min?: number;
  max?: number;
  enum?: string[];
  items?: { type: string };
}

export interface SkillTemplate {
  /** Skill 名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 默认 Cron 表达式 */
  defaultSchedule: string;
  /** 执行模式 */
  executionMode: "agent" | "server";
  /** 配置 Schema */
  configSchema: Record<string, SkillConfigField>;
  /** 生成命令的函数 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generateCommands: (config: any) => string[];
  /** 解析结果的函数(可选) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parseResult?: (stdout: string) => any;
}

/**
 * Skill Registry — 单例模式
 */
export class SkillRegistry {
  private templates = new Map<string, SkillTemplate>();

  constructor() {
    // 注册内置 Skills
    this.registerBuiltinSkills();
  }

  /**
   * 注册内置 Skills
   */
  private registerBuiltinSkills(): void {
    this.register(DISK_CHECK_SKILL_TEMPLATE);
    this.register(BACKUP_SKILL_TEMPLATE);
    this.register(LOG_CLEANUP_SKILL_TEMPLATE);
    this.register(SSL_CHECK_SKILL_TEMPLATE);
    this.register(SERVICE_HEALTH_SKILL_TEMPLATE);
  }

  /**
   * 注册一个 Skill 模板
   *
   * @param template - Skill 模板
   */
  register(template: SkillTemplate): void {
    this.templates.set(template.name, template);
  }

  /**
   * 获取指定名称的 Skill 模板
   *
   * @param name - Skill 名称
   * @returns Skill 模板,不存在则返回 undefined
   */
  get(name: string): SkillTemplate | undefined {
    return this.templates.get(name);
  }

  /**
   * 获取所有已注册的 Skill 模板
   *
   * @returns Skill 模板数组
   */
  list(): SkillTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * 检查 Skill 是否存在
   *
   * @param name - Skill 名称
   * @returns 是否存在
   */
  has(name: string): boolean {
    return this.templates.has(name);
  }

  /**
   * 验证 Skill 配置
   *
   * @param skillName - Skill 名称
   * @param config - 配置对象
   * @returns 验证结果 { valid: boolean, errors: string[] }
   */
  validateConfig(
    skillName: string,
    config: Record<string, unknown>,
  ): { valid: boolean; errors: string[] } {
    const template = this.templates.get(skillName);
    if (!template) {
      return { valid: false, errors: [`Skill '${skillName}' not found`] };
    }

    const errors: string[] = [];

    // 检查必填字段
    for (const [key, field] of Object.entries(template.configSchema)) {
      if (!field.optional && !(key in config)) {
        errors.push(`Missing required field: ${key}`);
        continue;
      }

      if (!(key in config)) continue; // 可选字段,跳过

      const value = config[key];

      // 类型检查
      if (field.type === "string" && typeof value !== "string") {
        errors.push(`Field '${key}' must be a string`);
      } else if (field.type === "number" && typeof value !== "number") {
        errors.push(`Field '${key}' must be a number`);
      } else if (field.type === "boolean" && typeof value !== "boolean") {
        errors.push(`Field '${key}' must be a boolean`);
      } else if (field.type === "array" && !Array.isArray(value)) {
        errors.push(`Field '${key}' must be an array`);
      }

      // 数值范围检查
      if (
        field.type === "number" &&
        typeof value === "number" &&
        (field.min !== undefined || field.max !== undefined)
      ) {
        if (field.min !== undefined && value < field.min) {
          errors.push(`Field '${key}' must be >= ${field.min}`);
        }
        if (field.max !== undefined && value > field.max) {
          errors.push(`Field '${key}' must be <= ${field.max}`);
        }
      }

      // 枚举值检查
      if (
        field.enum &&
        typeof value === "string" &&
        !field.enum.includes(value)
      ) {
        errors.push(`Field '${key}' must be one of: ${field.enum.join(", ")}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * 为配置填充默认值
   *
   * @param skillName - Skill 名称
   * @param config - 部分配置对象
   * @returns 填充默认值后的完整配置
   */
  fillDefaults(
    skillName: string,
    config: Record<string, unknown>,
  ): Record<string, unknown> {
    const template = this.templates.get(skillName);
    if (!template) {
      throw new Error(`Skill '${skillName}' not found`);
    }

    const fullConfig = { ...config };

    for (const [key, field] of Object.entries(template.configSchema)) {
      if (!(key in fullConfig) && field.default !== undefined) {
        fullConfig[key] = field.default;
      }
    }

    return fullConfig;
  }

  /**
   * 生成 Skill 执行命令
   *
   * @param skillName - Skill 名称
   * @param config - 配置对象
   * @returns 命令数组
   */
  generateCommands(
    skillName: string,
    config: Record<string, unknown>,
  ): string[] {
    const template = this.templates.get(skillName);
    if (!template) {
      throw new Error(`Skill '${skillName}' not found`);
    }

    // 验证配置
    const validation = this.validateConfig(skillName, config);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join(", ")}`);
    }

    // 填充默认值
    const fullConfig = this.fillDefaults(skillName, config);

    // 生成命令
    return template.generateCommands(fullConfig);
  }

  /**
   * 清空所有注册的 Skill(用于测试)
   */
  _clear(): void {
    this.templates.clear();
  }

  /**
   * 重新加载内置 Skills(用于测试)
   */
  _reload(): void {
    this.templates.clear();
    this.registerBuiltinSkills();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _skillRegistry: SkillRegistry | null = null;

/**
 * 获取 Skill Registry 单例
 */
export function getSkillRegistry(): SkillRegistry {
  if (!_skillRegistry) {
    _skillRegistry = new SkillRegistry();
  }
  return _skillRegistry;
}

/**
 * 重置 Skill Registry 单例(用于测试)
 */
export function _resetSkillRegistry(): void {
  _skillRegistry = null;
}
