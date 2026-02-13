### [pending] 前端长消息列表无虚拟滚动 — 500+ 条消息时滚动性能严重下降

**ID**: chat-076
**优先级**: P2
**模块路径**: packages/dashboard/src/pages/
**发现的问题**: `Chat.tsx` 消息列表使用简单的 `messages.map()` 渲染所有消息到 DOM。每条消息包含 `ChatMessage` 组件，assistant 消息还会触发 `MarkdownRenderer`（react-markdown + syntax highlighter）。当会话有 200+ 条消息时：(1) 初始渲染时间线性增长；(2) 每次新消息触发整个列表 re-render；(3) 所有代码块的 syntax highlighting 同时计算。`chat-sessions.ts:42-44` 的 `loadSession` 也一次性加载全部消息无分页。参考 ChatGPT：使用虚拟滚动只渲染可视区域 + 上下缓冲区的消息。
**改进方案**:
1. 引入 `react-virtuoso` 库实现虚拟滚动（专为 chat UI 设计，支持反向滚动和动态高度）
2. 替换 `messages.map()` 为 `<Virtuoso data={messages} itemContent={renderMessage} />`
3. 保留现有自动滚动逻辑（Virtuoso 内置 `followOutput` prop）
4. ChatMessage 组件添加 `React.memo` 避免不必要的 re-render
**验收标准**:
- 500 条消息的会话加载和滚动流畅（FPS > 30）
- 自动滚动到底部行为不变
- 流式消息输出时滚动平滑
- 现有 Chat.test.tsx 测试通过
**影响范围**:
- `packages/dashboard/src/pages/Chat.tsx` — 消息列表虚拟化
- `packages/dashboard/src/components/chat/ChatMessage.tsx` — 添加 React.memo
- `packages/dashboard/package.json` — 添加 react-virtuoso 依赖
**创建时间**: 2026-02-13
**完成时间**: -

---
