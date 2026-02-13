### [pending] 前端执行输出 outputs 字符串拼接无上限 — 大量输出可能冻结浏览器

**ID**: chat-071
**优先级**: P1
**模块路径**: packages/dashboard/src/stores/
**发现的问题**: `chat-execution.ts:83` 和 `chat-execution.ts:368` 中 `onOutput` 回调将新内容拼接到 `execution.outputs[stepId]`：`(s.execution.outputs[parsed.stepId] ?? '') + parsed.content`。此字符串无任何长度限制。如果 agent 执行的命令产生大量输出（如 `find /` 或日志 tail），outputs 字符串可增长到数 MB 甚至更多。问题链：(1) 字符串拼接 O(n) 复杂度，每次 onOutput 都复制整个字符串；(2) `ExecutionLog.tsx:175` 将完整字符串传入 `parseAnsi()` 重新解析；(3) React 因 state 变化频繁 re-render 整个输出 DOM。100K+ 行输出时浏览器将明显卡顿或冻结。
**改进方案**:
1. 添加输出上限常量 `MAX_OUTPUT_CHARS = 500_000`（约 500KB）
2. 当 `outputs[stepId].length > MAX_OUTPUT_CHARS` 时，截断头部保留尾部
3. 截断时在输出开头插入 `[... 早期输出已截断，共 {N} 字符 ...]\n`
4. 优化 `parseAnsi` 调用：缓存已解析的部分，只解析新增内容（增量解析）
**验收标准**:
- 输出字符串不超过 MAX_OUTPUT_CHARS
- 截断时有用户可见提示
- 高频 onOutput（100次/秒）不导致 UI 卡顿
- 现有 execution 测试通过 + 新增截断测试
**影响范围**:
- `packages/dashboard/src/stores/chat-execution.ts` — onOutput 回调添加截断逻辑
- `packages/dashboard/src/stores/chat-execution.test.ts` — 新增测试
**创建时间**: 2026-02-13
**完成时间**: -

---
