### [pending] SSE token 刷新无去重保护 — 并发 401 可能引发 token 轮换冲突

**ID**: chat-013
**优先级**: P1
**模块路径**: packages/dashboard/src/api/sse.ts
**发现的问题**: `sse.ts:28-47` 的 `tryRefreshToken()` 独立于 `client.ts:52-82` 的 `refreshAccessToken()`，后者有 `refreshPromise` 去重机制防止并发刷新，但 SSE 版本没有。如果 Chat SSE 和 Metrics SSE 同时遇到 401，两者各自调用 `tryRefreshToken()`，向服务端发送两次 refresh 请求。如果服务端实现了 refresh token 轮换（首次使用后失效），第二次请求会失败，导致用户被强制登出。
**改进方案**: 
1. 将 `sse.ts` 的 `tryRefreshToken()` 替换为调用 `client.ts` 的 `refreshAccessToken()` + 去重逻辑
2. 或将 token 刷新逻辑提取到独立的 `auth.ts` 模块，SSE 和 API 客户端共用
3. 确保任意时刻只有一个 refresh 请求在 flight
**验收标准**: 
- 多个 SSE 连接同时 401 时只发送一次 refresh 请求
- refresh 成功后所有等待者拿到新 token
- refresh 失败后所有等待者收到 null
- 新增测试覆盖并发 refresh 场景
**影响范围**: packages/dashboard/src/api/sse.ts, packages/dashboard/src/api/client.ts
**创建时间**: (自动填充)
**完成时间**: -

---
