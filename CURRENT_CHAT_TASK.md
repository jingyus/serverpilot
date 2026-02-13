### [pending] Execute 路由 profileMgr.getProfile 异常未被 SSE 流捕获 — 抛出时流未初始化

**ID**: chat-065
**优先级**: P2
**模块路径**: packages/server/src/api/routes/chat.ts
**发现的问题**: chat.ts 第 394-395 行 `const serverProfile = await profileMgr.getProfile(serverId, userId)` 在 `streamSSE()` 回调内部但在 `executePlanSteps()` 之前调用。如果 profile 加载失败（如数据库连接断开），异常会从 streamSSE 回调中抛出，Hono 的 streamSSE 会将其作为 500 错误返回，但此时客户端可能已经建立了 SSE 连接并在等待事件。客户端会看到连接突然关闭而非收到明确的错误事件。
**改进方案**: 将 profile 加载包裹在 try/catch 中，失败时通过 SSE 发送 complete 事件（success: false, error: 'profile load failed'），然后正常结束流。
**验收标准**: (1) profile 加载失败时客户端收到明确的 SSE 错误事件; (2) 不再看到无提示的连接断开; (3) 测试覆盖 profile 加载失败场景
**影响范围**: packages/server/src/api/routes/chat.ts
**创建时间**: (自动填充)
**完成时间**: -
