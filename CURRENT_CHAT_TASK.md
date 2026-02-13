### [pending] awaitAbort 轮询模式浪费 CPU — 200ms setInterval 未在 Promise.race 解决后清理

**ID**: chat-066
**优先级**: P0
**模块路径**: packages/server/src/ai/
**发现的问题**: `agentic-chat.ts:587-601` 的 `awaitAbort()` 方法使用 `setInterval(200ms)` 轮询 `abort.aborted` 状态。当 `Promise.race([confirmation.approved, awaitAbort()])` 中 `confirmation.approved` 先解决时（用户批准命令），`awaitAbort` 的 interval 仍然继续运行直到 `abort.aborted` 最终变为 true 或进程退出。每个确认请求最多泄漏一个 200ms interval 长达 5 分钟。在高频使用场景下（agentic 模式频繁触发 YELLOW/RED 命令确认），可累积数十个空转 interval。虽然 `.unref()` 避免了进程挂起，但 CPU 仍被无意义唤醒。
**改进方案**:
1. 将 `awaitAbort` 改为基于回调/事件的模式，而非轮询：
   - 给 `AbortState` 增加 `onAbort(callback)` 方法和内部 listener 列表
   - `awaitAbort` 返回的 Promise 注册 listener，abort 时触发 resolve
2. 或者更简单：让 `awaitAbort` 返回 `{ promise, cancel }` 元组，在 `Promise.race` 解决后调用 `cancel()` 清理 interval
3. 在 `toolExecuteCommand`（行 450-453）的 `Promise.race` 之后添加清理逻辑
**验收标准**:
- `awaitAbort` 不再使用 `setInterval` 轮询
- `Promise.race` 解决后所有 timer/listener 被立即清理
- 现有 agentic-chat 测试全部通过
- 新增单元测试验证：confirmation 解决后 abort interval 不再运行
**影响范围**:
- `packages/server/src/ai/agentic-chat.ts` — `awaitAbort` 方法重构 + `toolExecuteCommand` 调用处
- `packages/server/tests/ai/agentic-chat.test.ts` — 新增测试
**创建时间**: 2026-02-13
**完成时间**: -

---
