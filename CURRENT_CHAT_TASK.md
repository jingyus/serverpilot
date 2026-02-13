### [pending] 前端会话列表无分页 — SessionSidebar 无法加载超过 100 个历史会话

**ID**: chat-083
**优先级**: P0
**模块路径**: packages/dashboard/src/
**发现的问题**: `createFetchSessions()` (chat-sessions.ts:20-34) 只发一次 GET 请求无分页参数，`SessionSidebar.tsx` 没有"加载更多"或滚动加载机制。依赖 chat-082 完成后的分页 API。
**改进方案**: `fetchSessions` 改为支持分页，首次加载最近 50 个，滚动到底部触发 `loadMoreSessions`。`sessions` 数组采用追加模式（不覆盖已加载的）。`SessionSidebar` 底部增加 `IntersectionObserver` 触发加载。
**验收标准**: (1) 初次加载 50 个会话 (2) 滚动到底部自动加载下一批 (3) 全部加载完毕后不再请求 (4) 加载中显示 spinner
**影响范围**: `packages/dashboard/src/stores/chat-sessions.ts`, `packages/dashboard/src/components/chat/SessionSidebar.tsx`
**创建时间**: 2026-02-13
**完成时间**: -

---
