### [pending] SkillEngine 拆分 — engine.ts 已达 800 行硬限制需重构

**ID**: skill-090
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: engine.ts 已达 798 行，触及 800 行硬限制，无任何增长空间。文件承担了生命周期管理、执行编排、查询、模板变量构建、清理调度等职责。
**实现方案**: 
1. 提取查询方法 (`listInstalled`, `listAvailable`, `getSkill`, `getStats`) 到新文件 `engine-queries.ts` (~70 行)
2. 提取模板变量构建 (`buildServerVars`, `buildSkillVars`) 到新文件 `engine-template-vars.ts` (~50 行)
3. 提取清理逻辑 (`cleanupOldExecutions`, `cleanupPendingConfirmations`, 定时器管理) 到新文件 `engine-cleanup.ts` (~40 行)
4. engine.ts 通过 import 委托调用，保留单例接口不变
5. 现有测试不需要修改（公共 API 不变）
**验收标准**: 
- engine.ts 降至 ≤640 行，预留增长空间
- 3 个新文件均 ≤200 行
- 所有现有 engine 相关测试继续通过
- 公共 API (`getSkillEngine()` 等) 不变
**影响范围**: packages/server/src/core/skill/engine.ts (拆分), 新建 engine-queries.ts, engine-template-vars.ts, engine-cleanup.ts
**创建时间**: 2026-02-13
**完成时间**: -

---
