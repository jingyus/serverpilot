### [pending] skill-integration.test.ts 拆分 — 1083 行超出 800 行硬限制

**ID**: skill-071
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: `skill-integration.test.ts` 1083 行，超出硬限制 35%。包含 8 个 describe 块: full lifecycle、SSE event streaming、TriggerManager integration、RBAC skill permission enforcement、error recovery、multi-step execution、chain depth/cycle detection、status transition validation。
**实现方案**: 
1. 创建 `skill-integration-advanced.test.ts` — 提取 `RBAC skill permission enforcement` (L672-814) + `error recovery` (L815-908) + `multi-step execution` (L909-1004) + `chain depth/cycle detection` (L1005-1054) + `status transition validation` (L1055-end) ≈ 450 行
2. 原 `skill-integration.test.ts` 保留 `full lifecycle` + `SSE event streaming` + `TriggerManager integration` ≈ 650 行
**验收标准**: 
- `skill-integration.test.ts` ≤ 700 行
- `skill-integration-advanced.test.ts` ≤ 500 行
- 所有集成测试通过
**影响范围**: packages/server/src/core/skill/skill-integration.test.ts, packages/server/src/core/skill/skill-integration-advanced.test.ts (新)
**创建时间**: (自动填充)
**完成时间**: -

---
