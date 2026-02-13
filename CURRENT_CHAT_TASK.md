### [pending] chat store clearError 未重置 isReconnecting 标志 — 关闭错误后可能显示过时的重连状态

**ID**: chat-063
**优先级**: P2
**模块路径**: packages/dashboard/src/stores/chat.ts
**发现的问题**: chat.ts（store）第 180 行 `clearError: () => set({ error: null })` 只清除 error 状态，不重置 `isReconnecting`。如果 SSE 连接在重连过程中触发错误（如达到最大重连次数），UI 会同时显示错误提示和 "Reconnecting..." 状态栏。用户点击 dismiss 关闭错误提示后，isReconnecting 仍为 true，重连状态栏继续显示。
**改进方案**: `clearError` 中同时重置 `isReconnecting: false`。
**验收标准**: (1) 关闭错误提示后不再显示重连状态; (2) 测试验证 clearError 后 isReconnecting 为 false
**影响范围**: packages/dashboard/src/stores/chat.ts
**创建时间**: (自动填充)
**完成时间**: -

---
