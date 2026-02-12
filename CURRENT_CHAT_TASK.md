### [pending] sse.ts 文件超 500 行且含 4 套重复 SSE 解析逻辑 — 需提取通用解析器

**ID**: chat-030
**优先级**: P2
**模块路径**: packages/dashboard/src/api/sse.ts
**发现的问题**: `sse.ts` 当前 700 行，超出 500 行软限制。文件中 4 个 SSE 连接函数（`createSSEConnection` 行 101-238、`createMetricsSSE` 行 269-382、`createServerStatusSSE` 行 402-509、`createSkillExecutionSSE` 行 531-635）各自独立实现了完全相同的 SSE 流解析逻辑：`decoder + buffer + split('\n') + lines.pop() + event:/data: 解析`。同样的 `cleanup` + `scheduleReconnect` + `connect` 三件套也重复了 3 次。任何解析 bug 的修复需要在 4 处同步更新。
**改进方案**: 
1. 提取 `parseSSEStream(reader, dispatch)` 通用解析函数处理 buffer/decode/line-split/event dispatch
2. 提取 `createReconnectableSSE(connectFn, maxAttempts, onReconnecting)` 通用重连包装器
3. 4 个 SSE 函数简化为：配置 URL + 事件类型映射 + 调用通用函数
4. 主文件降至 300 行以内
**验收标准**: 
- `sse.ts` 降至 500 行以内
- SSE 解析逻辑只有一份
- 重连逻辑只有一份
- 所有现有 SSE 测试通过
- 无功能回归
**影响范围**: packages/dashboard/src/api/sse.ts
**创建时间**: (自动填充)
**完成时间**: -

---
