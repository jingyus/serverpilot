### [pending] batch-executor.ts 单元测试

**ID**: skill-067
**优先级**: P2
**模块路径**: packages/server/src/core/skill/batch-executor.test.ts (新)
**当前状态**: `batch-executor.ts`（144 行）是唯一没有对应测试文件的核心 Skill 模块。`skill-integration.test.ts` 可能有部分覆盖，但无独立的单元测试。
**实现方案**: 
1. 创建 `batch-executor.test.ts`
2. mock `getServerRepository()` 返回不同数量的服务器
3. 测试用例：
   - scope='all' 正常执行 3 台服务器
   - scope='all' 空服务器列表返回空结果
   - 部分服务器失败不影响其余服务器
   - 单台服务器异常被正确 catch 并记录
   - successCount/failureCount 计数正确
   - batchId 唯一性
4. 使用 vi.fn() mock `executeSingleFn` 回调
**验收标准**: 
- 至少 8 个测试用例
- 覆盖成功、失败、部分失败、空列表所有路径
- mock 模式与 skill-integration.test.ts 一致
**影响范围**: packages/server/src/core/skill/batch-executor.test.ts (新)
**创建时间**: (自动填充)
**完成时间**: -
