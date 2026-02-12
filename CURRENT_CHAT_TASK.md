### [pending] SSE 连接无自动重连 — 网络抖动导致 Chat 流式响应永久中断

**ID**: chat-004
**优先级**: P1
**模块路径**: packages/dashboard/src/api/sse.ts, packages/dashboard/src/stores/chat.ts
**发现的问题**:
Chat SSE 连接 (`createSSEConnection()` at sse.ts:82-137) 没有任何重连机制。对比同文件中的 `createMetricsSSE()` (sse.ts:158-271) 和 `createServerStatusSSE()` (sse.ts:291-398) 都有完整的自动重连（指数退避、`scheduleReconnect()`），但 Chat SSE 完全没有。

具体问题：
1. `sse.ts:128` — `while (true)` reader 循环结束后直接返回，不尝试重连
2. `sse.ts:129-134` — catch 块只调用 `callbacks.onError?.(error)`，然后结束
3. `chat.ts:560-569` — `onError` 回调直接设置 `isStreaming: false`，丢弃所有已接收的流式内容
4. 如果网络短暂断开（WiFi 切换、VPN 重连），正在进行的 AI 回复直接丢失，用户需要重新发送消息
5. 更严重的是：如果在执行阶段断开，SSE 断了但服务器端命令仍在执行，用户无法看到结果也无法取消

**改进方案**:
1. 为 `createSSEConnection()` 添加重连逻辑（参考同文件的 Metrics SSE 实现）
2. 重连时携带 sessionId，服务端支持从断点续传（或至少返回错过的事件）
3. `onError` 回调区分可重连错误（网络）和不可重连错误（401、404）
4. 添加 `onReconnecting` / `onReconnected` 回调，让 UI 显示重连状态
5. 在 chat store 中，网络中断时保留已收到的 `streamingContent`，重连后继续追加

**验收标准**:
- 网络短暂中断（<30s）后 SSE 自动恢复
- 重连过程中 UI 显示 "重连中" 提示
- 已收到的流式内容不丢失
- 401 错误不无限重连（走 token 刷新流程）
- 新增测试覆盖：重连成功、重连失败、401 不重连

**影响范围**:
- `packages/dashboard/src/api/sse.ts` — 核心修改
- `packages/dashboard/src/stores/chat.ts` — 错误处理调整
- `packages/dashboard/src/pages/Chat.tsx` — 可选：显示重连状态

**创建时间**: 2026-02-12
**完成时间**: -

---
