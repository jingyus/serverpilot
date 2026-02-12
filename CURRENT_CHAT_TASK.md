### [pending] SSE 解析后 currentEvent 在空行处重置 — 多行 data 的事件类型丢失

**ID**: chat-027
**优先级**: P1
**模块路径**: packages/dashboard/src/api/sse.ts
**发现的问题**: `sse.ts:198-211` 的 SSE 解析循环中，遇到空行时 `currentEvent = 'message'`（行 209）。按 SSE 规范，空行表示事件结束，应该 dispatch 当前事件并重置。但此处只重置 `currentEvent`，不 dispatch。如果服务端在 `event:` 和 `data:` 之间有空行（某些 SSE 库会这样做），`currentEvent` 会被错误重置为 `'message'`，导致 `tool_call`、`confirm_required` 等事件被路由到 `onMessage` 回调。同样的问题在 `createMetricsSSE`（行 341-354）、`createServerStatusSSE`（行 470-484）、`createSkillExecutionSSE`（行 593-623）中重复出现。4 处 SSE 解析逻辑完全重复（违反 DRY）。
**改进方案**: 
1. 提取一个 `parseSSEStream(reader: ReadableStreamDefaultReader, dispatch: (event: string, data: string) => void)` 通用函数
2. 所有 4 个 SSE 连接类型复用该函数
3. 修正空行处理：空行触发 `dispatch(currentEvent, accumulatedData)` 然后重置，而非仅重置 event name
4. 支持多行 `data:` 拼接（SSE 规范允许）
**验收标准**: 
- SSE 解析逻辑只有一份实现
- 空行后事件类型不会意外变为 'message'
- 多行 data 被正确拼接
- 所有现有 SSE 相关测试通过
**影响范围**: packages/dashboard/src/api/sse.ts
**创建时间**: (自动填充)
**完成时间**: -

---
