### [pending] Skill 执行取消 — 运行中的执行可被用户中止

**ID**: skill-074
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: `runner.ts` 的 AbortController 仅用于超时，无法从外部取消。`engine.ts` 不跟踪运行中的执行实例。用户无法停止失控或长时间运行的 Skill。
**实现方案**: 
1. 在 `engine.ts` 添加 `private runningExecutions: Map<string, AbortController>`:
   - `executeSingle()` 开始时创建 AbortController 并存入 Map
   - 将 AbortController.signal 传递给 `runner.run()`
   - 执行完成/失败时从 Map 中移除
2. 在 `runner.ts` 的 `run()` 方法接受外部 `signal?: AbortSignal` 参数:
   - 与内部 timeout AbortController 合并 (使用 `AbortSignal.any()`)
   - 在 AI 调用循环和工具执行前检查 signal
3. 在 `engine.ts` 添加 `cancel(executionId: string): Promise<void>`:
   - 从 Map 中获取 AbortController → abort()
   - 更新 DB status 为 'cancelled'
   - 发布 SSE 'error' 事件
4. 对应测试
**验收标准**: 
- `engine.cancel(executionId)` 可中止运行中的执行
- 被取消的执行 DB 状态标记为 'cancelled'
- SSE 推送取消事件到前端
- 测试覆盖: ≥8 个测试用例
**影响范围**: packages/server/src/core/skill/engine.ts, packages/server/src/core/skill/runner.ts, packages/server/src/core/skill/engine.test.ts (或新建 engine-cancel.test.ts)
**创建时间**: 2026-02-13
**完成时间**: -

---
