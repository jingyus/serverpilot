### [pending] engine.test.ts 拆分 — 1689 行远超 800 行硬限制

**ID**: skill-068
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: `engine.test.ts` 1689 行，是 800 行硬限制的 2.1 倍。包含 14 个 describe 块，覆盖 lifecycle、install、uninstall、configure、updateStatus、execute、webhook dispatch、chain context、template variable injection、queries、singleton、listAvailable、full lifecycle、batch execution。
**实现方案**: 
1. 创建 `engine-execute.test.ts` — 提取 `SkillEngine.execute` (L513-719) + `SkillEngine batch execution` (L1381-end) + `SkillEngine template variable injection` (L918-1101) ≈ 600 行
2. 创建 `engine-webhook.test.ts` — 提取 `SkillEngine webhook dispatch` (L720-831) + `SkillEngine chain context` (L832-917) ≈ 200 行
3. 创建 `engine-queries.test.ts` — 提取 `SkillEngine queries` (L1102-1227) + `SkillEngine singleton` (L1228-1270) + `SkillEngine.listAvailable` (L1271-1312) + `SkillEngine full lifecycle` (L1313-1380) ≈ 400 行
4. 原 `engine.test.ts` 保留 lifecycle + install + uninstall + configure + updateStatus ≈ 500 行
5. 共享 mock 和 helpers 提取到 `engine-test-utils.ts`（如果需要避免重复）
**验收标准**: 
- `engine.test.ts` ≤ 550 行
- 3 个新测试文件各 ≤ 650 行
- 所有 414 个 skill 测试仍通过
- `pnpm vitest run packages/server/src/core/skill/engine` 无失败
**影响范围**: packages/server/src/core/skill/engine.test.ts, packages/server/src/core/skill/engine-execute.test.ts (新), packages/server/src/core/skill/engine-webhook.test.ts (新), packages/server/src/core/skill/engine-queries.test.ts (新)
**创建时间**: (自动填充)
**完成时间**: -

---
