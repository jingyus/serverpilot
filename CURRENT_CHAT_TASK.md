### [pending] Chat 页面无 ErrorBoundary — 消息数据异常导致整页崩溃

**ID**: chat-089
**优先级**: P1
**模块路径**: packages/dashboard/src/pages/
**发现的问题**: `Chat.tsx` 中的 Virtuoso 消息列表（行 263-300）没有 React ErrorBoundary 保护。如果某条消息的 `content` 为 null/undefined（虽然 Zod schema 定义为 string，但从服务器加载历史消息可能出现数据不一致），或 `MarkdownRenderer` 遇到无法解析的 markdown（react-markdown 内部抛出），整个 Chat 页面会白屏。`MessageListFooter` 中的 `stripJsonPlan` (行 355) 对 null 输入也没有防御。用户只能刷新页面重试。
**改进方案**: 在 Virtuoso 外层包裹一个 `ChatErrorBoundary` 组件，捕获渲染错误后显示友好的错误提示（"对话加载出错，请刷新重试"），并提供"新建会话"按钮。
**验收标准**: (1) 消息渲染错误被 ErrorBoundary 捕获 (2) 显示友好错误提示而非白屏 (3) 提供刷新/新建会话操作 (4) 新增测试验证错误恢复
**影响范围**: `packages/dashboard/src/pages/Chat.tsx`, 可选新增 `packages/dashboard/src/components/chat/ChatErrorBoundary.tsx`
**创建时间**: 2026-02-13
**完成时间**: -

---
