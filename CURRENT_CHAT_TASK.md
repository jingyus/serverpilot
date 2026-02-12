### [pending] Agentic 循环不感知客户端断连 — writeSSE 静默吞错导致工具继续执行

**ID**: chat-034
**优先级**: P0
**模块路径**: packages/server/src/ai/agentic-chat.ts
**发现的问题**: `writeSSE()` 在第 662-672 行对所有写入错误静默 catch（`// Stream closed, ignore`）。虽然第 192 行有 `stream.onAbort` 设置 `streamAborted` 标志，但在 `run()` 的主循环中，只在循环开头（约第 219 行 `if (streamAborted) break`）检查此标志。如果断连发生在 `executeToolCall()` 执行中途（如长时间命令），AI 会继续在服务器上执行后续工具调用，浪费资源且无人接收结果。`streamAnthropicCall()` 内部也无断连检查。
**改进方案**: 1) 在 `executeToolCall` 每个 tool 方法开头检查 `streamAborted` 2) 在 `streamAnthropicCall` 中 token 回调时检查 `streamAborted` 并提前 abort Anthropic stream 3) `writeSSE` 检测到写入失败时主动设置 `streamAborted = true`（不依赖 onAbort 回调延迟）。
**验收标准**: 1) 客户端断连后 500ms 内停止所有工具调用 2) Anthropic API stream 也被中断（节省 token） 3) 新增 2+ 测试验证断连后循环终止
**影响范围**: `packages/server/src/ai/agentic-chat.ts`
**创建时间**: (自动填充)
**完成时间**: -

---
