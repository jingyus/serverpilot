### [pending] engine-cleanup.ts 单元测试 — 补齐清理逻辑测试覆盖

**ID**: skill-101
**优先级**: P1
**模块路径**: packages/server/src/core/skill/
**当前状态**: `engine-cleanup.ts` (75 行) 包含 `cleanupOldExecutions()` 和 `startCleanupTimers()` 两个函数，但没有对应的测试文件。清理逻辑的边界条件 (空记录、大批量删除、定时器启停) 未被验证。
**实现方案**: 
1. 创建 `engine-cleanup.test.ts`
2. 测试用例:
   - `cleanupOldExecutions()`: 删除过期记录、保留未过期记录、空表返回 0
   - `startCleanupTimers()`: 定时器启动后调用 cleanup、dispose 后不再调用
   - `EXECUTION_RETENTION_DAYS` 常量正确性
   - 初始 fire-and-forget cleanup 执行
3. 使用 `vi.useFakeTimers()` 测试定时器行为
4. Mock `SkillRepository.deleteExecutionsBefore()` 和 `expirePendingConfirmations`
**验收标准**: 
- ≥8 个测试用例覆盖所有分支
- 所有测试通过
- 不依赖外部状态 (纯 mock)
**影响范围**: 新建 packages/server/src/core/skill/engine-cleanup.test.ts
**创建时间**: 2026-02-13
**完成时间**: -

---
