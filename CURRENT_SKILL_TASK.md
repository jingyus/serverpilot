### [pending] trigger-manager.test.ts 拆分 — 1175 行超出 800 行硬限制

**ID**: skill-070
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: `trigger-manager.test.ts` 1175 行，超出硬限制 47%。包含 11 个 describe 块: lifecycle、cron triggers、event triggers、threshold triggers、debounce、register/unregister、singleton、error handling、chain triggers、startup loading、subscribeToDispatcher。
**实现方案**: 
1. 创建 `trigger-manager-triggers.test.ts` — 提取 `cron triggers` (L164-235) + `event triggers` (L236-344) + `threshold triggers` (L345-469) ≈ 400 行
2. 创建 `trigger-manager-advanced.test.ts` — 提取 `chain triggers` (L693-874) + `startup loading` (L875-1008) + `subscribeToDispatcher` (L1009-end) ≈ 400 行
3. 原 `trigger-manager.test.ts` 保留 lifecycle + debounce + register/unregister + singleton + error handling ≈ 400 行
**验收标准**: 
- 3 个文件各 ≤ 500 行
- 所有触发器相关测试仍通过
- `pnpm vitest run packages/server/src/core/skill/trigger-manager` 全部绿色
**影响范围**: packages/server/src/core/skill/trigger-manager.test.ts, packages/server/src/core/skill/trigger-manager-triggers.test.ts (新), packages/server/src/core/skill/trigger-manager-advanced.test.ts (新)
**创建时间**: (自动填充)
**完成时间**: -

---
