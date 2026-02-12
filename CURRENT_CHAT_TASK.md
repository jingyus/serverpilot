### [pending] /confirm 端点缺少 Zod 请求体验证 — 可能接受畸形数据

**ID**: chat-017
**优先级**: P2
**模块路径**: packages/server/src/api/routes/chat.ts
**发现的问题**: `chat.ts:677` 使用 `c.req.json<{ confirmId: string; approved: boolean }>()` 读取请求体，仅有 TypeScript 类型断言无运行时验证。项目中其他所有 POST 端点都使用 `validateBody(ZodSchema)` 中间件。如果客户端发送 `{ confirmId: 123 }`（number 而非 string）或缺少 `approved` 字段，不会被拦截。`c.req.json()` 本身在非 JSON body 时会抛出未处理异常导致 500 错误（而非 400）。
**改进方案**: 
1. 定义 `ConfirmBodySchema = z.object({ confirmId: z.string(), approved: z.boolean() })`
2. 使用 `validateBody(ConfirmBodySchema)` 中间件替换手动 `c.req.json()`
3. 与项目其他端点保持一致的验证模式
**验收标准**: 
- 畸形 JSON 返回 400 而非 500
- 缺失字段返回具体的验证错误信息
- 类型不匹配（如 confirmId 为 number）被正确拒绝
- 新增测试覆盖验证失败场景
**影响范围**: packages/server/src/api/routes/chat.ts
**创建时间**: (自动填充)
**完成时间**: -

---
