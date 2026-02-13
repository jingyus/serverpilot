### [pending] 并发 401 响应触发多次 auth:logout 事件 — 可能导致多次路由跳转

**ID**: chat-100
**优先级**: P3
**模块路径**: packages/dashboard/src/api/
**发现的问题**: `apiRequest()` (client.ts:83-88) 在持久化 401 时清除 token 并 dispatch `auth:logout` CustomEvent。如果多个请求同时收到 401（例如 token 过期后页面初始化时并发发出 fetchServers + fetchSessions + fetchNotifications），每个请求都会独立执行 `localStorage.removeItem` 和 `dispatchEvent(new CustomEvent('auth:logout'))`。多个 logout 事件可能导致：(1) React Router `navigate('/login')` 被多次调用 (2) 已清除的 token 被第二个请求再次尝试刷新（浪费请求）。虽然目前没有可观察的 bug，但是资源浪费。
**改进方案**: 使用模块级 flag 如 `let logoutDispatched = false`，确保只 dispatch 一次 logout 事件。在 `refreshAccessToken` 成功后重置 flag。或者用 `requestIdleCallback` 去重。
**验收标准**: (1) 并发 401 只触发一次 logout (2) token 刷新成功后恢复正常 (3) 现有测试通过
**影响范围**: `packages/dashboard/src/api/client.ts`
**创建时间**: 2026-02-13
**完成时间**: -
