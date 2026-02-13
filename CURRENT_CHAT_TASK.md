### [pending] Agentic 模式 serverProfile 类型为 unknown — 3 处 `as` 断言无运行时验证

**ID**: chat-096
**优先级**: P2
**模块路径**: packages/server/src/ai/
**发现的问题**: `AgenticRunOptions.serverProfile` (agentic-chat.ts:74) 类型为 `unknown`。在 `agentic-prompts.ts:53` 和 `58` 中通过 `as Parameters<typeof buildProfileContext>[0]` 断言使用，没有运行时类型检查。如果 `profileMgr.getProfile()` 返回了意外结构（例如 profile 版本升级后字段变化），`buildProfileContext` 可能在深层属性访问时抛出 TypeError，而此时已在 `buildFullSystemPrompt` 内部，错误消息不明确。profile 相关的 `as` 断言还出现在 `chat.ts:320` 的 legacy 模式中。
**改进方案**: 将 `serverProfile` 参数类型改为 `ServerProfile | null`（从 profile manager 导入具体类型），消除 `unknown` 和 `as` 断言。在 `agentic-prompts.ts` 入口做 null check 即可。
**验收标准**: (1) serverProfile 使用具体类型 (2) 消除 `as` 类型断言 (3) 类型安全无 `any` 逃逸 (4) 编译通过
**影响范围**: `packages/server/src/ai/agentic-chat.ts`, `packages/server/src/ai/agentic-prompts.ts`
**创建时间**: 2026-02-13
**完成时间**: -

---
