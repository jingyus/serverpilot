### [pending] engine.ts 文件拆分 — 提取 Confirmation Flow 到独立模块

**ID**: skill-061
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: `engine.ts` 793 行，逼近 800 行硬限制。Confirmation Flow（createPendingConfirmation, confirmExecution, rejectExecution, listPendingConfirmations, expirePendingConfirmations, executeConfirmed）占约 100 行，可独立为模块。
**实现方案**: 
1. 创建 `packages/server/src/core/skill/engine-confirmation.ts`（约 120 行）
2. 将 `createPendingConfirmation`, `confirmExecution`, `rejectExecution`, `listPendingConfirmations`, `expirePendingConfirmations`, `executeConfirmed` 方法提取为独立类 `SkillConfirmationManager`
3. `SkillConfirmationManager` 接收 `SkillRepository` 和 `execute` 回调作为依赖注入
4. `engine.ts` 中组合 `SkillConfirmationManager` 实例，委托调用
5. 对应测试拆分到 `engine-confirmation.test.ts`
6. 目标：`engine.ts` 降至 650 行以下
**验收标准**: 
- `engine.ts` ≤ 650 行
- `engine-confirmation.ts` ≤ 200 行
- 所有现有 engine 测试通过不变
- Confirmation 相关测试迁移到独立测试文件
**影响范围**: packages/server/src/core/skill/engine.ts, packages/server/src/core/skill/engine-confirmation.ts (新), packages/server/src/core/skill/engine-confirmation.test.ts (新)
**创建时间**: (自动填充)
**完成时间**: -

---
