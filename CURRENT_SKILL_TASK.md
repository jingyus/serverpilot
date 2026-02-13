### [pending] engine.ts 二次拆分 — 从 722 行降至 ≤500 行

**ID**: skill-098
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: engine.ts 当前 722 行，虽然之前已拆分出 5 个子模块（engine-queries/template-vars/cleanup/health/confirmation），但仍远超 500 行软限制。`executeSingle()` 方法单独就有 158 行，加上 lifecycle 管理、upgrade 流程、webhook 分发等，文件仍然臃肿。
**实现方案**: 
1. 提取 `executeSingle()` + `emitTriggerEvent()` + `dispatchWebhookEvent()` 到 `engine-execute.ts` (~180 行)
2. 提取 `upgrade()` + `upgradeGitSkill()` + `checkSkillRequirements()` 到 `engine-upgrade.ts` (~120 行)
3. 提取 `cancel()` + `isExecutionRunning()` + `getRunningExecutionIds()` + `runningExecutions` Map 到 `engine-cancellation.ts` (~50 行)
4. engine.ts 保留: 构造函数、install/uninstall/updateConfig/updateStatus + start/stop 生命周期 + 单例管理 + 查询委托 (~370 行)
5. 新文件通过参数注入 `repo`/`triggerManager` 等依赖，不直接依赖 engine 实例
**验收标准**: 
- engine.ts ≤ 500 行
- 每个新文件 ≤ 200 行
- 所有现有 engine 相关测试继续通过 (engine.test.ts + engine-*.test.ts)
- 公共 API (getSkillEngine() 等) 不变
**影响范围**: packages/server/src/core/skill/engine.ts (拆分), 新建 engine-execute.ts, engine-upgrade.ts, engine-cancellation.ts
**创建时间**: 2026-02-13
**完成时间**: -

---
