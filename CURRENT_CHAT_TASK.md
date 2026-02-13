### [pending] apiRequest 无请求超时 — 挂起的网络请求永远阻塞 UI

**ID**: chat-097
**优先级**: P2
**模块路径**: packages/dashboard/src/api/
**发现的问题**: `apiRequest<T>()` (client.ts) 使用原生 `fetch()` 无 `AbortController` 超时设置。当网络异常（如 DNS 解析挂起、服务器不响应）时，请求永远等待。特别影响 Chat 功能中的非 SSE 请求：`respondToStep` (POST /step-decision)、`respondToAgenticConfirm` (POST /confirm)、`deleteSession` (DELETE)、`renameSession` (PATCH) 等操作会因挂起请求导致按钮永远 loading。SSE 连接不受影响（有自己的 AbortController）。
**改进方案**: 在 `apiRequest` 中添加可选的 `timeout` 参数（默认 30s），使用 `AbortController` + `setTimeout` 实现。超时后抛出特定错误 `ApiTimeoutError`。
**验收标准**: (1) 请求 30s 超时自动取消 (2) 超时错误消息友好 (3) 支持自定义超时时间 (4) SSE 不受影响
**影响范围**: `packages/dashboard/src/api/client.ts`
**创建时间**: 2026-02-13
**完成时间**: -

---
