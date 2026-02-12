### [pending] SSE 流关闭后服务端 executePlanSteps 继续执行 — 浪费资源

**ID**: chat-029
**优先级**: P2
**模块路径**: packages/server/src/api/routes/chat-execution.ts
**发现的问题**: `chat-execution.ts:271-272` 中 `stream.writeSSE().catch(() => {})` 静默吞没写入错误。当客户端断开连接（关闭浏览器、网络断开）后，SSE stream 的所有 write 都会失败，但 `executePlanSteps` 的 for 循环（行 276-421）仍继续执行每个 step：调用 `executor.executeCommand()`、`auditLogger.log()`、`autoDiagnoseStepFailure()` 等。一个 5 步 plan，每步 30 秒超时，可能在客户端断开后白白执行 2.5 分钟。同样，`agentic-chat.ts:330` 的 `writeSSE().catch(() => {})` 也有此问题——AI 循环继续调用 Anthropic API（每次约 $0.01-0.05），浪费 API 费用。
**改进方案**: 
1. 在 `writeSSE` catch 中设置一个 `streamClosed = true` 标志
2. 在 step 循环的每次迭代开头检查 `if (streamClosed) break`
3. 或使用 Hono 的 `stream.onAbort(() => { aborted = true })` 回调
4. 对 agentic engine 同理：writeSSE 失败后设置标志，在 turn 循环中检查
**验收标准**: 
- 客户端断开后服务端在当前 step 完成后停止执行后续步骤
- Agentic 循环在 stream 关闭后停止调用 Anthropic API
- 审计日志记录"execution aborted: client disconnected"
- 新增测试：模拟 stream 关闭后验证执行中止
**影响范围**: packages/server/src/api/routes/chat-execution.ts, packages/server/src/ai/agentic-chat.ts
**创建时间**: (自动填充)
**完成时间**: -

---
