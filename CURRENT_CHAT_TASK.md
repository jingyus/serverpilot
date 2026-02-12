### [pending] Legacy 模式 RAG 搜索异常未捕获 — ragPipeline.search() 可能抛出未处理错误

**ID**: chat-052
**优先级**: P0
**模块路径**: packages/server/src/api/routes/chat.ts
**发现的问题**: chat.ts 第 208-216 行的 RAG 搜索逻辑没有 try/catch 包裹。`ragPipeline.search(body.message!)` 如果抛出异常（如向量存储损坏、内存不足），错误会直接传播到上层 try/catch（第 202-314 行），导致整个 AI 对话请求失败，用户看到通用错误消息而非优雅降级。对比 agentic-chat.ts 第 656-669 行有完整的 try/catch 包裹 RAG 搜索，这里是遗漏。
**改进方案**: 为 RAG 搜索添加 try/catch，失败时记录 warn 日志并继续执行（knowledgeContext 保持 undefined），实现与 agentic 模式一致的优雅降级。
**验收标准**: (1) RAG 搜索失败不阻断 AI 对话; (2) 失败时有 warn 级别日志; (3) 对话正常继续（无知识库上下文）; (4) 单元测试覆盖 RAG 异常场景
**影响范围**: packages/server/src/api/routes/chat.ts
**创建时间**: (自动填充)
**完成时间**: -

---
