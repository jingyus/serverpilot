### [pending] Token 估算对中文内容偏差 4 倍 — 可能导致上下文溢出或 AI 请求失败

**ID**: chat-012
**优先级**: P1
**模块路径**: packages/server/src/ai/profile-context.ts, packages/server/src/core/session/manager.ts
**发现的问题**: `profile-context.ts:54` 使用 `CHARS_PER_TOKEN = 4` 作为全局 token 估算比率。这对英文文本合理（约 4 字符/token），但本项目 AI 系统提示要求用中文回复（agentic-chat.ts:672），中文文本实际约 1-2 字符/token。这意味着 `buildContextWithLimit(sessionId, 8000)` 实际可能放入 32000 真实 token；`buildHistoryWithLimit(sessionId, 40000)` 可能放入 160000 真实 token，远超模型限制。`estimateTokens()` 在 `manager.ts:260` 和 `manager.ts:322` 被用于上下文裁剪决策。
**改进方案**: 
1. 改进 `estimateTokens()` 函数，检测文本中的非 ASCII 字符比例
2. 对于高 CJK 比例文本使用 `CHARS_PER_TOKEN = 1.5`；纯英文使用 `CHARS_PER_TOKEN = 4`；混合文本加权平均
3. 或引入轻量级 tokenizer 库（如 `tiktoken` 的 WASM 版本）做精确计算
4. 保持 `estimateTokens()` 的接口不变，仅改进内部实现
**验收标准**: 
- 中文对话 100 轮后不会因 token 溢出导致 AI 请求 400 错误
- `estimateTokens('你好世界')` 返回值在 3-5 之间（而非当前的 1）
- 英文估算精度不变
- 新增测试覆盖中文、英文、混合文本场景
**影响范围**: packages/server/src/ai/profile-context.ts, packages/server/src/core/session/manager.ts
**创建时间**: (自动填充)
**完成时间**: -

---
