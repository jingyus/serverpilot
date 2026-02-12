### [pending] server_scope: 'tagged' 优雅降级替代硬错误

**ID**: skill-063
**优先级**: P1
**模块路径**: packages/server/src/core/skill/batch-executor.ts
**当前状态**: `batch-executor.ts` 第 59-62 行 `server_scope: 'tagged'` 时直接 `throw new Error()`，导致整个 Skill 执行失败。应改为优雅降级到单服务器模式。
**实现方案**: 
1. 将 `throw new Error(...)` 替换为 `logger.warn(...)` 日志警告
2. 当 scope 为 `tagged` 时，回退到 `params.serverId` 单服务器执行
3. 在返回的 `BatchExecutionResult` 中添加 `warnings?: string[]` 字段，记录降级信息
4. 更新 `types.ts` 中 `BatchExecutionResult` 类型定义
5. 创建 `batch-executor.test.ts` 测试文件，覆盖 scope='all'、scope='tagged' 降级、空服务器列表、部分失败等场景
**验收标准**: 
- `server_scope: 'tagged'` 不再抛出异常
- 降级时产生 warning 日志 + 返回 warnings 数组
- 回退到 `params.serverId` 单服务器执行并成功完成
- `batch-executor.test.ts` 至少 8 个测试用例
**影响范围**: packages/server/src/core/skill/batch-executor.ts, packages/server/src/core/skill/types.ts, packages/server/src/core/skill/batch-executor.test.ts (新)
**创建时间**: (自动填充)
**完成时间**: -

---
