### [pending] Chat.tsx 超过 500 行软限制 — 631 行应提取子组件

**ID**: chat-061
**优先级**: P2
**模块路径**: packages/dashboard/src/pages/Chat.tsx
**发现的问题**: Chat.tsx 当前 631 行，超出 500 行软限制 131 行。文件在同一个文件中定义了 4 个组件：(1) ChatPage 主组件（第 1-356 行）; (2) ChatHeader（第 357-401 行，45 行）; (3) EmptyState（第 403-449 行，47 行）; (4) ServerSelector（第 451-499 行，49 行）; (5) SessionSidebar（第 516-631 行，115 行）。以及一个工具函数 getSessionDateGroup（第 501-514 行）。
**改进方案**: 将以下组件提取到 `packages/dashboard/src/components/chat/` 目录：(1) `ChatHeader.tsx`; (2) `ChatEmptyState.tsx`; (3) `ServerSelector.tsx`; (4) `SessionSidebar.tsx`（含 getSessionDateGroup 工具函数）。主文件只保留 ChatPage 主组件和路由逻辑。
**验收标准**: (1) Chat.tsx 降至 400 行以内; (2) 各子组件文件不超过 150 行; (3) 所有现有测试通过; (4) UI 行为和渲染不变
**影响范围**: packages/dashboard/src/pages/Chat.tsx, 新文件 ChatHeader.tsx, ChatEmptyState.tsx, ServerSelector.tsx, SessionSidebar.tsx
**创建时间**: (自动填充)
**完成时间**: -

---
