### [pending] run_as 执行身份约束实现 — SKILL_SPEC 已定义但后端完全未使用

**ID**: skill-075
**优先级**: P1
**模块路径**: packages/server/src/core/skill/runner-executor.ts
**当前状态**: 功能缺失 — `SKILL_SPEC.md` (line 157) 定义 `run_as: string` 约束，`shared/src/skill-schema.ts` (line 123) 已在 Zod schema 中验证此字段。但整个 `core/skill/` 目录中无任何 `run_as` 或 `runAs` 引用。当 Skill 声明 `run_as: root` 时，命令仍以 Agent 默认用户身份执行，不符合规范。
**实现方案**: 
1. 在 `runner-executor.ts` 的 `executeShell()` 方法中，当 `constraints.run_as` 有值时，将命令包装为 `sudo -u <run_as> -- <command>`（Linux）或相应的身份切换命令
2. 安全约束: `run_as` 为 `root` 时，自动将风险级别提升一级（yellow → red），需记入审计日志
3. 在 `runner.ts` 的 `run()` 方法中，从 manifest.constraints 读取 `run_as` 并传递给工具执行器
4. 在 `types.ts` 的 `SkillRunParams` 或工具执行上下文中添加 `runAs?: string` 字段
5. 测试: executeShell 有 run_as 时包装 sudo、run_as=root 风险提升、审计日志记录 run_as 信息
**验收标准**: 
- `run_as` 约束被读取并传递到命令执行层
- 命令被正确包装为身份切换形式
- `run_as: root` 触发风险等级提升
- 审计日志记录实际执行身份
- 测试 ≥ 6 个新增
**影响范围**: packages/server/src/core/skill/runner-executor.ts, packages/server/src/core/skill/runner.ts, packages/server/src/core/skill/types.ts, packages/server/src/core/skill/runner-executor.test.ts
**创建时间**: (自动填充)
**完成时间**: -

---
