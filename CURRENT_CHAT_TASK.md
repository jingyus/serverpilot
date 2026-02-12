### [pending] Chat.tsx EmptyState suggestion cards 无防重复点击 — 快速点击发送多条消息

**ID**: chat-059
**优先级**: P1
**模块路径**: packages/dashboard/src/pages/Chat.tsx
**发现的问题**: Chat.tsx 第 433-445 行的 EmptyState 组件中，suggestion cards 的 `onClick={() => onSuggestionClick(suggestion)}` 没有任何防抖或禁用逻辑。点击后 `onSuggestionClick` 调用 `sendMessage()`，但在 isStreaming 状态更新并触发重渲染之前（React 批量更新机制），用户可以再次点击另一个 card，导致发送第二条消息并立即 abort 第一个 SSE 连接。
**改进方案**: (1) 在 EmptyState 组件中接收 `isStreaming` prop，当 `isStreaming` 为 true 时给 cards 添加 `pointer-events-none opacity-50` 样式; (2) 或在 sendMessage 中增加重入保护（与 chat-058 合并处理）。
**验收标准**: (1) 点击 suggestion card 后其他 cards 立即变为不可点击状态; (2) 不会发送重复消息
**影响范围**: packages/dashboard/src/pages/Chat.tsx
**创建时间**: (自动填充)
**完成时间**: -

---
