// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Skill Client - Agent 端 Skill 执行客户端
 *
 * 接收来自 Server 的 Skill 执行请求,执行并上报进度
 */

import type { AuthenticatedClient } from "../authenticated-client.js";
import { createMessageLite as createMessage } from "../protocol-lite.js";
import { CommandExecutor } from "../execute/executor.js";
import { VerboseLogger } from "../ui/verbose.js";

export interface SkillDefinition {
  /** Skill ID */
  skillId: string;
  /** Skill 名称 */
  skillName: string;
  /** 要执行的命令列表 */
  commands: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 超时时间(毫秒) */
  timeout?: number;
  /** 工作目录 */
  cwd?: string;
}

export interface SkillResult {
  /** 是否成功 */
  success: boolean;
  /** 执行步骤结果 */
  results: SkillStepResult[];
  /** 总耗时(毫秒) */
  duration: number;
  /** 错误信息(如果失败) */
  error?: string;
}

export interface SkillStepResult {
  /** 命令 */
  command: string;
  /** 是否成功 */
  success: boolean;
  /** 退出码 */
  exitCode: number;
  /** 标准输出 */
  stdout: string;
  /** 标准错误 */
  stderr: string;
  /** 耗时(毫秒) */
  duration: number;
}

/**
 * Skill 执行客户端
 */
export class SkillClient {
  private executor: CommandExecutor;
  private verbose: VerboseLogger;

  constructor(
    private client: AuthenticatedClient,
    options: { verbose?: boolean; timeout?: number } = {},
  ) {
    this.executor = new CommandExecutor(options.timeout);
    this.verbose = new VerboseLogger({ enabled: options.verbose ?? false });
  }

  /**
   * 执行 Skill
   *
   * @param skill - Skill 定义
   * @returns Skill 执行结果
   */
  async executeSkill(skill: SkillDefinition): Promise<SkillResult> {
    this.verbose.log(
      "general",
      `[SkillClient] Executing skill: ${skill.skillName} (${skill.skillId})`,
    );

    const startTime = Date.now();
    const results: SkillStepResult[] = [];
    let allSuccess = true;
    let errorMessage: string | undefined;

    try {
      // 发送开始通知
      this.client.send(
        createMessage("skill.progress", {
          skillId: skill.skillId,
          status: "started",
        }),
      );

      // 执行每个命令
      for (let i = 0; i < skill.commands.length; i++) {
        const command = skill.commands[i];

        this.verbose.log(
          "general",
          `[SkillClient] Step ${i + 1}/${skill.commands.length}: ${command}`,
        );

        // 发送步骤开始通知
        this.client.send(
          createMessage("skill.progress", {
            skillId: skill.skillId,
            status: "running",
            step: i + 1,
            totalSteps: skill.commands.length,
            message: command,
          }),
        );

        const stepStartTime = Date.now();

        try {
          // 执行命令（parse shell command into command + args）
          const parts = command.split(/\s+/);
          const cmd = parts[0];
          const args = parts.slice(1);
          const result = await this.executor.execute(cmd, args, {
            env: skill.env,
            cwd: skill.cwd,
            timeoutMs: skill.timeout,
          });

          const duration = Date.now() - stepStartTime;

          const stepResult: SkillStepResult = {
            command,
            success: result.exitCode === 0,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            duration,
          };

          results.push(stepResult);

          if (result.exitCode !== 0) {
            allSuccess = false;
            errorMessage = `Step ${i + 1} failed: ${result.stderr || result.stdout}`;

            this.verbose.log("error", `[SkillClient] ${errorMessage}`);

            // 发送步骤失败通知
            this.client.send(
              createMessage("skill.progress", {
                skillId: skill.skillId,
                status: "failed",
                step: i + 1,
                error: errorMessage,
              }),
            );

            // 失败后不再继续执行
            break;
          }

          this.verbose.log("general", `[SkillClient] Step ${i + 1} succeeded`);

          // 发送步骤成功通知
          this.client.send(
            createMessage("skill.progress", {
              skillId: skill.skillId,
              status: "step_complete",
              step: i + 1,
            }),
          );
        } catch (err) {
          const duration = Date.now() - stepStartTime;
          const error = err instanceof Error ? err.message : String(err);

          const stepResult: SkillStepResult = {
            command,
            success: false,
            exitCode: -1,
            stdout: "",
            stderr: error,
            duration,
          };

          results.push(stepResult);
          allSuccess = false;
          errorMessage = `Step ${i + 1} threw error: ${error}`;

          this.verbose.log("error", `[SkillClient] ${errorMessage}`);

          // 发送步骤失败通知
          this.client.send(
            createMessage("skill.progress", {
              skillId: skill.skillId,
              status: "failed",
              step: i + 1,
              error: errorMessage,
            }),
          );

          break;
        }
      }

      const totalDuration = Date.now() - startTime;

      // 发送完成通知
      this.client.send(
        createMessage("skill.progress", {
          skillId: skill.skillId,
          status: allSuccess ? "completed" : "failed",
        }),
      );

      return {
        success: allSuccess,
        results,
        duration: totalDuration,
        error: errorMessage,
      };
    } catch (err) {
      const totalDuration = Date.now() - startTime;
      const error = err instanceof Error ? err.message : String(err);

      this.verbose.log(
        "error",
        `[SkillClient] Skill execution error: ${error}`,
      );

      // 发送失败通知
      this.client.send(
        createMessage("skill.progress", {
          skillId: skill.skillId,
          status: "failed",
          error,
        }),
      );

      return {
        success: false,
        results,
        duration: totalDuration,
        error,
      };
    }
  }

  /**
   * 注册 Skill 执行消息处理器
   *
   * 监听来自 Server 的 skill.execute 消息
   */
  registerHandlers(): void {
    this.client.on(
      "message",
      async (message: { type: string; payload?: unknown }) => {
        if (message.type === "skill.execute") {
          const payload = message.payload as SkillDefinition;

          this.verbose.log(
            "general",
            `[SkillClient] Received skill.execute: ${payload.skillName}`,
          );

          try {
            const result = await this.executeSkill(payload);

            // 发送最终结果（构建输出摘要）
            const outputLines: string[] = [];
            for (const r of result.results) {
              outputLines.push(`Command: ${r.command}`);
              outputLines.push(`Exit Code: ${r.exitCode}`);
              if (r.stdout) {
                outputLines.push(`Output: ${r.stdout.slice(0, 500)}`);
              }
              if (r.stderr) {
                outputLines.push(`Error: ${r.stderr.slice(0, 500)}`);
              }
            }

            this.client.send(
              createMessage("skill.result", {
                skillId: payload.skillId,
                success: result.success,
                duration: result.duration,
                error: result.error,
                output: outputLines.join("\n"),
              }),
            );
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);

            this.client.send(
              createMessage("skill.result", {
                skillId: payload.skillId,
                success: false,
                error,
              }),
            );
          }
        }
      },
    );

    this.verbose.log("general", "[SkillClient] Skill handlers registered");
  }
}
