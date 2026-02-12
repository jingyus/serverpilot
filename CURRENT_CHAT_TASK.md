### [pending] common-errors.ts 超出 800 行硬限制 — 853 行需要拆分

**ID**: chat-054
**优先级**: P0
**模块路径**: packages/server/src/ai/common-errors.ts
**发现的问题**: common-errors.ts 当前 853 行，超出 800 行硬限制 53 行。文件主要由 ERROR_RULES 纯数据数组（约 600 行）和匹配函数（约 150 行）组成。虽然 MEMORY.md 提到"pure data, exceeds 500 soft limit but acceptable"，但现在已经超过 800 行硬限制，不再 acceptable。
**改进方案**: 按错误类别拆分 ERROR_RULES 数据：(1) `error-rules-permission.ts` — 权限类规则; (2) `error-rules-network.ts` — 网络类规则; (3) `error-rules-dependency.ts` — 依赖和构建类规则; (4) `common-errors.ts` 保留类型定义、匹配函数、以及合并后的 ERROR_RULES 导出。或者更简洁地：将整个 ERROR_RULES 数组提取到 `error-rules-data.ts`，主文件只保留函数。
**验收标准**: (1) common-errors.ts 降至 300 行以内; (2) 数据文件可超 500 行但不超 800 行; (3) `matchCommonErrors()`、`getBestMatch()` 等函数行为不变; (4) 所有测试通过
**影响范围**: packages/server/src/ai/common-errors.ts, 新文件(s)
**创建时间**: (自动填充)
**完成时间**: -

---
