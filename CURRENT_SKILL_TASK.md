### [pending] skill-repository.ts 拆分 — InMemory 实现移至独立文件

**ID**: skill-092
**优先级**: P1
**模块路径**: packages/server/src/db/repositories/
**当前状态**: skill-repository.ts 已达 740 行 (92% 容量)，包含 Interface + DrizzleSkillRepository + InMemorySkillRepository + Stats 计算 + 单例管理。随功能增长将超 800 行限制。
**实现方案**: 
1. 提取 `InMemorySkillRepository` 类到 `skill-repository-memory.ts` (~220 行)
2. 提取 `computeStats()` 共享逻辑到 `skill-repository-stats.ts` (~70 行)
3. skill-repository.ts 只保留: Interface + DrizzleSkillRepository + 单例管理 (~450 行)
4. 更新所有 test 文件的 import 路径 (InMemory 从新文件导入)
**验收标准**: 
- skill-repository.ts 降至 ≤500 行
- InMemorySkillRepository 可独立导入
- 所有 repository 测试继续通过
**影响范围**: packages/server/src/db/repositories/skill-repository.ts (拆分), 新建 skill-repository-memory.ts, skill-repository-stats.ts
**创建时间**: 2026-02-13
**完成时间**: -

---
