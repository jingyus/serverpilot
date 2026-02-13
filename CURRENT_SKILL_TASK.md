### [pending] Skill Dry-Run 预览模式 — 不实际执行命令的模拟运行

**ID**: skill-093
**优先级**: P1
**模块路径**: packages/server/src/core/skill/
**当前状态**: Skill 执行后立即调用 AI 自主循环并向 Agent 发送真实命令。无法在不产生副作用的情况下预览 Skill 的执行计划。当前唯一安全机制是 `requires_confirmation: true` 阻止自动触发。
**实现方案**: 
1. 在 `types.ts` 的 `SkillRunParams` 添加 `dryRun?: boolean` 字段
2. 在 `runner.ts` 的 `SkillRunner.run()` 中:
   - dryRun=true 时修改 system prompt，要求 AI "输出你计划执行的命令列表，但不要调用工具"
   - 设置 `max_steps: 0` 或从 tool_definitions 中移除 shell/write_file
3. 在 `runner-executor.ts` 中增加保底: dryRun 模式下所有副作用工具返回 `"[DRY RUN] Would execute: ..."`
4. engine.ts `execute()` 方法传递 dryRun 到 runner
5. API 路由 `POST /skills/:id/execute` 支持 `{ dryRun: true }` 参数
6. 执行记录的 triggerType 设为 `'dry-run'`
**验收标准**: 
- Dry-run 执行不产生任何副作用
- AI 返回计划执行的命令列表
- 执行记录中标记为 dry-run
- 测试覆盖: ≥10 个测试用例
**影响范围**: packages/server/src/core/skill/types.ts, runner.ts, runner-executor.ts, engine.ts (各改 <20 行)
**创建时间**: 2026-02-13
**完成时间**: -

---
