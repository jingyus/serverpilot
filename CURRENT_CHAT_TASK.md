### [pending] agentic-prompts.ts 零测试覆盖 — buildFullSystemPrompt 的 RAG/Profile 集成逻辑无验证

**ID**: chat-087
**优先级**: P1
**模块路径**: packages/server/src/ai/
**发现的问题**: `agentic-prompts.ts`（91 行）完全没有测试文件。该文件包含 `buildAgenticSystemPrompt()`（系统提示词）和 `buildFullSystemPrompt()`（组合 profile + RAG + 基础提示词），后者在 `agentic-chat.ts:136` 被调用，是 agentic 模式的核心入口。`buildFullSystemPrompt` 中有 RAG 搜索（行 64-77）和 profile 上下文构建（行 51-60），错误时静默降级，这些分支完全没有测试覆盖。`serverProfile` 的 `as Parameters<typeof buildProfileContext>[0]` 类型断言（行 53, 58）也没有运行时验证。
**改进方案**: 新增 `agentic-prompts.test.ts`，覆盖：(1) 无 profile 无 RAG 时返回基础提示词 (2) 有 profile 时包含 profile 上下文 (3) 有 RAG 结果时包含知识上下文 (4) RAG 异常时降级到无知识上下文 (5) 组合场景 profile + caveats + knowledge
**验收标准**: (1) 新增测试文件覆盖 5+ 个场景 (2) 行覆盖率达到 90%+ (3) mock RAG pipeline 和 profile builder
**影响范围**: 新增 `packages/server/src/ai/agentic-prompts.test.ts`
**创建时间**: 2026-02-13
**完成时间**: -

---
