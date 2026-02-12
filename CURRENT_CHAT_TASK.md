### [pending] 前端 sendMessage 无重入保护 — 快速连续发送导致重复消息

**ID**: chat-058
**优先级**: P1
**模块路径**: packages/dashboard/src/stores/chat.ts
**发现的问题**: chat.ts（store）第 60-97 行的 `sendMessage()` 没有重入保护。虽然第 90 行会 `getActiveHandle()?.abort()` 中止前一个 SSE 连接，但第 74-88 行的 `set()` 调用会立即将新的 userMsg 追加到 messages 数组。如果用户快速点击两次发送（在 isStreaming 状态更新导致按钮禁用之前），两条用户消息都会被添加到 messages 中，并且第一个 SSE 连接被中止后，第二个连接的 onMessage 回调仍可能收到来自第一个请求的响应（因为服务端可能在 abort 信号到达前已开始流式输出）。
**改进方案**: 在 `sendMessage` 开头检查 `if (get().isStreaming) return;` 防止重入。或者在 MessageInput 组件层面在 isStreaming 为 true 时禁用发送（Chat.tsx 第 434-445 行的 suggestion cards 也需要同样处理）。
**验收标准**: (1) 快速连续点击不会发送重复消息; (2) isStreaming 期间发送操作被阻止; (3) suggestion cards 点击也受保护; (4) 测试覆盖快速连续发送场景
**影响范围**: packages/dashboard/src/stores/chat.ts, packages/dashboard/src/pages/Chat.tsx
**创建时间**: (自动填充)
**完成时间**: -

---
