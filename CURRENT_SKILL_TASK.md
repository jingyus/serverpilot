### [pending] Skill 版本升级 — engine.ts 添加 upgrade() 方法保留配置和执行历史

**ID**: skill-072
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: 升级 Skill 需要手动卸载再重新安装，卸载会级联删除执行历史和配置。`engine.ts` 无 `upgrade()` 方法，`git-installer.ts` 检测到目标目录存在时直接抛错。
**实现方案**: 
1. 在 `engine.ts` 添加 `upgrade(skillId: string, userId: string): Promise<InstalledSkill>` 方法:
   - 读取当前 skill 的 source/skillPath/config
   - 如果 source 是 git: 备份旧目录 → git clone 新版本到临时目录 → 验证 manifest → 替换旧目录 → 还原 config
   - 如果 source 是 local: 重新加载 skillPath 的 manifest → 更新 DB version/displayName
   - 保留 installed_skills 记录（更新 version, updatedAt），不删除 skill_executions
   - 暂停触发器 → 升级 → 重新注册触发器
2. 在 `git-installer.ts` 添加 `upgradeFromGitUrl(existingPath, gitUrl)` — clone 到临时目录 → 校验 → 原子替换
3. 对应测试: upgrade 成功保留配置、upgrade 失败回滚、version 变更验证
**验收标准**: 
- `engine.upgrade()` 方法可用，保留执行历史和用户配置
- Git 来源的 skill 支持原子升级（失败回滚）
- Local 来源的 skill 支持热加载新 manifest
- 测试覆盖: ≥12 个测试用例
**影响范围**: packages/server/src/core/skill/engine.ts, packages/server/src/core/skill/git-installer.ts, packages/server/src/core/skill/engine.test.ts (或新建 engine-upgrade.test.ts)
**创建时间**: 2026-02-13
**完成时间**: -

---
