### [pending] chat-execution.ts 超过 500 行软限制（652 行）— SSE 回调构建器可提取

**ID**: chat-078
**优先级**: P3
**模块路径**: packages/dashboard/src/stores/
**发现的问题**: `chat-execution.ts` 当前 652 行，超过项目 500 行软限制。主要体积来自 `buildStreamingCallbacks` 函数（约 300 行），其中包含 14+ 个 SSE 事件处理器。每个处理器逻辑独立（JSON.parse → Zod validate → set state），适合提取到独立模块。此外 `createConfirmPlan` 和 `createEmergencyStop` 也各约 80 行，与 streaming 回调逻辑无关。
**改进方案**:
1. 提取 `buildStreamingCallbacks` 到新文件 `chat-sse-handlers.ts`
2. 每个 SSE 事件处理器作为独立的命名函数导出
3. `chat-execution.ts` 只保留 `createConfirmPlan`、`createRespondToStep`、`createEmergencyStop` 等高层流程
4. 保持 `get()`/`set()` 通过参数注入（避免循环依赖）
**验收标准**:
- `chat-execution.ts` 降到 400 行以下
- `chat-sse-handlers.ts` < 350 行
- 所有现有 chat-execution 测试通过
- 无循环依赖
**影响范围**:
- `packages/dashboard/src/stores/chat-execution.ts` — 拆分
- `packages/dashboard/src/stores/chat-sse-handlers.ts` — 新文件
- `packages/dashboard/src/stores/chat-execution.test.ts` — 调整 import
**创建时间**: 2026-02-13
**完成时间**: -

---
