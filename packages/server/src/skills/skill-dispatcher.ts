// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Skill Dispatcher — 服务器端 Skill 推送服务
 *
 * 负责将 Skill 推送到指定的 Agent 执行
 */

import { createMessage } from "@aiinstaller/shared";
import type { InstallServer } from "../api/server.js";

// TODO: 协议层面需要添加 skill.execute, skill.progress, skill.result 等消息类型
// 临时类型别名,待协议完善后移除
type InstallWebSocketServer = InstallServer;

export interface SkillDefinition {
  /** Skill 唯一 ID */
  id: string;
  /** Skill 名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 要执行的命令列表 */
  commands: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 超时时间(毫秒) */
  timeout?: number;
  /** 工作目录 */
  cwd?: string;
}

export interface SkillProgress {
  skillId: string;
  status: "started" | "running" | "step_complete" | "completed" | "failed";
  step?: number;
  totalSteps?: number;
  message?: string;
  error?: string;
}

export interface SkillResult {
  skillId: string;
  success: boolean;
  output?: string;
  error?: string;
  duration?: number;
}

export type SkillProgressCallback = (progress: SkillProgress) => void;
export type SkillResultCallback = (result: SkillResult) => void;

/**
 * Skill Dispatcher — 推送 Skills 到 Agent
 */
export class SkillDispatcher {
  private wsServer: InstallWebSocketServer;
  private progressCallbacks = new Map<string, SkillProgressCallback>();
  private resultCallbacks = new Map<string, SkillResultCallback>();

  constructor(wsServer: InstallWebSocketServer) {
    this.wsServer = wsServer;
    this.registerHandlers();
  }

  /**
   * 注册 WebSocket 消息处理器
   * TODO: 需要在协议中定义 skill.progress 和 skill.result 消息类型
   * TODO: InstallServer 需要支持 skill 相关的事件监听
   */
  private registerHandlers(): void {
    // TODO: 监听 Agent 的 skill.progress 消息 (协议未定义)
    // this.wsServer.on("skill.progress", (clientId: string, progress: SkillProgress) => {
    //   const callback = this.progressCallbacks.get(progress.skillId);
    //   if (callback) {
    //     callback(progress);
    //   }
    // });
    // TODO: 监听 Agent 的 skill.result 消息 (协议未定义)
    // this.wsServer.on("skill.result", (clientId: string, result: SkillResult) => {
    //   const callback = this.resultCallbacks.get(result.skillId);
    //   if (callback) {
    //     callback(result);
    //     // 清理回调
    //     this.progressCallbacks.delete(result.skillId);
    //     this.resultCallbacks.delete(result.skillId);
    //   }
    // });
  }

  /**
   * 推送 Skill 到指定服务器的 Agent
   *
   * @param serverId - 目标服务器 ID
   * @param skill - Skill 定义
   * @param onProgress - 进度回调
   * @param onResult - 结果回调
   * @returns 是否成功推送
   */
  async dispatchSkill(
    serverId: string,
    skill: SkillDefinition,
    onProgress?: SkillProgressCallback,
    onResult?: SkillResultCallback,
  ): Promise<boolean> {
    // TODO: 查找该服务器的 WebSocket 会话
    // InstallServer 当前没有 getSessionByDeviceId 方法,需要实现
    // const clients = this.wsServer.getClientsByDeviceId(serverId);
    // if (clients.length === 0) {
    //   throw new Error(`Server ${serverId} is not connected`);
    // }

    // 注册回调
    if (onProgress) {
      this.progressCallbacks.set(skill.id, onProgress);
    }
    if (onResult) {
      this.resultCallbacks.set(skill.id, onResult);
    }

    // TODO: 发送 skill.execute 消息 (需要在协议中定义 skill.execute 消息类型)
    // const message = createMessage("skill.execute", skill);
    // const clientId = clients[0];
    // this.wsServer.send(clientId, JSON.stringify(message));

    // 临时实现: 抛出错误提示功能未完成
    throw new Error(
      "Skill dispatcher not yet fully implemented - protocol and API methods needed",
    );
  }

  /**
   * 取消 Skill 执行
   *
   * @param skillId - Skill ID
   */
  async cancelSkill(skillId: string): Promise<void> {
    // 清理回调
    this.progressCallbacks.delete(skillId);
    this.resultCallbacks.delete(skillId);

    // TODO: 发送 skill.cancel 消息到 Agent (需要 Agent 支持)
  }

  /**
   * 获取指定 Skill 的执行状态
   *
   * @param skillId - Skill ID
   * @returns 是否正在执行
   */
  isSkillRunning(skillId: string): boolean {
    return this.resultCallbacks.has(skillId);
  }

  /**
   * 清理所有回调(用于测试)
   */
  _clearCallbacks(): void {
    this.progressCallbacks.clear();
    this.resultCallbacks.clear();
  }
}
