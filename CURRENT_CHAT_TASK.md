### [pending] SSE 事件 JSON 解析错误全部静默吞没 — 开发调试和生产排错极其困难

**ID**: chat-011
**优先级**: P1
**模块路径**: packages/dashboard/src/stores/chat.ts
**发现的问题**: `chat.ts` 中所有 SSE 回调（onAutoExecute:246, onStepStart:316, onStepComplete:382, onOutput:370, onConfirmRequired:550, onConfirmId:561, onToolCall:520, onToolResult:534 等）统一使用 `catch { /* ignore */ }` 吞没 JSON 解析错误。如果服务端发送格式变更或损坏的数据，前端完全无感知，用户看到的是莫名的 UI 停滞（按钮不出现、输出不更新）而不是错误信息。
**改进方案**: 
1. 将 `catch { /* ignore */ }` 替换为 `catch (e) { console.warn('[SSE] Failed to parse event:', eventName, e); }`
2. 生产环境保持不抛异常（保证 SSE 流继续），但记录到 console.warn
3. 可选：添加 SSE 事件解析错误计数器，超过阈值时在 UI 显示 "部分数据解析失败" 提示
**验收标准**: 
- 浏览器控制台能看到 SSE 解析失败的 warn 日志，包含事件名和原始数据
- SSE 流不因解析错误中断
- 不影响正常流程的行为
**影响范围**: packages/dashboard/src/stores/chat.ts
**创建时间**: (自动填充)
**完成时间**: -

---
