### [pending] token-counting.ts 7 处 `any` 类型 — TypeScript strict 模式下的类型安全漏洞

**ID**: chat-042
**优先级**: P2
**模块路径**: packages/server/src/ai/token-counting.ts
**发现的问题**: 第 72、110、139、156、192、354、373 行共 7 处使用 `any` 类型参数。例如 `extractClaudeTokens(response: any)` — 调用方可传入任意值（string、null、undefined）且编译器不会报错。`isValidTokenUsage(usage: any)` 和 `safeTokenUsage(usage: any)` 是 type guard 函数但用 `any` 入参，丧失了 TypeScript 的类型收窄优势。
**改进方案**: 1) 将所有 `any` 改为 `unknown` 2) 在函数体内使用类型收窄（`typeof`/`in` 检查）访问属性 3) 对 `isValidTokenUsage` 使用 `is` 类型谓词 `(usage: unknown): usage is TokenUsage` 4) 所有 extract 函数入参改为 `unknown`。
**验收标准**: 1) token-counting.ts 零 `any` 类型 2) 所有函数使用 `unknown` + 运行时类型收窄 3) 现有测试全部通过 4) TypeScript strict 无新增错误
**影响范围**: `packages/server/src/ai/token-counting.ts`
**创建时间**: (自动填充)
**完成时间**: -

---
